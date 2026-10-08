import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  buildPenaltyReceivable,
  computePenaltyPostings,
  validateLateFeeRule,
  type LateFeePolicy,
  type PaidEvent,
  type Receivable,
} from './index';
import { R, catchFinance, mk } from '../../testing/fixtures';

const policy = (p: Partial<LateFeePolicy> = {}): LateFeePolicy => ({
  id: 'lf', version: 1, mode: 'FIXED', valuePaise: R(100), graceDays: 0, capPaise: null,
  effectiveFrom: '2026-01-01', effectiveTo: null, appliesToKinds: ['INSTALLMENT'], applyToOpeningBalance: false, ...p,
});
const parent = mk({ id: 'i1', no: 1, due: '2026-04-10', amount: R(10_000) });
const run = (asOf: string, p: Partial<LateFeePolicy> = {}, extra: { paid?: PaidEvent[]; existing?: { periodKey: string; amount: number }[]; parent?: Receivable } = {}) =>
  computePenaltyPostings({ parent: extra.parent ?? parent, policy: policy(p), asOf, paidEvents: extra.paid ?? [], existing: extra.existing ?? [] });

describe('late fee — FIXED', () => {
  it('nothing on the due date itself; penalty starts the day after (grace 0)', () => {
    expect(run('2026-04-10')).toEqual([]);
    expect(run('2026-04-11')).toEqual([
      { parentReceivableId: 'i1', periodKey: 'ONCE', accrualDate: '2026-04-11', amount: R(100), policyId: 'lf', policyVersion: 1 },
    ]);
  });
  it('grace period delays the first penalty day', () => {
    expect(run('2026-04-15', { graceDays: 5 })).toEqual([]);
    expect(run('2026-04-16', { graceDays: 5 })[0]?.accrualDate).toBe('2026-04-16');
  });
  it('is posted once, however often the job runs', () => {
    const first = run('2026-10-08');
    expect(first).toHaveLength(1);
    expect(run('2026-10-08', {}, { existing: [{ periodKey: 'ONCE', amount: R(100) }] })).toEqual([]);
  });
  it('no penalty when the due was already paid before the penalty day', () => {
    const paid = [{ date: '2026-04-10', amount: R(10_000) }];
    expect(run('2026-10-08', {}, { paid })).toEqual([]);
  });
  it('capped at the maximum penalty', () => {
    expect(run('2026-10-08', { valuePaise: R(500), capPaise: R(300) })[0]?.amount).toBe(R(300));
  });
});

describe('late fee — PER_DAY', () => {
  it('one posting per overdue day, deterministic keys', () => {
    const out = run('2026-04-14', { mode: 'PER_DAY', valuePaise: R(10) });
    expect(out.map((p) => [p.periodKey, p.accrualDate, p.amount])).toEqual([
      ['D:2026-04-11', '2026-04-11', R(10)],
      ['D:2026-04-12', '2026-04-12', R(10)],
      ['D:2026-04-13', '2026-04-13', R(10)],
      ['D:2026-04-14', '2026-04-14', R(10)],
    ]);
  });
  it('maximum cap stops accrual (and clips the last posting)', () => {
    const out = run('2026-04-30', { mode: 'PER_DAY', valuePaise: R(100), capPaise: R(250) });
    expect(out.map((p) => p.amount)).toEqual([R(100), R(100), R(50)]);
  });
  it('the cap counts penalties that were already posted', () => {
    const out = run('2026-04-30', { mode: 'PER_DAY', valuePaise: R(100), capPaise: R(250) }, { existing: [{ periodKey: 'D:2026-04-11', amount: R(100) }, { periodKey: 'D:2026-04-12', amount: R(100) }] });
    expect(out.map((p) => [p.periodKey, p.amount])).toEqual([['D:2026-04-13', R(50)]]);
  });
  it('catch-up runs post exactly the missing days; a second run posts nothing', () => {
    const existing = [{ periodKey: 'D:2026-04-11', amount: R(10) }, { periodKey: 'D:2026-04-12', amount: R(10) }];
    const out = run('2026-04-15', { mode: 'PER_DAY', valuePaise: R(10) }, { existing });
    expect(out.map((p) => p.periodKey)).toEqual(['D:2026-04-13', 'D:2026-04-14', 'D:2026-04-15']);
    const again = run('2026-04-15', { mode: 'PER_DAY', valuePaise: R(10) }, { existing: [...existing, ...out.map((p) => ({ periodKey: p.periodKey, amount: p.amount }))] });
    expect(again).toEqual([]);
  });
  it('accrual stops the day the due is fully paid, and a later reversal makes later days chargeable again', () => {
    const paidOn14 = [{ date: '2026-04-14', amount: R(10_000) }];
    expect(run('2026-04-20', { mode: 'PER_DAY', valuePaise: R(10) }, { paid: paidOn14 }).map((p) => p.periodKey)).toEqual(['D:2026-04-11', 'D:2026-04-12', 'D:2026-04-13']);
    const reversedOn17 = [...paidOn14, { date: '2026-04-17', amount: -R(10_000) }];
    expect(run('2026-04-18', { mode: 'PER_DAY', valuePaise: R(10) }, { paid: reversedOn17 }).map((p) => p.periodKey)).toEqual([
      'D:2026-04-11', 'D:2026-04-12', 'D:2026-04-13', 'D:2026-04-17', 'D:2026-04-18',
    ]);
  });
  it('a partial payment does not stop the penalty while something is still owed', () => {
    const partial = [{ date: '2026-04-12', amount: R(4_000) }];
    expect(run('2026-04-13', { mode: 'PER_DAY', valuePaise: R(10) }, { paid: partial })).toHaveLength(3);
  });
});

describe('late fee — PERCENT', () => {
  it('one-time percentage of the pending balance on the first penalty day', () => {
    const out = run('2026-10-08', { mode: 'PERCENT', valueBp: 200, valuePaise: undefined });
    expect(out).toHaveLength(1);
    expect(out[0]?.amount).toBe(R(200)); // 2 % of ₹10,000
  });
  it('uses what was still pending on that day (payments before it reduce the base)', () => {
    const paid = [{ date: '2026-04-05', amount: R(6_000) }];
    expect(run('2026-10-08', { mode: 'PERCENT', valueBp: 500 }, { paid })[0]?.amount).toBe(R(200)); // 5 % of ₹4,000
  });
  it('respects the cap', () => {
    expect(run('2026-10-08', { mode: 'PERCENT', valueBp: 1_000, capPaise: R(300) })[0]?.amount).toBe(R(300));
  });
});

describe('late fee — installment-specific rules, scope and history', () => {
  const two = (n: number): Receivable => mk({ id: `i${n}`, no: n, due: '2026-04-10', amount: R(1_000) });
  const overrides = { 2: { mode: 'FIXED' as const, valuePaise: R(500), graceDays: 10 } };
  it('an installment override replaces the default rule for that installment only', () => {
    const p = policy({ mode: 'FIXED', valuePaise: R(100), installmentOverrides: overrides });
    expect(computePenaltyPostings({ parent: two(1), policy: p, asOf: '2026-04-30', paidEvents: [], existing: [] })[0]?.amount).toBe(R(100));
    expect(computePenaltyPostings({ parent: two(2), policy: p, asOf: '2026-04-20', paidEvents: [], existing: [] })).toEqual([]); // grace 10
    expect(computePenaltyPostings({ parent: two(2), policy: p, asOf: '2026-04-21', paidEvents: [], existing: [] })[0]?.amount).toBe(R(500));
  });
  it('opening balance is NOT penalised unless explicitly configured', () => {
    const ob = mk({ id: 'ob', kind: 'OPENING_BALANCE', due: '2026-04-01', amount: R(5_000) });
    expect(run('2026-10-08', {}, { parent: ob })).toEqual([]);
    expect(run('2026-10-08', { applyToOpeningBalance: true }, { parent: ob })).toHaveLength(1);
  });
  it('never penalises a penalty, a void receivable, or kinds the policy does not cover', () => {
    const pen = mk({ id: 'p', kind: 'PENALTY', due: '2026-04-10', amount: R(100), parent: 'i1', periodKey: 'ONCE' });
    expect(run('2026-10-08', {}, { parent: pen })).toEqual([]);
    expect(run('2026-10-08', {}, { parent: { ...parent, paymentStatus: 'VOID' } })).toEqual([]);
    expect(run('2026-10-08', { appliesToKinds: [] })).toEqual([]);
  });
  it('a policy that starts later never penalises retroactively (FIXED) and only charges days on/after its start (PER_DAY)', () => {
    expect(run('2026-10-08', { effectiveFrom: '2026-06-01' })).toEqual([]);
    const out = run('2026-06-03', { mode: 'PER_DAY', valuePaise: R(10), effectiveFrom: '2026-06-01' });
    expect(out.map((p) => p.periodKey)).toEqual(['D:2026-06-01', 'D:2026-06-02', 'D:2026-06-03']);
    expect(run('2026-06-03', { mode: 'PER_DAY', valuePaise: R(10), effectiveFrom: '2026-01-01', effectiveTo: '2026-04-12' }).map((p) => p.periodKey)).toEqual(['D:2026-04-11', 'D:2026-04-12']);
  });
  it('HISTORY IS NEVER REWRITTEN: a later rule change leaves posted penalties alone and only prices new days', () => {
    const v1 = policy({ mode: 'PER_DAY', valuePaise: R(10), version: 1, effectiveTo: '2026-04-13' });
    const posted = computePenaltyPostings({ parent, policy: v1, asOf: '2026-04-13', paidEvents: [], existing: [] });
    expect(posted.map((p) => p.amount)).toEqual([R(10), R(10), R(10)]);
    const v2 = policy({ mode: 'PER_DAY', valuePaise: R(50), version: 2, effectiveFrom: '2026-04-14' });
    const next = computePenaltyPostings({ parent, policy: v2, asOf: '2026-04-16', paidEvents: [], existing: posted.map((p) => ({ periodKey: p.periodKey, amount: p.amount })) });
    expect(next.map((p) => [p.periodKey, p.amount, p.policyVersion])).toEqual([
      ['D:2026-04-14', R(50), 2],
      ['D:2026-04-15', R(50), 2],
      ['D:2026-04-16', R(50), 2],
    ]);
    expect(posted.every((p) => p.policyVersion === 1 && p.amount === R(10))).toBe(true);
  });
});

describe('penalty receivable', () => {
  const posting = computePenaltyPostings({ parent, policy: policy(), asOf: '2026-05-01', paidEvents: [], existing: [] })[0];
  it('is a SEPARATE receivable linked to its parent; the parent is untouched', () => {
    const before = JSON.stringify(parent);
    const pen = buildPenaltyReceivable(parent, posting as NonNullable<typeof posting>);
    expect(pen).toMatchObject({
      kind: 'PENALTY', parentReceivableId: 'i1', periodKey: 'ONCE', payable: R(100), pending: R(100),
      dueDate: '2026-04-11', originalDueDate: '2026-04-11', dedupeKey: 'PENALTY:i1:ONCE',
    });
    expect(pen.components[0]?.code).toBe('LATE_FEE');
    expect(JSON.stringify(parent)).toBe(before);
  });
  it('is collected through the normal allocation (after older overdue dues)', () => {
    const pen = buildPenaltyReceivable(parent, posting as NonNullable<typeof posting>);
    const res = allocatePayment({ amount: R(10_100), receivables: [pen, parent], today: '2026-05-01' });
    expect(res.allocations.map((a) => a.receivableId)).toEqual(['i1', pen.id]);
    expect(res.updatedReceivables.every((r) => r.paymentStatus === 'PAID')).toBe(true);
  });
});

describe('policy validation', () => {
  const v = (rule: Parameters<typeof validateLateFeeRule>[0]): string => catchFinance(() => validateLateFeeRule(rule)).code;
  it('rejects zero/invalid values, grace and caps', () => {
    expect(v({ mode: 'FIXED', valuePaise: 0, graceDays: 0 })).toBe('LATE_FEE_POLICY_INVALID');
    expect(v({ mode: 'PER_DAY', valuePaise: -5, graceDays: 0 })).toBe('LATE_FEE_POLICY_INVALID');
    expect(v({ mode: 'PERCENT', valueBp: 0, graceDays: 0 })).toBe('LATE_FEE_POLICY_INVALID');
    expect(v({ mode: 'PERCENT', valueBp: 10_001, graceDays: 0 })).toBe('LATE_FEE_POLICY_INVALID');
    expect(v({ mode: 'FIXED', valuePaise: 10, graceDays: -1 })).toBe('LATE_FEE_POLICY_INVALID');
    expect(v({ mode: 'FIXED', valuePaise: 10, graceDays: 1.5 })).toBe('LATE_FEE_POLICY_INVALID');
    expect(v({ mode: 'FIXED', valuePaise: 10, graceDays: 0, capPaise: 0 })).toBe('LATE_FEE_POLICY_INVALID');
    expect(() => validateLateFeeRule({ mode: 'FIXED', valuePaise: 10, graceDays: 0, capPaise: null })).not.toThrow();
  });
  it('an invalid policy fails loudly when used', () => {
    expect(catchFinance(() => run('2026-10-08', { valuePaise: 0 })).code).toBe('LATE_FEE_POLICY_INVALID');
  });
});

describe('PROPERTY — penalties respect the cap and are idempotent', () => {
  it('Σ posted ≤ cap, and a second run adds nothing', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5_000 }), fc.integer({ min: 1, max: 60_000 }), fc.integer({ min: 0, max: 20 }), fc.integer({ min: 1, max: 120 }), (daily, cap, grace, days) => {
        const asOf = `2026-${String(4 + Math.floor((10 + grace + days) / 30)).padStart(2, '0')}-${String(((10 + grace + days) % 30) + 1).padStart(2, '0')}`;
        const p = policy({ mode: 'PER_DAY', valuePaise: daily, capPaise: cap, graceDays: grace });
        const first = computePenaltyPostings({ parent, policy: p, asOf, paidEvents: [], existing: [] });
        expect(first.reduce((s, x) => s + x.amount, 0)).toBeLessThanOrEqual(cap);
        const second = computePenaltyPostings({ parent, policy: p, asOf, paidEvents: [], existing: first.map((x) => ({ periodKey: x.periodKey, amount: x.amount })) });
        expect(second).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
