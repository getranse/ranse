/** Workspace autonomy policy thresholds. Operator-tunable defaults applied when a mailbox sets `autonomy_policy='auto_send_if_confident'` without specifying a custom threshold. */
export const DEFAULT_AUTONOMY_THRESHOLD = 0.85;
export const MIN_AUTONOMY_THRESHOLD = 0.5;
export const MAX_AUTONOMY_THRESHOLD = 0.99;

/** Rollout percent for auto-send (0–100). 100 = enabled for all tickets. */
export const DEFAULT_AUTONOMY_ROLLOUT_PERCENT = 100;
