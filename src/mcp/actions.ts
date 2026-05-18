import type { Env } from '../env';
import { createApproval } from '../lib/approvals';
import { audit } from '../lib/audit';
import type { ProcedureRun, ProcedureStep } from '../types/procedure';
import { callRemoteMcpTool } from './client';
import { evaluateMcpGuardrails } from './guardrails';
import {
  createMcpToolCall,
  getMcpServer,
  getMcpTool,
  getMcpToolCall,
  getMcpToolCallForProcedureStep,
  resolveMcpToolReference,
  updateMcpToolCall,
} from './storage';
import { getMcpAuthSecret } from './secrets';

type CallActionStep = Extract<ProcedureStep, { type: 'call_action' }>;

export type McpProcedureActionResult =
  | { status: 'completed'; output: Record<string, unknown> }
  | { status: 'waiting'; output: Record<string, unknown> }
  | { status: 'failed'; error: string; output?: Record<string, unknown> };

export async function startMcpProcedureAction(
  env: Env,
  workspaceId: string,
  input: {
    run: ProcedureRun;
    step: CallActionStep;
    stepIndex: number;
    args: Record<string, unknown>;
    customerSegment?: string | null;
  },
): Promise<McpProcedureActionResult> {
  const existing = await getMcpToolCallForProcedureStep(
    env,
    workspaceId,
    input.run.id,
    input.stepIndex,
  );
  if (existing) {
    return continueRecordedMcpProcedureAction(env, workspaceId, {
      call: existing,
      run: input.run,
      step: input.step,
      stepIndex: input.stepIndex,
    });
  }

  const { server, tool } = await resolveMcpToolReference(env, workspaceId, input.step.tool);
  if (server.enabled !== 1) {
    return { status: 'failed', error: 'mcp_server_disabled', output: { server: server.name, tool: tool.name } };
  }

  const decision = await evaluateMcpGuardrails(env, workspaceId, {
    serverId: server.id,
    tool,
    ticketId: input.run.ticket_id,
    toolArgs: input.args,
    procedureRequiresApproval: input.step.requires_approval,
    customerSegment: input.customerSegment ?? null,
  });

  if (!decision.allowed) {
    const call = await createMcpToolCall(env, {
      workspaceId,
      serverId: server.id,
      toolName: tool.name,
      ticketId: input.run.ticket_id,
      procedureRunId: input.run.id,
      procedureStepId: input.step.id,
      procedureStepIndex: input.stepIndex,
      status: 'blocked',
      args: input.args,
    });
    await updateMcpToolCall(env, workspaceId, call.id, {
      status: 'blocked',
      error: decision.blockedReason,
    });
    await auditMcpCall(env, workspaceId, input.run.ticket_id, 'mcp.tool_call_blocked', {
      serverId: server.id,
      serverName: server.name,
      toolName: tool.name,
      toolCallId: call.id,
      reason: decision.blockedReason,
    });
    return {
      status: 'failed',
      error: decision.blockedReason ?? 'mcp_tool_blocked',
      output: { server: server.name, tool: tool.name, tool_call_id: call.id },
    };
  }

  if (decision.requiresApproval) {
    const call = await createMcpToolCall(env, {
      workspaceId,
      serverId: server.id,
      toolName: tool.name,
      ticketId: input.run.ticket_id,
      procedureRunId: input.run.id,
      procedureStepId: input.step.id,
      procedureStepIndex: input.stepIndex,
      status: 'pending_approval',
      args: input.args,
    });
    const approvalId = await createApproval(env, {
      workspaceId,
      ticketId: input.run.ticket_id,
      kind: 'call_external',
      proposed: {
        kind: 'mcp_tool_call',
        server_id: server.id,
        server_name: server.name,
        tool_name: tool.name,
        tool_title: tool.title,
        tool_call_id: call.id,
        procedure_run_id: input.run.id,
        procedure_step_id: input.step.id,
        procedure_step_index: input.stepIndex,
        args: input.args,
        read_only_hint: tool.read_only_hint === null ? null : tool.read_only_hint === 1,
        destructive_hint: tool.destructive_hint === null ? null : tool.destructive_hint === 1,
      },
      riskReasons: decision.reasons.length ? decision.reasons : ['external_action_requires_review'],
    });
    await updateMcpToolCall(env, workspaceId, call.id, {
      status: 'pending_approval',
      approvalRequestId: approvalId,
    });
    await auditMcpCall(env, workspaceId, input.run.ticket_id, 'mcp.tool_call_approval_requested', {
      serverId: server.id,
      serverName: server.name,
      toolName: tool.name,
      toolCallId: call.id,
      approvalId,
      reasons: decision.reasons,
    });
    return {
      status: 'waiting',
      output: {
        waits_for: 'approval_decided',
        approval_id: approvalId,
        tool_call_id: call.id,
        server: server.name,
        tool: tool.name,
        reasons: decision.reasons,
      },
    };
  }

  const call = await createMcpToolCall(env, {
    workspaceId,
    serverId: server.id,
    toolName: tool.name,
    ticketId: input.run.ticket_id,
    procedureRunId: input.run.id,
    procedureStepId: input.step.id,
    procedureStepIndex: input.stepIndex,
    status: 'running',
    args: input.args,
  });
  return executeRecordedMcpToolCall(env, workspaceId, {
    callId: call.id,
    ticketId: input.run.ticket_id,
  });
}

async function continueRecordedMcpProcedureAction(
  env: Env,
  workspaceId: string,
  input: {
    call: NonNullable<Awaited<ReturnType<typeof getMcpToolCallForProcedureStep>>>;
    run: ProcedureRun;
    step: CallActionStep;
    stepIndex: number;
  },
): Promise<McpProcedureActionResult> {
  const call = input.call;
  const server = await getMcpServer(env, workspaceId, call.server_id);
  const tool = await getMcpTool(env, workspaceId, call.server_id, call.tool_name);
  if (call.status === 'completed') {
    return { status: 'completed', output: normalizeToolCallOutput(call.result_json, call.id) };
  }
  if (call.status === 'pending_approval') {
    const approvalId =
      call.approval_request_id ??
      (await createRecoveredMcpApproval(env, workspaceId, {
        call,
        run: input.run,
        step: input.step,
        stepIndex: input.stepIndex,
        serverName: server?.name ?? call.server_id,
        toolTitle: tool?.title ?? null,
        readOnlyHint: tool?.read_only_hint ?? null,
        destructiveHint: tool?.destructive_hint ?? null,
      }));
    return {
      status: 'waiting',
      output: {
        waits_for: 'approval_decided',
        approval_id: approvalId,
        tool_call_id: call.id,
        server: server?.name ?? call.server_id,
        tool: call.tool_name,
      },
    };
  }
  if (call.status === 'running') {
    return executeRecordedMcpToolCall(env, workspaceId, { callId: call.id, ticketId: input.run.ticket_id });
  }
  return {
    status: 'failed',
    error: call.error ?? call.status,
    output: { tool_call_id: call.id, tool: call.tool_name },
  };
}

async function createRecoveredMcpApproval(
  env: Env,
  workspaceId: string,
  input: {
    call: NonNullable<Awaited<ReturnType<typeof getMcpToolCallForProcedureStep>>>;
    run: ProcedureRun;
    step: CallActionStep;
    stepIndex: number;
    serverName: string;
    toolTitle: string | null;
    readOnlyHint: number | null;
    destructiveHint: number | null;
  },
): Promise<string> {
  const approvalId = await createApproval(env, {
    workspaceId,
    ticketId: input.run.ticket_id,
    kind: 'call_external',
    proposed: {
      kind: 'mcp_tool_call',
      server_id: input.call.server_id,
      server_name: input.serverName,
      tool_name: input.call.tool_name,
      tool_title: input.toolTitle,
      tool_call_id: input.call.id,
      procedure_run_id: input.run.id,
      procedure_step_id: input.step.id,
      procedure_step_index: input.stepIndex,
      args: safeJson(input.call.args_json),
      read_only_hint: input.readOnlyHint === null ? null : input.readOnlyHint === 1,
      destructive_hint: input.destructiveHint === null ? null : input.destructiveHint === 1,
    },
    riskReasons: ['external_action_requires_review'],
  });
  await updateMcpToolCall(env, workspaceId, input.call.id, {
    status: 'pending_approval',
    approvalRequestId: approvalId,
  });
  return approvalId;
}

export async function resumeApprovedMcpProcedureAction(
  env: Env,
  workspaceId: string,
  input: {
    run: ProcedureRun;
    event?: { type: string; payload?: Record<string, unknown> };
    waitingOutput: Record<string, unknown>;
    currentStep: number;
  },
): Promise<McpProcedureActionResult & { currentStep?: number }> {
  if (input.event?.type !== 'approval_decided') {
    return { status: 'waiting', output: input.waitingOutput, currentStep: input.currentStep };
  }
  const expectedApprovalId = String(input.waitingOutput.approval_id ?? '');
  const eventApprovalId = String(input.event.payload?.approvalId ?? input.event.payload?.approval_id ?? '');
  if (!expectedApprovalId || eventApprovalId !== expectedApprovalId) {
    return { status: 'waiting', output: input.waitingOutput, currentStep: input.currentStep };
  }

  const callId = String(input.waitingOutput.tool_call_id ?? '');
  const call = callId ? await getMcpToolCall(env, workspaceId, callId) : null;
  if (!call) return { status: 'failed', error: 'mcp_tool_call_not_found', output: input.waitingOutput };

  const approved = input.event.payload?.approved === true;
  if (!approved) {
    await updateMcpToolCall(env, workspaceId, call.id, {
      status: 'blocked',
      error: 'mcp_action_rejected',
    });
    await auditMcpCall(env, workspaceId, input.run.ticket_id, 'mcp.tool_call_rejected', {
      toolCallId: call.id,
      approvalId: expectedApprovalId,
    });
    return { status: 'failed', error: 'mcp_action_rejected', output: { ...input.waitingOutput, rejected: true } };
  }

  const approval = await env.DB.prepare(
    `SELECT status FROM approval_request WHERE id = ? AND workspace_id = ? AND ticket_id = ?`,
  )
    .bind(expectedApprovalId, workspaceId, input.run.ticket_id)
    .first<{ status: string }>();
  if (approval?.status !== 'approved') {
    return { status: 'waiting', output: input.waitingOutput, currentStep: input.currentStep };
  }

  if (call.status === 'completed') {
    return {
      status: 'completed',
      output: normalizeToolCallOutput(call.result_json, call.id),
    };
  }
  if (call.status === 'failed' || call.status === 'blocked') {
    return {
      status: 'failed',
      error: call.error ?? call.status,
      output: normalizeToolCallOutput(call.result_json, call.id),
    };
  }

  await updateMcpToolCall(env, workspaceId, call.id, { status: 'running' });
  return executeRecordedMcpToolCall(env, workspaceId, {
    callId: call.id,
    ticketId: input.run.ticket_id,
  });
}

async function executeRecordedMcpToolCall(
  env: Env,
  workspaceId: string,
  input: { callId: string; ticketId: string },
): Promise<McpProcedureActionResult> {
  const call = await getMcpToolCall(env, workspaceId, input.callId);
  if (!call) return { status: 'failed', error: 'mcp_tool_call_not_found' };
  const server = await getMcpServer(env, workspaceId, call.server_id);
  const tool = await getMcpTool(env, workspaceId, call.server_id, call.tool_name);
  if (!server || !tool) return { status: 'failed', error: 'mcp_tool_not_found' };
  if (server.enabled !== 1) return { status: 'failed', error: 'mcp_server_disabled' };

  const toolArgs = asObject(safeJson(call.args_json));
  try {
    const result = await callRemoteMcpTool(server, tool.name, toolArgs, {
      authSecret: await getMcpAuthSecret(env, workspaceId, server),
      idempotencyKey: call.idempotency_key,
    });
    if (result.isError === true) {
      await updateMcpToolCall(env, workspaceId, call.id, {
        status: 'failed',
        result,
        error: 'mcp_tool_error',
      });
      await auditMcpCall(env, workspaceId, input.ticketId, 'mcp.tool_call_failed', {
        serverId: server.id,
        serverName: server.name,
        toolName: tool.name,
        toolCallId: call.id,
        error: 'mcp_tool_error',
      });
      return {
        status: 'failed',
        error: 'mcp_tool_error',
        output: { tool_call_id: call.id, server: server.name, tool: tool.name, result },
      };
    }

    await updateMcpToolCall(env, workspaceId, call.id, { status: 'completed', result });
    await auditMcpCall(env, workspaceId, input.ticketId, 'mcp.tool_call_completed', {
      serverId: server.id,
      serverName: server.name,
      toolName: tool.name,
      toolCallId: call.id,
    });
    return {
      status: 'completed',
      output: { tool_call_id: call.id, server: server.name, tool: tool.name, result },
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'mcp_tool_call_failed';
    await updateMcpToolCall(env, workspaceId, call.id, {
      status: 'failed',
      error,
    });
    await auditMcpCall(env, workspaceId, input.ticketId, 'mcp.tool_call_failed', {
      serverId: server.id,
      serverName: server.name,
      toolName: tool.name,
      toolCallId: call.id,
      error,
    });
    return {
      status: 'failed',
      error,
      output: { tool_call_id: call.id, server: server.name, tool: tool.name },
    };
  }
}

async function auditMcpCall(
  env: Env,
  workspaceId: string,
  ticketId: string,
  action: string,
  payload: Record<string, unknown>,
) {
  await audit(env, {
    workspaceId,
    ticketId,
    actorType: 'agent',
    actorId: 'procedure',
    action,
    payload,
  });
}

function normalizeToolCallOutput(resultJson: string, callId: string): Record<string, unknown> {
  return { tool_call_id: callId, result: safeJson(resultJson) };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
