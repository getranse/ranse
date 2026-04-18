import { Agent, callable } from 'agents';
import type { Env } from '../env';

export interface MailboxState {
  mailboxId: string;
  address: string;
  displayName: string;
  lastIngestAt: number;
  ingestCount: number;
  autoReplyCount: number;
}

const DEFAULT_STATE: MailboxState = {
  mailboxId: '',
  address: '',
  displayName: '',
  lastIngestAt: 0,
  ingestCount: 0,
  autoReplyCount: 0,
};

/**
 * Per-mailbox DO: tracks ingest counters, rate, and (later) duty-cycle flags
 * like "pause outbound while we investigate a loop".
 */
export class MailboxAgent extends Agent<Env, MailboxState> {
  initialState: MailboxState = DEFAULT_STATE;

  @callable()
  async recordInbound(args: { autoReply: boolean }) {
    await this.setState({
      ...this.state,
      lastIngestAt: Date.now(),
      ingestCount: this.state.ingestCount + 1,
      autoReplyCount: this.state.autoReplyCount + (args.autoReply ? 1 : 0),
    });
  }

  @callable()
  async stats() {
    return this.state;
  }
}
