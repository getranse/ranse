import { normalizeWhitespace } from './text';

function bytesToBinary(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

function trimPdfStreamBytes(bytes: Uint8Array): Uint8Array {
  let start = 0;
  let end = bytes.length;
  if (bytes[start] === 0x0d && bytes[start + 1] === 0x0a) start += 2;
  else if (bytes[start] === 0x0a) start += 1;
  if (bytes[end - 2] === 0x0d && bytes[end - 1] === 0x0a) end -= 2;
  else if (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d) end -= 1;
  return bytes.subarray(start, end);
}

async function inflatePdfStream(bytes: Uint8Array): Promise<string | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('deflate'));
    const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
    return bytesToBinary(inflated);
  } catch {
    return null;
  }
}

function decodePdfByteString(binary: string): string {
  if (binary.length >= 2 && binary.charCodeAt(0) === 0xfe && binary.charCodeAt(1) === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < binary.length; i += 2) {
      const code = (binary.charCodeAt(i) << 8) | binary.charCodeAt(i + 1);
      if (code !== 0) out += String.fromCharCode(code);
    }
    return out;
  }

  let out = '';
  for (const ch of binary) {
    const code = ch.charCodeAt(0);
    out += code < 32 && code !== 9 && code !== 10 && code !== 13 ? ' ' : ch;
  }
  return out;
}

function parsePdfLiteralString(input: string, start: number): { text: string; next: number } {
  let depth = 1;
  let out = '';
  for (let i = start + 1; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\') {
      const next = input[++i];
      if (!next) break;
      if (next === 'n') out += '\n';
      else if (next === 'r') out += '\r';
      else if (next === 't') out += '\t';
      else if (next === 'b') out += '\b';
      else if (next === 'f') out += '\f';
      else if (next === '\n') {
        // Line continuation.
      } else if (next === '\r') {
        if (input[i + 1] === '\n') i++;
      } else if (/[0-7]/.test(next)) {
        let octal = next;
        for (let n = 0; n < 2 && /[0-7]/.test(input[i + 1] ?? ''); n++) {
          octal += input[++i];
        }
        out += String.fromCharCode(Number.parseInt(octal, 8));
      } else {
        out += next;
      }
      continue;
    }
    if (ch === '(') {
      depth++;
      out += ch;
      continue;
    }
    if (ch === ')') {
      depth--;
      if (depth === 0) return { text: decodePdfByteString(out), next: i + 1 };
      out += ch;
      continue;
    }
    out += ch;
  }
  return { text: decodePdfByteString(out), next: input.length };
}

function parsePdfHexString(input: string, start: number): { text: string; next: number } {
  const end = input.indexOf('>', start + 1);
  if (end < 0) return { text: '', next: input.length };
  const raw = input.slice(start + 1, end);
  if (!/^[\da-f\s]*$/i.test(raw)) return { text: '', next: end + 1 };
  let hex = raw.replace(/\s+/g, '');
  if (hex.length % 2 === 1) hex += '0';
  let binary = '';
  for (let i = 0; i < hex.length; i += 2) {
    const code = Number.parseInt(hex.slice(i, i + 2), 16);
    if (Number.isFinite(code)) binary += String.fromCharCode(code);
  }
  return { text: decodePdfByteString(binary), next: end + 1 };
}

function extractTextFromPdfContentStream(stream: string): string {
  const parts: string[] = [];
  for (let i = 0; i < stream.length; i++) {
    if (stream[i] === '(') {
      const parsed = parsePdfLiteralString(stream, i);
      if (parsed.text.trim()) parts.push(parsed.text);
      i = parsed.next - 1;
    } else if (stream[i] === '<' && stream[i + 1] !== '<' && stream[i - 1] !== '<') {
      const parsed = parsePdfHexString(stream, i);
      if (parsed.text.trim()) parts.push(parsed.text);
      i = parsed.next - 1;
    }
  }
  return normalizeWhitespace(parts.join(' '));
}

function extractPdfFilters(dictionary: string): string[] {
  const match = dictionary.match(/\/Filter\s*(\[[^\]]+\]|\/[A-Za-z0-9]+)/);
  if (!match) return [];
  return Array.from(match[1].matchAll(/\/([A-Za-z0-9]+)/g), (m) => m[1]);
}

export async function extractTextFromPdfBytes(input: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength === 0) throw new Error('invalid_pdf');
  const binary = bytesToBinary(bytes);
  if (!binary.startsWith('%PDF-')) throw new Error('invalid_pdf');

  const texts: string[] = [];
  const unsupportedFilters = new Set<string>();
  let cursor = 0;
  while (cursor < binary.length) {
    const streamStart = binary.indexOf('stream', cursor);
    if (streamStart < 0) break;
    const streamEnd = binary.indexOf('endstream', streamStart);
    if (streamEnd < 0) break;

    const dictStart = binary.lastIndexOf('<<', streamStart);
    const dictEnd = binary.lastIndexOf('>>', streamStart);
    const dictionary = dictStart >= 0 && dictEnd > dictStart ? binary.slice(dictStart, dictEnd + 2) : '';
    const raw = trimPdfStreamBytes(bytes.subarray(streamStart + 'stream'.length, streamEnd));
    const filters = extractPdfFilters(dictionary);
    const streamText = filters.length === 0
      ? bytesToBinary(raw)
      : filters.length === 1 && filters[0] === 'FlateDecode'
        ? await inflatePdfStream(raw)
        : null;
    if (filters.some((filter) => filter !== 'FlateDecode')) {
      for (const filter of filters) unsupportedFilters.add(filter);
    }

    if (streamText) {
      const text = extractTextFromPdfContentStream(streamText);
      if (text) texts.push(text);
    }
    cursor = streamEnd + 'endstream'.length;
  }

  const text = normalizeWhitespace(texts.join('\n\n'));
  if (text) return text;

  const fallback = extractTextFromPdfContentStream(binary);
  if (fallback) return fallback;
  if (unsupportedFilters.size > 0) throw new Error(`unsupported_pdf_filter:${Array.from(unsupportedFilters).join(',')}`);
  throw new Error('empty_pdf_text');
}
