function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function sseStream(
  produce: (controller: {
    sendSources: (sources: { chapter: string; pageNumber: number | null }[]) => void;
    sendToken: (text: string) => void;
    sendExternalToken: (text: string) => void;
    sendError: (message: string) => void;
  }) => Promise<void>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const enqueue = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        await produce({
          sendSources: (sources) => enqueue(sseEvent("sources", sources)),
          sendToken: (text) => enqueue(sseEvent("token", text)),
          sendExternalToken: (text) => enqueue(sseEvent("external_token", text)),
          sendError: (message) => enqueue(sseEvent("error", message)),
        });
        enqueue(sseEvent("done", {}));
      } catch (err) {
        console.error("[chat stream error]", err);
        enqueue(sseEvent("error", err instanceof Error ? err.message : "Unknown error"));
      } finally {
        controller.close();
      }
    },
  });
}
