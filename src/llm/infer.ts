import type { z } from 'zod';
import type { Env } from '../env';
import { DEFAULT_AGENT_CONFIG } from './config';
import { MODELS_MASTER } from './config.types';
import type { ActionKey, AgentConfig, CallMetadata, ModelConfig, RuntimeOverrides } from './config.types';
import { resolveClient } from './core';

/** Providers that need an external API key configured. workers-ai is auth'd
 * via env.AI binding — no key required. */
const PROVIDERS_NEED_KEY: Record<string, keyof Env> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  'google-ai-studio': 'GOOGLE_AI_STUDIO_API_KEY',
  grok: 'GROK_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
};

function modelHasUsableAuth(modelName: string, env: Env, overrides?: RuntimeOverrides): boolean {
  const spec = MODELS_MASTER[modelName];
  if (!spec) return true; // unknown model — let the call attempt happen
  const provider = spec.provider;
  if (provider === 'workers-ai') return true;
  if (overrides?.userApiKeys?.[provider]) return true;
  const envKey = PROVIDERS_NEED_KEY[provider];
  return envKey ? !!env[envKey] : true;
}

export interface InferParams<T extends z.ZodTypeAny = z.ZodTypeAny> {
  env: Env;
  action: ActionKey;
  system: string;
  user: string;
  schema?: T;
  schemaName?: string;
  metadata: Omit<CallMetadata, 'actionKey'>;
  overrides?: RuntimeOverrides;
  workspaceConfig?: Partial<AgentConfig>;
  maxAttempts?: number;
}

export interface InferResult<T = unknown> {
  data: T;
  model: string;
  attempts: number;
  fellBackTo?: string;
}

async function resolveModelConfig(action: ActionKey, workspaceConfig?: Partial<AgentConfig>): Promise<ModelConfig> {
  return { ...DEFAULT_AGENT_CONFIG[action], ...(workspaceConfig?.[action] ?? {}) };
}

/**
 * Call Workers AI via the AI binding directly. Bypasses AI Gateway's
 * /compat endpoint entirely — that path has finicky auth requirements
 * (Cloudflare API token with workers-ai:run permission) that aren't
 * always satisfied by the deploy-time CLOUDFLARE_API_TOKEN. The
 * binding handles auth automatically and always works.
 */
async function callWorkersAI<T extends z.ZodTypeAny>(
  params: InferParams<T>,
  modelId: string,
  cfg: ModelConfig,
): Promise<z.infer<T> | string> {
  const schemaInstruction = params.schema
    ? '\n\nReply with ONLY a single JSON object matching the requested schema. No prose, no code fence, no preamble.'
    : '';
  const messages = [
    { role: 'system' as const, content: params.system },
    { role: 'user' as const, content: params.user + schemaInstruction },
  ];
  const response = await (params.env as any).AI.run(modelId, {
    messages,
    max_tokens: cfg.maxTokens,
    temperature: cfg.temperature,
  });
  // Workers AI's response shape varies by model and input — sometimes
  // `{ response: "text" }`, sometimes `{ response: { content: "text" } }`,
  // sometimes a raw string, sometimes an OpenAI-style choices array. Coerce
  // defensively so a shape mismatch doesn't blow up downstream `.match()`.
  const rawText =
    typeof response === 'string'
      ? response
      : (response?.response ??
          response?.choices?.[0]?.message?.content ??
          response?.output_text ??
          response?.result?.response);
  const text =
    typeof rawText === 'string'
      ? rawText
      : rawText && typeof rawText === 'object' && 'content' in rawText && typeof rawText.content === 'string'
        ? rawText.content
        : JSON.stringify(rawText ?? response ?? '');

  if (!params.schema) return text;
  // Llama models sometimes wrap JSON in code fences or add stray prose
  // around it. Extract the largest balanced {...} block; fall through to
  // raw parse if extraction misses.
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  const candidate = fenced?.[1] ?? text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  return params.schema.parse(JSON.parse(candidate));
}

async function callOnce<T extends z.ZodTypeAny>(
  params: InferParams<T>,
  modelName: string,
  cfg: ModelConfig,
): Promise<z.infer<T> | string> {
  const meta: CallMetadata = { ...params.metadata, actionKey: params.action };
  const { client, modelId, spec } = await resolveClient({
    env: params.env,
    overrides: params.overrides,
    metadata: meta,
    modelName,
  } as any);

  // Workers AI: use env.AI.run() directly. Skips AI Gateway /compat (which
  // has flaky/undocumented auth requirements) and authenticates via the AI
  // binding — always works as long as env.AI is bound. Adapts the response
  // shape to match what the OpenAI SDK path returns so downstream parsing
  // stays the same.
  if (spec.provider === 'workers-ai' && (params.env as any).AI) {
    return callWorkersAI<T>(params, modelId, cfg);
  }

  // /compat endpoint of AI Gateway requires `provider/model` format so it
  // knows which provider to dispatch to. Direct provider endpoints (e.g.
  // /openai with OPENAI_API_KEY) just want the bare model name.
  const apiModelName = spec.directOverride ? modelId : `${spec.provider}/${modelId}`;

  const messages = [
    { role: 'system' as const, content: params.system },
    { role: 'user' as const, content: params.user },
  ];

  if (params.schema && spec.supportsJsonSchema) {
    const { zodResponseFormat } = await import('openai/helpers/zod.mjs');
    const completion = await client.chat.completions.parse({
      model: apiModelName,
      messages,
      temperature: cfg.temperature,
      max_completion_tokens: cfg.maxTokens,
      reasoning_effort: spec.nonReasoning ? undefined : cfg.reasoningEffort,
      response_format: zodResponseFormat(params.schema, params.schemaName ?? params.action),
    } as any);
    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) throw new Error('No parsed output');
    return parsed as z.infer<T>;
  }

  const completion = await client.chat.completions.create({
    model: apiModelName,
    messages,
    temperature: cfg.temperature,
    max_completion_tokens: cfg.maxTokens,
    reasoning_effort: spec.nonReasoning ? undefined : cfg.reasoningEffort,
  } as any);
  const text = completion.choices[0]?.message?.content ?? '';
  if (params.schema) return params.schema.parse(JSON.parse(text));
  return text;
}

export async function infer<T extends z.ZodTypeAny>(params: InferParams<T>): Promise<InferResult<z.infer<T>>>;
export async function infer(params: InferParams<z.ZodTypeAny> & { schema?: undefined }): Promise<InferResult<string>>;
export async function infer(params: InferParams): Promise<InferResult> {
  const cfg = await resolveModelConfig(params.action, params.workspaceConfig);
  const maxAttempts = params.maxAttempts ?? 3;
  // Filter candidates whose provider needs an API key we don't have. Avoids
  // burning retries on a 401 fallback (e.g. anthropic without ANTHROPIC_API_KEY).
  const candidates = [cfg.model, cfg.fallbackModel]
    .filter(Boolean)
    .filter((m) => modelHasUsableAuth(m as string, params.env, params.overrides)) as string[];
  if (candidates.length === 0) {
    throw new Error(
      `No usable LLM for action "${params.action}" — primary "${cfg.model}" and fallback "${cfg.fallbackModel ?? '(none)'}" both require API keys that aren't configured. Add a key in /settings/providers, set the corresponding Worker secret, or change the model to a workers-ai/ option.`,
    );
  }

  let lastError: unknown;
  let attempts = 0;
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    for (let a = 0; a < maxAttempts; a++) {
      attempts++;
      try {
        const data = await callOnce(params as any, model, cfg);
        return { data, model, attempts, fellBackTo: i > 0 ? model : undefined };
      } catch (err) {
        lastError = err;
        const backoff = 200 * 2 ** a + Math.floor(Math.random() * 100);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastError ?? new Error('infer failed');
}
