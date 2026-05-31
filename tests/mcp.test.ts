import { describe, expect, it, vi } from 'vitest';
import { apiApp } from '../src/server/http/api/routes';
import { listRemoteMcpTools } from '../src/server/automation/mcp/client';
import {
  createMcpServer,
  createMcpToolCall,
  updateMcpToolCall,
  upsertDiscoveredMcpTools,
} from '../src/server/actions/mcp';
import { decideApproval } from '../src/server/actions/approvals';
import { createProcedureRun, upsertProcedureVersion } from '../src/server/actions/procedures';
import { runProcedure } from '../src/server/automation/procedures/runner';
import {
  addMember,
  createWorkspaceTestDb,
  login,
  seedMailbox,
  seedUser,
  seedWorkspace,
} from './helpers/workspace-db';

vi.mock('agents', () => ({
  getAgentByName: () => ({
    start: async () => undefined,
    resume: async () => undefined,
    setKey: async () => undefined,
    deleteKey: async () => undefined,
    getKey: async () => null,
  }),
  Agent: class {},
  callable: () => () => undefined,
}));

function seedTicket(db: ReturnType<typeof createWorkspaceTestDb>['db']) {
  seedMailbox(db, 'ws_a', 'mb_a', 'support@example.com');
  db.prepare(
    `INSERT INTO ticket (
       id, workspace_id, mailbox_id, subject, status, priority, last_message_at,
       requester_email, thread_token, created_at, updated_at
     ) VALUES ('tkt_1', 'ws_a', 'mb_a', 'Account question', 'open', 'normal', 1, 'customer@example.com', 'tok_1', 1, 1)`,
  ).run();
}

function mockMcpFetch(result: unknown) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? '{}'));
    if (body.method === 'initialize') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'test-mcp', version: '1.0.0' },
          },
        }),
        { headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess_1' } },
      );
    }
    if (body.method === 'notifications/initialized') return new Response('', { status: 202 });
    if (body.method === 'tools/list') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              {
                name: 'customers.lookup',
                description: 'Lookup customer',
                inputSchema: { type: 'object' },
                annotations: { readOnlyHint: true },
              },
            ],
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    if (body.method === 'tools/call') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected_mcp_method:${body.method}`);
  }) as any;
}

describe('MCP client', () => {
  it('lists tools over Streamable HTTP with session headers', async () => {
    const fetchImpl = mockMcpFetch({});
    const tools = await listRemoteMcpTools(
      {
        id: 'srv_1',
        workspace_id: 'ws_a',
        name: 'billing',
        endpoint_url: 'https://mcp.example.com/mcp',
        auth_type: 'none',
        auth_header_name: null,
        secret_ref: null,
        enabled: 1,
        last_discovered_at: null,
        last_error: null,
        created_at: 1,
        updated_at: 1,
      },
      { fetchImpl },
    );

    expect(tools.map((tool) => tool.name)).toEqual(['customers.lookup']);
    const initialized = fetchImpl.mock.calls.find(([, init]: any[]) =>
      String(init.body).includes('notifications/initialized'),
    );
    expect(initialized?.[1].headers.get('mcp-session-id')).toBe('sess_1');
  });

  it('rejects unsupported protocol versions during initialization', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? '{}'));
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2024-01-01', capabilities: {}, serverInfo: {} },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as any;

    await expect(
      listRemoteMcpTools(
        {
          id: 'srv_1',
          workspace_id: 'ws_a',
          name: 'billing',
          endpoint_url: 'https://mcp.example.com/mcp',
          auth_type: 'none',
          auth_header_name: null,
          secret_ref: null,
          enabled: 1,
          last_discovered_at: null,
          last_error: null,
          created_at: 1,
          updated_at: 1,
        },
        { fetchImpl },
      ),
    ).rejects.toThrow('mcp_protocol_version_unsupported');
  });

  it('rejects oversized MCP responses before parsing JSON-RPC', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? '{}'));
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: {} },
        }),
        { headers: { 'content-type': 'application/json', 'content-length': '1000001' } },
      );
    }) as any;

    await expect(
      listRemoteMcpTools(
        {
          id: 'srv_1',
          workspace_id: 'ws_a',
          name: 'billing',
          endpoint_url: 'https://mcp.example.com/mcp',
          auth_type: 'none',
          auth_header_name: null,
          secret_ref: null,
          enabled: 1,
          last_discovered_at: null,
          last_error: null,
          created_at: 1,
          updated_at: 1,
        },
        { fetchImpl },
      ),
    ).rejects.toThrow('mcp_response_too_large');
  });
});

describe('MCP procedure actions', () => {
  it('executes read-only MCP tools from call_action and saves structured output', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedTicket(db);
    const server = await createMcpServer(env, {
      workspaceId: 'ws_a',
      name: 'billing',
      endpointUrl: 'https://mcp.example.com/mcp',
    });
    await upsertDiscoveredMcpTools(env, 'ws_a', server.id, [
      {
        name: 'customers.lookup',
        description: 'Lookup customer',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true },
      },
    ]);
    await upsertProcedureVersion(env, {
      workspaceId: 'ws_a',
      spec: {
        slug: 'mcp-lookup',
        name: 'MCP lookup',
        version: '1.0.0',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'lookup',
            type: 'call_action',
            tool: 'billing.customers.lookup',
            requires_approval: false,
            args: { email: '{{ ticket.requester_email }}' },
            save_as: 'customer_profile',
          },
          {
            id: 'note',
            type: 'add_note',
            body: 'Plan: {{ customer_profile.structuredContent.plan }}',
          },
        ],
      },
    });
    vi.stubGlobal('fetch', mockMcpFetch({ structuredContent: { plan: 'pro' } }));
    const { run } = await createProcedureRun(env, {
      workspaceId: 'ws_a',
      procedureIdOrSlug: 'mcp-lookup',
      ticketId: 'tkt_1',
      context: { ticket: { requester_email: 'customer@example.com' } },
    });

    const completed = await runProcedure(env, 'ws_a', run.id);

    expect(completed.status).toBe('completed');
    expect(db.prepare(`SELECT status FROM mcp_tool_call`).get()).toEqual({ status: 'completed' });
    expect(db.prepare(`SELECT preview FROM message_index WHERE direction = 'note'`).get()).toEqual({
      preview: 'Plan: pro',
    });
    vi.unstubAllGlobals();
  });

  it('pauses destructive MCP tools for approval and resumes after approval is decided', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedTicket(db);
    const server = await createMcpServer(env, {
      workspaceId: 'ws_a',
      name: 'billing',
      endpointUrl: 'https://mcp.example.com/mcp',
    });
    await upsertDiscoveredMcpTools(env, 'ws_a', server.id, [
      {
        name: 'refunds.create',
        description: 'Create refund',
        inputSchema: { type: 'object' },
        annotations: { destructiveHint: true },
      },
    ]);
    await upsertProcedureVersion(env, {
      workspaceId: 'ws_a',
      spec: {
        slug: 'mcp-refund',
        name: 'MCP refund',
        version: '1.0.0',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'refund',
            type: 'call_action',
            tool: 'billing.refunds.create',
            args: { amount_cents: 1200 },
            save_as: 'refund',
          },
        ],
      },
    });
    vi.stubGlobal('fetch', mockMcpFetch({ structuredContent: { refund_id: 're_123' } }));
    const { run } = await createProcedureRun(env, {
      workspaceId: 'ws_a',
      procedureIdOrSlug: 'mcp-refund',
      ticketId: 'tkt_1',
    });

    const waiting = await runProcedure(env, 'ws_a', run.id);
    const approval = db
      .prepare(`SELECT id, status FROM approval_request WHERE kind = 'call_external'`)
      .get() as any;
    await decideApproval(env, approval.id, 'approved', 'operator', 'ws_a');
    const completed = await runProcedure(env, 'ws_a', run.id, {
      event: { type: 'approval_decided', payload: { approvalId: approval.id, approved: true } },
    });

    expect(waiting.status).toBe('waiting');
    expect(approval.status).toBe('pending');
    expect(completed.status).toBe('completed');
    expect(db.prepare(`SELECT status FROM mcp_tool_call`).get()).toEqual({ status: 'completed' });
    vi.unstubAllGlobals();
  });

  it('reuses a recorded MCP tool call when a procedure retries after the external call finished', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    seedTicket(db);
    const server = await createMcpServer(env, {
      workspaceId: 'ws_a',
      name: 'billing',
      endpointUrl: 'https://mcp.example.com/mcp',
    });
    await upsertDiscoveredMcpTools(env, 'ws_a', server.id, [
      {
        name: 'customers.lookup',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true },
      },
    ]);
    await upsertProcedureVersion(env, {
      workspaceId: 'ws_a',
      spec: {
        slug: 'mcp-retry',
        name: 'MCP retry',
        version: '1.0.0',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'lookup',
            type: 'call_action',
            tool: 'billing.customers.lookup',
            requires_approval: false,
            args: { email: 'customer@example.com' },
            save_as: 'customer_profile',
          },
          { id: 'note', type: 'add_note', body: 'Plan: {{ customer_profile.structuredContent.plan }}' },
        ],
      },
    });
    const { run } = await createProcedureRun(env, {
      workspaceId: 'ws_a',
      procedureIdOrSlug: 'mcp-retry',
      ticketId: 'tkt_1',
    });
    const call = await createMcpToolCall(env, {
      workspaceId: 'ws_a',
      serverId: server.id,
      toolName: 'customers.lookup',
      ticketId: 'tkt_1',
      procedureRunId: run.id,
      procedureStepId: 'lookup',
      procedureStepIndex: 0,
      status: 'running',
      args: { email: 'customer@example.com' },
    });
    await updateMcpToolCall(env, 'ws_a', call.id, {
      status: 'completed',
      result: { structuredContent: { plan: 'enterprise' } },
    });
    const fetchImpl = vi.fn(async () => {
      throw new Error('external_call_should_not_repeat');
    });
    vi.stubGlobal('fetch', fetchImpl);

    const completed = await runProcedure(env, 'ws_a', run.id);

    expect(completed.status).toBe('completed');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM mcp_tool_call`).get()).toEqual({ n: 1 });
    expect(db.prepare(`SELECT preview FROM message_index WHERE direction = 'note'`).get()).toEqual({
      preview: 'Plan: enterprise',
    });
    vi.unstubAllGlobals();
  });

  it('removes stale tools when rediscovery no longer returns them', async () => {
    const { db, env } = createWorkspaceTestDb();
    seedWorkspace(db, 'ws_a', 'Alpha');
    const server = await createMcpServer(env, {
      workspaceId: 'ws_a',
      name: 'billing',
      endpointUrl: 'https://mcp.example.com/mcp',
    });
    await upsertDiscoveredMcpTools(env, 'ws_a', server.id, [
      { name: 'customers.lookup', annotations: { readOnlyHint: true } },
      { name: 'refunds.create', annotations: { destructiveHint: true } },
    ]);

    await upsertDiscoveredMcpTools(env, 'ws_a', server.id, [
      { name: 'customers.lookup', annotations: { readOnlyHint: true } },
    ]);

    expect(db.prepare(`SELECT name FROM mcp_tool ORDER BY name`).all()).toEqual([
      { name: 'customers.lookup' },
    ]);
  });
});

describe('MCP API', () => {
  it('registers and discovers MCP servers through owner routes', async () => {
    const { db, env } = createWorkspaceTestDb();
    await seedUser(db, 'owner', 'owner@example.com');
    seedWorkspace(db, 'ws_a', 'Alpha');
    addMember(db, 'ws_a', 'owner', 'owner');
    vi.stubGlobal('fetch', mockMcpFetch({}));

    const cookie = await login(env, 'owner@example.com');
    const created = await apiApp.request(
      '/mcp/servers',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'billing',
          endpoint_url: 'https://mcp.example.com/mcp',
          auth_type: 'none',
        }),
      },
      env,
    );
    const body: any = await created.json();
    const discovered = await apiApp.request(
      `/mcp/servers/${body.server.id}/discover`,
      { method: 'POST', headers: { cookie } },
      env,
    );

    expect(created.status).toBe(200);
    expect(discovered.status).toBe(200);
    expect(db.prepare(`SELECT name FROM mcp_tool`).get()).toEqual({ name: 'customers.lookup' });
    vi.unstubAllGlobals();
  });
});
