import type { CfEnvelope } from '../../../interfaces/email';
const CF_API = 'https://api.cloudflare.com/client/v4';

export async function cfFetch<T = any>(
  path: string,
  opts: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; token: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    method: opts.method,
    headers: {
      authorization: `Bearer ${opts.token}`,
      'content-type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: CfEnvelope<T>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`CF ${opts.method} ${path}: non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !body.success) {
    const errs = body.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? res.statusText;
    const err = new Error(`CF ${opts.method} ${path}: ${errs}`);
    (err as any).status = res.status;
    (err as any).cfErrors = body.errors ?? [];
    throw err;
  }
  return body.result;
}

export async function verifyToken(token: string) {
  return cfFetch<{ id: string; status: string; expires_on?: string }>('/user/tokens/verify', {
    method: 'GET',
    token,
  });
}

export async function findZone(token: string, domain: string) {
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    const zones = await cfFetch<Array<{ id: string; name: string }>>(
      `/zones?name=${encodeURIComponent(candidate)}`,
      { method: 'GET', token },
    );
    if (zones.length > 0) return { zoneId: zones[0].id, zoneName: zones[0].name };
  }
  return null;
}
