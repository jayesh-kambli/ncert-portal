"use client";

import { useRef, useState } from "react";

interface Source {
  chapter: string;
  pageNumber: number | null;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  error?: boolean;
}

function parseSSEChunk(
  buffer: string,
  onEvent: (event: string, data: unknown) => void
): string {
  const events = buffer.split("\n\n");
  const remainder = events.pop() ?? "";

  for (const block of events) {
    const eventLine = block.split("\n").find((l) => l.startsWith("event: "));
    const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
    if (!eventLine || !dataLine) continue;
    const event = eventLine.slice("event: ".length);
    const data = JSON.parse(dataLine.slice("data: ".length));
    onEvent(event, data);
  }

  return remainder;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function sendMessage() {
    const question = input.trim();
    if (!question || isStreaming) return;

    const nextMessages: Message[] = [...messages, { role: "user", content: question }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setIsStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message =
          res.status === 429
            ? "You're sending messages a bit fast — please wait a few seconds and try again."
            : (body?.error ?? "Something went wrong reaching the server. Please try again.");
        setMessages((prev) => updateLast(prev, (m) => ({ ...m, content: message, error: true })));
        return;
      }

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSSEChunk(buffer, (event, data) => {
          if (event === "sources") {
            setMessages((prev) => updateLast(prev, (m) => ({ ...m, sources: data as Source[] })));
          } else if (event === "token") {
            setMessages((prev) =>
              updateLast(prev, (m) => ({ ...m, content: m.content + (data as string) }))
            );
          } else if (event === "error") {
            setMessages((prev) =>
              updateLast(prev, (m) => ({ ...m, content: data as string, error: true }))
            );
          }
        });
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } catch {
      setMessages((prev) =>
        updateLast(prev, (m) => ({
          ...m,
          content: "Something went wrong reaching the server. Please try again.",
          error: true,
        }))
      );
    } finally {
      setIsStreaming(false);
    }
  }

  function updateLast(prev: Message[], update: (m: Message) => Message): Message[] {
    if (prev.length === 0) return prev;
    const copy = [...prev];
    copy[copy.length - 1] = update(copy[copy.length - 1]);
    return copy;
  }

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-black">
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-black">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          NCERT Class 10 Science Tutor
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Ask a question from the Class 10 Science textbook.
        </p>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto px-6 py-6">
        {messages.length === 0 && (
          <p className="mt-10 text-center text-sm text-zinc-400">
            Try asking: &ldquo;What is photosynthesis?&rdquo;
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "self-end" : "self-start"}>
            <div
              className={`max-w-xl whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : m.error
                    ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                    : "bg-white text-zinc-800 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800"
              }`}
            >
              {m.content || (isStreaming && i === messages.length - 1 ? "…" : "")}
            </div>
            {m.sources && m.sources.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {m.sources.map((s, j) => (
                  <span
                    key={j}
                    className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  >
                    {s.chapter}
                    {s.pageNumber != null ? ` · p.${s.pageNumber}` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      <footer className="border-t border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-black">
        <form
          className="mx-auto flex max-w-3xl items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
        >
          <textarea
            className="flex-1 resize-none rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            rows={1}
            placeholder="Ask a question about Class 10 Science..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            disabled={isStreaming}
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}
