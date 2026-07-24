import { PORTAL_LINK_TTL_MS } from '../config/channels';
import type { PortalTokenPayload } from '../interfaces/portal';
import type { Env } from '../server/env';
import { hmacSign, hmacVerify } from './crypto';

/** Signed, expiring customer link to view one ticket's thread and status. */
export async function buildPortalLink(
  env: Env,
  input: { workspaceId: string; ticketId: string },
): Promise<string | null> {
  const base = env.APP_URL?.trim();
  if (!base || !env.COOKIE_SIGNING_KEY) return null;
  try {
    new URL(base);
  } catch {
    return null;
  }
  const payload = encode({ ...input, expiresAt: Date.now() + PORTAL_LINK_TTL_MS });
  const sig = await hmacSign(env.COOKIE_SIGNING_KEY, payload);
  const url = new URL('/portal', base);
  url.searchParams.set('token', `${payload}.${sig}`);
  return url.toString();
}

export async function verifyPortalToken(
  env: Env,
  token: string,
): Promise<PortalTokenPayload | null> {
  if (!env.COOKIE_SIGNING_KEY) return null;
  const [payloadPart, sig] = token.split('.');
  if (!payloadPart || !sig) return null;
  const expected = await hmacSign(env.COOKIE_SIGNING_KEY, payloadPart);
  if (!hmacVerify(expected, sig)) return null;
  const payload = decode(payloadPart);
  if (!payload || payload.expiresAt < Date.now()) return null;
  return payload;
}

function encode(payload: PortalTokenPayload): string {
  return btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decode(value: string): PortalTokenPayload | null {
  try {
    const padded = value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded));
    if (
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.ticketId !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
