import { describe, expect, it } from 'vitest';
import { buildPortalLink } from '../src/lib/portal-links';
import { portalApp } from '../src/server/http/portal';
import { createWorkspaceTestDb, seedMailbox, seedWorkspace } from './helpers/workspace-db';

async function setup() {
  const { db, env } = createWorkspaceTestDb();
  const routeEnv = {
    ...env,
    APP_URL: 'https://support.example.com',
    COOKIE_SIGNING_KEY: 'test-secret',
  };
  seedWorkspace(db, 'ws_a', 'Alpha');
  seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
  db.prepare(
    `INSERT INTO ticket (id, workspace_id, mailbox_id, subject, status, last_message_at, requester_email, thread_token, created_at, updated_at)
     VALUES ('tkt_1', 'ws_a', 'mb_a', 'Broken widget', 'open', 1, 'a@example.com', 'tok', 1, 1)`,
  ).run();
  const addMessage = (id: string, direction: string, preview: string) => {
    db.prepare(
      `INSERT INTO message_index (id, ticket_id, workspace_id, direction, preview, sent_at, created_at)
       VALUES (?, 'tkt_1', 'ws_a', ?, ?, 1, 1)`,
    ).run(id, direction, preview);
  };
  addMessage('m_in', 'inbound', 'My widget arrived broken');
  addMessage('m_out', 'outbound', 'A replacement ships tomorrow');
  addMessage('m_note', 'note', 'SECRET internal note about the customer');
  const link = await buildPortalLink(routeEnv as any, { workspaceId: 'ws_a', ticketId: 'tkt_1' });
  return { routeEnv, token: new URL(link!).searchParams.get('token')! };
}

describe('customer portal', () => {
  it('shows the thread and status for a valid signed link, never internal notes', async () => {
    const { routeEnv, token } = await setup();
    const res = await portalApp.request(`/?token=${encodeURIComponent(token)}`, {}, routeEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Broken widget');
    expect(html).toContain('My widget arrived broken');
    expect(html).toContain('A replacement ships tomorrow');
    expect(html).toContain('Open — we are on it');
    expect(html).not.toContain('SECRET internal note');
  });

  it('rejects missing, forged, and cross-ticket tokens', async () => {
    const { routeEnv, token } = await setup();
    expect((await portalApp.request('/', {}, routeEnv)).status).toBe(400);
    expect((await portalApp.request('/?token=forged.sig', {}, routeEnv)).status).toBe(400);
    const tampered = `${token.split('.')[0]}x.${token.split('.')[1]}`;
    expect(
      (await portalApp.request(`/?token=${encodeURIComponent(tampered)}`, {}, routeEnv)).status,
    ).toBe(400);
  });
});
