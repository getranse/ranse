import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { getSession } from '../lib/auth';

interface AuthedSession {
  sessionId: string;
  userId: string;
  workspaceId: string;
}

type Ctx = { Bindings: Env; Variables: { session: AuthedSession } };

export const apiApp = new Hono<Ctx>();

function getSupervisor(env: Env, workspaceId: string) {
  const id = env.WorkspaceSupervisorAgent.idFromName(workspaceId);
  return env.WorkspaceSupervisorAgent.get(id);
}

apiApp.use('*', async (c, next) => {
  const s = await getSession(c);
  if (!s?.workspaceId) return c.json({ error: 'unauthorized' }, 401);
  c.set('session', { sessionId: s.sessionId, userId: s.userId, workspaceId: s.workspaceId });
  await next();
});

apiApp.get('/tickets', async (c) => {
  const s = c.get('session');
  const status = c.req.query('status');
  const stub = getSupervisor(c.env, s.workspaceId);
  const tickets = await (stub as any).listTickets({ status, limit: 50 });
  return c.json({ tickets });
});

apiApp.get('/tickets/:id', async (c) => {
  const s = c.get('session');
  const stub = getSupervisor(c.env, s.workspaceId);
  const data = await (stub as any).getTicket(c.req.param('id'));
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json(data);
});

apiApp.post('/tickets/:id/assign', async (c) => {
  const s = c.get('session');
  const body = z.object({ userId: z.string().nullable() }).parse(await c.req.json());
  const stub = getSupervisor(c.env, s.workspaceId);
  await (stub as any).assignTicket({ ticketId: c.req.param('id'), userId: body.userId, actorUserId: s.userId });
  return c.json({ ok: true });
});

apiApp.post('/tickets/:id/status', async (c) => {
  const s = c.get('session');
  const body = z
    .object({ status: z.enum(['open', 'pending', 'resolved', 'closed', 'spam']) })
    .parse(await c.req.json());
  const stub = getSupervisor(c.env, s.workspaceId);
  await (stub as any).setTicketStatus({ ticketId: c.req.param('id'), status: body.status, actorUserId: s.userId });
  return c.json({ ok: true });
});

apiApp.post('/tickets/:id/note', async (c) => {
  const s = c.get('session');
  const body = z.object({ body: z.string().min(1).max(20000) }).parse(await c.req.json());
  const stub = getSupervisor(c.env, s.workspaceId);
  await (stub as any).addInternalNote({ ticketId: c.req.param('id'), body: body.body, actorUserId: s.userId });
  return c.json({ ok: true });
});

apiApp.get('/approvals', async (c) => {
  const s = c.get('session');
  const stub = getSupervisor(c.env, s.workspaceId);
  const approvals = await (stub as any).listApprovals();
  return c.json({ approvals });
});

apiApp.post('/approvals/:id/approve', async (c) => {
  const s = c.get('session');
  const body = z
    .object({ edits: z.object({ subject: z.string().optional(), body_markdown: z.string().optional() }).optional() })
    .parse(await c.req.json().catch(() => ({})));
  const stub = getSupervisor(c.env, s.workspaceId);
  const result = await (stub as any).approveAndSend({ approvalId: c.req.param('id'), actorUserId: s.userId, edits: body.edits });
  return c.json(result);
});

apiApp.post('/approvals/:id/reject', async (c) => {
  const s = c.get('session');
  const body = z.object({ reason: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
  const stub = getSupervisor(c.env, s.workspaceId);
  await (stub as any).rejectApproval({ approvalId: c.req.param('id'), actorUserId: s.userId, reason: body.reason });
  return c.json({ ok: true });
});

apiApp.get('/knowledge', async (c) => {
  const s = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT id, title, url, updated_at FROM knowledge_doc WHERE workspace_id = ? ORDER BY updated_at DESC`,
  )
    .bind(s.workspaceId)
    .all();
  return c.json({ docs: rows.results ?? [] });
});

apiApp.post('/knowledge', async (c) => {
  const s = c.get('session');
  const body = z
    .object({ title: z.string().min(1), body: z.string().min(1), url: z.string().url().optional() })
    .parse(await c.req.json());
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO knowledge_doc (id, workspace_id, title, body, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, s.workspaceId, body.title, body.body, body.url ?? null, now, now)
    .run();
  return c.json({ ok: true, id });
});

apiApp.get('/settings/llm', async (c) => {
  const s = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT action_key, model_name, fallback_model, temperature FROM workspace_llm_config WHERE workspace_id = ?`,
  )
    .bind(s.workspaceId)
    .all();
  return c.json({ config: rows.results ?? [] });
});

apiApp.post('/settings/llm', async (c) => {
  const s = c.get('session');
  const body = z
    .object({
      action_key: z.enum(['triage', 'summarize', 'draft', 'knowledge_query', 'escalation', 'conversational']),
      model_name: z.string().min(1),
      fallback_model: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      reasoning_effort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
    })
    .parse(await c.req.json());
  await c.env.DB.prepare(
    `INSERT INTO workspace_llm_config (workspace_id, action_key, model_name, fallback_model, reasoning_effort, temperature, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, action_key) DO UPDATE SET model_name=excluded.model_name, fallback_model=excluded.fallback_model, reasoning_effort=excluded.reasoning_effort, temperature=excluded.temperature, updated_at=excluded.updated_at`,
  )
    .bind(
      s.workspaceId,
      body.action_key,
      body.model_name,
      body.fallback_model ?? null,
      body.reasoning_effort ?? null,
      body.temperature ?? null,
      Date.now(),
    )
    .run();
  return c.json({ ok: true });
});

apiApp.get('/settings/providers', async (c) => {
  const s = c.get('session');
  const stub = c.env.UserSecretsStore.get(c.env.UserSecretsStore.idFromName(s.workspaceId));
  const providers = await (stub as any).listProviders();
  return c.json({ providers });
});

apiApp.post('/settings/providers', async (c) => {
  const s = c.get('session');
  const body = z.object({ provider: z.string(), api_key: z.string().min(1) }).parse(await c.req.json());
  const stub = c.env.UserSecretsStore.get(c.env.UserSecretsStore.idFromName(s.workspaceId));
  await (stub as any).setKey({ provider: body.provider, apiKey: body.api_key });
  return c.json({ ok: true });
});

apiApp.delete('/settings/providers/:provider', async (c) => {
  const s = c.get('session');
  const stub = c.env.UserSecretsStore.get(c.env.UserSecretsStore.idFromName(s.workspaceId));
  await (stub as any).deleteKey(c.req.param('provider'));
  return c.json({ ok: true });
});
