import type { Env } from '../env';
import { hmacSign, hmacVerify } from './crypto';
import type { FeedbackRating } from '../types/autonomy';

export interface FeedbackTokenPayload {
  workspaceId: string;
  ticketId: string;
  messageId: string;
  rating: FeedbackRating;
  expiresAt: number;
}

export interface FeedbackLinks {
  positive: string;
  negative: string;
}

export async function buildFeedbackLinks(
  env: Env,
  input: Omit<FeedbackTokenPayload, 'rating' | 'expiresAt'>,
): Promise<FeedbackLinks | null> {
  const base = env.APP_URL?.trim();
  if (!base || !env.COOKIE_SIGNING_KEY) return null;
  try {
    new URL(base);
  } catch {
    return null;
  }
  return {
    positive: await signedFeedbackUrl(env, base, { ...input, rating: 'positive' }),
    negative: await signedFeedbackUrl(env, base, { ...input, rating: 'negative' }),
  };
}

export async function verifyFeedbackToken(
  env: Env,
  token: string,
): Promise<FeedbackTokenPayload | null> {
  if (!env.COOKIE_SIGNING_KEY) return null;
  const [payloadPart, sig] = token.split('.');
  if (!payloadPart || !sig) return null;
  const expected = await hmacSign(env.COOKIE_SIGNING_KEY, payloadPart);
  if (!hmacVerify(expected, sig)) return null;

  const payload = decodePayload(payloadPart);
  if (!payload || payload.expiresAt < Date.now()) return null;
  if (payload.rating !== 'positive' && payload.rating !== 'negative') return null;
  return payload;
}

async function signedFeedbackUrl(
  env: Env,
  base: string,
  input: Omit<FeedbackTokenPayload, 'expiresAt'>,
): Promise<string> {
  const payload = encodePayload({
    ...input,
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 90,
  });
  const sig = await hmacSign(env.COOKIE_SIGNING_KEY ?? '', payload);
  const url = new URL('/feedback', base);
  url.searchParams.set('token', `${payload}.${sig}`);
  return url.toString();
}

function encodePayload(payload: FeedbackTokenPayload): string {
  const json = JSON.stringify(payload);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodePayload(value: string): FeedbackTokenPayload | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded));
    if (
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.ticketId !== 'string' ||
      typeof parsed.messageId !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}
