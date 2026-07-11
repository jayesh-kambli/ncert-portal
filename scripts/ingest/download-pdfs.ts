import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { Agent, setGlobalDispatcher } from "undici";
import { INGEST_TARGETS, PDF_DIR } from "./config";

const BASE_URL = "https://ncert.nic.in/textbook/pdf";
const MAX_CHAPTERS_PER_BOOK = 30;

// Local network middleboxes (AV/corporate proxy) intercept TLS to
// ncert.nic.in and break standard certificate validation (confirmed via
// curl -k working while default verification fails with ECONNRESET).
// User explicitly approved skipping cert verification for ncert.nic.in
// requests in this script. setGlobalDispatcher scopes to this process
// only (a one-shot ingestion script), not the Next.js app.
setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));

async function downloadChapter(bookCode: string, chapterNumber: number): Promise<boolean> {
  const padded = String(chapterNumber).padStart(2, "0");
  const fileName = `${bookCode}${padded}.pdf`;
  const destPath = path.join(PDF_DIR, fileName);

  if (existsSync(destPath)) {
    console.log(`skip (already downloaded): ${fileName}`);
    return true;
  }

  const url = `${BASE_URL}/${fileName}`;
  const res = await fetch(url);
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buffer);
  console.log(`downloaded: ${fileName} (${buffer.byteLength} bytes)`);
  return true;
}

async function downloadBook(bookCode: string): Promise<number> {
  let count = 0;
  for (let chapter = 1; chapter <= MAX_CHAPTERS_PER_BOOK; chapter++) {
    const ok = await downloadChapter(bookCode, chapter);
    if (!ok) break;
    count++;
  }
  console.log(`${bookCode}: ${count} chapters`);
  return count;
}

async function main() {
  await mkdir(PDF_DIR, { recursive: true });

  for (const target of INGEST_TARGETS) {
    for (const bookCode of target.bookCodes) {
      console.log(`\n== Class ${target.class} ${target.subject} — ${bookCode} ==`);
      const count = await downloadBook(bookCode);
      if (count === 0) {
        console.warn(`WARNING: no chapters found for ${bookCode} (class ${target.class} ${target.subject}) — check the book code`);
      }
    }
  }

  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
