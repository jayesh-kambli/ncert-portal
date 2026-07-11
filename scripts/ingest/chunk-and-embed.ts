import "dotenv/config";
import { readFile, readdir } from "fs/promises";
import path from "path";
import { sql } from "drizzle-orm";
import { db } from "../../lib/db/client";
import { chunks as chunksTable, type NewChunk } from "../../lib/db/schema";
import { embedTexts } from "../../lib/openai";
import { INGEST_TARGETS, TEXT_DIR } from "./config";
import { chunkText } from "./chunk";

interface ExtractedPage {
  pageNumber: number;
  text: string;
}

interface ExtractedChapter {
  chapterNumber: number;
  title: string;
  pages: ExtractedPage[];
}

const EMBED_BATCH_SIZE = 100;

const bookCodeToTarget = new Map<string, { class: number; subject: string }>();
for (const target of INGEST_TARGETS) {
  for (const bookCode of target.bookCodes) {
    bookCodeToTarget.set(bookCode, { class: target.class, subject: target.subject });
  }
}

interface LoadedChapter extends ExtractedChapter {
  bookCode: string;
  class: number;
  subject: string;
}

async function loadChapters(): Promise<LoadedChapter[]> {
  const files = (await readdir(TEXT_DIR)).filter((f) => f.endsWith(".json"));
  const chapters: LoadedChapter[] = [];

  for (const file of files) {
    const match = file.match(/^(.+?)(\d{2})\.json$/);
    if (!match) continue;
    const bookCode = match[1];
    const target = bookCodeToTarget.get(bookCode);
    if (!target) {
      console.warn(`skip ${file}: book code "${bookCode}" not found in INGEST_TARGETS`);
      continue;
    }

    const raw = await readFile(path.join(TEXT_DIR, file), "utf-8");
    const chapter: ExtractedChapter = JSON.parse(raw);
    chapters.push({ ...chapter, bookCode, class: target.class, subject: target.subject });
  }

  return chapters.sort(
    (a, b) => a.class - b.class || a.subject.localeCompare(b.subject) || a.chapterNumber - b.chapterNumber
  );
}

async function loadAlreadyIngestedChapters(): Promise<Set<string>> {
  const rows = await db
    .select({
      class: chunksTable.class,
      subject: chunksTable.subject,
      chapter: chunksTable.chapter,
    })
    .from(chunksTable)
    .groupBy(sql`${chunksTable.class}, ${chunksTable.subject}, ${chunksTable.chapter}`);
  return new Set(rows.map((r) => `${r.class}::${r.subject}::${r.chapter}`));
}

async function main() {
  const [allChapters, alreadyIngested] = await Promise.all([
    loadChapters(),
    loadAlreadyIngestedChapters(),
  ]);
  if (allChapters.length === 0) {
    throw new Error(
      `No extracted chapters found in ${TEXT_DIR}. Run 'npm run ingest:extract' first.`
    );
  }

  const chapters = allChapters.filter(
    (c) => !alreadyIngested.has(`${c.class}::${c.subject}::${c.title}`)
  );
  const skipped = allChapters.length - chapters.length;
  if (skipped > 0) {
    console.log(`Skipping ${skipped} already-ingested chapter(s).`);
  }
  if (chapters.length === 0) {
    console.log("Nothing new to ingest.");
    process.exit(0);
  }

  type PendingChunk = Omit<NewChunk, "embedding">;
  const pending: PendingChunk[] = [];

  for (const chapter of chapters) {
    let chunkIndex = 0;
    for (const page of chapter.pages) {
      for (const content of chunkText(page.text)) {
        pending.push({
          class: chapter.class,
          subject: chapter.subject,
          chapter: chapter.title,
          chapterNumber: chapter.chapterNumber,
          chunkIndex: chunkIndex++,
          content,
          pageNumber: page.pageNumber,
        });
      }
    }
  }

  console.log(`Prepared ${pending.length} chunks from ${chapters.length} chapters.`);

  for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
    const batch = pending.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedTexts(batch.map((b) => b.content));

    const rows: NewChunk[] = batch.map((b, j) => ({
      ...b,
      embedding: embeddings[j],
    }));

    await db.insert(chunksTable).values(rows);
    console.log(
      `embedded + inserted ${Math.min(i + EMBED_BATCH_SIZE, pending.length)}/${pending.length}`
    );
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
