import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  addPaise,
  assertNonNegativePaise,
  assertPaise,
  assertPositivePaise,
  formatINR,
  formatINRCompact,
  isPaise,
  minPaise,
  mulDivRound,
  parseRupeesToPaise,
  percentBp,
  splitEvenRemainderFirst,
  splitEvenRemainderLast,
  splitProportional,
  subPaise,
  sumPaise,
} from './money';

describe('paise guards', () => {
  it('accepts safe integers, rejects floats/NaN/strings', () => {
    expect(isPaise(0)).toBe(true);
    expect(isPaise(123_456)).toBe(true);
    expect(isPaise(12.5)).toBe(false);
    expect(isPaise(Number.NaN)).toBe(false);
    expect(isPaise('100')).toBe(false);
    expect(isPaise(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });

  it('assert helpers throw typed errors', () => {
    expect(() => assertPaise(1.5)).toThrowError(MoneyError);
    expect(() => assertNonNegativePaise(-1)).toThrowError(/must not be negative/);
    expect(() => assertPositivePaise(0)).toThrowError(/greater than zero/);
    expect(() => assertPositivePaise(1)).not.toThrow();
  });

  it('add/sub/sum are overflow-checked', () => {
    expect(addPaise(100, 250)).toBe(350);
    expect(subPaise(100, 250)).toBe(-150);
    expect(sumPaise([1, 2, 3])).toBe(6);
    expect(sumPaise([])).toBe(0);
    expect(minPaise(5, 3)).toBe(3);
    expect(() => addPaise(Number.MAX_SAFE_INTEGER, 1)).toThrowError(/safe range/);
    expect(() => sumPaise([1, 0.5])).toThrowError(MoneyError);
  });
});

describe('percentBp / mulDivRound', () => {
  it('rounds half-up to the paisa', () => {
    expect(percentBp(10_000, 1_000)).toBe(1_000); // 10 % of ₹100
    expect(percentBp(1_005, 5_000)).toBe(503); // 502.5 → 503
    expect(percentBp(1_001, 5_000)).toBe(501); // 500.5 → 501
    expect(percentBp(1_000, 3_333)).toBe(333); // 333.3 → 333
    expect(percentBp(0, 5_000)).toBe(0);
  });

  it('is exact for very large amounts (BigInt intermediate)', () => {
    const big = 900_000_000_000_000; // ₹9 trillion in paise
    expect(percentBp(big, 5_000)).toBe(450_000_000_000_000);
    expect(() => mulDivRound(Number.MAX_SAFE_INTEGER, 10_000, 1)).toThrowError(/safe range/);
  });

  it('rejects negatives and zero divisor', () => {
    expect(() => percentBp(-1, 100)).toThrowError(MoneyError);
    expect(() => mulDivRound(1, 1, 0)).toThrowError(MoneyError);
  });
});

describe('splitProportional (largest remainder)', () => {
  it('splits exactly and deterministically', () => {
    expect(splitProportional(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitProportional(10, [1, 2, 3])).toEqual([2, 3, 5]);
    expect(splitProportional(0, [3, 4])).toEqual([0, 0]);
    expect(splitProportional(0, [0, 0])).toEqual([0, 0]);
    expect(splitProportional(7, [0, 5])).toEqual([0, 7]);
  });

  it('rejects impossible inputs', () => {
    expect(() => splitProportional(5, [])).toThrowError(MoneyError);
    expect(() => splitProportional(5, [0, 0])).toThrowError(/zero weights/);
    expect(() => splitProportional(-1, [1])).toThrowError(MoneyError);
  });

  it('PROPERTY: parts sum to total, never negative, each within 1 of exact share', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000_000 }),
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 12 }),
        (total, weights) => {
          fc.pre(weights.some((w) => w > 0));
          const parts = splitProportional(total, weights);
          expect(parts.reduce((s, p) => s + p, 0)).toBe(total);
          const sumW = weights.reduce((s, w) => s + w, 0);
          parts.forEach((p, i) => {
            expect(p).toBeGreaterThanOrEqual(0);
            const exact = (total * (weights[i] ?? 0)) / sumW;
            expect(Math.abs(p - exact)).toBeLessThan(1 + 1e-6);
            if (weights[i] === 0) expect(p).toBe(0);
          });
        },
      ),
    );
  });
});

describe('even splits', () => {
  it('last absorbs the remainder (BRC-C4 default)', () => {
    expect(splitEvenRemainderLast(100, 3)).toEqual([33, 33, 34]);
    expect(splitEvenRemainderLast(5_000_000, 4)).toEqual([1_250_000, 1_250_000, 1_250_000, 1_250_000]);
    expect(splitEvenRemainderLast(0, 3)).toEqual([0, 0, 0]);
    expect(splitEvenRemainderLast(7, 1)).toEqual([7]);
  });
  it('first absorbs the remainder (alternative)', () => {
    expect(splitEvenRemainderFirst(100, 3)).toEqual([34, 33, 33]);
    expect(splitEvenRemainderFirst(7, 1)).toEqual([7]);
  });
  it('rejects n < 1', () => {
    expect(() => splitEvenRemainderLast(10, 0)).toThrowError(MoneyError);
    expect(() => splitEvenRemainderLast(10, 1.5)).toThrowError(MoneyError);
  });
  it('PROPERTY: sums to total', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), fc.integer({ min: 1, max: 24 }), (t, n) => {
        for (const parts of [splitEvenRemainderLast(t, n), splitEvenRemainderFirst(t, n)]) {
          expect(parts).toHaveLength(n);
          expect(parts.reduce((s, p) => s + p, 0)).toBe(t);
        }
      }),
    );
  });
});

describe('formatting', () => {
  it('uses Indian digit grouping', () => {
    expect(formatINR(0)).toBe('₹0');
    expect(formatINR(99_900)).toBe('₹999');
    expect(formatINR(100_000)).toBe('₹1,000');
    expect(formatINR(12_500_000)).toBe('₹1,25,000');
    expect(formatINR(1_234_567_800)).toBe('₹1,23,45,678');
    expect(formatINR(125_050)).toBe('₹1,250.50');
    expect(formatINR(125_000, { forceDecimals: true })).toBe('₹1,250.00');
    expect(formatINR(125_000, { symbol: false })).toBe('1,250');
    expect(formatINR(-500_000)).toBe('−₹5,000');
  });

  it('compact notation matches the SOW (₹4.25 Cr, ₹75 L)', () => {
    expect(formatINRCompact(4_250_000_000)).toBe('₹4.25 Cr'); // ₹4.25 crore = 4,250,000,000 paise
    expect(formatINRCompact(750_000_000)).toBe('₹75 L'); // ₹75 lakh
    expect(formatINRCompact(12_500_00)).toBe('₹12,500');
    expect(formatINRCompact(1_000_000_000)).toBe('₹1 Cr');
    expect(formatINRCompact(15_000_000)).toBe('₹1.5 L');
    expect(formatINRCompact(-1_000_000_000)).toBe('−₹1 Cr');
  });
});

describe('parseRupeesToPaise', () => {
  it('parses without floating point', () => {
    expect(parseRupeesToPaise('1,25,000')).toBe(12_500_000);
    expect(parseRupeesToPaise('₹ 1250.5')).toBe(125_050);
    expect(parseRupeesToPaise('0.07')).toBe(7);
    expect(parseRupeesToPaise('19.99')).toBe(1_999);
    expect(parseRupeesToPaise('100')).toBe(10_000);
  });
  it('rejects bad input', () => {
    for (const bad of ['', 'abc', '1.234', '-5', '1..2', '1e3']) {
      expect(() => parseRupeesToPaise(bad)).toThrowError(MoneyError);
    }
  });
  it('PROPERTY: format ∘ parse round-trips', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999_999 }), (p) => {
        expect(parseRupeesToPaise(formatINR(p, { forceDecimals: true }))).toBe(p);
      }),
    );
  });
});
