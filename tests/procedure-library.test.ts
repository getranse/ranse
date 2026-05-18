import { describe, expect, it, vi } from 'vitest';
import { apiApp } from '../src/api/routes';
import {
  getProcedureLibraryItem,
  listProcedureLibrary,
  validateProcedureLibrary,
} from '../src/procedures/library';
import { runProcedureSpecEvals } from '../src/evals/replay';
import {
  addMember,
  createWorkspaceTestDb,
  login,
  seedUser,
  seedWorkspace,
} from './helpers/workspace-db';

vi.mock('agents', () => ({
  getAgentByName: () => ({}),
  Agent: class {},
  callable: () => () => undefined,
}));

describe('procedure library', () => {
  it('ships validated procedures with evals and reference MCP tool specs', () => {
    const entries = listProcedureLibrary();

    expect(entries.map((entry) => entry.slug)).toEqual([
      'refund-intake',
      'password-reset',
      'shipping-dispute',
      'gdpr-data-request',
    ]);
    expect(validateProcedureLibrary().length).toBe(entries.length);
    for (const entry of entries) {
      const item = getProcedureLibraryItem(entry.slug);
      expect(item?.reference_mcp_tools.length).toBeGreaterThan(0);
      expect(item?.spec.evals?.length).toBeGreaterThan(0);
      expect(runProcedureSpecEvals(item!.spec).status).toBe('passed');
    }
  });

  it('lets workspace owners install a library procedure through the API', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    await seedUser(db, 'usr_a', 'owner@example.com');
    addMember(db, 'ws_a', 'usr_a', 'owner');
    const cookie = await login(env, 'owner@example.com');

    const listRes = await apiApp.request('/procedures/library', { headers: { cookie } }, env);
    const listBody = await listRes.json<any>();
    const installRes = await apiApp.request(
      '/procedures/library/password-reset/install',
      { method: 'POST', headers: { cookie } },
      env,
    );
    const installBody = await installRes.json<any>();

    expect(listRes.status).toBe(200);
    expect(listBody.procedures.some((entry: any) => entry.slug === 'password-reset')).toBe(true);
    expect(installRes.status).toBe(200);
    expect(installBody.procedure.slug).toBe('password-reset');
    expect(db.prepare(`SELECT source_kind, source_ref FROM procedure_version`).get()).toEqual({
      source_kind: 'seed',
      source_ref: 'library:password-reset@1.0.0',
    });
  });
});
