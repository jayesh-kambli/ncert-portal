import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { PDFParse } from "pdf-parse";
import { BOOK_CODE, CHAPTER_COUNT, PDF_DIR, TEXT_DIR } from "./config";

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
// always emitted as the first extracted line of a page's text.
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
  if (markerIndex === -1) return `Chapter ${chapterNumber}`;

  // Running header: subject name + page number, e.g. "Science\t58".
  const isRunningHeader = (line: string) => /^science\s*\t?\s*\d+$/i.test(line.trim());
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

async function extractChapter(chapterNumber: number) {
  const padded = String(chapterNumber).padStart(2, "0");
  const fileName = `${BOOK_CODE}${padded}.pdf`;
  const pdfPath = path.join(PDF_DIR, fileName);
  const outPath = path.join(TEXT_DIR, `${BOOK_CODE}${padded}.json`);

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

async function main() {
  await mkdir(TEXT_DIR, { recursive: true });

  for (let chapter = 1; chapter <= CHAPTER_COUNT; chapter++) {
    await extractChapter(chapter);
  }

  console.log(`Done. Extracted ${CHAPTER_COUNT} chapters to ${TEXT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
