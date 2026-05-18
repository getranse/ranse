import { MAX_SOURCE_BYTES, MAX_URL_REDIRECTS, URL_FETCH_TIMEOUT_MS } from './constants';
import { extractReadableTextFromHtml, normalizeWhitespace } from './text';
import { validatePublicHttpUrl } from '../lib/url-security';

function validateCrawlUrl(input: string | URL): URL {
  return validatePublicHttpUrl(input);
}

async function fetchWithTimeout(url: URL): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url.toString(), {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        accept: 'text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'user-agent': 'RanseBot/0.1 (+https://getranse.com)',
      },
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('fetch_timeout');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchUrlDocument(url: string): Promise<{ title?: string; body: string }> {
  let current = validateCrawlUrl(url);
  let res: Response | null = null;
  for (let redirects = 0; redirects <= MAX_URL_REDIRECTS; redirects++) {
    res = await fetchWithTimeout(current);
    if (![301, 302, 303, 307, 308].includes(res.status)) break;
    const location = res.headers.get('location');
    if (!location) throw new Error('redirect_missing_location');
    if (redirects === MAX_URL_REDIRECTS) throw new Error('too_many_redirects');
    current = validateCrawlUrl(new URL(location, current));
  }

  if (!res) throw new Error('fetch_failed');
  if (!res.ok) throw new Error(`fetch_failed_${res.status}`);

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const supportedType = !contentType || [
    'text/html',
    'text/plain',
    'application/xhtml+xml',
    'application/xml',
    'text/xml',
  ].includes(contentType);

  const contentLength = Number(res.headers.get('content-length') ?? '0');
  if (contentLength > MAX_SOURCE_BYTES) throw new Error('source_too_large');

  const raw = await res.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_SOURCE_BYTES) throw new Error('source_too_large');

  if (!supportedType && !/<html|<body|<article/i.test(raw)) throw new Error('unsupported_content_type');
  if (contentType.includes('html') || /<html|<body|<article/i.test(raw)) {
    return extractReadableTextFromHtml(raw);
  }
  return { body: normalizeWhitespace(raw) };
}
