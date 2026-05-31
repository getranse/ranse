import type { DiagramNode, DiagramEdge, ProcedureDiagram, LayoutCtx, PushNodeInput } from '../../../interfaces/procedures';
export type { DiagramNode, DiagramEdge, ProcedureDiagram };
import type { ProcedureSpec, ProcedureStep } from '../../../types/shared/procedure';

// Pure procedure-flow layout. Converts a `ProcedureSpec` into a list of
// nodes + edges with absolute pixel positions, ready for an SVG renderer.
// The shape choice mirrors flowchart conventions:
//   - terminal:    rounded "start" / "end" labels
//   - process:     rectangle (call_action, add_note, set_ticket_field,
//                  escalate_to, search)
//   - io:          parallelogram (ask_customer, wait_for_event)
//   - decision:    diamond (if)
//   - loop:        rectangle with double-stroke border, contains children
//
// The renderer is intentionally simple: a vertical waterfall with branches
// indenting right and rejoining at the next sequential step. This is the
// same compromise tools like draw.io's "auto-layout" make for sequential
// flowcharts — readable for ~80% of procedures, with manual editing
// reserved for the few that warrant it.

const NODE_WIDTH = 240;
const NODE_HEIGHT = 56;
const VERTICAL_GAP = 36;
const BRANCH_INDENT = 60;
const PADDING = 24;

export type DiagramNodeShape = 'terminal' | 'process' | 'io' | 'decision' | 'loop_container';

export function layoutProcedure(spec: ProcedureSpec): ProcedureDiagram {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const ctx: LayoutCtx = {
    nextY: PADDING,
    counter: { value: 0 },
    nodes,
    edges,
    minX: PADDING,
    maxX: PADDING + NODE_WIDTH,
  };

  const startId = pushNode(ctx, {
    shape: 'terminal',
    label: 'Start',
    sublabel: triggerLabel(spec.trigger.type),
  });

  const lastStepIds = layoutSteps(ctx, spec.steps, PADDING, startId);

  const endId = pushNode(ctx, {
    shape: 'terminal',
    label: 'End',
  });
  for (const last of lastStepIds) {
    edges.push({ fromId: last, toId: endId });
  }

  return {
    width: ctx.maxX + PADDING,
    height: ctx.nextY + PADDING,
    nodes,
    edges,
  };
}

function layoutSteps(
  ctx: LayoutCtx,
  steps: ProcedureStep[],
  x: number,
  enteringFrom: string,
): string[] {
  let previous: string[] = [enteringFrom];
  for (const step of steps) {
    const ids = layoutStep(ctx, step, x);
    for (const prev of previous) {
      ctx.edges.push({ fromId: prev, toId: ids.entry });
    }
    previous = ids.exits;
  }
  return previous;
}

function layoutStep(
  ctx: LayoutCtx,
  step: ProcedureStep,
  x: number,
): { entry: string; exits: string[] } {
  if (step.type === 'if') {
    return layoutIfStep(ctx, step, x);
  }
  if (step.type === 'loop') {
    return layoutLoopStep(ctx, step, x);
  }
  const node = pushNode(ctx, {
    shape: shapeFor(step.type),
    label: labelFor(step),
    sublabel: sublabelFor(step),
    stepType: step.type,
    approvalGate: step.type === 'call_action' && step.requires_approval === true,
    x,
  });
  return { entry: node, exits: [node] };
}

function layoutIfStep(
  ctx: LayoutCtx,
  step: Extract<ProcedureStep, { type: 'if' }>,
  x: number,
): { entry: string; exits: string[] } {
  const decisionId = pushNode(ctx, {
    shape: 'decision',
    label: 'if',
    sublabel: `${step.condition.var} ${describeCondition(step.condition)}`,
    stepType: 'if',
    x,
  });
  const branchX = x + BRANCH_INDENT;
  const thenExits = layoutSteps(ctx, step.then, branchX, decisionId);
  // Re-label the first edge into the `then` branch.
  const firstThenEdge = ctx.edges.findIndex((e) => e.fromId === decisionId && !e.label);
  if (firstThenEdge >= 0) ctx.edges[firstThenEdge].label = 'yes';
  const elseExits =
    step.else && step.else.length > 0
      ? layoutSteps(ctx, step.else, branchX, decisionId)
      : [decisionId];
  const lastElseEdge = ctx.edges.findIndex((e) => e.fromId === decisionId && !e.label);
  if (lastElseEdge >= 0) ctx.edges[lastElseEdge].label = 'no';
  return { entry: decisionId, exits: [...thenExits, ...elseExits] };
}

function layoutLoopStep(
  ctx: LayoutCtx,
  step: Extract<ProcedureStep, { type: 'loop' }>,
  x: number,
): { entry: string; exits: string[] } {
  const header = pushNode(ctx, {
    shape: 'loop_container',
    label: `loop ${step.each}${step.max_iterations ? ` (max ${step.max_iterations})` : ''}`,
    stepType: 'loop',
    x,
  });
  const innerExits = layoutSteps(ctx, step.steps, x + BRANCH_INDENT, header);
  return { entry: header, exits: innerExits };
}

function pushNode(ctx: LayoutCtx, input: PushNodeInput): string {
  ctx.counter.value += 1;
  const id = `n${ctx.counter.value}`;
  const x = input.x ?? PADDING;
  const node: DiagramNode = {
    id,
    shape: input.shape,
    label: input.label,
    sublabel: input.sublabel,
    stepType: input.stepType,
    approvalGate: input.approvalGate,
    x,
    y: ctx.nextY,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  };
  ctx.nodes.push(node);
  ctx.nextY += NODE_HEIGHT + VERTICAL_GAP;
  if (x + NODE_WIDTH > ctx.maxX) ctx.maxX = x + NODE_WIDTH;
  return id;
}

function shapeFor(type: ProcedureStep['type']): DiagramNodeShape {
  if (type === 'if') return 'decision';
  if (type === 'loop') return 'loop_container';
  if (type === 'ask_customer' || type === 'wait_for_event') return 'io';
  return 'process';
}

function labelFor(step: ProcedureStep): string {
  if (step.type === 'call_action') return `call ${step.tool}`;
  if (step.type === 'set_ticket_field') return `set ${step.field} = ${step.value}`;
  if (step.type === 'search') return `search ${step.scope ?? 'all'}`;
  if (step.type === 'add_note') return 'add internal note';
  if (step.type === 'ask_customer') return 'ask customer';
  if (step.type === 'wait_for_event') return `wait for ${step.event}`;
  if (step.type === 'escalate_to') return `escalate → ${step.route_to}`;
  return step.type;
}

function sublabelFor(step: ProcedureStep): string | undefined {
  if (step.type === 'call_action' && step.requires_approval) return 'requires approval';
  if (step.type === 'search') return step.query.slice(0, 60);
  if (step.type === 'ask_customer') return step.message.slice(0, 60);
  if (step.type === 'add_note') return step.body.slice(0, 60);
  if (step.type === 'wait_for_event' && step.timeout_ms) {
    return `timeout ${Math.round(step.timeout_ms / 60_000)}m`;
  }
  return undefined;
}

function describeCondition(c: {
  exists?: boolean;
  equals?: unknown;
  not_equals?: unknown;
}): string {
  if (c.exists === true) return 'exists';
  if (c.exists === false) return 'is missing';
  if (c.equals !== undefined) return `== ${JSON.stringify(c.equals)}`;
  if (c.not_equals !== undefined) return `!= ${JSON.stringify(c.not_equals)}`;
  return '';
}

function triggerLabel(type: string): string {
  if (type === 'manual') return 'manual';
  if (type === 'ticket_created') return 'on ticket created';
  if (type === 'intent') return 'on detected intent';
  return type;
}
