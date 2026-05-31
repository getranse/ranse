import { useEffect, useState } from 'react';
import { API } from '../../api';
import { BYOK_PROVIDERS as PROVIDERS } from '../../../config/llm';

export function LlmProvidersSection({ onSaved }: { onSaved: (msg?: string) => void }) {
  const [providers, setProviders] = useState<string[]>([]);
  const [provDraft, setProvDraft] = useState({ provider: 'openai', api_key: '' });

  async function load() {
    const p = await API.providers();
    setProviders(p.providers ?? []);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <h2>LLM providers (BYOK)</h2>
      <div className="card">
        <p className="muted">
          Add API keys for providers you want to use. Without a key, Ranse falls back to Workers AI.
        </p>
        {providers.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {providers.map((p) => (
              <span key={p} className="pill">
                {p} ✓
              </span>
            ))}
          </div>
        )}
        <div className="row">
          <select
            value={provDraft.provider}
            onChange={(e) => setProvDraft({ ...provDraft, provider: e.target.value })}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <input
            type="password"
            placeholder="API key"
            value={provDraft.api_key}
            onChange={(e) => setProvDraft({ ...provDraft, api_key: e.target.value })}
          />
          <button
            className="primary"
            onClick={async () => {
              await API.setProvider(provDraft.provider, provDraft.api_key);
              setProvDraft({ ...provDraft, api_key: '' });
              onSaved('Provider key saved');
              await load();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
}
