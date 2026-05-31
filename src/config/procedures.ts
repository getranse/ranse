/** Max bytes of context_json persisted per procedure step. Guards against runaway loop snapshots. */
export const LOOP_SNAPSHOT_MAX_BYTES = 64_000;
