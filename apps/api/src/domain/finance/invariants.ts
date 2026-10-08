import { isPaise, sumPaise, type Paise } from '@sfm/shared';
import { FinanceError } from './errors';
import { componentPending } from './receivable';
import type { AllocationDraft, Receivable } from './types';

const fail = (message: string, details?: Record<string, unknown>): never => {
  throw new FinanceError('INVARIANT_VIOLATION', message, details);
};

/**
 * The receivable invariants (data-model I7). Defence in depth: services call this after every
 * engine step, property tests call it on random scenarios, and the DB `$expr` validator enforces
 * the same arithmetic.
 */
export function assertReceivable(r: Receivable): void {
  const money: [string, number][] = [
    ['payable', r.payable],
    ['adjusted', r.adjusted],
    ['transferred', r.transferred],
    ['paid', r.paid],
    ['pending', r.pending],
  ];
  for (const [name, v] of money) {
    if (!isPaise(v)) fail(`${name} is not an integer paise value`, { id: r.id, [name]: v });
  }
  if (r.payable < 0 || r.adjusted < 0 || r.transferred < 0 || r.paid < 0) {
    fail('negative amount on receivable', { id: r.id });
  }
  if (r.adjusted + r.transferred + r.paid > r.payable) {
    fail('adjusted + transferred + paid exceeds payable', { id: r.id });
  }
  if (r.pending !== r.payable - r.adjusted - r.transferred - r.paid) {
    fail('pending is not payable − adjusted − transferred − paid', { id: r.id });
  }
  if (r.pending < 0) fail('pending is negative', { id: r.id });

  for (const c of r.components) {
    for (const v of [c.payable, c.adjusted, c.transferred, c.paid]) {
      if (!isPaise(v) || v < 0) fail('invalid component amount', { id: r.id, component: c.code });
    }
    if (componentPending(c) < 0)
      fail('component pending is negative', { id: r.id, component: c.code });
  }
  const sums = {
    payable: sumPaise(r.components.map((c) => c.payable)),
    adjusted: sumPaise(r.components.map((c) => c.adjusted)),
    transferred: sumPaise(r.components.map((c) => c.transferred)),
    paid: sumPaise(r.components.map((c) => c.paid)),
  };
  if (
    sums.payable !== r.payable ||
    sums.adjusted !== r.adjusted ||
    sums.transferred !== r.transferred ||
    sums.paid !== r.paid
  ) {
    fail('receivable aggregates differ from the sum of components', { id: r.id });
  }
}

export function assertReceivables(rs: readonly Receivable[]): void {
  rs.forEach(assertReceivable);
}

/** Σ allocations of a payment + unallocated = payment amount (data-model I8). */
export function assertAllocationConservation(
  paymentAmount: Paise,
  allocations: readonly AllocationDraft[],
  unallocated: Paise,
): void {
  const allocated = sumPaise(allocations.map((a) => a.amount));
  if (allocated + unallocated !== paymentAmount) {
    fail('allocations + unallocated do not equal the payment amount', {
      paymentAmount,
      allocated,
      unallocated,
    });
  }
  for (const a of allocations) {
    if (sumPaise(a.componentSplit.map((s) => s.amount)) !== a.amount) {
      fail('component split does not equal the allocation amount', {
        receivableId: a.receivableId,
      });
    }
  }
}
