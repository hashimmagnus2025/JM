import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  deriveDisplayStatus,
  deriveDueStatus,
  derivePaymentState,
  deriveScopeState,
  deriveStoredStatus,
  flagPendingAdjustment,
  isFullySettled,
  planCarryForward,
  type Receivable,
} from './index';
import { R, Y2025, Y2026, mk } from '../../testing/fixtures';

const inst = (due: string, amount = R(1_000), id = 'r'): Receivable =>
  mk({ id, no: 1, due, amount });
const pay = (r: Receivable[], amount: number): Receivable[] =>
  allocatePayment({ amount, receivables: r, today: '2026-10-08' }).updatedReceivables;

describe('Due Soon / Overdue (BRC-I1: Due Soon = 7 days before the due date by default, configurable)', () => {
  const due = (today: string, days = 7, r = inst('2026-10-10')): string =>
    deriveDueStatus(r, today, days);
  it('7 days before the due date → DUE_SOON; 8 days before → NOT_DUE', () => {
    expect(due('2026-10-02')).toBe('NOT_DUE');
    expect(due('2026-10-03')).toBe('DUE_SOON');
    expect(due('2026-10-09')).toBe('DUE_SOON');
  });
  it('the due date itself is DUE_SOON, the next day is OVERDUE', () => {
    expect(due('2026-10-10')).toBe('DUE_SOON');
    expect(due('2026-10-11')).toBe('OVERDUE');
  });
  it('the window is configurable', () => {
    expect(due('2026-10-03', 3)).toBe('NOT_DUE');
    expect(due('2026-10-07', 3)).toBe('DUE_SOON');
    expect(due('2026-09-01', 60)).toBe('DUE_SOON');
    expect(due('2026-10-10', 0)).toBe('DUE_SOON');
    expect(due('2026-10-09', 0)).toBe('NOT_DUE');
  });
  it('paid or void receivables have no due status', () => {
    expect(due('2026-12-01', 7, pay([inst('2026-10-10')], R(1_000))[0] as Receivable)).toBe('NONE');
    expect(due('2026-12-01', 7, { ...inst('2026-10-10'), paymentStatus: 'VOID' })).toBe('NONE');
  });
});

describe('PAID / Partially paid / Pending adjustment (BRC-I1)', () => {
  it('PAID needs a zero balance AND no pending adjustment', () => {
    const paid = pay([inst('2026-10-10')], R(1_000))[0] as Receivable;
    expect(derivePaymentState(paid)).toBe('PAID');
    expect(derivePaymentState({ ...paid, hasPendingAdjustment: true })).toBe('PENDING_ADJUSTMENT');
  });
  it('partial and unpaid', () => {
    expect(derivePaymentState(pay([inst('2026-10-10')], R(400))[0] as Receivable)).toBe('PARTIAL');
    expect(derivePaymentState(inst('2026-10-10'))).toBe('UNPAID');
  });
  it('waived, transferred and void', () => {
    expect(derivePaymentState({ ...inst('2026-10-10'), pending: 0, paymentStatus: 'WAIVED' })).toBe(
      'WAIVED',
    );
    expect(
      derivePaymentState({ ...inst('2026-10-10'), pending: 0, paymentStatus: 'TRANSFERRED' }),
    ).toBe('TRANSFERRED');
    expect(derivePaymentState({ ...inst('2026-10-10'), paymentStatus: 'VOID' })).toBe('VOID');
  });
  it('stored status derivation', () => {
    expect(
      deriveStoredStatus({ paymentStatus: 'UNPAID', pending: 0, paid: 5, transferred: 0 }),
    ).toBe('PAID');
    expect(
      deriveStoredStatus({ paymentStatus: 'UNPAID', pending: 0, paid: 0, transferred: 0 }),
    ).toBe('WAIVED');
    expect(
      deriveStoredStatus({ paymentStatus: 'UNPAID', pending: 0, paid: 3, transferred: 2 }),
    ).toBe('TRANSFERRED');
    expect(deriveStoredStatus({ paymentStatus: 'VOID', pending: 0, paid: 0, transferred: 0 })).toBe(
      'VOID',
    );
    expect(deriveStoredStatus({ paymentStatus: 'PAID', pending: 5, paid: 0, transferred: 0 })).toBe(
      'UNPAID',
    );
  });
  it('the single display badge: overdue > due soon > payment state', () => {
    expect(deriveDisplayStatus(inst('2026-04-10'), '2026-10-08', 7).primary).toBe('OVERDUE');
    expect(deriveDisplayStatus(inst('2026-10-10'), '2026-10-08', 7).primary).toBe('DUE_SOON');
    expect(deriveDisplayStatus(inst('2027-01-10'), '2026-10-08', 7).primary).toBe('UNPAID');
    const partlyOverdue = pay([inst('2026-04-10')], R(400))[0] as Receivable;
    expect(deriveDisplayStatus(partlyOverdue, '2026-10-08', 7)).toEqual({
      payment: 'PARTIAL',
      due: 'OVERDUE',
      primary: 'OVERDUE',
    });
  });
});

describe('FULLY SETTLED (student / fee scope)', () => {
  const dues = [inst('2026-04-10', R(500), 'a'), inst('2026-07-10', R(500), 'b')];
  it('not settled while anything is pending; settled when everything is cleared', () => {
    expect(isFullySettled(dues)).toBe(false);
    expect(isFullySettled(pay(dues, R(500)))).toBe(false);
    expect(isFullySettled(pay(dues, R(1_000)))).toBe(true);
  });
  it('blocked by a pending adjustment on any receivable', () => {
    const cleared = pay(dues, R(1_000));
    expect(
      isFullySettled(
        flagPendingAdjustment(cleared, [
          { receivableId: 'a', componentCode: 'TUITION', amount: 1 },
        ]),
      ),
    ).toBe(false);
  });
  it('void receivables are ignored; an empty scope is not "settled"', () => {
    expect(isFullySettled([])).toBe(false);
    expect(isFullySettled([{ ...inst('2026-04-10'), paymentStatus: 'VOID' }])).toBe(false);
    expect(
      isFullySettled([
        ...pay(dues, R(1_000)),
        { ...inst('2026-04-10', R(5), 'v'), paymentStatus: 'VOID' },
      ]),
    ).toBe(true);
  });
  it('scope = one year or all years: a prior-year due keeps the student unsettled overall but the new year can be settled', () => {
    const old = mk({ id: 'old', no: 4, due: '2026-01-10', amount: R(100), year: Y2025 });
    const cur = mk({ id: 'cur', no: 1, due: '2026-04-10', amount: R(100), year: Y2026 });
    const res = allocatePayment({
      amount: R(100),
      receivables: [old, cur],
      today: '2026-10-08',
      eligibleReceivableIds: ['cur'],
    }).updatedReceivables;
    expect(isFullySettled(res.filter((r) => r.academicYearId === Y2026))).toBe(true);
    expect(isFullySettled(res.filter((r) => r.academicYearId === Y2025))).toBe(false);
    expect(isFullySettled(res)).toBe(false);
  });
  it('carried-forward dues count as cleared for the source year', () => {
    const old = mk({ id: 'old', no: 4, due: '2026-01-10', amount: R(100), year: Y2025 });
    const plan = planCarryForward({
      openingBalanceId: 'ob',
      sources: [{ receivable: old }],
      targetAcademicYearId: Y2026,
      effectiveDate: '2026-04-01',
      reason: 'carry',
      existingActiveOpeningBalanceInTarget: false,
    });
    expect(isFullySettled(plan.updatedSources)).toBe(true);
    expect(isFullySettled([plan.openingBalance])).toBe(false);
  });
});

describe('student-level state (dashboard buckets; overdue is an overlay)', () => {
  it('UNPAID / PARTIAL / PAID / NONE', () => {
    const dues = [inst('2026-04-10', R(500), 'a'), inst('2027-01-10', R(500), 'b')];
    expect(deriveScopeState([], '2026-10-08', 7).paymentState).toBe('NONE');
    expect(deriveScopeState(dues, '2026-10-08', 7).paymentState).toBe('UNPAID');
    expect(deriveScopeState(pay(dues, R(100)), '2026-10-08', 7).paymentState).toBe('PARTIAL');
    expect(deriveScopeState(pay(dues, R(1_000)), '2026-10-08', 7)).toMatchObject({
      paymentState: 'PAID',
      fullySettled: true,
      pending: 0,
      earliestPendingDueDate: null,
    });
  });
  it('overdue / due soon flags and the time-independent earliest pending due date', () => {
    const dues = [
      inst('2027-01-10', R(500), 'b'),
      inst('2026-04-10', R(500), 'a'),
      inst('2026-10-10', R(500), 'c'),
    ];
    const s = deriveScopeState(dues, '2026-10-08', 7);
    expect(s).toMatchObject({
      hasOverdue: true,
      hasDueSoon: true,
      earliestPendingDueDate: '2026-04-10',
      paymentState: 'UNPAID',
    });
    // an overdue student is still counted as UNPAID/PARTIAL — never a separate exclusive bucket
    expect(deriveScopeState([dues[0] as Receivable], '2026-10-08', 7)).toMatchObject({
      hasOverdue: false,
      hasDueSoon: false,
    });
  });
});
