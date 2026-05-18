import type { Env } from '../env';
import { runDraft, type DraftResult } from '../agents/specialists/draft';
import { agenticSearchKnowledge } from '../knowledge';
import type { AgentConfig } from '../llm/config.types';
import { simulateProcedure } from '../procedures/simulate';
import type {
  EvalAssertion,
  ProcedureEvalReport,
  ResolvedTicketEvalExpected,
  ResolvedTicketEvalInput,
} from '../types/evals';
import type { AgenticKnowledgeResult, KnowledgeHit } from '../types/knowledge';
import type { ProcedureSpec } from '../types/procedure';
import { completeEvalRun, createEvalRun, insertEvalResult, listEvalCases } from './storage';

export interface RunEvalSuiteOptions {
  source?: 'api' | 'cli' | 'ci' | 'scheduled';
  limit?: number;
  caseIds?: string[];
  threshold?: number;
  workspaceConfig?: Partial<AgentConfig>;
  retrievalRunner?: (input: ResolvedTicketEvalInput) => Promise<AgenticKnowledgeResult>;
  draftRunner?: (input: ResolvedTicketEvalInput, knowledge: KnowledgeHit[]) => Promise<DraftResult>;
}

export async function runEvalSuite(
  env: Env,
  workspaceId: string,
  options: RunEvalSuiteOptions = {},
) {
  const threshold = clampThreshold(options.threshold ?? 0.35);
  const run = await createEvalRun(env, {
    workspaceId,
    source: options.source ?? 'api',
    config: { threshold, limit: options.limit ?? null, caseIds: options.caseIds ?? null },
  });
  const cases = await listEvalCases(env, workspaceId, {
    status: 'active',
    limit: options.limit ?? 100,
    caseIds: options.caseIds,
  });
  let passedCount = 0;
  let failedCount = 0;
  let regressionCount = 0;

  for (const evalCase of cases) {
    try {
      if (evalCase.source !== 'resolved_ticket') {
        await insertEvalResult(env, {
          workspaceId,
          runId: run.id,
          caseId: evalCase.id,
          status: 'skipped',
          assertions: [
            {
              name: 'source_supported',
              passed: false,
              message: 'Only resolved_ticket cases run in hosted replay.',
            },
          ],
          actual: {},
        });
        continue;
      }
      const input = JSON.parse(evalCase.input_json) as ResolvedTicketEvalInput;
      const expected = JSON.parse(evalCase.expected_json) as ResolvedTicketEvalExpected;
      const result = await replayResolvedTicketCase(env, workspaceId, input, expected, {
        threshold,
        workspaceConfig: options.workspaceConfig,
        retrievalRunner: options.retrievalRunner,
        draftRunner: options.draftRunner,
      });
      if (result.status === 'passed') passedCount += 1;
      else {
        failedCount += 1;
        regressionCount += 1;
      }
      await insertEvalResult(env, {
        workspaceId,
        runId: run.id,
        caseId: evalCase.id,
        status: result.status,
        score: result.score,
        assertions: result.assertions,
        actual: result.actual,
        error: result.error,
      });
    } catch (err) {
      failedCount += 1;
      regressionCount += 1;
      await insertEvalResult(env, {
        workspaceId,
        runId: run.id,
        caseId: evalCase.id,
        status: 'failed',
        assertions: [{ name: 'replay_completed', passed: false }],
        actual: {},
        error: err instanceof Error ? err.message : 'eval_case_failed',
      });
    }
  }

  const completed = await completeEvalRun(env, workspaceId, run.id, {
    caseCount: cases.length,
    passedCount,
    failedCount,
    regressionCount,
  });
  return { run: completed };
}

export async function replayResolvedTicketCase(
  env: Env,
  workspaceId: string,
  input: ResolvedTicketEvalInput,
  expected: ResolvedTicketEvalExpected,
  options: {
    threshold?: number;
    workspaceConfig?: Partial<AgentConfig>;
    retrievalRunner?: (input: ResolvedTicketEvalInput) => Promise<AgenticKnowledgeResult>;
    draftRunner?: (
      input: ResolvedTicketEvalInput,
      knowledge: KnowledgeHit[],
    ) => Promise<DraftResult>;
  } = {},
): Promise<{
  status: 'passed' | 'failed';
  score: number;
  assertions: EvalAssertion[];
  actual: Record<string, unknown>;
  error?: string;
}> {
  const threshold = clampThreshold(options.threshold ?? 0.35);
  const retrieval = options.retrievalRunner
    ? await options.retrievalRunner(input)
    : await agenticSearchKnowledge(
        env,
        workspaceId,
        `${input.latest_customer_message.subject}\n${input.latest_customer_message.preview}`,
        { limit: 5, maxHops: 3, workspaceConfig: options.workspaceConfig },
      );
  const draft = options.draftRunner
    ? await options.draftRunner(input, retrieval.hits)
    : await runDraft({
        env,
        workspaceId,
        ticketId: input.ticket.id,
        customerMessage: input.latest_customer_message.preview,
        customerName: input.ticket.requester_name ?? undefined,
        knowledge: retrieval.hits,
        workspaceConfig: options.workspaceConfig,
      });
  const score = scoreTextSimilarity(expected.expected_reply_preview, draft.body_markdown);
  const required = expected.required_terms.slice(0, 5);
  const lowerDraft = draft.body_markdown.toLowerCase();
  const missingTerms = required.filter((term) => !lowerDraft.includes(term.toLowerCase()));
  const assertions: EvalAssertion[] = [
    {
      name: 'draft_non_empty',
      passed: draft.body_markdown.trim().length >= 20,
      message: 'Draft should produce a substantive answer.',
    },
    {
      name: 'semantic_overlap',
      passed: score >= threshold,
      score,
      message: `Expected overlap >= ${threshold}.`,
    },
    {
      name: 'required_terms',
      passed: missingTerms.length <= Math.max(1, Math.floor(required.length / 2)),
      message: missingTerms.length ? `Missing terms: ${missingTerms.join(', ')}` : undefined,
    },
    {
      name: 'confidence_signal',
      passed: draft.confidence >= 0.2 || draft.needs_human_review_reasons.length > 0,
      score: draft.confidence,
      message: 'Low confidence drafts must explicitly ask for review.',
    },
  ];
  const passed = assertions.every((assertion) => assertion.passed);
  return {
    status: passed ? 'passed' : 'failed',
    score,
    assertions,
    actual: {
      body_markdown: draft.body_markdown,
      subject: draft.subject,
      confidence: draft.confidence,
      cites_knowledge_ids: draft.cites_knowledge_ids,
      retrieval_trace: retrieval.trace,
    },
  };
}

export function runProcedureSpecEvals(spec: ProcedureSpec): {
  status: 'passed' | 'failed';
  case_count: number;
  passed_count: number;
  failed_count: number;
  results: ProcedureEvalReport[];
} {
  const evals = spec.evals ?? [];
  const results = evals.map((evalCase) => {
    const actual = simulateProcedure(spec, evalCase.input);
    const assertions = evaluateProcedureExpectations(actual, evalCase.expect ?? {});
    return {
      name: evalCase.name,
      status: assertions.every((assertion) => assertion.passed)
        ? ('passed' as const)
        : ('failed' as const),
      assertions,
      actual,
    };
  });
  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.length - passed;
  return {
    status: failed > 0 ? 'failed' : 'passed',
    case_count: results.length,
    passed_count: passed,
    failed_count: failed,
    results,
  };
}

export function evaluateProcedureExpectations(
  actual: unknown,
  expect: Record<string, unknown>,
): EvalAssertion[] {
  const assertions: EvalAssertion[] = [];
  if ('status' in expect) {
    assertions.push({
      name: 'status',
      passed: getPath(actual, 'status') === expect.status,
      message: `Expected status ${String(expect.status)}, got ${String(getPath(actual, 'status'))}.`,
    });
  }
  if ('context' in expect && expect.context && typeof expect.context === 'object') {
    for (const [path, expectedValue] of Object.entries(expect.context as Record<string, unknown>)) {
      const actualValue = getPath(actual, `context.${path}`);
      assertions.push({
        name: `context.${path}`,
        passed: JSON.stringify(actualValue) === JSON.stringify(expectedValue),
        message: `Expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}.`,
      });
    }
  }
  if ('steps' in expect && Array.isArray(expect.steps)) {
    const stepIds =
      (getPath(actual, 'steps') as Array<{ step_id?: string }> | undefined)?.map(
        (step) => step.step_id,
      ) ?? [];
    assertions.push({
      name: 'steps',
      passed: JSON.stringify(stepIds) === JSON.stringify(expect.steps),
      message: `Expected steps ${JSON.stringify(expect.steps)}, got ${JSON.stringify(stepIds)}.`,
    });
  }
  if (assertions.length === 0) {
    assertions.push({
      name: 'runs_without_failure',
      passed: getPath(actual, 'status') !== 'failed',
    });
  }
  return assertions;
}

export function scoreTextSimilarity(expected: string, actual: string): number {
  const expectedTokens = tokenSet(expected);
  const actualTokens = tokenSet(actual);
  if (expectedTokens.size === 0 || actualTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of expectedTokens) {
    if (actualTokens.has(token)) overlap += 1;
  }
  return Number((overlap / expectedTokens.size).toFixed(4));
}

function tokenSet(value: string): Set<string> {
  const stop = new Set([
    'about',
    'after',
    'again',
    'also',
    'because',
    'before',
    'could',
    'hello',
    'please',
    'thank',
    'thanks',
    'there',
    'these',
    'those',
    'would',
    'your',
  ]);
  return new Set(
    (value.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []).filter((token) => !stop.has(token)),
  );
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function clampThreshold(value: number) {
  if (!Number.isFinite(value)) return 0.35;
  return Math.min(Math.max(value, 0.05), 0.95);
}
