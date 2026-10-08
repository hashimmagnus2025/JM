import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildFeePreview, type FeePreviewInput } from './index';
import { hashCanonical } from '../../lib/hash';
import { R, STUDENT, Y2026, catchFinance, deepFreeze, line, tuition } from '../../testing/fixtures';

const plan = {
  kind: 'STANDARD' as const,
  plan: {
    planCode: 'INST4',
    installments: ['2026-04-10', '2026-07-10', '2026-10-10', '2027-01-10'].map((dueDate, i) => ({
      no: i + 1,
      dueDate,
    })),
  },
};
const input = (patch: Partial<FeePreviewInput> = {}): FeePreviewInput => ({
  asOf: '2026-10-08',
  assignmentId: 'asg',
  studentId: STUDENT,
  academicYearId: Y2026,
  lines: [tuition(R(50_000))],
  plan,
  ...patch,
});
const concession = (approved: boolean, value = R(5_000)) => ({
  type: 'CONCESSION' as const,
  approved,
  request: {
    mode: 'FIXED' as const,
    value,
    basis: 'TOTAL_FEE' as const,
    distribution: 'LATEST_FIRST' as const,
  },
});

describe('admission preview and final save use the SAME engine (decision #15)', () => {
  it('is deterministic: identical input → identical output, including the hash basis', () => {
    const a = buildFeePreview(
      deepFreeze(
        input({
          openingBalance: {
            id: 'ob',
            amount: R(1_000),
            effectiveDate: '2026-04-01',
            source: 'MIGRATION',
            reason: 'migration',
          },
          adjustments: [concession(true)],
        }),
      ),
    );
    const b = buildFeePreview(
      input({
        openingBalance: {
          id: 'ob',
          amount: R(1_000),
          effectiveDate: '2026-04-01',
          source: 'MIGRATION',
          reason: 'migration',
        },
        adjustments: [concession(true)],
      }),
    );
    expect(a).toEqual(b);
    expect(hashCanonical(a.hashBasis)).toBe(hashCanonical(b.hashBasis));
  });

  it('the hash covers money, not the clock: unchanged across midnight, changed by any financial edit', () => {
    const h = (patch: Partial<FeePreviewInput>): string =>
      hashCanonical(buildFeePreview(input(patch)).hashBasis);
    const base = h({});
    expect(h({ asOf: '2026-10-09' })).toBe(base); // statuses change, money does not
    expect(h({ lines: [tuition(R(50_001))] })).not.toBe(base);
    expect(
      h({
        plan: {
          ...plan,
          plan: {
            ...plan.plan,
            installments: plan.plan.installments.map((i, k) =>
              k === 0 ? { ...i, dueDate: '2026-04-11' } : i,
            ),
          },
        },
      }),
    ).not.toBe(base);
    expect(
      h({
        openingBalance: {
          id: 'ob',
          amount: 1,
          effectiveDate: '2026-04-01',
          source: 'MANUAL',
          reason: 'abc',
        },
      }),
    ).not.toBe(base);
    expect(h({ adjustments: [concession(true)] })).not.toBe(base);
    expect(h({ adjustments: [concession(false)] })).not.toBe(base);
    expect(h({ historicalPayments: [{ amount: 100, paymentDate: '2026-04-12' }] })).not.toBe(base);
  });

  it('the persisted receivables ARE the previewed receivables (nothing is recalculated differently on save)', () => {
    const preview = buildFeePreview(input());
    const saved = buildFeePreview(input()); // the save path calls the very same function
    expect(saved.receivables).toEqual(preview.receivables);
    expect(preview.receivables.map((r) => r.dedupeKey)).toEqual([
      'FEE_ASSIGNMENT:asg:1',
      'FEE_ASSIGNMENT:asg:2',
      'FEE_ASSIGNMENT:asg:3',
      'FEE_ASSIGNMENT:asg:4',
    ]);
  });
});

describe('concessions awaiting approval', () => {
  it('do not reduce the outstanding, are flagged, and are shown as "if approved"', () => {
    const p = buildFeePreview(input({ adjustments: [concession(false)] }));
    expect(p.summary.concession).toBe(0);
    expect(p.summary.concessionPendingApproval).toBe(R(5_000));
    expect(p.summary.currentOutstanding).toBe(R(50_000));
    expect(p.summary.outstandingIfPendingApproved).toBe(R(45_000));
    expect(p.receivables.some((r) => r.hasPendingAdjustment)).toBe(true);
    expect(p.warnings.map((w) => w.code)).toContain('ADJUSTMENT_PENDING_APPROVAL');
    expect(p.pendingAdjustments).toHaveLength(1);
  });
  it('approved + pending together are both reflected correctly', () => {
    const p = buildFeePreview(
      input({ adjustments: [concession(true, R(5_000)), concession(false, R(2_000))] }),
    );
    expect(p.summary).toMatchObject({
      concession: R(5_000),
      concessionPendingApproval: R(2_000),
      currentOutstanding: R(45_000),
      outstandingIfPendingApproved: R(43_000),
    });
  });
  it('cannot be requested beyond what is still payable after the payments already made', () => {
    const e = catchFinance(() =>
      buildFeePreview(
        input({
          historicalPayments: [{ amount: R(50_000), paymentDate: '2026-04-12' }],
          adjustments: [concession(false, R(1))],
        }),
      ),
    );
    expect(e.code).toBe('ADJUSTMENT_EXCEEDS_PAYABLE');
  });
});

describe('historical payments entered at admission', () => {
  it('are allocated by the same engine, on their own date, oldest first', () => {
    const p = buildFeePreview(
      input({ historicalPayments: [{ amount: R(15_000), paymentDate: '2026-07-15' }] }),
    );
    expect(p.rows.map((r) => r.paid)).toEqual([R(12_500), R(2_500), 0, 0]);
    expect(p.historicalAllocations[0]?.allocations.map((a) => a.amount)).toEqual([
      R(12_500),
      R(2_500),
    ]);
  });
  it('are applied in date order regardless of input order', () => {
    const p = buildFeePreview(
      input({
        historicalPayments: [
          { amount: R(100), paymentDate: '2026-06-01' },
          { amount: R(200), paymentDate: '2026-05-01' },
        ],
      }),
    );
    expect(p.historicalAllocations.map((h) => h.paymentDate)).toEqual(['2026-05-01', '2026-06-01']);
  });
  it('reject a future date, zero, and more than is outstanding', () => {
    expect(
      catchFinance(() =>
        buildFeePreview(
          input({ historicalPayments: [{ amount: 100, paymentDate: '2026-10-09' }] }),
        ),
      ).code,
    ).toBe('PAYMENT_AMOUNT_INVALID');
    expect(
      catchFinance(() =>
        buildFeePreview(input({ historicalPayments: [{ amount: 0, paymentDate: '2026-05-01' }] })),
      ).details,
    ).toMatchObject({ reason: 'ZERO' });
    expect(
      catchFinance(() =>
        buildFeePreview(
          input({ historicalPayments: [{ amount: R(50_001), paymentDate: '2026-05-01' }] }),
        ),
      ).code,
    ).toBe('PAYMENT_EXCEEDS_OUTSTANDING');
  });
});

describe('preview content', () => {
  it('rows are sorted by due date with display statuses; warnings flag overdue-on-entry', () => {
    const p = buildFeePreview(
      input({
        openingBalance: {
          id: 'ob',
          amount: R(1_000),
          effectiveDate: '2026-04-01',
          source: 'MIGRATION',
          reason: 'migration',
        },
      }),
    );
    expect(p.rows.map((r) => r.label)).toEqual([
      'Opening balance',
      'Installment 1',
      'Installment 2',
      'Installment 3',
      'Installment 4',
    ]);
    expect(p.rows[1]?.status.primary).toBe('OVERDUE');
    expect(p.warnings.map((w) => w.code)).toEqual([
      'INSTALLMENT_OVERDUE_ON_ENTRY',
      'OPENING_BALANCE_OVERDUE_ON_ENTRY',
    ]);
  });
  it('no warnings for a fresh admission before the first due date', () => {
    expect(buildFeePreview(input({ asOf: '2026-03-01' })).warnings).toEqual([]);
  });
  it('multiple components appear as separate lines of the same installments', () => {
    const p = buildFeePreview(input({ lines: [tuition(R(40_000)), line('TRANSPORT', R(10_000))] }));
    expect(p.summary.applicableFee).toBe(R(50_000));
    expect(p.receivables[0]?.components.map((c) => c.code)).toEqual(['TUITION', 'TRANSPORT']);
  });
});

describe('PROPERTY — the FEE SUMMARY identity always holds', () => {
  it('applicable + opening + penalties − concession − alreadyPaid = current outstanding', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 90_000_000 }),
        fc.option(fc.integer({ min: 1, max: 20_000_000 }), { nil: undefined }),
        fc.double({ min: 0, max: 0.5, noNaN: true }),
        fc.double({ min: 0, max: 0.9, noNaN: true }),
        (fee, ob, cFrac, pFrac) => {
          const concessionAmt = Math.floor(fee * cFrac);
          const total = fee + (ob ?? 0) - concessionAmt;
          const payAmt = Math.floor(total * pFrac);
          const p = buildFeePreview(
            input({
              lines: [tuition(fee)],
              ...(ob
                ? {
                    openingBalance: {
                      id: 'ob',
                      amount: ob,
                      effectiveDate: '2026-04-01',
                      source: 'MIGRATION' as const,
                      reason: 'migration',
                    },
                  }
                : {}),
              adjustments: concessionAmt > 0 ? [concession(true, concessionAmt)] : [],
              historicalPayments: payAmt > 0 ? [{ amount: payAmt, paymentDate: '2026-05-01' }] : [],
            }),
          );
          const s = p.summary;
          expect(
            s.applicableFee + s.openingBalance + s.penalties - s.concession - s.alreadyPaid,
          ).toBe(s.currentOutstanding);
          expect(s.currentOutstanding).toBe(total - payAmt);
          expect(s.applicableFee).toBe(fee); // opening balance never leaks into the fee
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('preview options and edge branches', () => {
  it('passes class / division through and accepts an explicit opening-balance due date', () => {
    const p = buildFeePreview(
      input({
        classId: 'c5',
        divisionId: 'c5-A',
        openingBalance: {
          id: 'ob',
          amount: R(100),
          effectiveDate: '2026-04-01',
          dueDate: '2026-06-30',
          source: 'MANUAL',
          reason: 'carried dues',
        },
      }),
    );
    expect(p.receivables.every((r) => r.classId === 'c5' && r.divisionId === 'c5-A')).toBe(true);
    expect(p.receivables.find((r) => r.kind === 'OPENING_BALANCE')?.dueDate).toBe('2026-06-30');
  });
  it('uses overridden settings (e.g. component priority and due-soon window)', () => {
    const p = buildFeePreview(
      input({
        asOf: '2026-10-01',
        lines: [tuition(R(10_000)), line('ADMISSION', R(2_000))],
        plan: { kind: 'FULL', dueDate: '2026-10-10' },
        historicalPayments: [{ amount: R(2_000), paymentDate: '2026-09-01' }],
        settings: { componentPriority: ['ADMISSION'], dueSoonDays: 30 },
      }),
    );
    expect(p.historicalAllocations[0]?.allocations[0]?.componentSplit).toEqual([
      { componentCode: 'ADMISSION', amount: R(2_000) },
    ]);
    expect(p.rows[0]?.status.primary).toBe('DUE_SOON');
  });
  it('a waiver of a single due (RECEIVABLE basis) can be requested at admission', () => {
    const p = buildFeePreview(
      input({
        adjustments: [
          {
            type: 'WAIVER',
            approved: true,
            request: {
              mode: 'FIXED',
              value: R(100),
              basis: 'RECEIVABLE',
              receivableId: 'FEE_ASSIGNMENT:asg:4',
              distribution: 'PROPORTIONAL',
            },
          },
        ],
      }),
    );
    expect(p.receivables.find((r) => r.id === 'FEE_ASSIGNMENT:asg:4')?.adjusted).toBe(R(100));
    expect(p.summary.concession).toBe(R(100));
  });
  it('existing receivables of the student that are untouched stay untouched', () => {
    const existing = [
      {
        ...buildFeePreview(input({ assignmentId: 'old', academicYearId: 'ay-old' })).receivables[0],
      },
    ] as never[];
    const p = buildFeePreview(input({ existingReceivables: existing }));
    expect(p.existingAfter).toEqual(existing);
    expect(p.summary.paidToOtherYears).toBe(0);
  });
});
