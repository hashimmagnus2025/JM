import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RECEIPT_NUMBERING, formatReceiptNumber, paymentDateOf, receiptCounterKey, receiptScopeKey, validateReceiptNumbering } from './index';
import { catchFinance } from '../../testing/fixtures';

describe('receipt numbers (BRC-G1): REC-2026-000001', () => {
  it('formats prefix, scope year and zero-padded sequence', () => {
    expect(formatReceiptNumber(DEFAULT_RECEIPT_NUMBERING, '2026', 1)).toBe('REC-2026-000001');
    expect(formatReceiptNumber(DEFAULT_RECEIPT_NUMBERING, '2026', 123_456)).toBe('REC-2026-123456');
    expect(formatReceiptNumber({ prefix: 'FEE', scope: 'CALENDAR_YEAR', pad: 4 }, '2027', 42)).toBe('FEE-2027-0042');
    expect(formatReceiptNumber({ ...DEFAULT_RECEIPT_NUMBERING, scope: 'NONE' }, '', 7)).toBe('REC-000007');
  });
  it('never truncates: a sequence wider than the padding simply gets longer (still unique)', () => {
    expect(formatReceiptNumber(DEFAULT_RECEIPT_NUMBERING, '2026', 1_234_567)).toBe('REC-2026-1234567');
  });
  it('year part follows the configured scope (CL-08)', () => {
    const ctx = { paymentDate: '2027-02-10', academicYearLabel: '2026-27' };
    expect(receiptScopeKey('ACADEMIC_YEAR', ctx)).toBe('2026');
    expect(receiptScopeKey('CALENDAR_YEAR', ctx)).toBe('2027');
    expect(receiptScopeKey('FINANCIAL_YEAR', ctx)).toBe('2026'); // Feb 2027 belongs to FY 2026-27
    expect(receiptScopeKey('FINANCIAL_YEAR', { paymentDate: '2026-04-01' })).toBe('2026');
    expect(receiptScopeKey('FINANCIAL_YEAR', { paymentDate: '2026-03-31' })).toBe('2025');
    expect(receiptScopeKey('NONE', ctx)).toBe('');
    expect(catchFinance(() => receiptScopeKey('ACADEMIC_YEAR', { paymentDate: '2026-05-01' })).code).toBe('RECEIPT_NUMBER_INVALID');
  });
  it('each prefix + year has its own independent sequence counter', () => {
    expect(receiptCounterKey('REC', '2026')).toBe('receipt:REC:2026');
    expect(receiptCounterKey('REC', '')).toBe('receipt:REC:all');
    expect(receiptCounterKey('REC', '2026')).not.toBe(receiptCounterKey('REC', '2027'));
  });
  it('rejects bad prefix, padding and sequence', () => {
    expect(catchFinance(() => validateReceiptNumbering({ prefix: 'rec', scope: 'NONE', pad: 6 })).code).toBe('RECEIPT_NUMBER_INVALID');
    expect(catchFinance(() => validateReceiptNumbering({ prefix: '', scope: 'NONE', pad: 6 })).code).toBe('RECEIPT_NUMBER_INVALID');
    expect(catchFinance(() => validateReceiptNumbering({ prefix: 'REC', scope: 'NONE', pad: 2 })).code).toBe('RECEIPT_NUMBER_INVALID');
    for (const seq of [0, -1, 1.5]) expect(catchFinance(() => formatReceiptNumber(DEFAULT_RECEIPT_NUMBERING, '2026', seq)).code).toBe('RECEIPT_NUMBER_INVALID');
  });
  it('converts an instant to the IST payment date', () => {
    expect(paymentDateOf(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
  });
  it('PROPERTY: different sequences never produce the same number; numbers sort in sequence order within a width', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999_998 }), fc.integer({ min: 1, max: 999_999 }), (a, d) => {
        const b = Math.min(999_999, a + d);
        fc.pre(b !== a);
        const na = formatReceiptNumber(DEFAULT_RECEIPT_NUMBERING, '2026', a);
        const nb = formatReceiptNumber(DEFAULT_RECEIPT_NUMBERING, '2026', b);
        expect(na).not.toBe(nb);
        expect(na < nb).toBe(a < b);
      }),
    );
  });
});
