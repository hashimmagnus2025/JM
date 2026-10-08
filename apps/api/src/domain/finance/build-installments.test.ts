import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildInstallments, validatePlansForPublish, type FeeLine, type InstallmentPlan, type Receivable } from './index';
import { R, STUDENT, Y2026, catchFinance, line, tuition } from '../../testing/fixtures';

const base = { assignmentId: 'asg', studentId: STUDENT, academicYearId: Y2026 };
const four: InstallmentPlan = {
  planCode: 'INST4',
  installments: [
    { no: 1, dueDate: '2026-04-10' },
    { no: 2, dueDate: '2026-07-10' },
    { no: 3, dueDate: '2026-10-10' },
    { no: 4, dueDate: '2027-01-10' },
  ],
};
const col = (rs: Receivable[], code: string): number[] => rs.map((r) => r.components.find((c) => c.code === code)?.payable ?? 0);

describe('standard plan — even split', () => {
  it('splits ₹50,000 into 4 × ₹12,500 with the right due dates and keys', () => {
    const rs = buildInstallments({ ...base, lines: [tuition(R(50_000))], plan: { kind: 'STANDARD', plan: four } });
    expect(rs.map((r) => [r.installmentNo, r.dueDate, r.payable])).toEqual([
      [1, '2026-04-10', R(12_500)],
      [2, '2026-07-10', R(12_500)],
      [3, '2026-10-10', R(12_500)],
      [4, '2027-01-10', R(12_500)],
    ]);
    expect(rs.map((r) => r.dedupeKey)).toEqual(['FEE_ASSIGNMENT:asg:1', 'FEE_ASSIGNMENT:asg:2', 'FEE_ASSIGNMENT:asg:3', 'FEE_ASSIGNMENT:asg:4']);
    expect(rs.every((r) => r.kind === 'INSTALLMENT' && r.paymentStatus === 'UNPAID' && r.paid === 0)).toBe(true);
  });

  it('leftover paise go to the LAST installment by default (BRC-C4) or the FIRST if configured', () => {
    const three: InstallmentPlan = { planCode: 'I3', installments: four.installments.slice(0, 3) };
    const last = buildInstallments({ ...base, lines: [tuition(10_000)], plan: { kind: 'STANDARD', plan: three } });
    expect(last.map((r) => r.payable)).toEqual([3_333, 3_333, 3_334]);
    const first = buildInstallments({ ...base, lines: [tuition(10_000)], plan: { kind: 'STANDARD', plan: three }, remainderPlacement: 'FIRST' });
    expect(first.map((r) => r.payable)).toEqual([3_334, 3_333, 3_333]);
  });

  it('multiple fee components are each split exactly', () => {
    const rs = buildInstallments({ ...base, lines: [tuition(R(40_000)), line('TRANSPORT', R(10_000)), line('LIBRARY', 1_001)], plan: { kind: 'STANDARD', plan: four } });
    expect(col(rs, 'TUITION')).toEqual([R(10_000), R(10_000), R(10_000), R(10_000)]);
    expect(col(rs, 'TRANSPORT')).toEqual([R(2_500), R(2_500), R(2_500), R(2_500)]);
    expect(col(rs, 'LIBRARY').reduce((a, b) => a + b, 0)).toBe(1_001);
  });

  it('optional components the student opted out of, and zero-amount lines, are not billed', () => {
    const rs = buildInstallments({
      ...base,
      lines: [tuition(R(1_000)), { ...line('TRANSPORT', R(500)), included: false }, line('LAB', 0)],
      plan: { kind: 'STANDARD', plan: four },
    });
    expect(rs.flatMap((r) => r.components.map((c) => c.code))).not.toContain('TRANSPORT');
    expect(rs.reduce((s, r) => s + r.payable, 0)).toBe(R(1_000));
  });

  it('is deterministic and idempotent — regenerating gives identical keys/ids', () => {
    const a = buildInstallments({ ...base, lines: [tuition(R(1_000))], plan: { kind: 'STANDARD', plan: four } });
    const b = buildInstallments({ ...base, lines: [tuition(R(1_000))], plan: { kind: 'STANDARD', plan: four } });
    expect(a).toEqual(b);
    const mapped = buildInstallments({ ...base, lines: [tuition(R(1_000))], plan: { kind: 'STANDARD', plan: four }, idFactory: (k) => `oid:${k}` });
    expect(mapped[0]?.id).toBe('oid:FEE_ASSIGNMENT:asg:1');
  });
});

describe('installment-specific components (SOW §12)', () => {
  it('a component can be charged in one installment only (FIXED full amount)', () => {
    const plan: InstallmentPlan = {
      planCode: 'P',
      installments: [
        { no: 1, dueDate: '2026-04-10', componentSchedule: [{ componentCode: 'ADMISSION', mode: 'FIXED', value: R(5_000) }] },
        { no: 2, dueDate: '2026-07-10' },
      ],
    };
    const rs = buildInstallments({ ...base, lines: [tuition(R(20_000)), line('ADMISSION', R(5_000))], plan: { kind: 'STANDARD', plan } });
    expect(col(rs, 'ADMISSION')).toEqual([R(5_000), 0]);
    expect(col(rs, 'TUITION')).toEqual([R(10_000), R(10_000)]);
  });

  it('PERCENT_BP schedules split exactly (largest remainder)', () => {
    const plan: InstallmentPlan = {
      planCode: 'P',
      installments: [
        { no: 1, dueDate: '2026-04-10', componentSchedule: [{ componentCode: 'TUITION', mode: 'PERCENT_BP', value: 5_000 }] },
        { no: 2, dueDate: '2026-07-10', componentSchedule: [{ componentCode: 'TUITION', mode: 'PERCENT_BP', value: 3_000 }] },
        { no: 3, dueDate: '2026-10-10', componentSchedule: [{ componentCode: 'TUITION', mode: 'PERCENT_BP', value: 2_000 }] },
      ],
    };
    const rs = buildInstallments({ ...base, lines: [tuition(1_000_001)], plan: { kind: 'STANDARD', plan } });
    const c = col(rs, 'TUITION');
    expect(c.reduce((a, b) => a + b, 0)).toBe(1_000_001);
    expect(c[0]).toBeGreaterThanOrEqual(500_000);
  });

  it('REMAINDER takes what FIXED/PERCENT entries leave', () => {
    const plan: InstallmentPlan = {
      planCode: 'P',
      installments: [
        { no: 1, dueDate: '2026-04-10', componentSchedule: [{ componentCode: 'TUITION', mode: 'FIXED', value: R(3_000) }] },
        { no: 2, dueDate: '2026-07-10', componentSchedule: [{ componentCode: 'TUITION', mode: 'PERCENT_BP', value: 2_500 }] },
        { no: 3, dueDate: '2026-10-10', componentSchedule: [{ componentCode: 'TUITION', mode: 'REMAINDER' }] },
      ],
    };
    const rs = buildInstallments({ ...base, lines: [tuition(R(10_000))], plan: { kind: 'STANDARD', plan } });
    expect(col(rs, 'TUITION')).toEqual([R(3_000), R(2_500), R(4_500)]);
  });

  it('a plan that leaves an installment empty simply does not generate it', () => {
    const plan: InstallmentPlan = {
      planCode: 'P',
      installments: [
        { no: 1, dueDate: '2026-04-10', componentSchedule: [{ componentCode: 'ADMISSION', mode: 'FIXED', value: 100 }] },
        { no: 2, dueDate: '2026-07-10', componentSchedule: [{ componentCode: 'ADMISSION', mode: 'FIXED', value: 0 }] },
      ],
    };
    expect(catchFinance(() => buildInstallments({ ...base, lines: [line('ADMISSION', 100)], plan: { kind: 'STANDARD', plan } })).code).toBe('COMPONENT_SCHEDULE_MISMATCH');
    const ok: InstallmentPlan = { planCode: 'P', installments: [plan.installments[0] as never, { no: 2, dueDate: '2026-07-10', componentSchedule: [{ componentCode: 'OTHER', mode: 'FIXED', value: 5 }] }] };
    const rs = buildInstallments({ ...base, lines: [line('ADMISSION', 100), line('OTHER', 5)], plan: { kind: 'STANDARD', plan: ok } });
    expect(rs.map((r) => r.installmentNo)).toEqual([1, 2]);
  });

  it('rejects schedules that do not add up', () => {
    const mk = (entries: ({ componentCode: string; mode: 'FIXED' | 'PERCENT_BP' | 'REMAINDER'; value?: number } | undefined)[]): InstallmentPlan => ({
      planCode: 'P',
      installments: entries.map((e, i) => ({ no: i + 1, dueDate: `2026-0${i + 4}-10`, ...(e ? { componentSchedule: [e] } : {}) })),
    });
    const run = (plan: InstallmentPlan): string => catchFinance(() => buildInstallments({ ...base, lines: [tuition(1_000)], plan: { kind: 'STANDARD', plan } })).code;
    expect(run(mk([{ componentCode: 'TUITION', mode: 'FIXED', value: 400 }, { componentCode: 'TUITION', mode: 'FIXED', value: 500 }]))).toBe('COMPONENT_SCHEDULE_MISMATCH');
    expect(run(mk([{ componentCode: 'TUITION', mode: 'PERCENT_BP', value: 4_000 }, { componentCode: 'TUITION', mode: 'PERCENT_BP', value: 5_000 }]))).toBe('COMPONENT_SCHEDULE_MISMATCH');
    expect(run(mk([{ componentCode: 'TUITION', mode: 'PERCENT_BP', value: 5_000 }, { componentCode: 'TUITION', mode: 'FIXED', value: 500 }]))).toBe('COMPONENT_SCHEDULE_MISMATCH');
    expect(run(mk([{ componentCode: 'TUITION', mode: 'REMAINDER' }, { componentCode: 'TUITION', mode: 'REMAINDER' }]))).toBe('COMPONENT_SCHEDULE_MISMATCH');
    expect(run(mk([{ componentCode: 'TUITION', mode: 'FIXED', value: 1_500 }, { componentCode: 'TUITION', mode: 'REMAINDER' }]))).toBe('COMPONENT_SCHEDULE_MISMATCH');
    expect(run(mk([{ componentCode: 'TUITION', mode: 'FIXED', value: 0 }, { componentCode: 'TUITION', mode: 'REMAINDER' }]))).toBe('COMPONENT_SCHEDULE_MISMATCH');
  });
});

describe('full payment and custom plans', () => {
  it('FULL → one installment with every component', () => {
    const rs = buildInstallments({ ...base, lines: [tuition(R(40_000)), line('TRANSPORT', R(10_000))], plan: { kind: 'FULL', dueDate: '2026-04-10' } });
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ label: 'Full payment', installmentNo: 1, payable: R(50_000) });
  });

  it('CUSTOM amounts must add up to the total fee', () => {
    const e = catchFinance(() =>
      buildInstallments({ ...base, lines: [tuition(R(100))], plan: { kind: 'CUSTOM', installments: [{ dueDate: '2026-04-10', amount: R(60) }, { dueDate: '2026-07-10', amount: R(30) }] } }),
    );
    expect(e.code).toBe('INSTALLMENT_PLAN_INVALID');
  });

  it('CUSTOM distributes components proportionally and exactly, sorted by due date', () => {
    const lines: FeeLine[] = [tuition(R(7_000)), line('TRANSPORT', R(3_000))];
    const rs = buildInstallments({
      ...base,
      lines,
      plan: { kind: 'CUSTOM', installments: [{ dueDate: '2026-10-10', amount: R(2_500), label: 'Final' }, { dueDate: '2026-04-10', amount: R(7_500) }] },
    });
    expect(rs.map((r) => [r.installmentNo, r.dueDate, r.payable])).toEqual([[1, '2026-04-10', R(7_500)], [2, '2026-10-10', R(2_500)]]);
    expect(col(rs, 'TUITION').reduce((a, b) => a + b, 0)).toBe(R(7_000));
    expect(col(rs, 'TRANSPORT').reduce((a, b) => a + b, 0)).toBe(R(3_000));
    expect(rs[1]?.label).toBe('Final');
  });

  it('CUSTOM validates input', () => {
    const run = (installments: { dueDate: string; amount: number }[]): string =>
      catchFinance(() => buildInstallments({ ...base, lines: [tuition(R(100))], plan: { kind: 'CUSTOM', installments } })).code;
    expect(run([])).toBe('INSTALLMENT_PLAN_INVALID');
    expect(run([{ dueDate: '2026-04-10', amount: 0 }, { dueDate: '2026-05-10', amount: R(100) }])).toBe('INSTALLMENT_PLAN_INVALID');
  });
});

describe('input validation', () => {
  const run = (lines: FeeLine[], plan: InstallmentPlan = four): string =>
    catchFinance(() => buildInstallments({ ...base, lines, plan: { kind: 'STANDARD', plan } })).code;
  it('rejects bad fee lines', () => {
    expect(run([])).toBe('FEE_LINES_INVALID');
    expect(run([{ ...tuition(R(1)), included: false }])).toBe('FEE_LINES_INVALID');
    expect(run([tuition(R(1)), tuition(R(2))])).toBe('FEE_LINES_INVALID');
    expect(run([tuition(-5)])).toBe('FEE_LINES_INVALID');
    expect(run([tuition(1.5)])).toBe('FEE_LINES_INVALID');
  });
  it('rejects bad plans', () => {
    expect(run([tuition(100)], { planCode: 'x', installments: [] })).toBe('INSTALLMENT_PLAN_INVALID');
    expect(run([tuition(100)], { planCode: 'x', installments: [{ no: 1, dueDate: '2026-04-10' }, { no: 1, dueDate: '2026-05-10' }] })).toBe('INSTALLMENT_PLAN_INVALID');
    expect(run([tuition(100)], { planCode: 'x', installments: [{ no: 0, dueDate: '2026-04-10' }] })).toBe('INSTALLMENT_PLAN_INVALID');
    expect(run([tuition(100)], { planCode: 'x', installments: [{ no: 1, dueDate: '2026-07-10' }, { no: 2, dueDate: '2026-04-10' }] })).toBe('INSTALLMENT_PLAN_INVALID');
    expect(() =>
      buildInstallments({ ...base, lines: [tuition(100)], plan: { kind: 'STANDARD', plan: { planCode: 'x', installments: [{ no: 1, dueDate: '2026-02-30' }] } } }),
    ).toThrow(/valid YYYY-MM-DD/);
  });
  it('validatePlansForPublish accepts good plans and rejects broken or missing ones', () => {
    expect(() => validatePlansForPublish([tuition(R(100))], [four])).not.toThrow();
    expect(catchFinance(() => validatePlansForPublish([tuition(R(100))], [])).code).toBe('INSTALLMENT_PLAN_INVALID');
    const broken: InstallmentPlan = { planCode: 'b', installments: [{ no: 1, dueDate: '2026-04-10', componentSchedule: [{ componentCode: 'TUITION', mode: 'FIXED', value: 5 }] }] };
    expect(catchFinance(() => validatePlansForPublish([tuition(R(100))], [broken])).code).toBe('COMPONENT_SCHEDULE_MISMATCH');
  });
});

describe('PROPERTY — installments always add up to the fee', () => {
  it('Σ installments = Σ lines, per component, for any amounts and plan length', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 900_000_000 }), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom<'LAST' | 'FIRST'>('LAST', 'FIRST'),
        (amounts, n, placement) => {
          const lines = amounts.map((a, i) => line(`C${i}`, a));
          const plan: InstallmentPlan = { planCode: 'p', installments: Array.from({ length: n }, (_, i) => ({ no: i + 1, dueDate: `2026-${String(Math.min(12, i + 1)).padStart(2, '0')}-10` })) };
          // dates must not go backwards: months are capped at 12 which keeps them non-decreasing
          const rs = buildInstallments({ ...base, lines, plan: { kind: 'STANDARD', plan }, remainderPlacement: placement });
          lines.forEach((l) => expect(col(rs, l.code).reduce((a, b) => a + b, 0)).toBe(l.amount));
          expect(rs.reduce((s, r) => s + r.payable, 0)).toBe(amounts.reduce((a, b) => a + b, 0));
        },
      ),
    );
  });
  it('custom plans add up per component too', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 50_000_000 }), { minLength: 1, maxLength: 5 }),
        fc.array(fc.integer({ min: 1, max: 1_000 }), { minLength: 1, maxLength: 6 }),
        (amounts, weights) => {
          const lines = amounts.map((a, i) => line(`C${i}`, a));
          const gross = amounts.reduce((a, b) => a + b, 0);
          fc.pre(gross >= weights.length);
          const parts = weights.map((w) => Math.max(1, Math.floor((gross * w) / weights.reduce((a, b) => a + b, 0))));
          parts[parts.length - 1] = gross - parts.slice(0, -1).reduce((a, b) => a + b, 0);
          fc.pre((parts[parts.length - 1] ?? 0) > 0);
          const rs = buildInstallments({
            ...base,
            lines,
            plan: { kind: 'CUSTOM', installments: parts.map((amount, i) => ({ amount, dueDate: `2026-${String(i + 1).padStart(2, '0')}-10` })) },
          });
          lines.forEach((l) => expect(col(rs, l.code).reduce((a, b) => a + b, 0)).toBe(l.amount));
        },
      ),
    );
  });
});
