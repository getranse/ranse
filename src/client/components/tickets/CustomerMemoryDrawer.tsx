import type { CustomerMemoryDrawerProps } from '../../../interfaces/client';
import { useEffect, useState } from 'react';
import { API, type CustomerMemoryEntry } from '../../api';

const KIND_LABELS: Record<string, string> = {
  fact: 'Fact',
  preference: 'Preference',
  context: 'Context',
  complaint: 'Complaint',
  communication_style: 'Style',
};

export function CustomerMemoryDrawer({ customerId, customerName }: CustomerMemoryDrawerProps) {
  const [memory, setMemory] = useState<CustomerMemoryEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<string>('fact');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await API.listCustomerMemory(customerId);
      setMemory(res.memory ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memory');
    }
  }

  useEffect(() => {
    load();
  }, [customerId]);

  async function addFact() {
    if (!draft.trim()) return;
    setBusy('add');
    setError(null);
    try {
      await API.addCustomerMemory(customerId, { fact_text: draft.trim(), kind, confidence: 0.95 });
      setDraft('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed');
    } finally {
      setBusy(null);
    }
  }

  async function redact(memoryId: string) {
    const reason = window.prompt('Why redact this memory?', 'operator-redacted');
    if (!reason) return;
    setBusy(`redact:${memoryId}`);
    setError(null);
    try {
      await API.redactCustomerMemory(customerId, memoryId, reason);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Redact failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
        Customer memory {customerName ? `· ${customerName}` : ''}
      </div>
      {error && (
        <div className="muted" style={{ fontSize: 12, color: '#b91c1c', marginTop: 4 }}>
          {error}
        </div>
      )}
      <div className="source-list" style={{ marginTop: 6 }}>
        {memory.length === 0 && (
          <div className="muted" style={{ fontSize: 12 }}>
            Nothing remembered yet. Facts auto-extract when this customer's tickets resolve.
          </div>
        )}
        {memory.map((row) => (
          <div className="source-row" key={row.id}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13 }}>{row.fact_text}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {KIND_LABELS[row.kind] ?? row.kind} ·{' '}
                {row.created_by === 'operator'
                  ? 'operator-authored'
                  : `${Math.round(row.confidence * 100)}% confidence`}
                {row.source_ticket_id ? ` · from ${row.source_ticket_id.slice(0, 10)}…` : ''}
              </div>
            </div>
            <button disabled={busy === `redact:${row.id}`} onClick={() => redact(row.id)}>
              Redact
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 6, marginTop: 8 }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          value={draft}
          placeholder="Add a durable fact about this customer"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) addFact();
          }}
        />
        <button className="primary" disabled={!draft.trim() || busy === 'add'} onClick={addFact}>
          Add
        </button>
      </div>
    </section>
  );
}
