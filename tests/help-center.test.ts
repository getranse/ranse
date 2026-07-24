import { describe, expect, it } from 'vitest';
import { setArticlePublic } from '../src/server/actions/help-center';
import { helpApp } from '../src/server/http/help';
import { createWorkspaceTestDb, seedWorkspace } from './helpers/workspace-db';

function setup() {
  const { db, env } = createWorkspaceTestDb();
  seedWorkspace(db, 'ws_a', 'Alpha');
  const addArticle = (id: string, title: string, body: string, status = 'ready') => {
    db.prepare(
      `INSERT INTO knowledge_source (id, workspace_id, kind, title, status, created_at, updated_at)
       VALUES (?, 'ws_a', 'manual', ?, ?, 1, 1)`,
    ).run(id, title, status);
    db.prepare(
      `INSERT INTO knowledge_chunk (id, workspace_id, source_id, ordinal, title, body, snippet, vector_id, content_hash, created_at, updated_at)
       VALUES (?, 'ws_a', ?, 0, ?, ?, '', ?, 'h', 1, 1)`,
    ).run(`c_${id}`, id, title, body, `v_${id}`);
  };
  return { db, env, addArticle };
}

describe('public help center', () => {
  it('serves only published, ready articles under the workspace slug', async () => {
    const { env, addArticle } = setup();
    addArticle('src_pub', 'Refund policy', 'Refunds are available within **30 days**.');
    addArticle('src_priv', 'Internal runbook', 'Secret escalation steps');
    await setArticlePublic(env, 'ws_a', 'src_pub', true);

    const list = await helpApp.request('/alpha', {}, env);
    expect(list.status).toBe(200);
    const listHtml = await list.text();
    expect(listHtml).toContain('Refund policy');
    expect(listHtml).not.toContain('Internal runbook');

    const article = await helpApp.request('/alpha/src_pub', {}, env);
    const articleHtml = await article.text();
    expect(articleHtml).toContain('<strong>30 days</strong>');

    expect((await helpApp.request('/alpha/src_priv', {}, env)).status).toBe(404);
    expect((await helpApp.request('/nope', {}, env)).status).toBe(404);
  });

  it('unpublishing removes the article and rejects cross-workspace toggles', async () => {
    const { env, addArticle } = setup();
    addArticle('src_pub', 'Refund policy', 'Body');
    await setArticlePublic(env, 'ws_a', 'src_pub', true);
    expect(await setArticlePublic(env, 'ws_other', 'src_pub', false)).toBe(false);
    await setArticlePublic(env, 'ws_a', 'src_pub', false);
    expect((await helpApp.request('/alpha/src_pub', {}, env)).status).toBe(404);
  });
});
