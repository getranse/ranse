import { describe, expect, it } from 'vitest';
import { DEFAULT_BUSINESS_HOURS } from '../src/config/sla';
import {
  addBusinessMinutes,
  parseWorkspaceSLAPolicy,
} from '../src/server/inbox/agents/specialists/business-hours';
import { computeSLA } from '../src/server/inbox/agents/specialists/sla';

// Monday 2026-07-20 10:00 UTC.
const MONDAY_10 = Date.UTC(2026, 6, 20, 10, 0, 0);
// Friday 2026-07-24 16:30 UTC.
const FRIDAY_1630 = Date.UTC(2026, 6, 24, 16, 30, 0);

describe('addBusinessMinutes', () => {
  it('stays within the same business day when the window fits', () => {
    expect(addBusinessMinutes(MONDAY_10, 60, DEFAULT_BUSINESS_HOURS)).toBe(
      Date.UTC(2026, 6, 20, 11, 0, 0),
    );
  });

  it('rolls remaining minutes across the weekend', () => {
    // 30 min left on Friday (16:30→17:00), 30 more resume Monday 09:00.
    expect(addBusinessMinutes(FRIDAY_1630, 60, DEFAULT_BUSINESS_HOURS)).toBe(
      Date.UTC(2026, 6, 27, 9, 30, 0),
    );
  });

  it('starts counting at opening time for after-hours arrivals', () => {
    const sundayNight = Date.UTC(2026, 6, 19, 22, 0, 0);
    expect(addBusinessMinutes(sundayNight, 15, DEFAULT_BUSINESS_HOURS)).toBe(
      Date.UTC(2026, 6, 20, 9, 15, 0),
    );
  });

  it('honors the workspace UTC offset', () => {
    // NY winter offset: local 09:00 = 14:00 UTC.
    const ny = { ...DEFAULT_BUSINESS_HOURS, utc_offset_minutes: -300 };
    const mondayMidnightUtc = Date.UTC(2026, 6, 20, 0, 0, 0);
    expect(addBusinessMinutes(mondayMidnightUtc, 30, ny)).toBe(Date.UTC(2026, 6, 20, 14, 30, 0));
  });
});

describe('computeSLA with business hours', () => {
  const policy = parseWorkspaceSLAPolicy(
    JSON.stringify({ sla: { business_hours_only: true, first_response_minutes: { urgent: 60 } } }),
  );

  it('pushes deadlines for tickets arriving outside business hours', () => {
    const sla = computeSLA({
      policy,
      priority: 'urgent',
      firstMessageAt: FRIDAY_1630,
      now: FRIDAY_1630,
    });
    // 30 min Friday + 30 min Monday morning.
    expect(sla.first_response_due_at).toBe(Date.UTC(2026, 6, 27, 9, 30, 0));
    expect(sla.first_response_breached).toBe(false);
  });

  it('keeps wall-clock deadlines when business_hours_only is off', () => {
    const wallClock = parseWorkspaceSLAPolicy('{}');
    const sla = computeSLA({
      policy: wallClock,
      priority: 'urgent',
      firstMessageAt: FRIDAY_1630,
      now: FRIDAY_1630,
    });
    expect(sla.first_response_due_at).toBe(FRIDAY_1630 + 15 * 60_000);
  });
});

describe('parseWorkspaceSLAPolicy', () => {
  it('merges partial settings over defaults and survives bad JSON', () => {
    const merged = parseWorkspaceSLAPolicy(
      JSON.stringify({ sla: { first_response_minutes: { urgent: 5 } } }),
    );
    expect(merged.first_response_minutes).toEqual({ normal: 240, high: 60, urgent: 5 });
    expect(merged.business_hours_only).toBe(false);

    expect(parseWorkspaceSLAPolicy('not-json').first_response_minutes.normal).toBe(240);
    expect(parseWorkspaceSLAPolicy(null).resolution_hours.urgent).toBe(2);
  });
});
