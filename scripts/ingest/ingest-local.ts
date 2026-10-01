import "dotenv/config";
import { readFile, readdir } from "fs/promises";
import path from "path";
import { parseArgs } from "util";
import { and, eq } from "drizzle-orm";
import { PDFParse } from "pdf-parse";
import { db } from "../../lib/db/client";
import { chunks as chunksTable, type NewChunk } from "../../lib/db/schema";
import { embedTexts } from "../../lib/openai";
import { CA_CLASS } from "../../lib/subjects";
import { chunkText } from "./chunk";

// Ingests a folder of PDFs that only exist on the local machine (i.e. not
// downloadable from ncert.nic.in, so download-pdfs.ts can't fetch them)
// straight into the chunks table — extract, chunk, embed and insert in one
// pass, no intermediate data/ files.
//
//   npm run ingest:local -- --dir "C:\path\to\pdfs" --class CA --subject "Taxation"
//
// --class takes a school class number, or "CA" (stored as CA_CLASS).
//
// Each PDF becomes one chapter. The chapter title is the file name (minus
// extension and any leading "01 - " style numbering); the chapter number is
// that leading number if present, otherwise the file's position in
// natural sort order. Subfolders are walked recursively.

const EMBED_BATCH_SIZE = 100;

const { values: args } = parseArgs({
  options: {
    dir: { type: "string" },
    class: { type: "string" },
    subject: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

function usage(message: string): never {
  console.error(message);
  console.error(
    `\nUsage: npm run ingest:local -- --dir <pdf folder> --class <number|CA> --subject "<name>" [--dry-run]`
  );
  process.exit(1);
}

if (!args.dir) usage("Missing --dir");
if (!args.class || !/^(\d+|ca)$/i.test(args.class)) usage('Missing --class (a number, or "CA")');
if (!args.subject?.trim()) usage("Missing --subject");

const PDF_ROOT = path.resolve(args.dir);
const CLASS = args.class.toLowerCase() === "ca" ? CA_CLASS : Number(args.class);
const SUBJECT = args.subject.trim();
const DRY_RUN = args["dry-run"];

const LEADING_NUMBER_RE = /^\s*(?:chapter|ch|unit)?[\s._-]*(\d{1,3})(?:[\s._)-]+|$)/i;

// Same garbled-font check as extract-text.ts: pages extracted as mostly
// Private Use Area codepoints are unsearchable noise.
function isMostlyGarbled(text: string): boolean {
  const printable = text.replace(/[^\x20-\x7E]/g, "").length;
  return printable / text.length < 0.5;
}

// Lighter than extract-text.ts's cleanPageText: that one strips the first
// line of every page as an NCERT running header, which would eat real
// content in arbitrary PDFs. Here we only drop blank lines and bare page
// numbers, and undo letter-spaced headings ("T a x a t i o n").
function cleanPageText(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^\d+$/.test(line))
    .map((line) => {
      const tokens = line.split(" ");
      return tokens.length >= 4 && tokens.every((t) => t.length === 1) ? tokens.join("") : line;
    })
    .join("\n");
}

async function findPdfs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await findPdfs(full)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) found.push(full);
  }
  return found;
}

interface PlannedChapter {
  file: string;
  chapterNumber: number;
  title: string;
}

function planChapters(files: string[]): PlannedChapter[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const sorted = [...files].sort((a, b) =>
    collator.compare(path.relative(PDF_ROOT, a), path.relative(PDF_ROOT, b))
  );

  const planned = sorted.map((file, i) => {
    const base = path.basename(file, path.extname(file));
    const match = base.match(LEADING_NUMBER_RE);
    const stripped = match ? base.slice(match[0].length).trim() : base.trim();
    return {
      file,
      chapterNumber: match ? Number(match[1]) : i + 1,
      title: stripped || base.trim(),
    };
  });

  // Re-runs skip chapters by (class, subject, title), so titles must be
  // unique within the subject or a later file would be silently skipped.
  const seen = new Map<string, string>();
  for (const c of planned) {
    const prev = seen.get(c.title);
    if (prev) {
      usage(`Two PDFs map to the same chapter title "${c.title}":\n  ${prev}\n  ${c.file}\nRename one.`);
    }
    seen.set(c.title, c.file);
  }
  return planned;
}

async function extractPages(file: string): Promise<{ pageNumber: number; text: string }[]> {
  const parser = new PDFParse({ data: await readFile(file) });
  try {
    const result = await parser.getText();
    return result.pages
      .map((p) => ({ pageNumber: p.num, text: cleanPageText(p.text) }))
      .filter((p) => p.text.length > 0 && !isMostlyGarbled(p.text));
  } finally {
    await parser.destroy();
  }
}

async function loadAlreadyIngestedTitles(): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ chapter: chunksTable.chapter })
    .from(chunksTable)
    .where(and(eq(chunksTable.class, CLASS), eq(chunksTable.subject, SUBJECT)));
  return new Set(rows.map((r) => r.chapter));
}

async function ingestChapter(chapter: PlannedChapter): Promise<void> {
  const pages = await extractPages(chapter.file);
  if (pages.length === 0) {
    console.warn(`  WARNING: no extractable text (scanned/image-only PDF?) — skipped`);
    return;
  }

  type PendingChunk = Omit<NewChunk, "embedding">;
  const pending: PendingChunk[] = [];
  let chunkIndex = 0;
  for (const page of pages) {
    for (const content of chunkText(page.text)) {
      pending.push({
        class: CLASS,
        subject: SUBJECT,
        chapter: chapter.title,
        chapterNumber: chapter.chapterNumber,
        chunkIndex: chunkIndex++,
        content,
        pageNumber: page.pageNumber,
      });
    }
  }
  console.log(`  ${pages.length} pages -> ${pending.length} chunks`);
  if (DRY_RUN) return;

  const rows: NewChunk[] = [];
  for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
    const batch = pending.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedTexts(batch.map((b) => b.content));
    rows.push(...batch.map((b, j) => ({ ...b, embedding: embeddings[j] })));
    console.log(`  embedded ${Math.min(i + EMBED_BATCH_SIZE, pending.length)}/${pending.length}`);
  }

  // Insert the whole chapter in one transaction: a crash mid-chapter must
  // not leave a partial chapter behind, since re-runs skip any chapter
  // title that already has rows.
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += EMBED_BATCH_SIZE) {
      await tx.insert(chunksTable).values(rows.slice(i, i + EMBED_BATCH_SIZE));
    }
  });
  console.log(`  inserted`);
}

async function main() {
  const files = await findPdfs(PDF_ROOT);
  if (files.length === 0) usage(`No PDFs found under ${PDF_ROOT}`);

  const chapters = planChapters(files);
  const alreadyIngested = DRY_RUN ? new Set<string>() : await loadAlreadyIngestedTitles();

  console.log(
    `${DRY_RUN ? "[dry run] " : ""}Class ${CLASS} "${SUBJECT}": ${chapters.length} PDF(s) in ${PDF_ROOT}\n`
  );

  for (const chapter of chapters) {
    console.log(`Ch ${chapter.chapterNumber}: "${chapter.title}"  (${path.relative(PDF_ROOT, chapter.file)})`);
    if (alreadyIngested.has(chapter.title)) {
      console.log(`  already ingested — skipped`);
      continue;
    }
    await ingestChapter(chapter);
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
