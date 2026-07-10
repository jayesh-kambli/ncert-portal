import { and, cosineDistance, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { chunks, type Chunk } from "../db/schema";
import { embedTexts } from "../openai";

export interface RetrievedChunk extends Chunk {
  vectorScore: number;
  textScore: number;
}

const VECTOR_TOP_K = 8;
const TEXT_TOP_K = 8;
const FINAL_TOP_K = 8;
const MAX_CONTEXT_CHARS = 6000; // rough token budget guard for the prompt

// Below this cosine similarity (and with no keyword match either), a
// result is just "nearest available" noise, not actually relevant — e.g.
// searching this corpus for "telephone" still returns *something*, since
// vector search always has a nearest neighbor. Without this floor, those
// irrelevant chunks were leaking into source citations.
const MIN_VECTOR_SCORE = 0.2;

export async function retrieveChunks(
  query: string,
  filters: { class: number; subject: string }
): Promise<RetrievedChunk[]> {
  const [queryEmbedding] = await embedTexts([query]);

  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, queryEmbedding)})`;

  const vectorResults = await db
    .select({ chunk: chunks, score: similarity })
    .from(chunks)
    .where(and(eq(chunks.class, filters.class), eq(chunks.subject, filters.subject)))
    .orderBy((t) => desc(t.score))
    .limit(VECTOR_TOP_K);

  const textResults = await db
    .select({
      chunk: chunks,
      score: sql<number>`ts_rank(to_tsvector('english', ${chunks.content}), plainto_tsquery('english', ${query}))`,
    })
    .from(chunks)
    .where(
      and(
        eq(chunks.class, filters.class),
        eq(chunks.subject, filters.subject),
        sql`to_tsvector('english', ${chunks.content}) @@ plainto_tsquery('english', ${query})`
      )
    )
    .orderBy((t) => desc(t.score))
    .limit(TEXT_TOP_K);

  const merged = new Map<string, RetrievedChunk>();

  for (const { chunk, score } of vectorResults) {
    merged.set(chunk.id, { ...chunk, vectorScore: score, textScore: 0 });
  }
  for (const { chunk, score } of textResults) {
    const existing = merged.get(chunk.id);
    if (existing) {
      existing.textScore = score;
    } else {
      merged.set(chunk.id, { ...chunk, vectorScore: 0, textScore: score });
    }
  }

  // Simple hybrid ranking: vector similarity is the primary signal (it's
  // normalized 0-1); keyword rank is a secondary boost, weighted down since
  // ts_rank isn't on the same scale.
  const ranked = [...merged.values()]
    .filter((r) => r.vectorScore >= MIN_VECTOR_SCORE || r.textScore > 0)
    .sort((a, b) => b.vectorScore + b.textScore * 0.25 - (a.vectorScore + a.textScore * 0.25));

  return capByCharBudget(ranked.slice(0, FINAL_TOP_K));
}

function capByCharBudget(results: RetrievedChunk[]): RetrievedChunk[] {
  const kept: RetrievedChunk[] = [];
  let total = 0;
  for (const r of results) {
    if (total + r.content.length > MAX_CONTEXT_CHARS && kept.length > 0) break;
    kept.push(r);
    total += r.content.length;
  }
  return kept;
}
