import { describe, expect, it } from 'vitest';
import {
  createMacro,
  deleteMacro,
  listMacros,
  renderMacro,
  updateMacro,
} from '../src/server/actions/macros';
import { createWorkspaceTestDb, seedWorkspace } from './helpers/workspace-db';

function setup() {
  const { db, env } = createWorkspaceTestDb();
  seedWorkspace(db, 'ws_a', 'Alpha');
  seedWorkspace(db, 'ws_b', 'Beta');
  db.exec(`CREATE TABLE macro (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
    body TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  return { env };
}

describe('canned responses', () => {
  it('supports CRUD scoped to a workspace', async () => {
    const { env } = setup();
    const macro = await createMacro(env, 'ws_a', 'Refund policy', 'Our policy is 30 days.');
    expect(await listMacros(env, 'ws_b')).toHaveLength(0);

    expect(await updateMacro(env, 'ws_a', macro.id, { body: 'Our policy is 60 days.' })).toBe(true);
    expect(await updateMacro(env, 'ws_b', macro.id, { body: 'hijack' })).toBe(false);
    expect((await listMacros(env, 'ws_a'))[0].body).toBe('Our policy is 60 days.');

    await deleteMacro(env, 'ws_a', macro.id);
    expect(await listMacros(env, 'ws_a')).toHaveLength(0);
  });

  it('renders known placeholders and leaves unknown ones visible', () => {
    const rendered = renderMacro('Hi {{customer_name}}, re: {{ticket_subject}}. {{mystery}}', {
      customer_name: 'Jane',
      ticket_subject: 'Broken widget',
    });
    expect(rendered).toBe('Hi Jane, re: Broken widget. {{mystery}}');
  });
});
