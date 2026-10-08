import { diffDays, type BusinessDate, type Paise } from '@sfm/shared';
import type { FinanceSettings, Receivable } from './types';

export interface AgingBucket {
  amount: Paise;
  count: number;
}

/** 0–30 / 31–60 / 61–90 / 90+ (boundaries configurable). `notYetDue` holds future-dated pending items. */
export interface AgingBuckets {
  notYetDue: AgingBucket;
  d0_30: AgingBucket;
  d31_60: AgingBucket;
  d61_90: AgingBucket;
  d90plus: AgingBucket;
  total: AgingBucket;
}

export type AgingBucketKey = Exclude<keyof AgingBuckets, 'total'>;

/** Days past the (original) due date; negative = not yet due. */
export function agingDays(
  r: Pick<Receivable, 'dueDate' | 'originalDueDate'>,
  today: BusinessDate,
  basis: FinanceSettings['agingBasis'],
): number {
  return diffDays(basis === 'ORIGINAL_DUE_DATE' ? r.originalDueDate : r.dueDate, today);
}

export function bucketOf(days: number, boundaries: readonly [number, number, number]): AgingBucketKey {
  if (days < 0) return 'notYetDue';
  if (days <= boundaries[0]) return 'd0_30';
  if (days <= boundaries[1]) return 'd31_60';
  if (days <= boundaries[2]) return 'd61_90';
  return 'd90plus';
}

/**
 * Age everything that is still pending. Aging is calculated from the receivable's ORIGINAL due date
 * (BRC-I2); opening balances age from their configured effective/due date (their due date).
 * A receivable due today (days = 0) falls in the 0–30 bucket — see CL-11.
 */
export function computeAging(
  receivables: readonly Receivable[],
  today: BusinessDate,
  cfg: Pick<FinanceSettings, 'agingBoundaries' | 'agingBasis'>,
): AgingBuckets {
  const zero = (): AgingBucket => ({ amount: 0, count: 0 });
  const out: AgingBuckets = {
    notYetDue: zero(),
    d0_30: zero(),
    d31_60: zero(),
    d61_90: zero(),
    d90plus: zero(),
    total: zero(),
  };
  for (const r of receivables) {
    if (r.paymentStatus === 'VOID' || r.pending <= 0) continue;
    const key = bucketOf(agingDays(r, today, cfg.agingBasis), cfg.agingBoundaries);
    out[key].amount += r.pending;
    out[key].count += 1;
    out.total.amount += r.pending;
    out.total.count += 1;
  }
  return out;
}
