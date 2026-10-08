import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical';

describe('canonicalJson', () => {
  it('is key-order independent and omits undefined properties', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }], z: undefined })).toBe(
      '{"a":[2,{"c":2,"d":1}],"b":1}',
    );
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it('handles primitives, dates and null', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('x"y')).toBe('"x\\"y"');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(false)).toBe('false');
    expect(canonicalJson(new Date('2026-10-08T00:00:00Z'))).toBe('"2026-10-08T00:00:00.000Z"');
    expect(canonicalJson([undefined, 1])).toBe('[null,1]');
  });
  it('rejects values that cannot be canonicalised', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Infinity)).toThrow();
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson(10n)).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
  });
});
