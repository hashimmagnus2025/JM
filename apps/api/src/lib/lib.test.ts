import { describe, expect, it } from 'vitest';
import { hashCanonical, hashValue, sha256Hex } from './hash';
import { decideIdempotency, isValidIdempotencyKey } from './idempotency';

describe('hashing', () => {
  it('sha256 of a known value', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashCanonical('abc')).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('hashValue is independent of key order', () => {
    expect(hashValue({ a: 1, b: [1, 2] })).toBe(hashValue({ b: [1, 2], a: 1 }));
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
  });
});

describe('idempotency decision', () => {
  it('first request proceeds; same body replays; different body is rejected', () => {
    expect(decideIdempotency(null, 'h1')).toEqual({ action: 'PROCEED' });
    expect(decideIdempotency({ key: 'k', requestHash: 'h1' }, 'h1')).toEqual({ action: 'REPLAY' });
    expect(decideIdempotency({ key: 'k', requestHash: 'h1' }, 'h2')).toEqual({ action: 'KEY_REUSED_DIFFERENT_REQUEST' });
  });
  it('validates key shape', () => {
    expect(isValidIdempotencyKey('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true);
    expect(isValidIdempotencyKey('short')).toBe(false);
    expect(isValidIdempotencyKey('has space has space has space')).toBe(false);
    expect(isValidIdempotencyKey(undefined)).toBe(false);
    expect(isValidIdempotencyKey('x'.repeat(200))).toBe(false);
  });
});
