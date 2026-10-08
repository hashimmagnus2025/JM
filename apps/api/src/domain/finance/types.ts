import type { BusinessDate, Paise } from '@sfm/shared';

/**
 * Finance domain types. Pure data — no behaviour, no persistence concerns.
 * Money is integer paise; dates are IST business dates (YYYY-MM-DD).
 */

export type ReceivableKind = 'INSTALLMENT' | 'OPENING_BALANCE' | 'PENALTY' | 'ADHOC';

/**
 * Stored status (engine-written). Time-dependent states (due soon / overdue) are derived
 * at read time and never stored — see status.ts.
 *  - WAIVED:      payable fully covered by adjustments, nothing paid
 *  - TRANSFERRED: remainder carried forward by a manual carry-forward (BRC-D1)
 */
export type ReceivableStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'WAIVED' | 'TRANSFERRED' | 'VOID';

export const OPENING_BALANCE_COMPONENT = 'OPENING_BALANCE';
export const LATE_FEE_COMPONENT = 'LATE_FEE';

export interface ComponentBalance {
  code: string;
  name: string;
  payable: Paise;
  adjusted: Paise;
  transferred: Paise;
  paid: Paise;
}

/**
 * One payable unit: an installment, an opening balance or a penalty.
 *   pending = payable − adjusted − transferred − paid        (always derived, never typed in)
 */
export interface Receivable {
  id: string;
  studentId: string;
  academicYearId: string;
  classId?: string;
  divisionId?: string;
  kind: ReceivableKind;
  label: string;
  installmentNo?: number;
  dueDate: BusinessDate;
  originalDueDate: BusinessDate;
  parentReceivableId?: string;
  periodKey?: string;
  components: ComponentBalance[];
  payable: Paise;
  adjusted: Paise;
  transferred: Paise;
  paid: Paise;
  pending: Paise;
  paymentStatus: ReceivableStatus;
  /** An adjustment targeting this receivable is awaiting approval (blocks the PAID status, BRC-I1). */
  hasPendingAdjustment: boolean;
  /** Deterministic origin key; unique per institution → duplicate installments/penalties impossible. */
  dedupeKey: string;
  /** Optimistic-concurrency token; bumped by every guarded write. */
  version: number;
}

export interface ComponentAmount {
  componentCode: string;
  amount: Paise;
}

/** A line of the fee snapshot a student is billed for. */
export interface FeeLine {
  code: string;
  name: string;
  amount: Paise;
  /** default true; an optional component the student opted out of has included=false */
  included?: boolean;
}

/** Strategy names are stored on every payment so the order actually used stays auditable. */
export type AllocationStrategy = 'OLDEST_DUE_FIRST' | 'MANUAL';

export interface AllocationDraft {
  receivableId: string;
  studentId: string;
  academicYearId: string;
  kind: 'ALLOCATION' | 'REVERSAL';
  /** signed: negative for REVERSAL rows */
  amount: Paise;
  componentSplit: ComponentAmount[];
  reversesAllocationId?: string;
}

/** An allocation that has been persisted (immutable ledger row). */
export interface PostedAllocation extends AllocationDraft {
  id: string;
  paymentId: string;
  postingDate: BusinessDate;
}

export interface FinanceSettings {
  dueSoonDays: number;
  /** ordered fee-component codes used INSIDE one receivable (BRC-E1) */
  componentPriority: string[];
  expectedIncludesPenalties: boolean;
  agingBoundaries: [number, number, number];
  agingBasis: 'ORIGINAL_DUE_DATE' | 'CURRENT_DUE_DATE';
  advanceEnabled: boolean;
  remainderPlacement: 'LAST' | 'FIRST';
}

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  dueSoonDays: 7,
  componentPriority: [],
  expectedIncludesPenalties: false,
  agingBoundaries: [30, 60, 90],
  agingBasis: 'ORIGINAL_DUE_DATE',
  advanceEnabled: false,
  remainderPlacement: 'LAST',
};
