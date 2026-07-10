import "dotenv/config";
import { readFile, readdir } from "fs/promises";
import path from "path";
import { db } from "../../lib/db/client";
import { chunks as chunksTable, type NewChunk } from "../../lib/db/schema";
import { embedTexts } from "../../lib/openai";
import { TARGET_CLASS, TARGET_SUBJECT, TEXT_DIR } from "./config";
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

async function loadChapters(): Promise<ExtractedChapter[]> {
  const files = (await readdir(TEXT_DIR)).filter((f) => f.endsWith(".json"));
  const chapters: ExtractedChapter[] = [];
  for (const file of files) {
    const raw = await readFile(path.join(TEXT_DIR, file), "utf-8");
    chapters.push(JSON.parse(raw));
  }
  return chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
}

async function main() {
  const chapters = await loadChapters();
  if (chapters.length === 0) {
    throw new Error(
      `No extracted chapters found in ${TEXT_DIR}. Run 'npm run ingest:extract' first.`
    );
  }

  type PendingChunk = Omit<NewChunk, "embedding">;
  const pending: PendingChunk[] = [];

  for (const chapter of chapters) {
    let chunkIndex = 0;
    for (const page of chapter.pages) {
      for (const content of chunkText(page.text)) {
        pending.push({
          class: TARGET_CLASS,
          subject: TARGET_SUBJECT,
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
