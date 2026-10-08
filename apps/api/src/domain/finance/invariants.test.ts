import { describe, expect, it } from 'vitest';
import {
  assertAllocationConservation,
  assertReceivable,
  assertReceivables,
  isPayable,
  newReceivable,
  recompute,
  totalPending,
  type AllocationDraft,
  type Receivable,
} from './index';
import { R, catchFinance, mk } from '../../testing/fixtures';

const ok = (): Receivable =>
  mk({ id: 'a', no: 1, due: '2026-04-10', comps: { TUITION: R(100), LAB: R(50) } });
const code = (r: Receivable): string => catchFinance(() => assertReceivable(r)).code;

describe('assertReceivable — the books must always balance', () => {
  it('accepts healthy receivables, including paid, adjusted and transferred ones', () => {
    expect(() => assertReceivable(ok())).not.toThrow();
    const c = ok();
    const adj = recompute({
      ...c,
      components: c.components.map((x, i) =>
        i === 0 ? { ...x, adjusted: R(10), paid: R(20), transferred: R(5) } : x,
      ),
    });
    expect(() => assertReceivable(adj)).not.toThrow();
    expect(() => assertReceivables([ok(), adj])).not.toThrow();
  });

  it('rejects non-integer and negative money', () => {
    expect(code({ ...ok(), paid: 0.5 })).toBe('INVARIANT_VIOLATION');
    expect(code({ ...ok(), pending: Number.NaN })).toBe('INVARIANT_VIOLATION');
    expect(code({ ...ok(), adjusted: -1 })).toBe('INVARIANT_VIOLATION');
    expect(code({ ...ok(), transferred: -1 })).toBe('INVARIANT_VIOLATION');
  });

  it('rejects over-payment / over-adjustment', () => {
    expect(code({ ...ok(), paid: R(151), pending: -R(1) })).toBe('INVARIANT_VIOLATION');
    expect(code({ ...ok(), adjusted: R(100), transferred: R(30), paid: R(30) })).toBe(
      'INVARIANT_VIOLATION',
    );
  });

  it('rejects a pending amount that is not payable − adjusted − transferred − paid', () => {
    expect(code({ ...ok(), pending: ok().pending - 1 })).toBe('INVARIANT_VIOLATION');
    expect(
      catchFinance(() =>
        assertReceivable({
          ...ok(),
          pending: -5,
          payable: 0,
          adjusted: 0,
          transferred: 0,
          paid: 5,
        }),
      ).message,
    ).toMatch(/exceeds payable|negative/);
  });

  it('rejects broken components', () => {
    const base = ok();
    const bad = (patch: Partial<Receivable['components'][number]>): string =>
      code({
        ...base,
        components: base.components.map((c, i) => (i === 0 ? { ...c, ...patch } : c)),
      });
    expect(bad({ paid: 0.1 })).toBe('INVARIANT_VIOLATION');
    expect(bad({ payable: -1 })).toBe('INVARIANT_VIOLATION');
    expect(bad({ paid: R(101) })).toBe('INVARIANT_VIOLATION'); // component over-paid although the totals might hide it
  });

  it('rejects aggregates that differ from the components', () => {
    const base = ok();
    const moved = {
      ...base,
      components: base.components.map((c, i) => (i === 0 ? { ...c, payable: c.payable + 1 } : c)),
    };
    expect(code(moved)).toBe('INVARIANT_VIOLATION');
    expect(
      code({
        ...base,
        components: base.components.map((c, i) => (i === 0 ? { ...c, adjusted: 1 } : c)),
      }),
    ).toBe('INVARIANT_VIOLATION');
    expect(
      code({
        ...base,
        components: base.components.map((c, i) => (i === 0 ? { ...c, transferred: 1 } : c)),
      }),
    ).toBe('INVARIANT_VIOLATION');
  });
});

describe('assertAllocationConservation', () => {
  const row = (amount: number, split = amount): AllocationDraft => ({
    receivableId: 'a',
    studentId: 's',
    academicYearId: 'y',
    kind: 'ALLOCATION',
    amount,
    componentSplit: [{ componentCode: 'T', amount: split }],
  });
  it('Σ allocations + unallocated must equal the payment', () => {
    expect(() => assertAllocationConservation(100, [row(60), row(30)], 10)).not.toThrow();
    expect(catchFinance(() => assertAllocationConservation(100, [row(60)], 10)).code).toBe(
      'INVARIANT_VIOLATION',
    );
  });
  it('each allocation must equal its component split', () => {
    expect(
      catchFinance(() => assertAllocationConservation(100, [row(100, 99)], 0)).message,
    ).toMatch(/component split/);
  });
});

describe('receivable builders and helpers', () => {
  const init = {
    id: 'x',
    studentId: 's',
    academicYearId: 'y',
    kind: 'INSTALLMENT' as const,
    label: 'L',
    dueDate: '2026-04-10',
    dedupeKey: 'k',
  };
  it('newReceivable validates its components', () => {
    expect(catchFinance(() => newReceivable({ ...init, components: [] })).code).toBe(
      'INVARIANT_VIOLATION',
    );
    expect(
      catchFinance(() =>
        newReceivable({
          ...init,
          components: [
            { code: 'A', name: 'A', payable: 1 },
            { code: 'A', name: 'A', payable: 2 },
          ],
        }),
      ).message,
    ).toMatch(/duplicate component/);
    expect(() =>
      newReceivable({ ...init, components: [{ code: 'A', name: 'A', payable: -1 }] }),
    ).toThrow();
    expect(() =>
      newReceivable({ ...init, components: [{ code: 'A', name: 'A', payable: 1.5 }] }),
    ).toThrow();
  });
  it('carries optional dimensions through', () => {
    const r = newReceivable({
      ...init,
      classId: 'c',
      divisionId: 'd',
      installmentNo: 3,
      parentReceivableId: 'p',
      periodKey: 'ONCE',
      components: [{ code: 'A', name: 'A', payable: 5 }],
    });
    expect(r).toMatchObject({
      classId: 'c',
      divisionId: 'd',
      installmentNo: 3,
      parentReceivableId: 'p',
      periodKey: 'ONCE',
      originalDueDate: '2026-04-10',
      version: 0,
      hasPendingAdjustment: false,
    });
  });
  it('totalPending ignores void receivables; isPayable excludes finished or void ones', () => {
    const a = mk({ id: 'a', no: 1, due: '2026-04-10', amount: 100 });
    const v: Receivable = {
      ...mk({ id: 'v', no: 2, due: '2026-04-10', amount: 50 }),
      paymentStatus: 'VOID',
    };
    expect(totalPending([a, v])).toBe(100);
    expect(isPayable(a)).toBe(true);
    expect(isPayable(v)).toBe(false);
    expect(isPayable({ ...a, pending: 0 })).toBe(false);
    expect(isPayable({ ...a, paymentStatus: 'WAIVED' })).toBe(false);
    expect(isPayable({ ...a, paymentStatus: 'TRANSFERRED' })).toBe(false);
  });
});
