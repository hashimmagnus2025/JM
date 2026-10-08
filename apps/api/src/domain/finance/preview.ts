import { canonicalJson, isAfter, type BusinessDate, type Paise } from '@sfm/shared';
import {
  applyAdjustment,
  flagPendingAdjustment,
  resolveAdjustment,
  type AdjustmentApplication,
  type AdjustmentRequest,
} from './adjustments';
import { allocatePayment } from './allocate';
import { buildInstallments, type PlanSpec } from './build-installments';
import { FinanceError } from './errors';
import { buildOpeningBalanceReceivable, type OpeningBalanceSource } from './opening-balance';
import { deriveDisplayStatus, type ReceivableDisplayStatus } from './status';
import { summarize, type NextInstallment, type Summary } from './summary';
import { DEFAULT_FINANCE_SETTINGS, type AllocationDraft, type FeeLine, type FinanceSettings, type Receivable } from './types';

export interface PreviewAdjustmentInput {
  type: 'SCHOLARSHIP' | 'DISCOUNT' | 'CONCESSION' | 'WAIVER' | 'OTHER';
  request: AdjustmentRequest;
  /** only APPROVED adjustments reduce the outstanding; others are shown as "if approved" */
  approved: boolean;
}

export interface PreviewPaymentInput {
  amount: Paise;
  paymentDate: BusinessDate;
}

export interface FeePreviewInput {
  /** "today" — drives overdue / due-soon statuses only; it never changes an amount */
  asOf: BusinessDate;
  assignmentId: string;
  studentId: string;
  academicYearId: string;
  classId?: string;
  divisionId?: string;
  lines: readonly FeeLine[];
  plan: PlanSpec;
  openingBalance?: {
    id: string;
    amount: Paise;
    effectiveDate: BusinessDate;
    dueDate?: BusinessDate;
    source: OpeningBalanceSource;
    reason: string;
  };
  adjustments?: readonly PreviewAdjustmentInput[];
  /** payments made before this system / at admission (BRC-D2), allocated by the SAME allocation engine */
  historicalPayments?: readonly PreviewPaymentInput[];
  /** the student's other receivables (e.g. prior-year dues) — they take part in allocation and totals */
  existingReceivables?: readonly Receivable[];
  settings?: Partial<FinanceSettings>;
}

export interface PreviewInstallmentRow {
  receivableId: string;
  kind: Receivable['kind'];
  label: string;
  installmentNo: number | undefined;
  dueDate: BusinessDate;
  payable: Paise;
  adjusted: Paise;
  paid: Paise;
  pending: Paise;
  status: ReceivableDisplayStatus;
}

export interface PreviewWarning {
  code: 'INSTALLMENT_OVERDUE_ON_ENTRY' | 'OPENING_BALANCE_OVERDUE_ON_ENTRY' | 'ADJUSTMENT_PENDING_APPROVAL';
  message: string;
}

export interface FeePreviewSummary {
  /** Gross fee of this year's installments — NEVER includes the opening balance */
  applicableFee: Paise;
  openingBalance: Paise;
  penalties: Paise;
  /** approved concessions/discounts currently effective */
  concession: Paise;
  /** concessions waiting for approval (not yet reducing the outstanding) */
  concessionPendingApproval: Paise;
  /** paid against THIS year's receivables */
  alreadyPaid: Paise;
  /** historical payments that were allocated to other years' dues (oldest-first) */
  paidToOtherYears: Paise;
  /** this year: applicable + opening + penalties − concession − alreadyPaid */
  currentOutstanding: Paise;
  outstandingIfPendingApproved: Paise;
  overdue: Paise;
  nextInstallment: NextInstallment | null;
  /** outstanding across every year (this year + existing receivables) */
  totalOutstandingAllYears: Paise;
}

export interface FeePreview {
  receivables: Receivable[];
  existingAfter: Receivable[];
  rows: PreviewInstallmentRow[];
  summary: FeePreviewSummary;
  yearSummary: Summary;
  allYearsSummary: Summary;
  appliedAdjustments: { type: PreviewAdjustmentInput['type']; amount: Paise; applications: AdjustmentApplication[] }[];
  pendingAdjustments: { type: PreviewAdjustmentInput['type']; amount: Paise; applications: AdjustmentApplication[] }[];
  historicalAllocations: { paymentDate: BusinessDate; amount: Paise; allocations: AllocationDraft[] }[];
  warnings: PreviewWarning[];
  /**
   * Canonical string of everything that determines the money (amounts, due dates, adjustments, payments).
   * Excludes `asOf`/statuses so a preview stays valid across midnight. lib/hash.ts turns it into the
   * `previewHash` the client sends back; the save path recomputes it with THIS SAME function.
   */
  hashBasis: string;
}

/**
 * THE one calculation used by both the admission preview and the admission save (decision #15).
 * Pure: same input → same output, no clock, no I/O.
 */
export function buildFeePreview(input: FeePreviewInput): FeePreview {
  const settings: FinanceSettings = { ...DEFAULT_FINANCE_SETTINGS, ...(input.settings ?? {}) };
  const existing = input.existingReceivables ?? [];

  /* 1 ─ installments (the year's gross fee) */
  let fresh = buildInstallments({
    assignmentId: input.assignmentId,
    studentId: input.studentId,
    academicYearId: input.academicYearId,
    ...(input.classId !== undefined ? { classId: input.classId } : {}),
    ...(input.divisionId !== undefined ? { divisionId: input.divisionId } : {}),
    lines: input.lines,
    plan: input.plan,
    remainderPlacement: settings.remainderPlacement,
  });

  /* 2 ─ opening balance: a SEPARATE receivable, never part of the gross fee */
  if (input.openingBalance) {
    const ob = input.openingBalance;
    const existingActive = existing.some(
      (r) => r.kind === 'OPENING_BALANCE' && r.academicYearId === input.academicYearId && r.paymentStatus !== 'VOID',
    );
    fresh = [
      buildOpeningBalanceReceivable(
        {
          id: ob.id,
          studentId: input.studentId,
          academicYearId: input.academicYearId,
          ...(input.classId !== undefined ? { classId: input.classId } : {}),
          ...(input.divisionId !== undefined ? { divisionId: input.divisionId } : {}),
          amount: ob.amount,
          effectiveDate: ob.effectiveDate,
          ...(ob.dueDate !== undefined ? { dueDate: ob.dueDate } : {}),
          source: ob.source,
          reason: ob.reason,
        },
        { existingActive },
      ),
      ...fresh,
    ];
  }

  /* 3 ─ adjustments: approved ones apply, the rest are only reported */
  const applied: FeePreview['appliedAdjustments'] = [];
  const pending: FeePreview['pendingAdjustments'] = [];
  const yearScope = (rs: Receivable[]): Receivable[] => rs.filter((r) => r.academicYearId === input.academicYearId);
  const adjustments = input.adjustments ?? [];
  for (const a of adjustments.filter((x) => x.approved)) {
    const resolved = resolveAdjustment(a.request, yearScope(fresh));
    fresh = mergeById(fresh, applyAdjustment(fresh, resolved.applications));
    applied.push({ type: a.type, ...resolved });
  }
  /* 4 ─ historical payments: same allocation engine, oldest due first, on the payment's own date */
  let all: Receivable[] = [...existing, ...fresh];
  const historical: FeePreview['historicalAllocations'] = [];
  const payments = [...(input.historicalPayments ?? [])].sort((a, b) => (a.paymentDate < b.paymentDate ? -1 : a.paymentDate > b.paymentDate ? 1 : 0));
  for (const p of payments) {
    if (isAfter(p.paymentDate, input.asOf)) {
      throw new FinanceError('PAYMENT_AMOUNT_INVALID', 'A historical payment cannot be dated in the future.', { paymentDate: p.paymentDate });
    }
    const res = allocatePayment({
      amount: p.amount,
      receivables: all,
      today: p.paymentDate,
      componentPriority: settings.componentPriority,
      advanceEnabled: false,
    });
    all = res.updatedReceivables;
    historical.push({ paymentDate: p.paymentDate, amount: p.amount, allocations: res.allocations });
  }

  const freshIds = new Set(fresh.map((r) => r.id));
  let receivables = all.filter((r) => freshIds.has(r.id));
  const existingAfter = all.filter((r) => !freshIds.has(r.id));

  /* 4b ─ concessions still awaiting approval: resolved against the real post-payment state (an
         adjustment can never reduce a due below what is already paid), applied ONLY to a scenario copy;
         the real receivables just carry the pending flag (blocks PAID, CL-09) */
  let scenario = receivables;
  for (const a of adjustments.filter((x) => !x.approved)) {
    const resolved = resolveAdjustment(a.request, yearScope(scenario));
    scenario = applyAdjustment(scenario, resolved.applications);
    receivables = flagPendingAdjustment(receivables, resolved.applications);
    pending.push({ type: a.type, ...resolved });
  }

  /* 5 ─ summary, rows, warnings */
  const yearSummary = summarize(receivables, input.asOf, settings);
  const allYearsSummary = summarize(all, input.asOf, settings);
  const scenarioOutstanding = summarize(scenario, input.asOf, settings).totalOutstanding;
  const existingPaidDelta = existingAfter.reduce((s, r) => s + r.paid, 0) - existing.reduce((s, r) => s + r.paid, 0);

  const rows: PreviewInstallmentRow[] = [...receivables]
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : (a.installmentNo ?? 0) - (b.installmentNo ?? 0)))
    .map((r) => ({
      receivableId: r.id,
      kind: r.kind,
      label: r.label,
      installmentNo: r.installmentNo,
      dueDate: r.dueDate,
      payable: r.payable,
      adjusted: r.adjusted,
      paid: r.paid,
      pending: r.pending,
      status: deriveDisplayStatus(r, input.asOf, settings.dueSoonDays),
    }));

  const warnings: PreviewWarning[] = [];
  if (receivables.some((r) => r.kind === 'INSTALLMENT' && r.pending > 0 && r.dueDate < input.asOf)) {
    warnings.push({ code: 'INSTALLMENT_OVERDUE_ON_ENTRY', message: 'One or more installments are already overdue on the admission date.' });
  }
  if (receivables.some((r) => r.kind === 'OPENING_BALANCE' && r.pending > 0 && r.dueDate < input.asOf)) {
    warnings.push({ code: 'OPENING_BALANCE_OVERDUE_ON_ENTRY', message: 'The opening balance is already overdue.' });
  }
  if (pending.length > 0) {
    warnings.push({ code: 'ADJUSTMENT_PENDING_APPROVAL', message: 'Some concessions are awaiting approval and do not reduce the outstanding yet.' });
  }

  const summary: FeePreviewSummary = {
    applicableFee: yearSummary.grossFee,
    openingBalance: yearSummary.openingBalance.payable,
    penalties: yearSummary.penalties.payable,
    concession: applied.reduce((s, a) => s + a.amount, 0),
    concessionPendingApproval: pending.reduce((s, a) => s + a.amount, 0),
    alreadyPaid: yearSummary.totalPaid,
    paidToOtherYears: existingPaidDelta,
    currentOutstanding: yearSummary.totalOutstanding,
    outstandingIfPendingApproved: scenarioOutstanding,
    overdue: yearSummary.overdue,
    nextInstallment: yearSummary.nextInstallment,
    totalOutstandingAllYears: allYearsSummary.totalOutstanding,
  };

  const hashBasis = canonicalJson({
    receivables: all
      .map((r) => ({
        k: r.dedupeKey,
        kind: r.kind,
        due: r.dueDate,
        c: r.components.map((c) => [c.code, c.payable, c.adjusted, c.transferred, c.paid]),
        pa: r.hasPendingAdjustment,
      }))
      .sort((a, b) => (a.k < b.k ? -1 : 1)),
    applied: applied.map((a) => a.applications),
    pending: pending.map((a) => a.applications),
    payments: payments.map((p) => [p.paymentDate, p.amount]),
  });

  return {
    receivables,
    existingAfter,
    rows,
    summary,
    yearSummary,
    allYearsSummary,
    appliedAdjustments: applied,
    pendingAdjustments: pending,
    historicalAllocations: historical,
    warnings,
    hashBasis,
  };
}

function mergeById(base: Receivable[], updated: Receivable[]): Receivable[] {
  const m = new Map(updated.map((r) => [r.id, r]));
  return base.map((r) => m.get(r.id) ?? r);
}
