import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { getOpenAI, CHAT_MODEL } from "@/lib/openai";
import { retrieveChunks } from "@/lib/rag/retrieve";
import { buildSystemPrompt, sourceDescription } from "@/lib/rag/prompt";
import { sseStream } from "@/lib/rag/stream";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { createTagStreamParser } from "@/lib/rag/tag-stream-parser";
import { isAvailable } from "@/lib/subjects";

export const dynamic = "force-dynamic";

const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_ITERATIONS = 4;

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  messages: IncomingMessage[];
  class: number;
  subject: string;
}

interface Source {
  chapter: string;
  pageNumber: number | null;
}

function buildSearchTool(studentClass: number, subject: string): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "search_textbook",
      description: `Search the student's ${sourceDescription(studentClass, subject)} for passages relevant to a specific question, topic, or example. Returns the most relevant excerpts found, or none if nothing matches.`,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "A focused search query describing exactly what information is needed — a concept, definition, provision, process, or example.",
          },
        },
        required: ["query"],
      },
    },
  };
}

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(getClientIp(request));
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  const body = (await request.json()) as ChatRequestBody;
  const incoming = body.messages ?? [];
  const studentClass = body.class;
  const subject = body.subject;

  if (!isAvailable(studentClass, subject)) {
    return new Response(
      JSON.stringify({ error: "Please select a valid class and subject." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const latest = incoming[incoming.length - 1];
  if (!latest || latest.role !== "user" || !latest.content?.trim()) {
    return new Response(JSON.stringify({ error: "No user question provided." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const history = incoming.slice(0, -1).slice(-MAX_HISTORY_MESSAGES);

  const conversation: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(studentClass, subject) },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatCompletionMessageParam),
    { role: "user", content: latest.content },
  ];

  const searchTool = buildSearchTool(studentClass, subject);

  const stream = sseStream(async ({ sendSources, sendToken, sendExternalToken }) => {
    const allSources = new Map<string, Source>();
    const tagParser = createTagStreamParser((mode, text) => {
      if (mode === "external") sendExternalToken(text);
      else sendToken(text);
    });

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const completion = await getOpenAI().chat.completions.create({
        model: CHAT_MODEL,
        stream: true,
        messages: conversation,
        tools: [searchTool],
      });

      let assistantContent = "";
      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
      let finishReason: string | null | undefined = null;

      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta;
        finishReason = chunk.choices[0]?.finish_reason ?? finishReason;

        if (delta?.content) {
          assistantContent += delta.content;
          tagParser.feed(delta.content);
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
        tagParser.flush();
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
        const result = await runTool(tc.name, tc.arguments, allSources, studentClass, subject);
        conversation.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }

      sendSources([...allSources.values()]);
    }

    tagParser.flush();
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
  allSources: Map<string, Source>,
  studentClass: number,
  subject: string
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

  const results = await retrieveChunks(query, { class: studentClass, subject });

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
