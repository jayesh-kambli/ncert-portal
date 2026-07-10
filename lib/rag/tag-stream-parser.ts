// Splits a live token stream into "grounded" (default) and "external" text
// based on a <external>...</external> marker the model is instructed to
// wrap non-textbook content in. Text can arrive split across arbitrary
// chunk boundaries (e.g. "<exte" then "rnal>"), so this holds back any
// buffer tail that could still be the start of the next expected tag
// until it either completes or is proven not to be a tag.
const OPEN_TAG = "<external>";
const CLOSE_TAG = "</external>";

export type Mode = "grounded" | "external";

export function createTagStreamParser(onSegment: (mode: Mode, text: string) => void) {
  let buffer = "";
  let mode: Mode = "grounded";

  function longestTagPrefixSuffix(text: string, tag: string): number {
    const max = Math.min(text.length, tag.length - 1);
    for (let len = max; len > 0; len--) {
      if (text.endsWith(tag.slice(0, len))) return len;
    }
    return 0;
  }

  function process() {
    for (;;) {
      const expectedTag = mode === "grounded" ? OPEN_TAG : CLOSE_TAG;
      const idx = buffer.indexOf(expectedTag);

      if (idx !== -1) {
        if (idx > 0) onSegment(mode, buffer.slice(0, idx));
        buffer = buffer.slice(idx + expectedTag.length);
        mode = mode === "grounded" ? "external" : "grounded";
        continue;
      }

      const holdBack = longestTagPrefixSuffix(buffer, expectedTag);
      const safeLength = buffer.length - holdBack;
      if (safeLength > 0) onSegment(mode, buffer.slice(0, safeLength));
      buffer = buffer.slice(safeLength);
      return;
    }
  }

  return {
    feed(text: string) {
      buffer += text;
      process();
    },
    flush() {
      if (buffer) onSegment(mode, buffer);
      buffer = "";
    },
  };
}
