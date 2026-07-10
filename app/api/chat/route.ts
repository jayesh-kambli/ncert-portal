import { openai, CHAT_MODEL } from "@/lib/openai";
import { retrieveChunks } from "@/lib/rag/retrieve";
import { contextualizeQuery, type ChatMessage } from "@/lib/rag/rewrite";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/rag/prompt";
import { sseStream } from "@/lib/rag/stream";

export const dynamic = "force-dynamic";

// MVP scope: single class/subject (see plan). Swap or make dynamic once
// the portal covers more than Class 10 Science.
const CLASS_FILTER = 10;
const SUBJECT_FILTER = "Science";

// Below this cosine similarity, retrieved chunks aren't reliable enough to
// answer from — deflect instead of letting the model guess.
const CONFIDENCE_THRESHOLD = 0.2;

const MAX_HISTORY_MESSAGES = 10;

interface ChatRequestBody {
  messages: ChatMessage[];
}

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequestBody;
  const messages = body.messages ?? [];

  const latest = messages[messages.length - 1];
  if (!latest || latest.role !== "user" || !latest.content?.trim()) {
    return new Response(JSON.stringify({ error: "No user question provided." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const history = messages.slice(0, -1).slice(-MAX_HISTORY_MESSAGES);

  const stream = sseStream(async ({ sendSources, sendToken }) => {
    const question = await contextualizeQuery(history, latest.content);
    const retrieved = await retrieveChunks(question, {
      class: CLASS_FILTER,
      subject: SUBJECT_FILTER,
    });

    const confident = retrieved.length > 0 && retrieved[0].vectorScore >= CONFIDENCE_THRESHOLD;

    if (!confident) {
      sendSources([]);
      sendToken(
        "I don't see this covered in the Class 10 Science material I have. " +
          "Could you rephrase, or ask about a topic from the textbook?"
      );
      return;
    }

    const sources = dedupeSources(retrieved);
    sendSources(sources);

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.map((m) => ({ role: m.role, content: m.content }) as const),
        { role: "user", content: buildUserPrompt(latest.content, retrieved) },
      ],
    });

    for await (const part of completion) {
      const text = part.choices[0]?.delta?.content;
      if (text) sendToken(text);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function dedupeSources(
  retrieved: Awaited<ReturnType<typeof retrieveChunks>>
): { chapter: string; pageNumber: number | null }[] {
  const seen = new Set<string>();
  const sources: { chapter: string; pageNumber: number | null }[] = [];
  for (const chunk of retrieved) {
    const key = `${chunk.chapter}::${chunk.pageNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ chapter: chunk.chapter, pageNumber: chunk.pageNumber });
  }
  return sources;
}
