import { useState } from 'react';
import { API } from '../../api';

/**
 * Merge another ticket into this one. The operator pastes/types the other
 * ticket's id (visible in its URL); its messages, tags, and pending
 * approvals move here and the other ticket closes.
 */
export function MergeControl({ ticketId, onMerged }: { ticketId: string; onMerged: () => void }) {
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function merge() {
    const sourceTicketId = source.trim();
    if (!sourceTicketId) return;
    setBusy(true);
    setError('');
    try {
      const res = await API.mergeTicket(ticketId, sourceTicketId);
      if (!res.ok) throw new Error(res.message || 'Merge failed');
      setSource('');
      onMerged();
    } catch (err: any) {
      setError(err.message || 'Merge failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <strong>Merge</strong>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input
          placeholder="Other ticket id…"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && merge()}
          style={{ flex: 1 }}
        />
        <button type="button" disabled={!source.trim() || busy} onClick={merge}>
          {busy ? 'Merging…' : 'Merge in'}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
