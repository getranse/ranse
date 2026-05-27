import type { Env } from '../env';

// First-run onboarding state. Derived rather than persisted: the
// authoritative source is "did the workspace ever have a KB source / a
// public channel / an outbound message" — querying the underlying tables
// directly. The only persisted bit is whether the operator dismissed the
// banner (stored in `workspace.settings_json.onboarding_dismissed_at`).
//
// Derived state lets us drop the banner the moment activity exists,
// without needing each producer to remember to update the wizard.

export interface OnboardingStep {
  id: 'ingest_knowledge' | 'connect_channel' | 'first_reply';
  label: string;
  description: string;
  done: boolean;
  action: { kind: 'navigate'; href: string; label: string };
}

export interface OnboardingState {
  steps: OnboardingStep[];
  completedCount: number;
  dismissed: boolean;
  shouldShow: boolean;
}

export async function getOnboardingState(env: Env, workspaceId: string): Promise<OnboardingState> {
  const [knowledge, channel, reply, dismissed] = await Promise.all([
    countKnowledgeSources(env, workspaceId),
    countPublicChannels(env, workspaceId),
    countOutboundMessages(env, workspaceId),
    loadDismissed(env, workspaceId),
  ]);

  const steps: OnboardingStep[] = [
    {
      id: 'ingest_knowledge',
      label: 'Add your first knowledge source',
      description:
        'Help-center URL, PDF, or a Markdown doc. The agent grounds every reply on what you ingest.',
      done: knowledge > 0,
      action: { kind: 'navigate', href: '/settings#knowledge', label: 'Open Knowledge' },
    },
    {
      id: 'connect_channel',
      label: 'Connect a channel',
      description:
        'Email mailbox, embeddable chat, Slack, SMS, WhatsApp, voice — pick where customers should reach you.',
      done: channel > 0,
      action: { kind: 'navigate', href: '/settings#channels', label: 'Open Channels' },
    },
    {
      id: 'first_reply',
      label: 'Send your first reply',
      description:
        'Draft with AI from any inbound, edit if needed, and send. The agent learns from the choices you make.',
      done: reply > 0,
      action: { kind: 'navigate', href: '/', label: 'Open Inbox' },
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;
  return {
    steps,
    completedCount,
    dismissed,
    shouldShow: !dismissed && !allDone,
  };
}

export async function dismissOnboarding(env: Env, workspaceId: string): Promise<void> {
  const row = await env.DB.prepare(`SELECT settings_json FROM workspace WHERE id = ?`)
    .bind(workspaceId)
    .first<{ settings_json: string }>();
  const settings = parseSettings(row?.settings_json);
  settings.onboarding_dismissed_at = Date.now();
  await env.DB.prepare(`UPDATE workspace SET settings_json = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(settings), Date.now(), workspaceId)
    .run();
}

async function countKnowledgeSources(env: Env, workspaceId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM knowledge_source WHERE workspace_id = ?`,
  )
    .bind(workspaceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function countPublicChannels(env: Env, workspaceId: string): Promise<number> {
  // Email channels count: a mailbox is a connected channel even though it
  // doesn't have a public_channel row, so we count mailboxes too.
  const [mailbox, channel] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM mailbox WHERE workspace_id = ?`)
      .bind(workspaceId)
      .first<{ n: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM public_channel WHERE workspace_id = ?`)
      .bind(workspaceId)
      .first<{ n: number }>(),
  ]);
  return (mailbox?.n ?? 0) + (channel?.n ?? 0);
}

async function countOutboundMessages(env: Env, workspaceId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM message_index
       WHERE workspace_id = ? AND direction = 'outbound'`,
  )
    .bind(workspaceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function loadDismissed(env: Env, workspaceId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT settings_json FROM workspace WHERE id = ?`)
    .bind(workspaceId)
    .first<{ settings_json: string }>();
  const settings = parseSettings(row?.settings_json);
  return Boolean(settings.onboarding_dismissed_at);
}

function parseSettings(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
