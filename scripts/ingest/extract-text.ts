import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { PDFParse } from "pdf-parse";
import { PDF_DIR, TEXT_DIR } from "./config";

interface ExtractedPage {
  pageNumber: number;
  text: string;
}

interface ExtractedChapter {
  chapterNumber: number;
  title: string;
  pages: ExtractedPage[];
}

// Lines that repeat on (almost) every page and carry no content, e.g. the
// "Reprint 2026-27" watermark seen throughout NCERT PDFs.
const NOISE_LINE_PATTERNS = [/^reprint\s+\d{4}-\d{2}$/i, /^\s*\d+\s*$/];

// The running page header (e.g. "Science\t82" or "Life Processes 83") is
// always emitted as the first extracted line of a page's text — subject
// name or chapter title, followed by a page number, no punctuation.
const RUNNING_HEADER_RE = /^.{1,50}\s+\d{1,4}$/;

// Some decorative section-heading pages render the same heading multiple
// times as separate overlapping text layers, e.g.
// "5.3 RESPIRATION\t5.3 RESPIRATION\t5.3 RESPIRATION" — collapse to one copy.
function collapseRepeatedSegments(line: string): string {
  const parts = line.split("\t").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return line;
  const allSame = parts.every((p) => p === parts[0]);
  return allSame ? parts[0] : line;
}

// Decorative heading fonts sometimes get extracted with every character
// as its own space-separated token, e.g. "P o w e r - s h a r i n g"
// instead of "Power-sharing" — collapse runs of single-character tokens
// back into words.
function collapseLetterSpacing(line: string): string {
  const tokens = line.split(" ");
  if (tokens.length < 4) return line;
  if (!tokens.every((t) => t.length === 1)) return line;
  return tokens.join("");
}

function cleanPageText(raw: string): string {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length > 0 && RUNNING_HEADER_RE.test(lines[0])) {
    lines.shift();
  }

  return lines
    .map(collapseRepeatedSegments)
    .map(collapseLetterSpacing)
    .filter((line) => !NOISE_LINE_PATTERNS.some((p) => p.test(line)))
    .join("\n");
}

// NCERT chapter-opener pages render the "CHAPTER N" marker as a rotated
// sidebar label, so PDF text extraction can emit it either as "CHAPTER 1"
// or reversed as "1  CHAPTER" (tab-joined), and — because it's a separate
// text object — either before or after the actual title lines. We locate
// the marker line by number and pull the title from whichever adjacent
// lines look like a heading (short, no sentence-ending punctuation).
function extractTitle(firstPageLines: string[], chapterNumber: number): string {
  const markerRe = new RegExp(`^(chapter\\s*${chapterNumber}|${chapterNumber}\\s*chapter)$`, "i");
  const markerIndex = firstPageLines.findIndex((line) =>
    markerRe.test(line.replace(/\t/g, " ").replace(/\s+/g, " ").trim())
  );

  if (markerIndex === -1) {
    // Some books (e.g. newer NCF-aligned titles) don't render a distinct
    // "CHAPTER N" sidebar marker at all — their opener page just starts
    // with a short title line (sometimes wrapped across 2 lines), or
    // straight into body prose. Only trust leading lines as a title if
    // they look like standalone heading fragments (short, no
    // sentence-ending punctuation); otherwise fall back rather than risk
    // grabbing a sentence fragment as the "title".
    const isTitleFragment = (line: string) => {
      const cleaned = line.replace(/\t\d{1,4}$/, "").trim();
      // Real chapter titles in these books run short (~15-25 chars); a
      // wrapped sentence fragment can coincidentally avoid ending
      // punctuation but tends to run longer before it wraps.
      return cleaned.length > 0 && cleaned.length < 45 && !/[.,;:?!]$/.test(cleaned);
    };

    const collected: string[] = [];
    for (let i = 0; i < Math.min(2, firstPageLines.length); i++) {
      if (!isTitleFragment(firstPageLines[i])) break;
      collected.push(firstPageLines[i].replace(/\t\d{1,4}$/, "").trim());
    }

    return collected.length > 0 ? collected.join(" ") : `Chapter ${chapterNumber}`;
  }

  // Running header: subject name + page number, e.g. "Mathematics\t58".
  // Same shape as RUNNING_HEADER_RE, kept separate since here we only
  // want to exclude it from *title* candidates, not strip it from content.
  const isRunningHeader = (line: string) => RUNNING_HEADER_RE.test(line.trim());
  // Sidebar box labels that sometimes sit next to the title on opener
  // pages (e.g. "Activity 13.1") — not part of the chapter title.
  const isBoxLabel = (line: string) => /^activity\s+[\d.]+$/i.test(line.trim());

  const isHeadingLike = (line: string) =>
    line.length > 0 &&
    line.length < 60 &&
    !/[.;:]$/.test(line) &&
    !isRunningHeader(line) &&
    !isBoxLabel(line);

  const collect = (start: number, step: 1 | -1): string[] => {
    const collected: string[] = [];
    for (let i = start; i >= 0 && i < firstPageLines.length; i += step) {
      const line = firstPageLines[i];
      if (isBoxLabel(line)) break; // stop entirely — don't cross a box label
      if (!isHeadingLike(line)) break;
      collected.push(line);
      if (collected.length >= 3) break;
    }
    return step === -1 ? collected.reverse() : collected;
  };

  const before = collect(markerIndex - 1, -1);
  const after = collect(markerIndex + 1, 1);
  const titleLines = before.length > 0 ? before : after;

  return titleLines.length > 0 ? titleLines.join(" ") : `Chapter ${chapterNumber}`;
}

async function extractChapter(bookCode: string, chapterNumber: number) {
  const padded = String(chapterNumber).padStart(2, "0");
  const fileName = `${bookCode}${padded}.pdf`;
  const pdfPath = path.join(PDF_DIR, fileName);
  const outPath = path.join(TEXT_DIR, `${bookCode}${padded}.json`);

  const buffer = await readFile(pdfPath);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();

  const pages: ExtractedPage[] = result.pages
    .map((p) => ({ pageNumber: p.num, text: cleanPageText(p.text) }))
    .filter((p) => p.text.length > 0);

  const firstPageLines = pages[0]?.text.split("\n") ?? [];
  const title = extractTitle(firstPageLines, chapterNumber);

  const chapter: ExtractedChapter = { chapterNumber, title, pages };
  await writeFile(outPath, JSON.stringify(chapter, null, 2));
  console.log(`extracted: ${fileName} -> "${title}" (${pages.length} pages)`);
}

async function listDownloadedBooks(): Promise<Map<string, number[]>> {
  const files = await readdir(PDF_DIR);
  const byBook = new Map<string, number[]>();

  for (const file of files) {
    const match = file.match(/^(.+?)(\d{2})\.pdf$/);
    if (!match) continue;
    const [, bookCode, chapterStr] = match;
    const chapters = byBook.get(bookCode) ?? [];
    chapters.push(Number(chapterStr));
    byBook.set(bookCode, chapters);
  }

  return byBook;
}

async function main() {
  await mkdir(TEXT_DIR, { recursive: true });

  const byBook = await listDownloadedBooks();
  if (byBook.size === 0) {
    throw new Error(`No downloaded PDFs found in ${PDF_DIR}. Run 'npm run ingest:download' first.`);
  }

  for (const [bookCode, chapters] of byBook) {
    chapters.sort((a, b) => a - b);
    console.log(`\n== ${bookCode} (${chapters.length} chapters) ==`);
    for (const chapter of chapters) {
      await extractChapter(bookCode, chapter);
    }
  }

  console.log(`\nDone. Extracted ${byBook.size} book(s) to ${TEXT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
