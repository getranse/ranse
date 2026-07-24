import { DEFAULT_BUSINESS_HOURS, DEFAULT_SLA } from '../../../../config/sla';
import type { BusinessHours, SLAPolicy } from '../../../../interfaces/agents';

const DAY_MS = 86_400_000;

/**
 * Advance a timestamp by N minutes counting only business time. Times are
 * shifted into the workspace's local clock (fixed UTC offset), walked day by
 * day, then shifted back. The guard caps pathological calendars (e.g. zero
 * working days) at ~10 years instead of looping forever.
 */
export function addBusinessMinutes(startMs: number, minutes: number, bh: BusinessHours): number {
  const offset = bh.utc_offset_minutes * 60_000;
  let remaining = minutes;
  let t = startMs + offset;
  for (let guard = 0; guard < 3_660; guard++) {
    const dayStart = Math.floor(t / DAY_MS) * DAY_MS;
    if (bh.days.includes(new Date(dayStart).getUTCDay())) {
      const open = dayStart + bh.start_hour * 3_600_000;
      const close = dayStart + bh.end_hour * 3_600_000;
      const from = Math.max(t, open);
      if (from < close) {
        const available = (close - from) / 60_000;
        if (remaining <= available) return from + remaining * 60_000 - offset;
        remaining -= available;
      }
    }
    t = dayStart + DAY_MS;
  }
  return t - offset;
}

/** Compute an SLA deadline from a start time, honoring business_hours_only. */
export function slaDeadline(policy: SLAPolicy, startMs: number, minutes: number): number {
  if (!policy.business_hours_only) return startMs + minutes * 60_000;
  return addBusinessMinutes(startMs, minutes, policy.business_hours ?? DEFAULT_BUSINESS_HOURS);
}

/**
 * Workspace SLA policy from settings_json (`settings.sla`), merged over
 * DEFAULT_SLA so partial configs stay valid.
 */
export function parseWorkspaceSLAPolicy(settingsJson: string | null | undefined): SLAPolicy {
  let sla: Partial<SLAPolicy> = {};
  try {
    sla = JSON.parse(settingsJson || '{}')?.sla ?? {};
  } catch {
    sla = {};
  }
  return {
    first_response_minutes: {
      ...DEFAULT_SLA.first_response_minutes,
      ...sla.first_response_minutes,
    },
    resolution_hours: { ...DEFAULT_SLA.resolution_hours, ...sla.resolution_hours },
    business_hours_only: sla.business_hours_only ?? DEFAULT_SLA.business_hours_only,
    ...(sla.business_hours ? { business_hours: sla.business_hours } : {}),
  };
}

export function applyChannelOverrides(
  policy: SLAPolicy,
  channelFirstResponseMinutes: number | null,
  channelResolutionMinutes: number | null,
): SLAPolicy {
  if (channelFirstResponseMinutes === null && channelResolutionMinutes === null) return policy;
  // A channel-specific SLA overrides the priority curve uniformly. This is
  // intentional: a customer reaching out over SMS expects the same response
  // regardless of how the operator triaged the priority.
  const fr = channelFirstResponseMinutes;
  const res = channelResolutionMinutes;
  return {
    first_response_minutes: {
      normal: fr ?? policy.first_response_minutes.normal,
      high: fr ?? policy.first_response_minutes.high,
      urgent: fr ?? policy.first_response_minutes.urgent,
    },
    resolution_hours: {
      normal: res ? Math.max(1, Math.round(res / 60)) : policy.resolution_hours.normal,
      high: res ? Math.max(1, Math.round(res / 60)) : policy.resolution_hours.high,
      urgent: res ? Math.max(1, Math.round(res / 60)) : policy.resolution_hours.urgent,
    },
    business_hours_only: policy.business_hours_only,
  };
}
