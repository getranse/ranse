import { DEFAULT_CHUNK_CHARS, DEFAULT_OVERLAP_CHARS } from './constants';
import { normalizeWhitespace } from './text';

export function chunkText(
  input: string,
  opts: { maxChars?: number; overlapChars?: number } = {},
): string[] {
  const maxChars = opts.maxChars ?? DEFAULT_CHUNK_CHARS;
  const overlapChars = opts.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const text = normalizeWhitespace(input);
  if (!text) return [];

  const paragraphs = text.split(/\n{2,}/).map((p) => normalizeWhitespace(p)).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  function pushCurrent() {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      pushCurrent();
      const step = Math.max(1, maxChars - overlapChars);
      for (let i = 0; i < paragraph.length; i += step) {
        chunks.push(paragraph.slice(i, i + maxChars).trim());
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    const overlap = current.slice(Math.max(0, current.length - overlapChars)).trim();
    pushCurrent();
    current = overlap && `${overlap}\n\n${paragraph}`.length <= maxChars
      ? `${overlap}\n\n${paragraph}`
      : paragraph;
  }

  pushCurrent();
  return chunks.filter(Boolean);
}
