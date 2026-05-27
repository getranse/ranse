import { api } from './core';

// LLM model config + BYOK provider keys (the /api/llm + /api/llm/providers endpoints).

export const llmApi = {
  llmConfig: () => api<any>('/api/llm'),
  setLlmConfig: (body: any) => api('/api/llm', { method: 'POST', body: JSON.stringify(body) }),
  providers: () => api<{ providers: string[] }>('/api/llm/providers'),
  setProvider: (provider: string, api_key: string) =>
    api('/api/llm/providers', { method: 'POST', body: JSON.stringify({ provider, api_key }) }),
};
