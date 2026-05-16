import { MAX_SOURCE_BYTES, MAX_URL_REDIRECTS, URL_FETCH_TIMEOUT_MS } from './constants';
import { extractReadableTextFromHtml, normalizeWhitespace } from './text';

function parseIpv4Literal(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const nums = parts.map((part) => Number(part));
  return nums.every((num) => Number.isInteger(num) && num >= 0 && num <= 255) ? nums : null;
}

function isBlockedIpv4(nums: number[]): boolean {
  const [a, b, c] = nums;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIpv6(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === '::' ||
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80') ||
    host.startsWith('ff') ||
    host.startsWith('2001:db8') ||
    host.startsWith('::ffff:127.') ||
    host.startsWith('::ffff:10.') ||
    host.startsWith('::ffff:192.168.')
  );
}

function isBlockedSourceHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === 'metadata.google.internal') return true;

  const ipv4 = parseIpv4Literal(host);
  if (ipv4) return isBlockedIpv4(ipv4);
  if (host.includes(':')) return isBlockedIpv6(host);
  return false;
}

function validateCrawlUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    throw new Error('invalid_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported_url_scheme');
  if (url.username || url.password) throw new Error('url_credentials_not_allowed');
  if (isBlockedSourceHost(url.hostname)) throw new Error('private_url_not_allowed');
  url.hash = '';
  return url;
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
