import { addPaise, isBefore, minPaise, type BusinessDate, type Paise } from '@sfm/shared';
import { FinanceError } from './errors';
import { assertAllocationConservation, assertReceivable } from './invariants';
import { validatePaymentAmount } from './payment-rules';
import { componentPending, isPayable, recompute } from './receivable';
import type {
  AllocationDraft,
  AllocationStrategy,
  ComponentAmount,
  Receivable,
  ReceivableKind,
} from './types';

/* ------------------------------ ordering (BRC-E1) ------------------------------ */

const KIND_RANK: Record<ReceivableKind, number> = {
  OPENING_BALANCE: 0,
  PENALTY: 1,
  INSTALLMENT: 2,
  ADHOC: 3,
};

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * OLDEST_DUE_FIRST — decided order:
 *   Tier 0  (overdue: dueDate < today)   oldest due date first; ties: opening balance → penalty → installment
 *   Tier 1  (not yet overdue)            opening balance → penalty → installment, then oldest due date
 * which yields: ① oldest overdue ② opening balance ③ penalty ④ oldest pending installment ⑤ newer installments.
 */
export function compareOldestDueFirst(today: BusinessDate): (a: Receivable, b: Receivable) => number {
  const tier = (r: Receivable): number => (isBefore(r.dueDate, today) ? 0 : 1);
  return (a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    const byDue = cmpStr(a.dueDate, b.dueDate);
    const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    const byNo = (a.installmentNo ?? 0) - (b.installmentNo ?? 0);
    const rest = byNo !== 0 ? byNo : cmpStr(a.id, b.id);
    if (ta === 0) return byDue !== 0 ? byDue : byKind !== 0 ? byKind : rest;
    return byKind !== 0 ? byKind : byDue !== 0 ? byDue : rest;
  };
}

export function orderReceivables(
  receivables: readonly Receivable[],
  strategy: AllocationStrategy,
  today: BusinessDate,
): Receivable[] {
  if (strategy !== 'OLDEST_DUE_FIRST') {
    throw new FinanceError('ALLOCATION_INVALID', `strategy ${strategy} has no automatic ordering`);
  }
  return [...receivables].sort(compareOldestDueFirst(today));
}

/* ------------------------------ component split (inside one receivable) ------------------------------ */

/**
 * Apply `amount` to the components of ONE receivable in configured priority order
 * (codes not listed follow in the receivable's own component order).
 */
export function splitByComponentPriority(
  r: Receivable,
  amount: Paise,
  priority: readonly string[],
): ComponentAmount[] {
  const ranked = r.components
    .map((c, index) => {
      const p = priority.indexOf(c.code);
      return { c, rank: p >= 0 ? p : priority.length + index };
    })
    .sort((a, b) => a.rank - b.rank);
  let remaining = amount;
  const out: ComponentAmount[] = [];
  for (const { c } of ranked) {
    if (remaining === 0) break;
    const take = minPaise(remaining, componentPending(c));
    if (take > 0) {
      out.push({ componentCode: c.code, amount: take });
      remaining -= take;
    }
  }
  if (remaining !== 0) {
    throw new FinanceError('ALLOCATION_INVALID', 'amount exceeds the receivable pending balance', {
      receivableId: r.id,
      amount,
      pending: r.pending,
    });
  }
  return out;
}

/* ------------------------------ allocate a payment ------------------------------ */

export interface ManualAllocationItem {
  receivableId: string;
  amount: Paise;
}

export interface AllocateInput {
  amount: Paise;
  receivables: readonly Receivable[];
  /** business date used to decide which receivables are overdue */
  today: BusinessDate;
  strategy?: AllocationStrategy;
  componentPriority?: readonly string[];
  /** required when strategy = MANUAL */
  manual?: readonly ManualAllocationItem[];
  /** restrict AUTO allocation to the dues the cashier selected */
  eligibleReceivableIds?: readonly string[];
  /** BRC-E2: advance payments are disabled by default → over-payment is rejected */
  advanceEnabled?: boolean;
}

export interface AllocateResult {
  strategy: AllocationStrategy;
  allocations: AllocationDraft[];
  /** advance credit (only ever > 0 when advanceEnabled) */
  unallocated: Paise;
  /** the receivables after applying the allocations (inputs are never mutated) */
  updatedReceivables: Receivable[];
}

function draft(r: Receivable, amount: Paise, priority: readonly string[]): AllocationDraft {
  return {
    receivableId: r.id,
    studentId: r.studentId,
    academicYearId: r.academicYearId,
    kind: 'ALLOCATION',
    amount,
    componentSplit: splitByComponentPriority(r, amount, priority),
  };
}

export function allocatePayment(input: AllocateInput): AllocateResult {
  validatePaymentAmount(input.amount);
  const strategy = input.strategy ?? 'OLDEST_DUE_FIRST';
  const priority = input.componentPriority ?? [];
  const advance = input.advanceEnabled ?? false;
  const byId = new Map(input.receivables.map((r) => [r.id, r]));
  let allocations: AllocationDraft[] = [];
  let unallocated = 0;

  if (strategy === 'MANUAL') {
    const items = input.manual ?? [];
    if (items.length === 0) throw new FinanceError('ALLOCATION_INVALID', 'manual allocation needs at least one item');
    const seen = new Set<string>();
    let total = 0;
    for (const item of items) {
      if (seen.has(item.receivableId)) {
        throw new FinanceError('ALLOCATION_INVALID', 'a receivable appears twice in the manual allocation', {
          receivableId: item.receivableId,
        });
      }
      seen.add(item.receivableId);
      validatePaymentAmount(item.amount);
      const r = byId.get(item.receivableId);
      if (!r || !isPayable(r)) {
        throw new FinanceError('ALLOCATION_INVALID', 'receivable is not payable', { receivableId: item.receivableId });
      }
      if (item.amount > r.pending) {
        throw new FinanceError('ALLOCATION_INVALID', 'manual amount exceeds the receivable pending balance', {
          receivableId: r.id,
          amount: item.amount,
          pending: r.pending,
        });
      }
      total = addPaise(total, item.amount);
      allocations.push(draft(r, item.amount, priority));
    }
    if (total > input.amount) {
      throw new FinanceError('ALLOCATION_INVALID', 'manual allocation exceeds the payment amount', {
        allocated: total,
        amount: input.amount,
      });
    }
    unallocated = input.amount - total;
    if (unallocated > 0 && !advance) {
      throw new FinanceError('ALLOCATION_INCOMPLETE', 'the whole payment must be allocated to dues', {
        unallocated,
      });
    }
  } else {
    const allowed = input.eligibleReceivableIds ? new Set(input.eligibleReceivableIds) : null;
    const eligible = input.receivables.filter((r) => isPayable(r) && (allowed === null || allowed.has(r.id)));
    const outstanding = eligible.reduce((s, r) => addPaise(s, r.pending), 0);
    if (outstanding === 0 && !advance) {
      throw new FinanceError('NO_PAYABLE_RECEIVABLES', 'There is nothing outstanding to pay.', { amount: input.amount });
    }
    if (input.amount > outstanding && !advance) {
      throw new FinanceError('PAYMENT_EXCEEDS_OUTSTANDING', 'Payment is more than the outstanding amount.', {
        amount: input.amount,
        outstanding,
      });
    }
    let remaining = input.amount;
    for (const r of orderReceivables(eligible, strategy, input.today)) {
      if (remaining === 0) break;
      const take = minPaise(remaining, r.pending);
      allocations.push(draft(r, take, priority));
      remaining -= take;
    }
    unallocated = remaining; // > 0 only when advanceEnabled
  }

  assertAllocationConservation(input.amount, allocations, unallocated);
  const updatedReceivables = applyAllocations(input.receivables, allocations);
  allocations = allocations.map((a) => ({ ...a, componentSplit: a.componentSplit.map((s) => ({ ...s })) }));
  return { strategy, allocations, unallocated, updatedReceivables };
}

/* ------------------------------ apply (also used for reversals) ------------------------------ */

/**
 * Apply signed allocation rows to receivables (positive = payment, negative = reversal).
 * Returns NEW receivables (same order), bumps `version` once per touched receivable and asserts
 * every invariant. Never mutates its inputs.
 */
export function applyAllocations(
  receivables: readonly Receivable[],
  allocations: readonly AllocationDraft[],
): Receivable[] {
  const next = new Map<string, Receivable>();
  const touched = new Set<string>();
  for (const r of receivables) next.set(r.id, { ...r, components: r.components.map((c) => ({ ...c })) });

  for (const a of allocations) {
    const r = next.get(a.receivableId);
    if (!r) throw new FinanceError('ALLOCATION_INVALID', 'allocation targets an unknown receivable', { receivableId: a.receivableId });
    for (const split of a.componentSplit) {
      const c = r.components.find((x) => x.code === split.componentCode);
      if (!c) {
        throw new FinanceError('ALLOCATION_INVALID', 'allocation targets an unknown component', {
          receivableId: r.id,
          component: split.componentCode,
        });
      }
      c.paid += split.amount;
      if (c.paid < 0) {
        throw new FinanceError('INVARIANT_VIOLATION', 'reversal would make paid negative', {
          receivableId: r.id,
          component: c.code,
        });
      }
      if (componentPending(c) < 0) {
        throw new FinanceError('PAYMENT_EXCEEDS_OUTSTANDING', 'allocation exceeds the component pending balance', {
          receivableId: r.id,
          component: c.code,
        });
      }
    }
    touched.add(r.id);
  }

  return receivables.map((orig) => {
    const r = next.get(orig.id) as Receivable;
    if (!touched.has(orig.id)) return orig;
    const done = recompute({ ...r, version: orig.version + 1 });
    assertReceivable(done);
    return done;
  });
}
