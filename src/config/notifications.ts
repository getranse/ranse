/** SMS / chat unsubscribe keywords. Inbound messages matching one of these
 *  (case-insensitive, exact-word) flip the customer's channel preference to
 *  disabled. Keep these in line with TCPA / industry norms. */
export const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END']);
