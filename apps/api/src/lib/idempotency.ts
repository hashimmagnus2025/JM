/**
 * Idempotency decision (pure). Retry-sensitive financial APIs (payment creation, reversal, admission,
 * import commit…) take a client-generated `Idempotency-Key`. The first request with a key does the work and
 * stores its request hash + result; later requests with the same key either replay the stored result or are
 * rejected when the body differs. A unique index on the key is the database-level backstop.
 */
export interface IdempotencyRecord {
  key: string;
  requestHash: string;
}

export type IdempotencyDecision =
  | { action: 'PROCEED' }
  | { action: 'REPLAY' }
  | { action: 'KEY_REUSED_DIFFERENT_REQUEST' };

export function decideIdempotency(existing: IdempotencyRecord | null, requestHash: string): IdempotencyDecision {
  if (existing === null) return { action: 'PROCEED' };
  return existing.requestHash === requestHash ? { action: 'REPLAY' } : { action: 'KEY_REUSED_DIFFERENT_REQUEST' };
}

/** Keys are client-generated UUID-ish strings; reject anything that is not a sane opaque token. */
export const isValidIdempotencyKey = (key: unknown): key is string =>
  typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key);
