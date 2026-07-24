// Master model registry: every model name the dispatcher accepts, with its
// provider and capability flags. Operators extend this to add models.
import type { ModelSpec } from '../server/schemas/llm';

export const MODELS_MASTER: Record<string, ModelSpec> = {
  'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast': {
    provider: 'workers-ai',
    contextSize: 128_000,
    nonReasoning: true,
    // directOverride was true here previously but that pointed the OpenAI SDK
    // at AI Gateway's /workers-ai endpoint, which is Cloudflare's native API
    // shape — not OpenAI chat.completions. Routing through /compat instead
    // lets the gateway translate the OpenAI-format request to Workers AI.
    supportsTools: true,
    supportsJsonSchema: true,
  },
  'workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct': {
    provider: 'workers-ai',
    contextSize: 128_000,
    nonReasoning: true,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  'openai/gpt-4o': {
    provider: 'openai',
    contextSize: 128_000,
    nonReasoning: true,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  'openai/gpt-4o-mini': {
    provider: 'openai',
    contextSize: 128_000,
    nonReasoning: true,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  'openai/gpt-5': {
    provider: 'openai',
    contextSize: 400_000,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  'openai/gpt-5-mini': {
    provider: 'openai',
    contextSize: 400_000,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  'anthropic/claude-opus-4-7': {
    provider: 'anthropic',
    contextSize: 1_000_000,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  'anthropic/claude-sonnet-4-6': {
    provider: 'anthropic',
    contextSize: 1_000_000,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  'anthropic/claude-haiku-4-5': {
    provider: 'anthropic',
    contextSize: 200_000,
    nonReasoning: true,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  'google-ai-studio/gemini-2.5-pro': {
    provider: 'google-ai-studio',
    contextSize: 1_000_000,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  'google-ai-studio/gemini-2.5-flash': {
    provider: 'google-ai-studio',
    contextSize: 1_000_000,
    nonReasoning: true,
    supportsTools: true,
    supportsJsonSchema: true,
  },
};
