// JSON repair for LLM structured output: some models emit raw control
// characters inside string literals, which strict JSON.parse rejects.

export function parseJsonWithControlCharRepair(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    const repaired = escapeControlCharsInJsonStrings(text);
    if (repaired === text) throw err;
    return JSON.parse(repaired);
  }
}

function escapeControlCharsInJsonStrings(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (!inString) {
      if (char === '"') inString = true;
      result += char;
      continue;
    }

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = false;
      result += char;
      continue;
    }

    if (char === '\n') {
      result += '\\n';
      continue;
    }
    if (char === '\r') {
      result += '\\r';
      continue;
    }
    if (char === '\t') {
      result += '\\t';
      continue;
    }

    const code = char.charCodeAt(0);
    if (code < 0x20) {
      result += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }

    result += char;
  }

  return result;
}
