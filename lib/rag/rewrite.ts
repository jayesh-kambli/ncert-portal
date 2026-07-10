import { getOpenAI, CHAT_MODEL } from "../openai";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Follow-up questions ("why does that happen?", "give another example")
// often lack the keywords needed for good retrieval on their own. This
// rewrites the latest question into a standalone one using prior turns,
// before it's embedded/searched — a standard "condense question" step.
export async function contextualizeQuery(
  history: ChatMessage[],
  latestQuestion: string
): Promise<string> {
  if (history.length === 0) return latestQuestion;

  const transcript = history
    .slice(-6) // last few turns is enough context to resolve references
    .map((m) => `${m.role === "user" ? "Student" : "Assistant"}: ${m.content}`)
    .join("\n");

  const response = await getOpenAI().chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "Rewrite the student's latest question as a standalone question that makes sense without the conversation history. " +
          "Resolve pronouns and implicit references (e.g. 'that', 'it', 'this one') using the conversation. " +
          "If the question is already standalone, return it unchanged. " +
          "Output ONLY the rewritten question, nothing else.",
      },
      {
        role: "user",
        content: `Conversation so far:\n${transcript}\n\nLatest question: ${latestQuestion}`,
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() || latestQuestion;
}
