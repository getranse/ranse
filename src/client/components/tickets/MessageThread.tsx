import { formatDateTime } from '../../../lib/format';
import type { TicketViewData } from '../../../types/shared/ticket';

export function MessageThread({ messages }: { messages: TicketViewData['messages'] }) {
  return (
    <div className="thread">
      {messages.map((m) => (
        <div key={m.id} className={`msg ${m.direction}`}>
          <div className="msg-header">
            <span>
              {m.direction === 'inbound'
                ? m.from_address
                : m.direction === 'outbound'
                  ? `You → ${m.to_address}`
                  : 'Internal note'}
            </span>
            <span>{formatDateTime(m.sent_at)}</span>
          </div>
          <div className="msg-body">{m.preview}</div>
        </div>
      ))}
    </div>
  );
}
