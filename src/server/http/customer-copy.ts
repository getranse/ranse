// Every customer-visible string from the public HTTP surfaces, collected in
// one place so localization stays tractable (docs/07 "Accessibility & i18n").
// Operator-console copy lives in the client; this file is only what
// customers see on portal/help/feedback pages.

export const PORTAL_COPY = {
  invalidLink: 'This link is invalid or has expired.',
  gone: 'This request is no longer available.',
  you: 'You',
  replyHint: 'To add more detail, just reply to any email from us on this request.',
  status: {
    open: 'Open — we are on it',
    pending: 'Waiting on you',
    resolved: 'Resolved',
    closed: 'Closed',
    spam: 'Closed',
  } as Record<string, string>,
};

export const HELP_COPY = {
  rateLimited: 'Slow down.',
  centerMissing: 'This help center does not exist.',
  articleMissing: 'This article does not exist.',
  title: 'Help center',
  empty: 'No articles published yet.',
  backToList: '← All articles',
};

export const FEEDBACK_COPY = {
  title: 'Ranse feedback',
  missingLink: 'Feedback link is missing.',
  invalidLink: 'Feedback link is invalid or expired.',
  staleLink: 'Feedback link is no longer valid.',
  recorded: 'Thanks. Your feedback was recorded.',
  surveyInvalid: 'That survey response looks invalid.',
  surveyRecorded: 'Thanks — your rating was recorded.',
  surveyQuestion: 'How would you rate this support experience? (1 = poor, 5 = great)',
  surveyCommentPlaceholder: 'Anything to add? (optional)',
  surveySubmit: 'Send rating',
};
