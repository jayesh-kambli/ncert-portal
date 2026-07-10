import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { Agent, setGlobalDispatcher } from "undici";
import { BOOK_CODE, CHAPTER_COUNT, PDF_DIR } from "./config";

const BASE_URL = "https://ncert.nic.in/textbook/pdf";

// Local network middleboxes (AV/corporate proxy) intercept TLS to
// ncert.nic.in and break standard certificate validation (confirmed via
// curl -k working while default verification fails with ECONNRESET).
// User explicitly approved skipping cert verification for ncert.nic.in
// requests in this script. setGlobalDispatcher scopes to this process
// only (a one-shot ingestion script), not the Next.js app.
setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));

async function downloadChapter(chapterNumber: number) {
  const padded = String(chapterNumber).padStart(2, "0");
  const fileName = `${BOOK_CODE}${padded}.pdf`;
  const destPath = path.join(PDF_DIR, fileName);

  if (existsSync(destPath)) {
    console.log(`skip (already downloaded): ${fileName}`);
    return;
  }

  const url = `${BASE_URL}/${fileName}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buffer);
  console.log(`downloaded: ${fileName} (${buffer.byteLength} bytes)`);
}

async function main() {
  await mkdir(PDF_DIR, { recursive: true });

  for (let chapter = 1; chapter <= CHAPTER_COUNT; chapter++) {
    await downloadChapter(chapter);
  }

  console.log(`Done. ${CHAPTER_COUNT} chapters available in ${PDF_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
