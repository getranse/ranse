import { useEffect, useState } from 'react';
import { API } from '../api';

const ACTIONS = ['triage', 'summarize', 'draft', 'knowledge_query', 'escalation', 'conversational'] as const;
const PROVIDERS = ['openai', 'anthropic', 'google-ai-studio', 'grok', 'openrouter'];

const MODEL_HINTS: Record<string, string[]> = {
  'workers-ai': ['workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct'],
  openai: ['openai/gpt-4o', 'openai/gpt-4o-mini', 'openai/gpt-5', 'openai/gpt-5-mini'],
  anthropic: ['anthropic/claude-opus-4-7', 'anthropic/claude-sonnet-4-6', 'anthropic/claude-haiku-4-5'],
  'google-ai-studio': ['google-ai-studio/gemini-2.5-pro', 'google-ai-studio/gemini-2.5-flash'],
};

export function SettingsView() {
  const [providers, setProviders] = useState<string[]>([]);
  const [provDraft, setProvDraft] = useState({ provider: 'openai', api_key: '' });
  const [llmConfig, setLlmConfig] = useState<any[]>([]);
  const [saved, setSaved] = useState('');

  async function load() {
    const [p, l] = await Promise.all([API.providers(), API.llmConfig()]);
    setProviders(p.providers ?? []);
    setLlmConfig(l.config ?? []);
  }
  useEffect(() => { load(); }, []);

  const configByAction = Object.fromEntries(llmConfig.map((c) => [c.action_key, c]));

  return (
    <>
      <h1>Settings</h1>

      <h2>LLM providers (BYOK)</h2>
      <div className="card">
        <p className="muted">Add API keys for providers you want to use. Without a key, Ranse falls back to Workers AI.</p>
        {providers.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {providers.map((p) => <span key={p} className="pill">{p} ✓</span>)}
          </div>
        )}
        <div className="row">
          <select value={provDraft.provider} onChange={(e) => setProvDraft({ ...provDraft, provider: e.target.value })}>
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input type="password" placeholder="API key" value={provDraft.api_key} onChange={(e) => setProvDraft({ ...provDraft, api_key: e.target.value })} />
          <button className="primary" onClick={async () => {
            await API.setProvider(provDraft.provider, provDraft.api_key);
            setProvDraft({ ...provDraft, api_key: '' });
            setSaved('Provider key saved');
            await load();
          }}>Save</button>
        </div>
      </div>

      <h2>Model per agent action</h2>
      <div className="card">
        <p className="muted">Which model does each specialist use? Leave blank to use the defaults.</p>
        {ACTIONS.map((action) => {
          const cur = configByAction[action];
          return (
            <div key={action} className="row" style={{ marginBottom: 8 }}>
              <div style={{ flex: 0.4, fontWeight: 500 }}>{action}</div>
              <input
                placeholder="provider/model-id"
                defaultValue={cur?.model_name ?? ''}
                onBlur={async (e) => {
                  if (!e.target.value) return;
                  await API.setLlmConfig({ action_key: action, model_name: e.target.value });
                  setSaved(`Saved ${action}`);
                  await load();
                }}
              />
              <input
                placeholder="fallback (optional)"
                defaultValue={cur?.fallback_model ?? ''}
                onBlur={async (e) => {
                  if (!e.target.value) return;
                  await API.setLlmConfig({ action_key: action, model_name: cur?.model_name, fallback_model: e.target.value });
                  await load();
                }}
              />
            </div>
          );
        })}
        <details style={{ marginTop: 12 }}>
          <summary className="muted">Known model IDs</summary>
          {Object.entries(MODEL_HINTS).map(([p, list]) => (
            <div key={p} style={{ marginTop: 6 }}>
              <strong>{p}</strong>
              <div style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>{list.map((m) => <div key={m}>{m}</div>)}</div>
            </div>
          ))}
        </details>
      </div>

      {saved && <div className="success-banner" style={{ position: 'fixed', bottom: 20, right: 20 }}>{saved}</div>}
    </>
  );
}
