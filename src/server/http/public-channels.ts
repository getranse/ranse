import { type Context, Hono } from 'hono';
import type { Env } from '../env';
import { apiError } from '../../lib/errors';
import {
  appendPublicSessionMessage,
  createPublicSession,
  getPublicChannelByKey,
  ingestInboundMessage,
  publicChannelConfig,
  publicSessionMessages,
  tryGetAdapter,
} from '../inbox/channels';
import { formHtml, formResultHtml, widgetScript } from '../inbox/channels/surfaces';
import { messageSchema, startSchema } from '../schemas/public-channels';

type PublicCtx = Context<{ Bindings: Env }>;

export const publicChannelsApp = new Hono<{ Bindings: Env }>();
export const publicSurfaceApp = new Hono<{ Bindings: Env }>();

publicChannelsApp.options('*', (c) => withCors(c, c.body(null, 204)));

publicChannelsApp.get('/channels/:key/config', async (c) => {
  const result = await publicChannelConfig(c.env, c.req.param('key'), c.req.header('origin'));
  if (!result) return withCors(c, apiError(c, 'not_found', 'Channel not found.'));
  return withCors(c, c.json({ channel: result.config }));
});

publicChannelsApp.post('/channels/:key/sessions', async (c) => {
  const rateLimited = await checkRateLimit(c, `public:start:${c.req.param('key')}`);
  if (rateLimited) return withCors(c, rateLimited);
  const body = startSchema.parse(await c.req.json().catch(() => ({})));
  if (body.company?.trim()) return withCors(c, c.json({ ok: true }));
  try {
    const result = await createPublicSession(
      c.env,
      c.req.param('key'),
      {
        email: body.email,
        name: body.name,
        subject: body.subject,
        message: body.message,
        visitorId: body.visitor_id,
      },
      { origin: c.req.header('origin'), userAgent: c.req.header('user-agent') },
    );
    return withCors(
      c,
      c.json({
        session_id: result.sessionId,
        session_token: result.sessionToken,
        ticket_id: result.ticketId,
        message_id: result.messageId,
      }),
    );
  } catch (err) {
    return withCors(c, publicError(c, err));
  }
});

publicChannelsApp.get('/sessions/:id', async (c) => {
  const token = bearerToken(c.req.header('authorization')) ?? c.req.query('token') ?? '';
  try {
    const result = await publicSessionMessages(c.env, c.req.param('id'), token, {
      origin: c.req.header('origin'),
    });
    if (!result) return withCors(c, apiError(c, 'unauthorized', 'Invalid session token.'));
    return withCors(
      c,
      c.json({
        session: {
          id: result.session.id,
          ticket_id: result.session.ticket_id,
          requester_email: result.session.requester_email,
        },
        messages: result.messages,
      }),
    );
  } catch (err) {
    return withCors(c, publicError(c, err));
  }
});

publicChannelsApp.post('/sessions/:id/messages', async (c) => {
  const token = bearerToken(c.req.header('authorization')) ?? '';
  const rateLimited = await checkRateLimit(c, `public:message:${c.req.param('id')}`);
  if (rateLimited) return withCors(c, rateLimited);
  const body = messageSchema.parse(await c.req.json().catch(() => ({})));
  if (body.company?.trim()) return withCors(c, c.json({ ok: true }));
  try {
    const result = await appendPublicSessionMessage(
      c.env,
      c.req.param('id'),
      token,
      { message: body.message },
      { origin: c.req.header('origin') },
    );
    return withCors(c, c.json({ ok: true, ...result }));
  } catch (err) {
    return withCors(c, publicError(c, err));
  }
});

// Single webhook endpoint for every third-party adapter. The adapter
// validates the signature, parses the payload, and the shared ingress
// pipeline turns it into a ticket/message — no per-provider plumbing here.
//
// Voice channels reuse this endpoint:
//   - WebSocket upgrade (Twilio Streams, Gemini Live browser) is routed
//     through `adapter.handleChallenge` which dispatches to the provider's
//     streaming bridge.
//   - `?answer=1` POST (Twilio Voice answer hook) returns a TwiML <Connect>
//     <Stream> response pointing back at this same URL.
//   - Status callbacks land here as plain POSTs and go through the normal
//     verify → parse → ingest path.
publicChannelsApp.on(['GET', 'POST'], '/channels/:key/webhook', async (c) => {
  const channel = await getPublicChannelByKey(c.env, c.req.param('key'));
  if (!channel || channel.enabled !== 1) return c.text('Channel not found', 404);
  const adapter = tryGetAdapter(channel.kind);
  if (!adapter) return c.text('Adapter not available', 404);

  if (adapter.handleChallenge) {
    const handled = await adapter.handleChallenge(c.env, channel, c.req.raw);
    if (handled) return handled;
  }

  if (c.req.method === 'GET') return c.text('OK', 200);

  const rawBody = await c.req.text();
  const headerMap = headerRecord(c.req.raw.headers);
  const verified = await adapter.verifyWebhook(c.env, channel, headerMap, rawBody);
  if (!verified.ok) return c.text(`Signature check failed: ${verified.reason}`, 401);
  const parsed = await adapter.parseIngress(c.env, channel, headerMap, rawBody);
  if (!parsed) return c.text('OK', 200);
  await ingestInboundMessage(c.env, channel, parsed);
  return c.text('OK', 200);
});

// Convenience alias for browser-driven voice (Gemini Live widget). The
// upgrade lands at /webhook anyway because the adapter dispatches WebSocket
// upgrades regardless of path, but exposing /voice/ws gives operators a
// less surprising URL to embed in client-side code.
publicChannelsApp.get('/channels/:key/voice/ws', async (c) => {
  const channel = await getPublicChannelByKey(c.env, c.req.param('key'));
  if (!channel || channel.enabled !== 1 || channel.kind !== 'voice') {
    return c.text('Voice channel not found', 404);
  }
  const adapter = tryGetAdapter(channel.kind);
  if (!adapter?.handleChallenge) return c.text('Voice provider not streaming', 501);
  const handled = await adapter.handleChallenge(c.env, channel, c.req.raw);
  return handled ?? c.text('Expected WebSocket upgrade', 426);
});

publicSurfaceApp.get('/forms/:key', async (c) => {
  const result = await publicChannelConfig(c.env, c.req.param('key'), null);
  if (!result || result.channel.kind !== 'form') return c.text('Form not found', 404);
  return c.html(
    formHtml(result.config.name, result.config.welcome_message, result.config.require_email),
  );
});

publicSurfaceApp.post('/forms/:key', async (c) => {
  const rateLimited = await checkFormRateLimit(c, `public:form:${c.req.param('key')}`);
  if (rateLimited) return rateLimited;
  const config = await publicChannelConfig(c.env, c.req.param('key'), null);
  if (!config || config.channel.kind !== 'form') return c.text('Form not found', 404);
  const parsed = await c.req.parseBody();
  const message = stringField(parsed.message);
  const email = stringField(parsed.email);
  const name = stringField(parsed.name);
  const subject = stringField(parsed.subject);
  const company = stringField(parsed.company);
  if (company) return c.html(formResultHtml('Thanks. Your request has been received.'));
  if (!message) return c.html(formResultHtml('Message is required.'), 400);
  try {
    await createPublicSession(
      c.env,
      c.req.param('key'),
      { email, name, subject, message, visitorId: null },
      { origin: null, userAgent: c.req.header('user-agent') },
    );
    return c.html(formResultHtml('Thanks. Your request has been received.'));
  } catch (err) {
    const message =
      err instanceof Error && err.message === 'email_required'
        ? 'Enter a valid email address.'
        : 'We could not submit the form.';
    return c.html(formResultHtml(message), 400);
  }
});

publicSurfaceApp.get('/widget/:asset', async (c) => {
  const asset = c.req.param('asset') ?? '';
  if (!asset.endsWith('.js')) return c.text('Widget not found', 404);
  const key = asset.slice(0, -3);
  return c.text(widgetScript(key), 200, {
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': 'public, max-age=300',
  });
});

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function withCors(c: PublicCtx, response: Response): Response {
  const origin = c.req.header('origin') ?? '*';
  response.headers.set('access-control-allow-origin', origin);
  response.headers.set('vary', 'origin');
  response.headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  response.headers.set('access-control-allow-headers', 'content-type,authorization');
  response.headers.set('access-control-max-age', '600');
  return response;
}

async function checkRateLimit(c: PublicCtx, key: string): Promise<Response | null> {
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
  const result = await c.env.RATE_LIMIT_INGEST?.limit({ key: `${key}:${ip}` }).catch(() => ({
    success: true,
  }));
  return result && !result.success ? apiError(c, 'rate_limited', 'Slow down.', 429) : null;
}

async function checkFormRateLimit(c: PublicCtx, key: string): Promise<Response | null> {
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
  const result = await c.env.RATE_LIMIT_INGEST?.limit({ key: `${key}:${ip}` }).catch(() => ({
    success: true,
  }));
  return result && !result.success
    ? c.html(formResultHtml('Please wait before submitting another request.'), 429)
    : null;
}

function publicError(c: PublicCtx, err: unknown): Response {
  if (err instanceof Error) {
    if (err.message === 'origin_not_allowed') {
      return apiError(c, 'forbidden', 'Origin not allowed.', 403);
    }
    if (err.message === 'email_required') {
      return apiError(c, 'validation_error', 'A valid email address is required.', 400);
    }
    if (err.message === 'message_required') {
      return apiError(c, 'validation_error', 'Message is required.', 400);
    }
    if (err.message === 'session_not_found') {
      return apiError(c, 'unauthorized', 'Invalid session token.', 401);
    }
    if (err.message === 'channel_not_found') {
      return apiError(c, 'not_found', 'Channel not found.', 404);
    }
  }
  throw err;
}

function bearerToken(value?: string | null): string | null {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
