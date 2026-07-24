import type { PublicChannelEntry } from '../../api';
import { sharingSummary } from './public-channel-helpers';

export function ChannelRow({
  channel,
  canManage,
  onToggle,
}: {
  channel: PublicChannelEntry;
  canManage: boolean;
  onToggle: () => void;
}) {
  const summary = sharingSummary(channel);
  return (
    <div className="source-row public-channel-row">
      <div>
        <div style={{ fontWeight: 500 }}>
          {channel.name} <span className="pill">{channel.kind}</span>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {channel.mailbox_address} · {channel.enabled === 1 ? 'enabled' : 'disabled'}
        </div>
        {summary.embed && <code>{summary.embed}</code>}
        <div className="muted" style={{ fontSize: 12 }}>
          {summary.hint}
        </div>
      </div>
      <button disabled={!canManage} onClick={onToggle}>
        {channel.enabled === 1 ? 'Disable' : 'Enable'}
      </button>
    </div>
  );
}
