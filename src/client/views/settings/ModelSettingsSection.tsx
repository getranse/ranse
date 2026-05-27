import { API } from '../../api';
import { ACTION_KEYS, type ActionKey } from '../../../types/llm';

type LlmConfigRow = {
  action_key: ActionKey;
  model_name?: string | null;
  fallback_model?: string | null;
};

const ACTION_LABELS: Record<ActionKey, string> = {
  triage: 'triage',
  summarize: 'summarize',
  draft: 'draft',
  knowledge_query: 'knowledge_query reranker',
  knowledge_plan: 'knowledge_plan',
  knowledge_judge: 'knowledge_judge',
  knowledge_rewrite: 'knowledge_rewrite',
  escalation: 'escalation',
  conversational: 'conversational',
};

const MODEL_HINTS: Record<string, string[]> = {
  'workers-ai': [
    'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    'workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct',
    'workers-ai/@cf/baai/bge-reranker-base',
  ],
  openai: ['openai/gpt-4o', 'openai/gpt-4o-mini', 'openai/gpt-5', 'openai/gpt-5-mini'],
  anthropic: [
    'anthropic/claude-opus-4-7',
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-haiku-4-5',
  ],
  'google-ai-studio': ['google-ai-studio/gemini-2.5-pro', 'google-ai-studio/gemini-2.5-flash'],
};

export function ModelSettingsSection({
  llmConfig,
  reload,
  onSaved,
}: {
  llmConfig: LlmConfigRow[];
  reload: () => Promise<void>;
  onSaved: (message?: string) => void;
}) {
  const configByAction = Object.fromEntries(llmConfig.map((c) => [c.action_key, c])) as Partial<
    Record<ActionKey, LlmConfigRow>
  >;

  return (
    <>
      <h2>Model per agent action</h2>
      <div className="card">
        <p className="muted">
          Which model does each specialist use? Leave blank to use the defaults.
        </p>
        {ACTION_KEYS.map((action) => {
          const cur = configByAction[action];
          return (
            <div key={action} className="row" style={{ marginBottom: 8 }}>
              <div style={{ flex: 0.4, fontWeight: 500 }}>{ACTION_LABELS[action]}</div>
              <input
                placeholder="provider/model-id"
                defaultValue={cur?.model_name ?? ''}
                onBlur={async (e) => {
                  const model = e.target.value.trim();
                  if (!model) return;
                  await API.setLlmConfig({ action_key: action, model_name: model });
                  onSaved(`Saved ${action}`);
                  await reload();
                }}
              />
              <input
                placeholder="fallback (optional)"
                defaultValue={cur?.fallback_model ?? ''}
                onBlur={async (e) => {
                  const fallback = e.target.value.trim();
                  if (!fallback || !cur?.model_name) return;
                  await API.setLlmConfig({
                    action_key: action,
                    model_name: cur.model_name,
                    fallback_model: fallback,
                  });
                  await reload();
                }}
              />
            </div>
          );
        })}
        <details style={{ marginTop: 12 }}>
          <summary className="muted">Known model IDs</summary>
          {Object.entries(MODEL_HINTS).map(([provider, list]) => (
            <div key={provider} style={{ marginTop: 6 }}>
              <strong>{provider}</strong>
              <div style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>
                {list.map((model) => (
                  <div key={model}>{model}</div>
                ))}
              </div>
            </div>
          ))}
        </details>
      </div>
    </>
  );
}
