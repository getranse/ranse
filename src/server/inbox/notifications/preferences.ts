import type { ChannelPreference, PreferenceCheck } from '../../../interfaces/notifications';

export type { ChannelPreference, PreferenceCheck };

import type { ChannelKind } from '../../../types/shared/channels';
import { audit } from '../../actions/audit';
import type { Env } from '../../env';

// Per-customer per-channel delivery preferences. Two surfaces both consult
// this:
//   - The outbound dispatcher (`channels/egress.ts`) blocks an outbound
//     send when the customer has opted out of that channel.
//   - The notification cascade engine skips a step (and may advance to the
//     next) when delivery would be inside a quiet-hours window.
//
// Defaults are permissive: if no row exists for (workspace, customer,
// channel_kind), delivery is allowed. The operator UI builds rows when a
// customer opts in/out explicitly, and the inbound path can create rows
// from STOP/HELP-style replies (an inbound containing "STOP" sets
// status='disabled' on the originating channel).

import type { ChannelPreferenceStatus } from '../../../interfaces/notifications';

export type { ChannelPreferenceStatus };

export async function getPreference(
  env: Env,
  workspaceId: string,
  customerId: string,
  channelKind: ChannelKind,
): Promise<ChannelPreference | null> {
  return env.DB.prepare(
    `SELECT * FROM customer_channel_preference
       WHERE workspace_id = ? AND customer_id = ? AND channel_kind = ?`,
  )
    .bind(workspaceId, customerId, channelKind)
    .first<ChannelPreference>();
}

export async function listPreferences(
  env: Env,
  workspaceId: string,
  customerId: string,
): Promise<ChannelPreference[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM customer_channel_preference
       WHERE workspace_id = ? AND customer_id = ?
       ORDER BY channel_kind ASC`,
  )
    .bind(workspaceId, customerId)
    .all<ChannelPreference>();
  return rows.results ?? [];
}

export async function canDeliverTo(
  env: Env,
  args: {
    workspaceId: string;
    customerId: string | null;
    channelKind: ChannelKind;
    now?: number;
  },
): Promise<PreferenceCheck> {
  if (!args.customerId) return { allowed: true };
  const pref = await getPreference(env, args.workspaceId, args.customerId, args.channelKind);
  if (!pref) return { allowed: true };
  if (pref.status === 'disabled') return { allowed: false, reason: 'opted_out' };
  const quiet = quietHoursDelay(pref, args.now ?? Date.now());
  if (quiet === 0) return { allowed: true };
  return { allowed: false, reason: 'quiet_hours', retryAfterMs: quiet };
}

export async function setPreference(
  env: Env,
  args: {
    workspaceId: string;
    customerId: string;
    channelKind: ChannelKind;
    status: ChannelPreferenceStatus;
    consentSource?: string | null;
    quietHoursStartMinutes?: number | null;
    quietHoursEndMinutes?: number | null;
    timezone?: string | null;
    actorUserId?: string | null;
  },
): Promise<ChannelPreference> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO customer_channel_preference (
       workspace_id, customer_id, channel_kind, status, quiet_hours_start_minutes,
       quiet_hours_end_minutes, timezone, consent_source, consent_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, customer_id, channel_kind) DO UPDATE SET
       status = excluded.status,
       quiet_hours_start_minutes = excluded.quiet_hours_start_minutes,
       quiet_hours_end_minutes = excluded.quiet_hours_end_minutes,
       timezone = excluded.timezone,
       consent_source = excluded.consent_source,
       consent_at = excluded.consent_at,
       updated_at = excluded.updated_at`,
  )
    .bind(
      args.workspaceId,
      args.customerId,
      args.channelKind,
      args.status,
      args.quietHoursStartMinutes ?? null,
      args.quietHoursEndMinutes ?? null,
      args.timezone ?? null,
      args.consentSource ?? null,
      args.status === 'enabled' ? now : null,
      now,
    )
    .run();
  await audit(env, {
    workspaceId: args.workspaceId,
    actorType: args.actorUserId ? 'user' : 'system',
    actorId: args.actorUserId ?? undefined,
    action: 'customer_channel_preference.updated',
    payload: {
      customerId: args.customerId,
      channelKind: args.channelKind,
      status: args.status,
      consentSource: args.consentSource ?? null,
    },
  });
  const updated = await getPreference(env, args.workspaceId, args.customerId, args.channelKind);
  if (!updated) throw new Error('preference_persist_failed');
  return updated;
}

// Inbound STOP/HELP handling. Carriers expect SMS STOP to disable the
// channel within 1 message; we apply the same rule to any channel that
// supports text replies. Returns true if a preference change was applied.
export async function applyStopKeyword(
  env: Env,
  args: {
    workspaceId: string;
    customerId: string;
    channelKind: ChannelKind;
    text: string;
  },
): Promise<boolean> {
  const trimmed = args.text.trim().toUpperCase();
  if (!STOP_KEYWORDS.has(trimmed)) return false;
  await setPreference(env, {
    workspaceId: args.workspaceId,
    customerId: args.customerId,
    channelKind: args.channelKind,
    status: 'disabled',
    consentSource: `inbound_keyword:${trimmed.toLowerCase()}`,
  });
  return true;
}

import { STOP_KEYWORDS } from '../../../config/notifications';

function quietHoursDelay(pref: ChannelPreference, now: number): number {
  if (pref.quiet_hours_start_minutes === null || pref.quiet_hours_end_minutes === null) {
    return 0;
  }
  // Compute the customer's local minute-of-day from the configured tz.
  // We approximate by parsing the offset from a known timezone string; for
  // operators that haven't set a tz, we assume UTC (which is conservative —
  // they'll get rare false "quiet" hits at the edges).
  const tzOffsetMinutes = parseTimezoneOffsetMinutes(pref.timezone ?? 'UTC', now);
  const local = new Date(now + tzOffsetMinutes * 60_000);
  const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  const start = pref.quiet_hours_start_minutes;
  const end = pref.quiet_hours_end_minutes;
  const inWindow =
    start <= end
      ? minuteOfDay >= start && minuteOfDay < end
      : minuteOfDay >= start || minuteOfDay < end;
  if (!inWindow) return 0;
  const minutesUntilEnd = (end + (1440 - minuteOfDay)) % 1440 || 1440;
  return minutesUntilEnd * 60_000;
}

function parseTimezoneOffsetMinutes(timezone: string, now: number): number {
  if (timezone === 'UTC') return 0;
  // Use Intl.DateTimeFormat to pull the offset for the given tz at `now`.
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });
    const parts = fmt.formatToParts(new Date(now));
    const offset = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const match = offset.match(/GMT([+-]?\d{1,2})(?::(\d{2}))?/);
    if (!match) return 0;
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2] ?? '0', 10);
    const sign = hours < 0 ? -1 : 1;
    return sign * (Math.abs(hours) * 60 + minutes);
  } catch {
    return 0;
  }
}
