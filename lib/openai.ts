import OpenAI from "openai";

// Lazily constructed: the OpenAI SDK throws at construction time if
// OPENAI_API_KEY is missing, and Next.js evaluates route modules during
// `next build` (page-data collection) even for dynamic routes — a
// module-level `new OpenAI()` would fail the build in any environment
// where the key isn't present at build time (e.g. secrets injected only
// at runtime, not build time).
let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const CHAT_MODEL = "gpt-4o-mini";

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const res = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}
