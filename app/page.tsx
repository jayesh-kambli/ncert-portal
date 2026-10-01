"use client";

import { useRef, useState } from "react";
import { Markdown } from "./components/Markdown";
import { CLASSES, SUBJECTS_BY_CLASS } from "@/lib/subjects";

const SUBJECT_EMOJI: Record<string, string> = {
  Mathematics: "📐",
  Science: "🔬",
  "Social Science": "🌍",
  English: "📖",
  Physics: "⚛️",
  Chemistry: "🧪",
  Biology: "🧬",
  Accountancy: "📒",
  "Business Studies": "💼",
  Economics: "📈",
  "CA: Taxation": "🧾",
};

interface Source {
  chapter: string;
  pageNumber: number | null;
}

interface Segment {
  type: "grounded" | "external";
  text: string;
}

type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; segments: Segment[]; sources?: Source[]; error?: boolean };

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

function appendSegment(
  m: Extract<Message, { role: "assistant" }>,
  type: Segment["type"],
  text: string
): Extract<Message, { role: "assistant" }> {
  const last = m.segments[m.segments.length - 1];
  if (last && last.type === type) {
    return { ...m, segments: [...m.segments.slice(0, -1), { ...last, text: last.text + text }] };
  }
  return { ...m, segments: [...m.segments, { type, text }] };
}

// Assistant messages carry `segments` for rendering, not a flat `content`
// string — the API only needs plain text for conversation history, so
// flatten segments back into one string here. Without this, JSON.stringify
// silently drops the (nonexistent) `content` field on assistant messages,
// and the API rejects the resulting null content.
function toApiMessage(m: Message): { role: "user" | "assistant"; content: string } {
  if (m.role === "user") return { role: "user", content: m.content };
  return { role: "assistant", content: m.segments.map((s) => s.text).join("") };
}

export default function Home() {
  const [studentClass, setStudentClass] = useState(10);
  const [subject, setSubject] = useState<string>("Science");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  function changeSelection(nextClass: number, nextSubject: string) {
    // Class 11-12 have a different subject set than 7-10 (Physics/
    // Chemistry/Biology instead of Science) — if the current subject
    // doesn't exist for the newly picked class, fall back to its first.
    const validSubjects = SUBJECTS_BY_CLASS[nextClass];
    const resolvedSubject = validSubjects.includes(nextSubject) ? nextSubject : validSubjects[0];
    setStudentClass(nextClass);
    setSubject(resolvedSubject);
    setMessages([]); // history from a different class/subject would confuse the model
  }

  function updateLastAssistant(
    prev: Message[],
    update: (
      m: Extract<Message, { role: "assistant" }>
    ) => Extract<Message, { role: "assistant" }>
  ): Message[] {
    if (prev.length === 0) return prev;
    const last = prev[prev.length - 1];
    if (last.role !== "assistant") return prev;
    const copy = [...prev];
    copy[copy.length - 1] = update(last);
    return copy;
  }

  async function sendMessage() {
    const question = input.trim();
    if (!question || isStreaming) return;

    const nextMessages: Message[] = [...messages, { role: "user", content: question }];
    setMessages([...nextMessages, { role: "assistant", segments: [] }]);
    setInput("");
    setIsStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(toApiMessage),
          class: studentClass,
          subject,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message =
          res.status === 429
            ? "You're sending messages a bit fast — please wait a few seconds and try again."
            : (body?.error ?? "Something went wrong reaching the server. Please try again.");
        setMessages((prev) =>
          updateLastAssistant(prev, (m) => ({
            ...m,
            segments: [{ type: "grounded", text: message }],
            error: true,
          }))
        );
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
            setMessages((prev) =>
              updateLastAssistant(prev, (m) => ({ ...m, sources: data as Source[] }))
            );
          } else if (event === "token") {
            setMessages((prev) =>
              updateLastAssistant(prev, (m) => appendSegment(m, "grounded", data as string))
            );
          } else if (event === "external_token") {
            setMessages((prev) =>
              updateLastAssistant(prev, (m) => appendSegment(m, "external", data as string))
            );
          } else if (event === "error") {
            setMessages((prev) =>
              updateLastAssistant(prev, (m) => ({
                ...m,
                segments: [{ type: "grounded", text: data as string }],
                error: true,
              }))
            );
          }
        });
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } catch {
      setMessages((prev) =>
        updateLastAssistant(prev, (m) => ({
          ...m,
          segments: [
            { type: "grounded", text: "Something went wrong reaching the server. Please try again." },
          ],
          error: true,
        }))
      );
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <header className="shrink-0 border-b border-surface-border px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[15px] font-medium text-foreground sm:text-base">
              NCERT Study Tutor
            </h1>
            <p className="text-xs text-foreground/55 sm:text-sm">
              Ask a question from the {subject} textbook.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex flex-wrap gap-1.5 sm:justify-end">
              {CLASSES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => changeSelection(c, subject)}
                  aria-pressed={c === studentClass}
                  className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    c === studentClass
                      ? "bg-accent text-accent-foreground"
                      : "bg-surface text-foreground/60 hover:text-foreground"
                  }`}
                >
                  Class {c}
                  {(c === 11 || c === 12) && (
                    <span
                      className={`text-[9px] font-medium tracking-wide uppercase ${
                        c === studentClass ? "text-accent-foreground/60" : "text-foreground/35"
                      }`}
                    >
                      beta
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 sm:justify-end">
              {SUBJECTS_BY_CLASS[studentClass].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => changeSelection(studentClass, s)}
                  aria-pressed={s === subject}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    s === subject
                      ? "bg-accent text-accent-foreground"
                      : "bg-surface text-foreground/60 hover:text-foreground"
                  }`}
                >
                  <span aria-hidden="true">{SUBJECT_EMOJI[s]}</span>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="thin-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-8">
        {messages.length === 0 && (
          <p className="mt-10 text-center text-sm text-foreground/40">
            Ask anything from your Class {studentClass} {subject} textbook.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col gap-2.5 ${m.role === "user" ? "items-end" : "items-start"}`}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl bg-surface px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-foreground sm:max-w-lg">
                {m.content}
              </div>
            ) : (
              <div
                className={`w-full min-w-0 text-[15px] leading-7 ${
                  m.error ? "text-red-600 dark:text-red-400" : "text-foreground"
                }`}
              >
                {m.segments.length === 0
                  ? isStreaming && i === messages.length - 1 && (
                      <span className="text-foreground/40">…</span>
                    )
                  : m.segments.map((seg, j) =>
                      seg.type === "external" ? (
                        <div
                          key={j}
                          className="my-3 rounded-xl border border-surface-border bg-surface px-4 py-3"
                        >
                          <p className="mb-1 text-[11px] font-medium tracking-wide text-foreground/45 uppercase">
                            Beyond your textbook
                          </p>
                          <div className="text-foreground/85">
                            <Markdown>{seg.text}</Markdown>
                          </div>
                        </div>
                      ) : (
                        <Markdown key={j}>{seg.text}</Markdown>
                      )
                    )}
              </div>
            )}
            {m.role === "assistant" && m.sources && m.sources.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {m.sources.map((s, j) => (
                  <span
                    key={j}
                    className="rounded-full border border-surface-border bg-surface px-2.5 py-0.5 text-xs text-foreground/55"
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
        </div>
      </main>

      <footer className="shrink-0 px-4 py-4 sm:px-6 sm:py-5">
        <form
          className="mx-auto flex max-w-2xl items-end gap-2 rounded-3xl border border-surface-border bg-surface px-3 py-2 focus-within:border-accent/50"
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
        >
          <textarea
            className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-foreground outline-none placeholder:text-foreground/40"
            rows={1}
            placeholder={`Ask a question about Class ${studentClass} ${subject}...`}
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
            aria-label="Send message"
            disabled={isStreaming || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-opacity disabled:opacity-30"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
      </footer>
    </div>
  );
}
