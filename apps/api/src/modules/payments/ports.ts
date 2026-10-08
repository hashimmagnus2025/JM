import type { BusinessDate, Paise } from '@sfm/shared';
import type { AllocationStrategy, PostedAllocation, Receivable } from '../../domain/finance';

/** Persisted shapes used by the posting kernel (Mongo adapter maps these to the collections in docs §3.3). */
export interface StoredPayment {
  id: string;
  paymentNo: string;
  studentId: string;
  amount: Paise;
  allocatedAmount: Paise;
  unallocatedAmount: Paise;
  method: string;
  referenceNumber?: string | undefined;
  referenceBank?: string | undefined;
  /** present only when the method requires a unique reference; UNSET on reversal so a corrected re-entry is possible */
  uniqueRefKey?: string | undefined;
  paymentDate: BusinessDate;
  receivedAt: Date;
  collectedBy: string;
  source: 'COUNTER' | 'HISTORICAL' | 'IMPORT';
  allocationMode: 'AUTO' | 'MANUAL';
  allocationStrategy: AllocationStrategy;
  remarks?: string | undefined;
  idempotencyKey: string;
  requestHash: string;
  status: 'POSTED' | 'REVERSED';
  receiptNo: string;
  reversalId?: string | undefined;
}

export interface StoredReceipt {
  id: string;
  receiptNo: string;
  paymentId: string;
  studentId: string;
  status: 'ISSUED' | 'CANCELLED';
  issuedAt: Date;
  /** immutable snapshot of the balances at issue time (full print snapshot: Phase 12) */
  balances: { previousBalance: Paise; paidNow: Paise; remainingBalance: Paise };
  cancellation?: { at: Date; by: string; reason: string } | undefined;
}

export interface StoredReversal {
  id: string;
  paymentId: string;
  reason: string;
  requestedBy: string;
  approvedBy?: string | undefined;
  /** approver when approval was required, otherwise the performing user (CL-07) */
  authorizedBy: string;
  originalPaymentDate: BusinessDate;
  originalAmount: Paise;
  reversalDate: BusinessDate;
  reversedAmount: Paise;
  reversedAt: Date;
  status: 'COMPLETED';
}

export interface AuditEntry {
  at: Date;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  studentId?: string | undefined;
  before?: unknown;
  after?: unknown;
  reason?: string | undefined;
}

/** Unique index violated (E11000 in MongoDB). `index` names the violated constraint. */
export class DuplicateKeyError extends Error {
  constructor(public readonly index: string) {
    super(`duplicate key on ${index}`);
    this.name = 'DuplicateKeyError';
  }
}

/** Transient transaction conflict (MongoDB WriteConflict / TransientTransactionError) → retry. */
export class WriteConflictError extends Error {
  constructor(public readonly what: string) {
    super(`write conflict on ${what}`);
    this.name = 'WriteConflictError';
  }
}

/** Everything the posting kernel needs from storage. All methods run INSIDE one transaction. */
export interface LedgerTx {
  findPaymentByIdempotencyKey(key: string): Promise<StoredPayment | null>;
  findPaymentByUniqueRef(uniqueRefKey: string): Promise<StoredPayment | null>;
  findPayment(id: string): Promise<StoredPayment | null>;
  loadReceivables(studentId: string): Promise<Receivable[]>;
  loadReceivablesByIds(ids: readonly string[]): Promise<Receivable[]>;
  /**
   * GUARDED compare-and-set: replaces the receivable only if the stored `version` equals
   * `next.version - 1` (nobody changed it since it was read). Returns false otherwise.
   */
  replaceReceivableGuarded(next: Receivable): Promise<boolean>;
  insertPayment(p: StoredPayment): Promise<void>;
  /** POSTED → REVERSED, guarded on the stored status; returns false if it was not POSTED any more */
  markPaymentReversed(id: string, reversalId: string): Promise<boolean>;
  loadAllocations(paymentId: string): Promise<PostedAllocation[]>;
  insertAllocations(rows: readonly PostedAllocation[]): Promise<void>;
  /**
   * Next value of a sequence (receipt / payment numbers). An ATOMIC increment that is deliberately NOT part of the
   * transaction: it never write-conflicts (no global serialisation of payments) and is never rolled back, so an
   * aborted payment leaves a gap but a number is never reused (decision BRC-G1: gaps allowed).
   */
  nextSequence(counterKey: string): Promise<number>;
  insertReceipt(r: StoredReceipt): Promise<void>;
  findReceiptByPayment(paymentId: string): Promise<StoredReceipt | null>;
  cancelReceipt(
    paymentId: string,
    cancellation: { at: Date; by: string; reason: string },
  ): Promise<void>;
  insertReversal(r: StoredReversal): Promise<void>;
  insertAudit(e: AuditEntry): Promise<void>;
}

export interface LedgerStore {
  /**
   * Runs `work` atomically. On WriteConflictError the whole unit is retried against a fresh snapshot;
   * any other error aborts and rolls back everything.
   */
  runInTransaction<T>(work: (tx: LedgerTx) => Promise<T>): Promise<T>;
}
