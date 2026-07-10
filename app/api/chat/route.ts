import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { getOpenAI, CHAT_MODEL } from "@/lib/openai";
import { retrieveChunks } from "@/lib/rag/retrieve";
import { SYSTEM_PROMPT } from "@/lib/rag/prompt";
import { sseStream } from "@/lib/rag/stream";

export const dynamic = "force-dynamic";

// MVP scope: single class/subject (see plan). Swap or make dynamic once
// the portal covers more than Class 10 Science.
const CLASS_FILTER = 10;
const SUBJECT_FILTER = "Science";

const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_ITERATIONS = 4;

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  messages: IncomingMessage[];
}

interface Source {
  chapter: string;
  pageNumber: number | null;
}

const SEARCH_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_textbook",
    description:
      "Search the student's Class 10 Science NCERT textbook for passages relevant to a specific question, topic, or example. Returns the most relevant excerpts found, or none if nothing matches.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A focused search query describing exactly what information is needed — a concept, definition, process, or example.",
        },
      },
      required: ["query"],
    },
  },
};

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequestBody;
  const incoming = body.messages ?? [];

  const latest = incoming[incoming.length - 1];
  if (!latest || latest.role !== "user" || !latest.content?.trim()) {
    return new Response(JSON.stringify({ error: "No user question provided." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const history = incoming.slice(0, -1).slice(-MAX_HISTORY_MESSAGES);

  const conversation: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatCompletionMessageParam),
    { role: "user", content: latest.content },
  ];

  const stream = sseStream(async ({ sendSources, sendToken }) => {
    const allSources = new Map<string, Source>();

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const completion = await getOpenAI().chat.completions.create({
        model: CHAT_MODEL,
        stream: true,
        messages: conversation,
        tools: [SEARCH_TOOL],
      });

      let assistantContent = "";
      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
      let finishReason: string | null | undefined = null;

      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta;
        finishReason = chunk.choices[0]?.finish_reason ?? finishReason;

        if (delta?.content) {
          assistantContent += delta.content;
          sendToken(delta.content);
        }

        for (const tc of delta?.tool_calls ?? []) {
          const existing = toolCalls.get(tc.index) ?? { id: "", name: "", arguments: "" };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          toolCalls.set(tc.index, existing);
        }
      }

      if (toolCalls.size === 0 || finishReason !== "tool_calls") {
        // Model produced a final answer — already streamed live above.
        return;
      }

      const orderedCalls = [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);

      conversation.push({
        role: "assistant",
        content: assistantContent || null,
        tool_calls: orderedCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of orderedCalls) {
        const result = await runTool(tc.name, tc.arguments, allSources);
        conversation.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }

      sendSources([...allSources.values()]);
    }

    sendToken(
      "Sorry, I'm having trouble finding a clear answer for that right now — could you try rephrasing?"
    );
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function runTool(
  name: string,
  rawArgs: string,
  allSources: Map<string, Source>
): Promise<string> {
  if (name !== "search_textbook") {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  let query: string;
  try {
    query = JSON.parse(rawArgs).query;
  } catch {
    return JSON.stringify({ error: "Invalid tool arguments" });
  }
  if (!query || typeof query !== "string") {
    return JSON.stringify({ error: "Missing query" });
  }

  const results = await retrieveChunks(query, { class: CLASS_FILTER, subject: SUBJECT_FILTER });

  for (const chunk of results) {
    const key = `${chunk.chapter}::${chunk.pageNumber}`;
    if (!allSources.has(key)) {
      allSources.set(key, { chapter: chunk.chapter, pageNumber: chunk.pageNumber });
    }
  }

  if (results.length === 0) {
    return JSON.stringify({ found: false });
  }

  return JSON.stringify({
    found: true,
    excerpts: results.map((r) => ({
      chapter: r.chapter,
      page: r.pageNumber,
      content: r.content,
    })),
  });
}
