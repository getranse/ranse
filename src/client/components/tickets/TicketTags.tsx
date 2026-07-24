import { useCallback, useEffect, useState } from 'react';
import type { Tag } from '../../../interfaces/tickets';
import { API } from '../../api';

export function TicketTags({ ticketId }: { ticketId: string }) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [all, setAll] = useState<Tag[]>([]);
  const [draft, setDraft] = useState('');

  const reload = useCallback(() => {
    API.ticketTags(ticketId)
      .then((d) => setTags(d.tags ?? []))
      .catch(() => undefined);
    API.tags()
      .then((d) => setAll(d.tags ?? []))
      .catch(() => undefined);
  }, [ticketId]);

  useEffect(reload, [reload]);

  async function add() {
    const name = draft.trim();
    if (!name) return;
    const existing = all.find((t) => t.name.toLowerCase() === name.toLowerCase());
    const tag = existing ?? (await API.createTag(name)).tag;
    await API.tagTicket(ticketId, tag.id);
    setDraft('');
    reload();
  }

  async function remove(tagId: string) {
    await API.untagTicket(ticketId, tagId);
    reload();
  }

  return (
    <div style={{ marginTop: 16 }}>
      <strong>Tags</strong>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {tags.map((t) => (
          <span key={t.id} className="pill" title="Click to remove" style={{ cursor: 'pointer' }}>
            <button
              type="button"
              onClick={() => remove(t.id)}
              style={{ all: 'unset', cursor: 'pointer' }}
              aria-label={`Remove tag ${t.name}`}
            >
              {t.name} ×
            </button>
          </span>
        ))}
        {tags.length === 0 && <span className="muted">No tags</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input
          list={`tags-${ticketId}`}
          placeholder="Add tag…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          style={{ flex: 1 }}
        />
        <datalist id={`tags-${ticketId}`}>
          {all.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
        <button type="button" onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}
