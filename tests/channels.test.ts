import { describe, expect, it, vi } from 'vitest';
import { apiApp } from '../src/server/http/api/routes';
import { app } from '../src/server/http/app';
import {
  addMember,
  createWorkspaceTestDb,
  login,
  seedMailbox,
  seedUser,
  seedWorkspace,
} from './helpers/workspace-db';

vi.mock('agents', () => ({
  getAgentByName: () => ({}),
  Agent: class {},
  callable: () => () => undefined,
  routeAgentRequest: () => null,
}));

async function seedOwner() {
  const { db, env } = createWorkspaceTestDb();
  await seedUser(db, 'owner', 'owner@example.com');
  seedWorkspace(db, 'ws_a', 'Alpha');
  addMember(db, 'ws_a', 'owner', 'owner');
  seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
  const cookie = await login(env, 'owner@example.com');
  return { db, env, cookie };
}

async function createChannel(
  env: ReturnType<typeof createWorkspaceTestDb>['env'],
  cookie: string,
  body: Record<string, unknown> = {},
) {
  const res = await apiApp.request(
    '/channels/public',
    {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'chat',
        mailbox_id: 'mb_a',
        name: 'Website support',
        allowed_origins: ['https://example.com'],
        welcome_message: 'How can we help?',
        ...body,
      }),
    },
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}

describe('public channels', () => {
  it('lets owners create and update public channels while blocking viewers', async () => {
    const { db, env, cookie } = await seedOwner();
    await seedUser(db, 'viewer', 'viewer@example.com');
    addMember(db, 'ws_a', 'viewer', 'viewer');
    const viewerCookie = await login(env, 'viewer@example.com');

    const forbidden = await apiApp.request(
      '/channels/public',
      {
        method: 'POST',
        headers: { cookie: viewerCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'chat', mailbox_id: 'mb_a', name: 'Nope' }),
      },
      env,
    );
    expect(forbidden.status).toBe(403);

    const created = await createChannel(env, cookie);
    expect(created.channel.public_key).toMatch(/^pub_/);

    const patched = await apiApp.request(
      `/channels/public/${created.channel.id}`,
      {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false, name: 'Website chat' }),
      },
      env,
    );
    const patchedBody: any = await patched.json();
    expect(patched.status).toBe(200);
    expect(patchedBody.channel.enabled).toBe(0);
    expect(patchedBody.channel.name).toBe('Website chat');
  });

  it('creates tickets from public chat sessions and protects session reads with tokens', async () => {
    const { db, env, cookie } = await seedOwner();
    const created = await createChannel(env, cookie);
    const key = created.channel.public_key;

    const denied = await app.request(
      `/public/channels/${key}/config`,
      { headers: { origin: 'https://evil.example' } },
      env,
    );
    expect(denied.status).toBe(404);

    const config = await app.request(
      `/public/channels/${key}/config`,
      { headers: { origin: 'https://example.com' } },
      env,
    );
    expect(config.status).toBe(200);

    const started = await app.request(
      `/public/channels/${key}/sessions`,
      {
        method: 'POST',
        headers: { origin: 'https://example.com', 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'customer@example.com',
          name: 'Customer',
          subject: 'Need help',
          message: 'I need help with my subscription invoice.\nPlease keep the line break.',
        }),
      },
      env,
    );
    const startBody: any = await started.json();
    expect(started.status).toBe(200);
    expect(startBody.session_token).toMatch(/^pst_/);
    expect(db.prepare(`SELECT subject, requester_email FROM ticket`).get()).toEqual({
      subject: 'Need help',
      requester_email: 'customer@example.com',
    });

    const invalidRead = await app.request(`/public/sessions/${startBody.session_id}`, {}, env);
    expect(invalidRead.status).toBe(401);

    const deniedRead = await app.request(
      `/public/sessions/${startBody.session_id}`,
      {
        headers: {
          origin: 'https://evil.example',
          authorization: `Bearer ${startBody.session_token}`,
        },
      },
      env,
    );
    expect(deniedRead.status).toBe(403);

    const appended = await app.request(
      `/public/sessions/${startBody.session_id}/messages`,
      {
        method: 'POST',
        headers: {
          origin: 'https://example.com',
          authorization: `Bearer ${startBody.session_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ message: 'Adding more detail.' }),
      },
      env,
    );
    expect(appended.status).toBe(200);

    const timeline = await app.request(
      `/public/sessions/${startBody.session_id}`,
      { headers: { authorization: `Bearer ${startBody.session_token}` } },
      env,
    );
    const timelineBody: any = await timeline.json();
    expect(timeline.status).toBe(200);
    expect(timelineBody.messages.map((msg: any) => msg.body)).toEqual([
      'I need help with my subscription invoice.\nPlease keep the line break.',
      'Adding more detail.',
    ]);
  });

  it('serves hosted forms and widget scripts for public channels', async () => {
    const { db, env, cookie } = await seedOwner();
    const created = await createChannel(env, cookie, {
      kind: 'form',
      name: 'Contact support',
      require_email: false,
      allowed_origins: ['https://customer.example'],
    });
    const key = created.channel.public_key;

    const form = await app.request(
      `/forms/${key}`,
      { headers: { origin: 'https://ranse.example' } },
      env,
    );
    expect(form.status).toBe(200);
    const formHtml = await form.text();
    expect(formHtml).toContain('Contact support');
    expect(formHtml).toContain('<input name="email"');

    const submitted = await app.request(
      `/forms/${key}`,
      {
        method: 'POST',
        headers: {
          origin: 'https://ranse.example',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          email: 'form@example.com',
          name: 'Form User',
          subject: 'Form issue',
          message: 'The hosted form should create a ticket.',
        }),
      },
      env,
    );
    expect(submitted.status).toBe(200);
    expect(db.prepare(`SELECT requester_email FROM ticket`).get()).toEqual({
      requester_email: 'form@example.com',
    });

    const widget = await app.request(`/widget/${key}.js`, {}, env);
    expect(widget.status).toBe(200);
    expect(widget.headers.get('content-type')).toContain('application/javascript');
    expect(await widget.text()).toContain(`var key="${key}"`);
  });
});
