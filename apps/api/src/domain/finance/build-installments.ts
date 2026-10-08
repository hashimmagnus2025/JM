import {
  assertBusinessDate,
  isBefore,
  percentBp,
  splitEvenRemainderFirst,
  splitEvenRemainderLast,
  splitProportional,
  sumPaise,
  type BusinessDate,
  type Paise,
} from '@sfm/shared';
import { FinanceError } from './errors';
import { newReceivable } from './receivable';
import type { FeeLine, Receivable } from './types';

/* ------------------------------ plan description ------------------------------ */

export type ScheduleMode = 'FIXED' | 'PERCENT_BP' | 'REMAINDER';

/** How ONE component is spread over installments (installment-specific components, SOW §12). */
export interface ComponentScheduleEntry {
  componentCode: string;
  mode: ScheduleMode;
  /** paise for FIXED, basis points for PERCENT_BP, unused for REMAINDER */
  value?: number;
}

export interface PlanInstallment {
  no: number;
  label?: string;
  dueDate: BusinessDate;
  /** components NOT listed in any installment of the plan are split evenly over ALL installments */
  componentSchedule?: ComponentScheduleEntry[];
}

export interface InstallmentPlan {
  planCode: string;
  installments: PlanInstallment[];
}

export interface CustomInstallment {
  dueDate: BusinessDate;
  amount: Paise;
  label?: string;
}

export type PlanSpec =
  | { kind: 'STANDARD'; plan: InstallmentPlan }
  | { kind: 'FULL'; dueDate: BusinessDate }
  | { kind: 'CUSTOM'; installments: CustomInstallment[] };

export interface BuildInstallmentsInput {
  /** identifies the fee assignment → deterministic dedupe keys (regenerating can never duplicate) */
  assignmentId: string;
  studentId: string;
  academicYearId: string;
  classId?: string;
  divisionId?: string;
  lines: readonly FeeLine[];
  plan: PlanSpec;
  /** BRC-C4: where leftover paise go when an amount does not divide evenly (default LAST) */
  remainderPlacement?: 'LAST' | 'FIRST';
  /** persistence layer maps dedupeKey → real id; the default (identity) keeps previews deterministic */
  idFactory?: (dedupeKey: string) => string;
}

export const installmentDedupeKey = (assignmentId: string, no: number): string =>
  `FEE_ASSIGNMENT:${assignmentId}:${no}`;

/* ------------------------------ helpers ------------------------------ */

const bad = (message: string, details?: Record<string, unknown>): never => {
  throw new FinanceError('INSTALLMENT_PLAN_INVALID', message, details);
};

function includedLines(lines: readonly FeeLine[]): FeeLine[] {
  const out: FeeLine[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.code))
      throw new FinanceError('FEE_LINES_INVALID', `duplicate fee component ${l.code}`);
    seen.add(l.code);
    if (!Number.isSafeInteger(l.amount) || l.amount < 0) {
      throw new FinanceError(
        'FEE_LINES_INVALID',
        `fee line ${l.code} must be a non-negative whole paise amount`,
      );
    }
    if (l.included === false || l.amount === 0) continue;
    out.push(l);
  }
  if (out.length === 0)
    throw new FinanceError(
      'FEE_LINES_INVALID',
      'at least one fee component with an amount is required',
    );
  return out;
}

/** column of per-installment amounts for one component */
function scheduleComponent(
  line: FeeLine,
  installments: readonly PlanInstallment[],
  placement: 'LAST' | 'FIRST',
): Paise[] {
  const n = installments.length;
  const entries = installments.map((i) =>
    i.componentSchedule?.find((e) => e.componentCode === line.code),
  );
  if (entries.every((e) => e === undefined)) {
    return placement === 'LAST'
      ? splitEvenRemainderLast(line.amount, n)
      : splitEvenRemainderFirst(line.amount, n);
  }

  const listed = entries.filter((e): e is ComponentScheduleEntry => e !== undefined);
  const remainders = listed.filter((e) => e.mode === 'REMAINDER');
  const fixed = listed.filter((e) => e.mode === 'FIXED');
  const pct = listed.filter((e) => e.mode === 'PERCENT_BP');
  const mismatch = (reason: string): never => {
    throw new FinanceError('COMPONENT_SCHEDULE_MISMATCH', `${line.code}: ${reason}`, {
      component: line.code,
    });
  };
  if (remainders.length > 1) mismatch('only one REMAINDER installment is allowed');
  for (const e of [...fixed, ...pct]) {
    if (!Number.isSafeInteger(e.value) || (e.value ?? 0) <= 0)
      mismatch('schedule values must be positive whole numbers');
  }

  const col: Paise[] = Array.from({ length: n }, () => 0);
  if (remainders.length === 0) {
    if (pct.length === 0) {
      // all FIXED
      if (sumPaise(fixed.map((e) => e.value ?? 0)) !== line.amount)
        mismatch('fixed amounts must add up to the component amount');
      entries.forEach((e, i) => (col[i] = e?.value ?? 0));
    } else if (fixed.length === 0) {
      // all PERCENT — must be exactly 100 %, split exactly by largest remainder
      const bps = pct.map((e) => e.value ?? 0);
      if (sumPaise(bps) !== 10_000) mismatch('percentages must add up to exactly 100 %');
      const parts = splitProportional(line.amount, bps);
      let k = 0;
      entries.forEach((e, i) => {
        if (e) col[i] = parts[k++] ?? 0;
      });
    } else {
      mismatch('mixing FIXED and PERCENT_BP requires one REMAINDER installment');
    }
  } else {
    let taken = 0;
    entries.forEach((e, i) => {
      if (!e || e.mode === 'REMAINDER') return;
      const v = e.mode === 'FIXED' ? (e.value ?? 0) : percentBp(line.amount, e.value ?? 0);
      col[i] = v;
      taken += v;
    });
    const rest = line.amount - taken;
    if (rest < 0) mismatch('scheduled amounts exceed the component amount');
    entries.forEach((e, i) => {
      if (e?.mode === 'REMAINDER') col[i] = rest;
    });
  }
  return col;
}

/**
 * CUSTOM plan: distribute each installment amount over the components in proportion to what each
 * component still has left. The last installment takes whatever remains, so every component's
 * column adds up exactly to its fee line.
 */
function customMatrix(lines: readonly FeeLine[], amounts: readonly Paise[]): Paise[][] {
  const remaining = lines.map((l) => l.amount);
  const matrix: Paise[][] = [];
  amounts.forEach((amt, idx) => {
    if (idx === amounts.length - 1) {
      matrix.push([...remaining]);
      remaining.fill(0);
      return;
    }
    const parts = splitProportional(amt, remaining);
    parts.forEach((p, c) => (remaining[c] = (remaining[c] ?? 0) - p));
    matrix.push(parts);
  });
  return matrix;
}

/* ------------------------------ main ------------------------------ */

/** Generate the installment receivables for one fee assignment (rounding-safe, idempotent keys). */
export function buildInstallments(input: BuildInstallmentsInput): Receivable[] {
  const lines = includedLines(input.lines);
  const gross = sumPaise(lines.map((l) => l.amount));
  const placement = input.remainderPlacement ?? 'LAST';
  const idOf = input.idFactory ?? ((k: string) => k);

  type Slot = { no: number; label: string; dueDate: BusinessDate; amounts: Paise[] };
  let slots: Slot[];

  if (input.plan.kind === 'FULL') {
    assertBusinessDate(input.plan.dueDate, 'due date');
    slots = [
      {
        no: 1,
        label: 'Full payment',
        dueDate: input.plan.dueDate,
        amounts: lines.map((l) => l.amount),
      },
    ];
  } else if (input.plan.kind === 'CUSTOM') {
    const items = input.plan.installments;
    if (items.length === 0) bad('a custom plan needs at least one installment');
    items.forEach((i, idx) => {
      assertBusinessDate(i.dueDate, `installment ${idx + 1} due date`);
      if (!Number.isSafeInteger(i.amount) || i.amount <= 0)
        bad('custom installment amounts must be positive whole paise');
    });
    if (sumPaise(items.map((i) => i.amount)) !== gross) {
      bad('custom installments must add up to the total fee', {
        total: gross,
        given: sumPaise(items.map((i) => i.amount)),
      });
    }
    const sorted = [...items].sort((a, b) =>
      a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0,
    );
    const matrix = customMatrix(
      lines,
      sorted.map((i) => i.amount),
    );
    slots = sorted.map((i, idx) => ({
      no: idx + 1,
      label: i.label ?? `Installment ${idx + 1}`,
      dueDate: i.dueDate,
      amounts: matrix[idx] ?? [],
    }));
  } else {
    const plan = input.plan.plan;
    if (plan.installments.length === 0) bad('a plan needs at least one installment');
    const nos = new Set<number>();
    for (const i of plan.installments) {
      if (!Number.isInteger(i.no) || i.no < 1) bad('installment numbers must be positive integers');
      if (nos.has(i.no)) bad(`duplicate installment number ${i.no}`);
      nos.add(i.no);
      assertBusinessDate(i.dueDate, `installment ${i.no} due date`);
    }
    const ordered = [...plan.installments].sort((a, b) => a.no - b.no);
    for (let k = 1; k < ordered.length; k++) {
      const prev = ordered[k - 1];
      const cur = ordered[k];
      if (prev && cur && isBefore(cur.dueDate, prev.dueDate))
        bad('installment due dates must not go backwards');
    }
    const columns = lines.map((l) => scheduleComponent(l, ordered, placement));
    slots = ordered.map((i, idx) => ({
      no: i.no,
      label: i.label ?? `Installment ${i.no}`,
      dueDate: i.dueDate,
      amounts: columns.map((col) => col[idx] ?? 0),
    }));
  }

  const out: Receivable[] = [];
  for (const slot of slots) {
    const comps = lines
      .map((l, idx) => ({ code: l.code, name: l.name, payable: slot.amounts[idx] ?? 0 }))
      .filter((c) => c.payable > 0);
    if (comps.length === 0) continue; // an installment that carries nothing is not generated
    const key = installmentDedupeKey(input.assignmentId, slot.no);
    out.push(
      newReceivable({
        id: idOf(key),
        studentId: input.studentId,
        academicYearId: input.academicYearId,
        classId: input.classId,
        divisionId: input.divisionId,
        kind: 'INSTALLMENT',
        label: slot.label,
        installmentNo: slot.no,
        dueDate: slot.dueDate,
        components: comps,
        dedupeKey: key,
      }),
    );
  }
  if (sumPaise(out.map((r) => r.payable)) !== gross) {
    throw new FinanceError(
      'INVARIANT_VIOLATION',
      'generated installments do not add up to the fee',
      { gross },
    );
  }
  return out;
}
