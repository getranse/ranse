import { API } from '../../api';

/** Per-ticket override for AI draft generation: inherit / on / off. */
export function AiDraftsToggle({
  ticketId,
  enabled,
  onChanged,
}: {
  ticketId: string;
  enabled: number | null | undefined;
  onChanged: () => Promise<void>;
}) {
  const value = enabled == null ? 'inherit' : enabled === 1 ? 'on' : 'off';
  return (
    <div style={{ fontSize: 12, marginTop: 4 }}>
      <select
        value={value}
        onChange={async (e) => {
          const next = e.target.value;
          await API.setTicketAiDrafts(ticketId, next === 'inherit' ? null : next === 'on');
          await onChanged();
        }}
        style={{ width: '100%', padding: 4 }}
      >
        <option value="inherit">Inherit workspace default</option>
        <option value="on">On for this ticket</option>
        <option value="off">Off for this ticket</option>
      </select>
    </div>
  );
}
