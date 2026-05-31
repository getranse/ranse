import { describe, expect, it, vi } from 'vitest';
import { apiApp } from '../src/server/http/api/routes';
import { createMcpServer, upsertDiscoveredMcpTools } from '../src/server/actions/mcp';
import {
  getProcedureLibraryItem,
  getProcedureLibraryManifest,
  getProcedureLibraryReadiness,
  listProcedureLibrary,
  validateProcedureLibrary,
} from '../src/server/automation/procedures/library';
import { runProcedureSpecEvals } from '../src/server/automation/evals/replay';
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
  it('ships validated procedures with evals, checksums, and MCP tool specs', async () => {
    const entries = await listProcedureLibrary();

    const slugs = entries.map((entry) => entry.slug);
    // Phase 7 originals are still present.
    expect(slugs).toEqual(
      expect.arrayContaining([
        'refund-intake',
        'verify-identity-channel-aware',
        'password-reset',
        'shipping-dispute',
        'gdpr-data-request',
      ]),
    );
    // Phase 11 Action Library shipped at least the procedures backing each
    // first-party MCP template.
    expect(slugs).toEqual(
      expect.arrayContaining([
        'order-address-edit',
        'subscription-pause',
        'outage-report',
        'jira-bug-escalation',
        'auth0-password-reset',
        'internal-action-webhook',
      ]),
    );
    // Slugs are unique.
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(await validateProcedureLibrary()).toHaveLength(entries.length);
    for (const entry of entries) {
      expect((entry as any).spec).toBeUndefined();
      expect(entry.provenance.spec_checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.provenance.source_ref).toContain(`#sha256:${entry.provenance.spec_checksum}`);
      const item = await getProcedureLibraryItem(entry.slug);
      expect(item?.reference_mcp_tools.length).toBeGreaterThan(0);
      expect(item?.spec.evals?.length).toBeGreaterThan(0);
      expect(runProcedureSpecEvals(item!.spec).status).toBe('passed');
      const actionTools = collectActionTools(item!.spec.steps);
      for (const tool of item!.reference_mcp_tools) {
        expect(tool.annotations?.openWorldHint).not.toBeUndefined();
        const optional = (tool as any).usage === 'optional';
        if (!optional) {
          expect(actionTools).toContain(`${tool.server}.${tool.tool}`);
        }
        const matchingActions = collectActions(item!.spec.steps).filter(
          (step) => step.tool === `${tool.server}.${tool.tool}`,
        );
        if (tool.annotations?.readOnlyHint !== true) {
          expect(matchingActions.every((step) => step.requires_approval !== false)).toBe(true);
        }
      }
    }
  });

  it('returns immutable library clones and a full manifest', async () => {
    const entries = await listProcedureLibrary();
    entries[0].tags.push('mutated');
    expect((await listProcedureLibrary())[0].tags).not.toContain('mutated');

    const detail = await getProcedureLibraryItem('refund-intake');
    detail!.spec.name = 'Mutated';
    expect((await getProcedureLibraryItem('refund-intake'))?.spec.name).toBe('Refund intake');

    const manifest = await getProcedureLibraryManifest();
    expect(manifest.manifest_version).toBe('2026-05-18');
    expect(manifest.standards.mcp_schema).toBe('2025-11-25');
    expect(manifest.procedures).toHaveLength(entries.length);
  });

  it('lets workspace owners install a library procedure through the API', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    await seedUser(db, 'usr_a', 'owner@example.com');
    addMember(db, 'ws_a', 'usr_a', 'owner');
    const cookie = await login(env, 'owner@example.com');

    const listRes = await apiApp.request('/procedures/library', { headers: { cookie } }, env);
    const listBody = await listRes.json<any>();
    const manifestRes = await apiApp.request(
      '/procedures/library/manifest',
      { headers: { cookie } },
      env,
    );
    const detailRes = await apiApp.request(
      '/procedures/library/password-reset',
      { headers: { cookie } },
      env,
    );
    const detailBody = await detailRes.json<any>();
    const installRes = await apiApp.request(
      '/procedures/library/password-reset/install',
      { method: 'POST', headers: { cookie } },
      env,
    );
    const installBody = await installRes.json<any>();

    expect(listRes.status).toBe(200);
    expect(listBody.procedures.some((entry: any) => entry.slug === 'password-reset')).toBe(true);
    expect(listBody.procedures[0].spec).toBeUndefined();
    expect(listBody.procedures[0].readiness.status).toBe('needs_setup');
    expect(manifestRes.status).toBe(200);
    expect(detailRes.status).toBe(200);
    expect(detailBody.procedure.provenance.spec_checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(installRes.status).toBe(200);
    expect(installBody.procedure.slug).toBe('password-reset');
    const stored = db.prepare(`SELECT source_kind, source_ref FROM procedure_version`).get() as {
      source_kind: string;
      source_ref: string;
    };
    expect(stored).toEqual({
      source_kind: 'seed',
      source_ref: detailBody.procedure.provenance.source_ref,
    });
    expect(stored.source_ref).toContain('#sha256:');
  });

  it('reports MCP readiness for library installs', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    const missing = await getProcedureLibraryReadiness(env, 'ws_a', 'refund-intake');
    expect(missing?.status).toBe('needs_setup');
    expect(missing?.tools.map((tool) => tool.status)).toEqual(['missing_server', 'missing_server']);

    const server = await createMcpServer(env, {
      workspaceId: 'ws_a',
      name: 'stripe',
      endpointUrl: 'https://mcp.example.com/stripe',
    });
    await upsertDiscoveredMcpTools(env, 'ws_a', server.id, [
      {
        name: 'customers.search',
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      },
      {
        name: 'refunds.create',
        inputSchema: {},
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
    ]);

    const ready = await getProcedureLibraryReadiness(env, 'ws_a', 'refund-intake');
    expect(ready).toMatchObject({
      status: 'ready',
      ready_tool_count: 2,
      required_tool_count: 2,
    });
  });

  it('fails closed on unknown procedures and non-admin installs', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    await seedUser(db, 'usr_viewer', 'viewer@example.com');
    addMember(db, 'ws_a', 'usr_viewer', 'viewer');
    const cookie = await login(env, 'viewer@example.com');

    const missingRes = await apiApp.request(
      '/procedures/library/not-real',
      { headers: { cookie } },
      env,
    );
    const installRes = await apiApp.request(
      '/procedures/library/refund-intake/install',
      { method: 'POST', headers: { cookie } },
      env,
    );

    expect(missingRes.status).toBe(404);
    expect(installRes.status).toBe(403);
  });
});

function collectActionTools(steps: any[]): string[] {
  return collectActions(steps).map((step) => step.tool);
}

function collectActions(steps: any[]): any[] {
  const actions: any[] = [];
  for (const step of steps) {
    if (step.type === 'call_action') actions.push(step);
    if (step.type === 'if') {
      actions.push(...collectActions(step.then ?? []), ...collectActions(step.else ?? []));
    }
    if (step.type === 'loop') actions.push(...collectActions(step.steps ?? []));
  }
  return actions;
}
