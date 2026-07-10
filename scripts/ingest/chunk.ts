// Recursive character-based chunker (LangChain-style separator cascade),
// sized in characters as a proxy for tokens (~4 chars/token for English).
const CHUNK_SIZE_CHARS = 1600; // ~400 tokens
const CHUNK_OVERLAP_CHARS = 240; // ~15%
const SEPARATORS = ["\n\n", "\n", ". ", " "];

function splitOnSeparator(text: string, separator: string): string[] {
  return separator ? text.split(separator) : text.split("");
}

function recursiveSplit(text: string, separators: string[]): string[] {
  if (text.length <= CHUNK_SIZE_CHARS) return [text];

  const [separator, ...rest] = separators;
  if (separator === undefined) {
    // Fallback: hard-split by character count.
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += CHUNK_SIZE_CHARS) {
      parts.push(text.slice(i, i + CHUNK_SIZE_CHARS));
    }
    return parts;
  }

  const pieces = splitOnSeparator(text, separator).filter((p) => p.length > 0);
  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    const candidate = current ? current + separator + piece : piece;
    if (candidate.length <= CHUNK_SIZE_CHARS) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      if (piece.length > CHUNK_SIZE_CHARS) {
        chunks.push(...recursiveSplit(piece, rest));
        current = "";
      } else {
        current = piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function addOverlap(chunks: string[]): string[] {
  if (chunks.length <= 1) return chunks;
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk;
    let tail = chunks[i - 1].slice(-CHUNK_OVERLAP_CHARS);
    const firstSpace = tail.indexOf(" ");
    if (firstSpace > 0) tail = tail.slice(firstSpace + 1); // avoid starting mid-word
    return `${tail}\n${chunk}`;
  });
}

export function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const base = recursiveSplit(trimmed, SEPARATORS);
  return addOverlap(base).map((c) => c.trim()).filter(Boolean);
}
