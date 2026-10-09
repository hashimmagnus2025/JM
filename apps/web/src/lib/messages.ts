import { ApiError } from './api';

/** Plain-language messages for stable API error codes. Unknown codes fall back to the server's safe message. */
const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'The e-mail or password is not correct.',
  ACCOUNT_LOCKED: 'Too many wrong attempts. Please wait a few minutes and try again.',
  ACCOUNT_DISABLED: 'This account is switched off. Please contact your administrator.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  FORBIDDEN: 'You do not have permission to do this.',
  NETWORK_ERROR: 'Cannot reach the server. Check your connection and try again.',
  VALIDATION_ERROR: 'Some details are missing or not valid. Please check the highlighted fields.',
  VERSION_CONFLICT: 'Someone else changed this just now. Reload and try again.',
  CONCURRENT_CHANGE: 'Someone else just changed this. Reload and try again.',
  YEAR_OVERLAP: 'These dates overlap with another academic year.',
  YEAR_LABEL_IN_USE: 'An academic year with this name already exists.',
  YEAR_LOCKED: 'This year is no longer planned, so it cannot be edited any more.',
  YEAR_CLOSE_BLOCKED: 'This year cannot be closed yet.',
  YEAR_IS_CURRENT: 'This is the current academic year. Make another year current first.',
  YEAR_HAS_DATA: 'This year already has students or fees, so it cannot go back to planned.',
  CATEGORY_CODE_IN_USE: 'A category with this code already exists.',
  WEAK_PASSWORD: 'Please choose a stronger password.',
  CURRENT_PASSWORD_WRONG: 'The current password is not correct.',
};

export function friendlyMessage(e: unknown): string {
  if (e instanceof ApiError) return MESSAGES[e.code] ?? e.message;
  return 'Something went wrong. Please try again.';
}

/** field → message map from a VALIDATION_ERROR response */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return {};
  const out: Record<string, string> = {};
  for (const d of e.details as { field?: string; message?: string }[]) {
    if (d.field && d.message && !out[d.field]) out[d.field] = d.message;
  }
  return out;
}
