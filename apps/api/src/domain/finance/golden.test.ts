import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  applyAllocations,
  buildFeePreview,
  computeAging,
  summarize,
  type Receivable,
} from './index';
import { R, STUDENT, Y2026, line, mk, tuition } from '../../testing/fixtures';

/**
 * GOLDEN TESTS — numbers taken from the SOW itself and from the client brief. If any of these
 * changes, a business rule changed.
 */
describe('GOLDEN §7.11 — admission FEE SUMMARY (verified arithmetic)', () => {
  const preview = buildFeePreview({
    asOf: '2026-10-08',
    assignmentId: 'asg-1',
    studentId: STUDENT,
    academicYearId: Y2026,
    lines: [tuition(R(50_000))],
    plan: {
      kind: 'STANDARD',
      plan: {
        planCode: 'INST4',
        installments: [
          { no: 1, dueDate: '2026-04-10' },
          { no: 2, dueDate: '2026-07-10' },
          { no: 3, dueDate: '2026-10-10' },
          { no: 4, dueDate: '2027-01-10' },
        ],
      },
    },
    openingBalance: { id: 'ob-1', amount: R(10_000), effectiveDate: '2026-04-01', source: 'MIGRATION', reason: 'Migrated from previous system' },
    adjustments: [
      {
        type: 'CONCESSION',
        approved: true,
        request: { mode: 'FIXED', value: R(5_000), basis: 'TOTAL_FEE', distribution: 'LATEST_FIRST' },
      },
    ],
    historicalPayments: [{ amount: R(20_000), paymentDate: '2026-04-12' }],
  });

  it('applicable fee excludes the opening balance (it is NOT added to the fee)', () => {
    expect(preview.summary.applicableFee).toBe(R(50_000));
    expect(preview.summary.openingBalance).toBe(R(10_000));
  });

  it('CURRENT OUTSTANDING = 50,000 + 10,000 − 5,000 − 20,000 = ₹35,000', () => {
    const s = preview.summary;
    expect(s.concession).toBe(R(5_000));
    expect(s.alreadyPaid).toBe(R(20_000));
    expect(s.currentOutstanding).toBe(R(35_000));
    expect(s.applicableFee + s.openingBalance + s.penalties - s.concession - s.alreadyPaid).toBe(s.currentOutstanding);
  });

  it('allocates the 20,000 oldest-first: opening balance, then installment 1', () => {
    const byLabel = Object.fromEntries(preview.rows.map((r) => [r.label, r]));
    expect(byLabel['Opening balance']).toMatchObject({ payable: R(10_000), paid: R(10_000), pending: 0 });
    expect(byLabel['Installment 1']).toMatchObject({ payable: R(12_500), paid: R(10_000), pending: R(2_500) });
    expect(byLabel['Installment 2']).toMatchObject({ paid: 0, pending: R(12_500) });
    expect(byLabel['Installment 3']).toMatchObject({ paid: 0, pending: R(12_500) });
    expect(byLabel['Installment 4']).toMatchObject({ adjusted: R(5_000), pending: R(7_500) });
  });

  it('statuses on 8 Oct 2026: I1 overdue 181 d, I2 overdue 90 d, I3 due soon, I4 not due', () => {
    const st = Object.fromEntries(preview.rows.map((r) => [r.label, r.status.primary]));
    expect(st).toMatchObject({
      'Opening balance': 'PAID',
      'Installment 1': 'OVERDUE',
      'Installment 2': 'OVERDUE',
      'Installment 3': 'DUE_SOON',
      'Installment 4': 'UNPAID',
    });
    expect(preview.summary.overdue).toBe(R(15_000));
  });

  it('next installment = Installment 3 (₹12,500, 10 Oct 2026)', () => {
    expect(preview.summary.nextInstallment).toMatchObject({ installmentNo: 3, pending: R(12_500), dueDate: '2026-10-10' });
  });

  it('aging buckets from ORIGINAL due dates: 181 d → 90+, 90 d → 61–90, due soon → not yet due', () => {
    const aging = computeAging(preview.receivables, '2026-10-08', { agingBoundaries: [30, 60, 90], agingBasis: 'ORIGINAL_DUE_DATE' });
    expect(aging.d90plus).toEqual({ amount: R(2_500), count: 1 });
    expect(aging.d61_90).toEqual({ amount: R(12_500), count: 1 });
    expect(aging.notYetDue).toEqual({ amount: R(12_500 + 7_500), count: 2 });
    expect(aging.total.amount).toBe(R(35_000));
  });

  it('collection % = collected fees ÷ expected fees (opening balance excluded from both)', () => {
    // expected = 50,000 − 5,000 = 45,000 ; collected against installments = 10,000 → 22.22 %
    expect(preview.yearSummary.expectedFees).toBe(R(45_000));
    expect(preview.yearSummary.collectedFees).toBe(R(10_000));
    expect(preview.yearSummary.collectionBp).toBe(2_222);
  });
});

describe('GOLDEN SOW §12 — installment table', () => {
  // 4 × ₹15,000 (10 Apr, 10 Jul, 10 Oct, 10 Jan): paid 15,000 / 10,000 / 0 / 0
  it('Paid · Partial · Pending · Pending with the exact pending amounts', () => {
    let rs: Receivable[] = [
      mk({ id: 'i1', no: 1, due: '2026-04-10', amount: R(15_000) }),
      mk({ id: 'i2', no: 2, due: '2026-07-10', amount: R(15_000) }),
      mk({ id: 'i3', no: 3, due: '2026-10-10', amount: R(15_000) }),
      mk({ id: 'i4', no: 4, due: '2027-01-10', amount: R(15_000) }),
    ];
    rs = allocatePayment({ amount: R(25_000), receivables: rs, today: '2026-07-15' }).updatedReceivables;
    expect(rs.map((r) => [r.paid, r.pending, r.paymentStatus])).toEqual([
      [R(15_000), 0, 'PAID'],
      [R(10_000), R(5_000), 'PARTIAL'],
      [0, R(15_000), 'UNPAID'],
      [0, R(15_000), 'UNPAID'],
    ]);
  });
});

describe('GOLDEN SOW §15 — partial payment', () => {
  it('installment 15,000 − payment 10,000 = 5,000 remaining, status Partially Paid, still in outstanding', () => {
    const rs = [mk({ id: 'i', no: 1, due: '2026-10-10', amount: R(15_000) })];
    const res = allocatePayment({ amount: R(10_000), receivables: rs, today: '2026-10-01' });
    expect(res.updatedReceivables[0]).toMatchObject({ pending: R(5_000), paymentStatus: 'PARTIAL' });
    expect(summarize(res.updatedReceivables, '2026-10-01', { dueSoonDays: 7, expectedIncludesPenalties: false }).totalOutstanding).toBe(R(5_000));
  });
});

describe('GOLDEN SOW §17 — payment allocation', () => {
  const base = [
    mk({ id: 'i1', no: 1, due: '2026-04-10', amount: R(5_000) }),
    mk({ id: 'i2', no: 2, due: '2026-07-10', amount: R(15_000) }),
  ];
  it('₹20,000 clears both (5,000 + 15,000)', () => {
    const res = allocatePayment({ amount: R(20_000), receivables: base, today: '2026-10-08' });
    expect(res.allocations.map((a) => [a.receivableId, a.amount])).toEqual([['i1', R(5_000)], ['i2', R(15_000)]]);
    expect(res.updatedReceivables.every((r) => r.paymentStatus === 'PAID')).toBe(true);
    expect(res.unallocated).toBe(0);
  });
  it('₹12,000 → I1 5,000 (paid) + I2 7,000 (partial, 8,000 pending)', () => {
    const res = allocatePayment({ amount: R(12_000), receivables: base, today: '2026-10-08' });
    expect(res.allocations.map((a) => a.amount)).toEqual([R(5_000), R(7_000)]);
    expect(res.updatedReceivables.map((r) => r.pending)).toEqual([0, R(8_000)]);
  });
});

describe('GOLDEN SOW §5/§6 — Class 10 division table reconciles', () => {
  // Div A 40 students ₹20L exp ₹18L coll · B 42 ₹21L/₹17L · C 39 ₹19.5L/₹17L · D 39 ₹19.5L/₹16L
  const lakh = (n: number): number => R(n * 100_000);
  const divisions = [
    { name: 'A', students: 40, expected: 20, collected: 18 },
    { name: 'B', students: 42, expected: 21, collected: 17 },
    { name: 'C', students: 39, expected: 19.5, collected: 17 },
    { name: 'D', students: 39, expected: 19.5, collected: 16 },
  ];
  const summaries = divisions.map((d) => {
    const due = mk({ id: `div-${d.name}`, no: 1, due: '2026-04-10', amount: lakh(d.expected) });
    const paid = allocatePayment({ amount: lakh(d.collected), receivables: [due], today: '2026-10-08' }).updatedReceivables;
    return { d, s: summarize(paid, '2026-10-08', { dueSoonDays: 7, expectedIncludesPenalties: false }) };
  });
  it('division outstanding: 2L, 4L, 2.5L, 3.5L', () => {
    expect(summaries.map((x) => x.s.totalOutstanding)).toEqual([lakh(2), lakh(4), lakh(2.5), lakh(3.5)]);
  });
  it('class totals: 160 students · ₹80L expected · ₹68L collected · ₹12L outstanding · 85 %', () => {
    const sum = (f: (x: (typeof summaries)[number]) => number): number => summaries.reduce((a, x) => a + f(x), 0);
    expect(sum((x) => x.d.students)).toBe(160);
    expect(sum((x) => x.s.expectedFees)).toBe(lakh(80));
    expect(sum((x) => x.s.collectedFees)).toBe(lakh(68));
    expect(sum((x) => x.s.totalOutstanding)).toBe(lakh(12));
    const all = summarize(
      summaries.flatMap((x) => [mk({ id: `x-${x.d.name}`, no: 1, due: '2026-04-10', amount: lakh(x.d.expected) })]).map((r, i) =>
        allocatePayment({ amount: lakh(divisions[i]?.collected ?? 0), receivables: [r], today: '2026-10-08' }).updatedReceivables[0] as Receivable,
      ),
      '2026-10-08',
      { dueSoonDays: 7, expectedIncludesPenalties: false },
    );
    expect(all.collectionBp).toBe(8_500);
  });
});

describe('GOLDEN SOW §31 / §35 — expected vs actual, forecast inputs', () => {
  const cr = (n: number): number => R(n * 10_000_000);
  it('§31: expected ₹5.00 Cr, actual ₹4.25 Cr → outstanding ₹75 L, rate 85 %', () => {
    const due = mk({ id: 'yr', no: 1, due: '2026-04-10', amount: cr(5) });
    const paid = allocatePayment({ amount: cr(4.25), receivables: [due], today: '2026-10-08' }).updatedReceivables;
    const s = summarize(paid, '2026-10-08', { dueSoonDays: 7, expectedIncludesPenalties: false });
    expect(s.totalOutstanding).toBe(R(7_500_000));
    expect(s.collectionBp).toBe(8_500);
  });
  it('§35: expected ₹1.20 Cr, collected ₹82 L → outstanding ₹38 L, rate 68 %', () => {
    const due = mk({ id: 'yr', no: 1, due: '2026-04-10', amount: cr(1.2) });
    const paid = allocatePayment({ amount: R(8_200_000), receivables: [due], today: '2026-10-08' }).updatedReceivables;
    const s = summarize(paid, '2026-10-08', { dueSoonDays: 7, expectedIncludesPenalties: false });
    expect(s.totalOutstanding).toBe(R(3_800_000));
    expect(Math.round(s.collectionBp / 100)).toBe(68);
  });
});

describe('GOLDEN — applying a multi-component allocation keeps every invariant', () => {
  it('Admission + Tuition receivable paid in configured priority order', () => {
    const r = mk({ id: 'c', no: 1, due: '2026-04-10', comps: { TUITION: R(8_000), ADMISSION: R(2_000) } });
    const res = allocatePayment({ amount: R(3_000), receivables: [r], today: '2026-05-01', componentPriority: ['ADMISSION', 'TUITION'] });
    expect(res.allocations[0]?.componentSplit).toEqual([
      { componentCode: 'ADMISSION', amount: R(2_000) },
      { componentCode: 'TUITION', amount: R(1_000) },
    ]);
    const again = applyAllocations([r], res.allocations);
    expect(again[0]?.pending).toBe(R(7_000));
    void line;
  });
});
