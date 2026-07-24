import type { BusinessHours, SLAPolicy } from '../interfaces/agents';

/** Default workspace SLA — applied when a workspace hasn't set custom first-response / resolution windows. */
export const DEFAULT_SLA: SLAPolicy = {
  first_response_minutes: { normal: 240, high: 60, urgent: 15 },
  resolution_hours: { normal: 48, high: 8, urgent: 2 },
  business_hours_only: false,
};

/** Default calendar for business-hours SLAs: Mon–Fri, 09:00–17:00, UTC. */
export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  days: [1, 2, 3, 4, 5],
  start_hour: 9,
  end_hour: 17,
  utc_offset_minutes: 0,
};
