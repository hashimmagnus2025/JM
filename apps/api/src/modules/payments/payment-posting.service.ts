import { addPaise, type BusinessDate, type Clock, type Paise } from '@sfm/shared';
import {
  FinanceError,
  allocatePayment,
  applyReversal,
  assertReversalReason,
  assertValidApprover,
  buildReversalAllocations,
  buildReversalReportRow,
  decideReversalApproval,
  formatReceiptNumber,
  receiptCounterKey,
  receiptScopeKey,
  totalPending,
  validatePaymentAmount,
  type AllocationStrategy,
  type FinanceSettings,
  type ManualAllocationItem,
  type PostedAllocation,
  type Receivable,
  type ReceiptNumbering,
  type ReversalReportRow,
} from '../../domain/finance';
import { hashValue } from '../../lib/hash';
import { decideIdempotency, isValidIdempotencyKey } from '../../lib/idempotency';
import {
  DuplicateKeyError,
  WriteConflictError,
  type AuditEntry,
  type LedgerStore,
  type LedgerTx,
  type StoredPayment,
  type StoredReversal,
} from './ports';

export interface PaymentSettings {
  finance: Pick<FinanceSettings, 'componentPriority' | 'advanceEnabled'>;
  numbering: ReceiptNumbering;
  /** methods whose reference number must be globally unique (UPI, bank transfer, card …) */
  uniqueReferenceMethods: readonly string[];
  /** BRC-E6: null/undefined = no second approval; no amount is hard-coded */
  reversalApprovalThresholdPaise: Paise | null | undefined;
}

export interface PostPaymentCommand {
  idempotencyKey: string;
  studentId: string;
  amount: Paise;
  method: string;
  referenceNumber?: string;
  referenceBank?: string;
  paymentDate: BusinessDate;
  collectedBy: string;
  /** academic-year label that contains `paymentDate` (resolved by the caller) — only used for receipt numbering */
  academicYearLabel?: string;
  allocation?: {
    mode: 'AUTO' | 'MANUAL';
    items?: readonly ManualAllocationItem[];
    eligibleReceivableIds?: readonly string[];
  };
  remarks?: string;
  source?: StoredPayment['source'];
}

export interface PostPaymentResult {
  payment: StoredPayment;
  receiptNo: string;
  allocations: PostedAllocation[];
  balanceBefore: Paise;
  balanceAfter: Paise;
  /** true when this is the stored result of an earlier identical request */
  replayed: boolean;
}

export interface ReversePaymentCommand {
  paymentId: string;
  reason: string;
  requestedBy: string;
  approver?: { id: string; hasPermission: boolean };
  reversalDate?: BusinessDate;
}

export interface ReversePaymentResult {
  reversal: StoredReversal;
  report: ReversalReportRow;
  reversalAllocations: PostedAllocation[];
}

interface Deps {
  store: LedgerStore;
  clock: Clock;
  settings: () => PaymentSettings;
  newId: () => string;
}

const MAX_DUPLICATE_RETRIES = 3;

/**
 * The payment-posting KERNEL: everything that must be atomic when money moves, with no HTTP,
 * permission or UI concerns (those wrap it in Phase 11).
 *
 *  - idempotent (Idempotency-Key + request hash; unique index is the backstop)
 *  - duplicate transaction references rejected
 *  - allocation by the pure engine; receivable updates are GUARDED compare-and-set → two cashiers
 *    can never collect the same rupee twice
 *  - payment + allocations + receipt number + audit commit together or not at all
 *  - reversal = compensating allocations; nothing is edited or deleted
 */
export class PaymentPostingService {
  constructor(private readonly deps: Deps) {}

  async post(cmd: PostPaymentCommand): Promise<PostPaymentResult> {
    validatePaymentAmount(cmd.amount);
    if (!isValidIdempotencyKey(cmd.idempotencyKey)) {
      throw new FinanceError(
        'IDEMPOTENCY_KEY_REUSED',
        'A valid Idempotency-Key is required to record a payment.',
      );
    }
    const requestHash = hashValue({
      studentId: cmd.studentId,
      amount: cmd.amount,
      method: cmd.method,
      referenceNumber: cmd.referenceNumber,
      referenceBank: cmd.referenceBank,
      paymentDate: cmd.paymentDate,
      allocation: cmd.allocation,
      remarks: cmd.remarks,
      source: cmd.source ?? 'COUNTER',
    });

    // sequence numbers are reserved ONCE per command and reused when the transaction is retried after a conflict,
    // so contention does not burn numbers (an aborted command may still leave a gap, which BRC-G1 allows)
    const reserved = new Map<string, number>();
    const seq = async (tx: LedgerTx, key: string): Promise<number> => {
      const have = reserved.get(key);
      if (have !== undefined) return have;
      const next = await tx.nextSequence(key);
      reserved.set(key, next);
      return next;
    };

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.deps.store.runInTransaction((tx) =>
          this.postInTx(tx, cmd, requestHash, seq),
        );
      } catch (e) {
        if (e instanceof DuplicateKeyError) {
          // someone committed the same Idempotency-Key between our check and our insert → replay their result
          if (e.index === 'payments.idempotencyKey' && attempt < MAX_DUPLICATE_RETRIES) continue;
          if (e.index === 'payments.uniqueRefKey') throw duplicateRef();
        }
        throw e;
      }
    }
  }

  private async postInTx(
    tx: LedgerTx,
    cmd: PostPaymentCommand,
    requestHash: string,
    seq: (tx: LedgerTx, key: string) => Promise<number>,
  ): Promise<PostPaymentResult> {
    const settings = this.deps.settings();

    /* 1 ─ idempotency */
    const existing = await tx.findPaymentByIdempotencyKey(cmd.idempotencyKey);
    const decision = decideIdempotency(
      existing ? { key: existing.idempotencyKey, requestHash: existing.requestHash } : null,
      requestHash,
    );
    if (decision.action === 'KEY_REUSED_DIFFERENT_REQUEST') {
      throw new FinanceError(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different payment.',
      );
    }
    if (decision.action === 'REPLAY' && existing) {
      const [allocations, receipt] = await Promise.all([
        tx.loadAllocations(existing.id),
        tx.findReceiptByPayment(existing.id),
      ]);
      return {
        payment: existing,
        receiptNo: existing.receiptNo,
        allocations,
        balanceBefore: receipt?.balances.previousBalance ?? 0,
        balanceAfter: receipt?.balances.remainingBalance ?? 0,
        replayed: true,
      };
    }

    /* 2 ─ duplicate transaction reference (UPI / bank / card…) */
    let uniqueRefKey: string | undefined;
    if (cmd.referenceNumber && settings.uniqueReferenceMethods.includes(cmd.method)) {
      uniqueRefKey = `${cmd.method}|${cmd.referenceBank ?? ''}|${cmd.referenceNumber.trim().toUpperCase()}`;
      const clash = await tx.findPaymentByUniqueRef(uniqueRefKey);
      if (clash && clash.status === 'POSTED') throw duplicateRef(clash.receiptNo);
    }

    /* 3 ─ allocate with the pure engine */
    const receivables = await tx.loadReceivables(cmd.studentId);
    const balanceBefore = totalPending(receivables);
    const mode = cmd.allocation?.mode ?? 'AUTO';
    const strategy: AllocationStrategy = mode === 'MANUAL' ? 'MANUAL' : 'OLDEST_DUE_FIRST';
    const result = allocatePayment({
      amount: cmd.amount,
      receivables,
      today: cmd.paymentDate,
      strategy,
      componentPriority: settings.finance.componentPriority,
      advanceEnabled: settings.finance.advanceEnabled,
      ...(cmd.allocation?.items ? { manual: cmd.allocation.items } : {}),
      ...(cmd.allocation?.eligibleReceivableIds
        ? { eligibleReceivableIds: cmd.allocation.eligibleReceivableIds }
        : {}),
    });

    /* 4 ─ GUARDED updates: if anyone changed a receivable since we read it, abort and retry on fresh data */
    for (let i = 0; i < receivables.length; i++) {
      const next = result.updatedReceivables[i] as Receivable;
      if (next !== receivables[i]) {
        const ok = await tx.replaceReceivableGuarded(next);
        if (!ok) throw new WriteConflictError('receivable ' + next.id);
      }
    }

    /* 5 ─ payment, allocations, receipt number, audit — all in the same transaction */
    const paymentId = this.deps.newId();
    const paymentSeq = await seq(tx, 'payment:all');
    const scope = receiptScopeKey(settings.numbering.scope, {
      paymentDate: cmd.paymentDate,
      ...(cmd.academicYearLabel ? { academicYearLabel: cmd.academicYearLabel } : {}),
    });
    const receiptSeq = await seq(tx, receiptCounterKey(settings.numbering.prefix, scope));
    const receiptNo = formatReceiptNumber(settings.numbering, scope, receiptSeq);
    const allocated = result.allocations.reduce((s, a) => addPaise(s, a.amount), 0);

    const payment: StoredPayment = {
      id: paymentId,
      paymentNo: `PAY-${String(paymentSeq).padStart(6, '0')}`,
      studentId: cmd.studentId,
      amount: cmd.amount,
      allocatedAmount: allocated,
      unallocatedAmount: result.unallocated,
      method: cmd.method,
      referenceNumber: cmd.referenceNumber,
      referenceBank: cmd.referenceBank,
      uniqueRefKey,
      paymentDate: cmd.paymentDate,
      receivedAt: this.deps.clock.now(),
      collectedBy: cmd.collectedBy,
      source: cmd.source ?? 'COUNTER',
      allocationMode: mode,
      allocationStrategy: result.strategy,
      remarks: cmd.remarks,
      idempotencyKey: cmd.idempotencyKey,
      requestHash,
      status: 'POSTED',
      receiptNo,
    };
    await tx.insertPayment(payment);

    const posted: PostedAllocation[] = result.allocations.map((a) => ({
      ...a,
      id: this.deps.newId(),
      paymentId,
      postingDate: cmd.paymentDate,
    }));
    await tx.insertAllocations(posted);

    const balanceAfter = balanceBefore - allocated;
    await tx.insertReceipt({
      id: this.deps.newId(),
      receiptNo,
      paymentId,
      studentId: cmd.studentId,
      status: 'ISSUED',
      issuedAt: this.deps.clock.now(),
      balances: {
        previousBalance: balanceBefore,
        paidNow: cmd.amount,
        remainingBalance: balanceAfter,
      },
    });
    await tx.insertAudit(
      audit(
        this.deps.clock,
        cmd.collectedBy,
        'PAYMENT_CREATED',
        'payment',
        paymentId,
        cmd.studentId,
        undefined,
        { amount: cmd.amount, method: cmd.method, receiptNo },
      ),
    );
    await tx.insertAudit(
      audit(
        this.deps.clock,
        cmd.collectedBy,
        'RECEIPT_GENERATED',
        'receipt',
        receiptNo,
        cmd.studentId,
      ),
    );

    return {
      payment,
      receiptNo,
      allocations: posted,
      balanceBefore,
      balanceAfter,
      replayed: false,
    };
  }

  /** Reverse a payment with compensating entries (decision BRC-E6). */
  async reverse(cmd: ReversePaymentCommand): Promise<ReversePaymentResult> {
    assertReversalReason(cmd.reason);
    return this.deps.store.runInTransaction(async (tx) => {
      const settings = this.deps.settings();
      const payment = await tx.findPayment(cmd.paymentId);
      if (!payment) throw new FinanceError('PAYMENT_NOT_FOUND', 'Payment not found.');
      if (payment.status === 'REVERSED')
        throw new FinanceError(
          'PAYMENT_ALREADY_REVERSED',
          'This payment has already been reversed.',
        );

      const { approvalRequired } = decideReversalApproval({
        amount: payment.amount,
        thresholdPaise: settings.reversalApprovalThresholdPaise,
      });
      if (approvalRequired) {
        if (!cmd.approver)
          throw new FinanceError(
            'REVERSAL_APPROVAL_REQUIRED',
            'This reversal needs a second person to approve it.',
          );
        assertValidApprover({
          requesterId: cmd.requestedBy,
          approverId: cmd.approver.id,
          approverHasPermission: cmd.approver.hasPermission,
        });
      }

      const originals = await tx.loadAllocations(payment.id);
      const compensating = buildReversalAllocations(originals);
      const reversalDate = cmd.reversalDate ?? this.deps.clock.today();
      const touched = await tx.loadReceivablesByIds([
        ...new Set(originals.map((r) => r.receivableId)),
      ]);
      const reopened = applyReversal(touched, compensating);
      for (let i = 0; i < touched.length; i++) {
        const ok = await tx.replaceReceivableGuarded(reopened[i] as Receivable);
        if (!ok) throw new WriteConflictError('receivable ' + (touched[i] as Receivable).id);
      }

      const rows: PostedAllocation[] = compensating.map((a) => ({
        ...a,
        id: this.deps.newId(),
        paymentId: payment.id,
        postingDate: reversalDate,
      }));
      await tx.insertAllocations(rows);

      const reversal: StoredReversal = {
        id: this.deps.newId(),
        paymentId: payment.id,
        reason: cmd.reason.trim(),
        requestedBy: cmd.requestedBy,
        approvedBy: cmd.approver?.id,
        authorizedBy: cmd.approver?.id ?? cmd.requestedBy,
        originalPaymentDate: payment.paymentDate,
        originalAmount: payment.amount,
        reversalDate,
        reversedAmount: payment.allocatedAmount,
        reversedAt: this.deps.clock.now(),
        status: 'COMPLETED',
      };
      try {
        await tx.insertReversal(reversal);
      } catch (e) {
        if (e instanceof DuplicateKeyError)
          throw new FinanceError(
            'PAYMENT_ALREADY_REVERSED',
            'This payment has already been reversed.',
          );
        throw e;
      }
      if (!(await tx.markPaymentReversed(payment.id, reversal.id)))
        throw new WriteConflictError('payment ' + payment.id);
      await tx.cancelReceipt(payment.id, {
        at: this.deps.clock.now(),
        by: reversal.authorizedBy,
        reason: reversal.reason,
      });
      await tx.insertAudit(
        audit(
          this.deps.clock,
          reversal.authorizedBy,
          'PAYMENT_REVERSED',
          'payment',
          payment.id,
          payment.studentId,
          { status: 'POSTED' },
          { status: 'REVERSED', reversalId: reversal.id },
          reversal.reason,
        ),
      );
      await tx.insertAudit(
        audit(
          this.deps.clock,
          reversal.authorizedBy,
          'RECEIPT_CANCELLED',
          'receipt',
          payment.receiptNo,
          payment.studentId,
          { status: 'ISSUED' },
          { status: 'CANCELLED' },
          reversal.reason,
        ),
      );

      return {
        reversal,
        reversalAllocations: rows,
        report: buildReversalReportRow({
          payment: {
            paymentDate: payment.paymentDate,
            amount: payment.amount,
            receiptNo: payment.receiptNo,
          },
          reversalDate,
          reversedAmount: reversal.reversedAmount,
          reason: reversal.reason,
          authorizedBy: reversal.authorizedBy,
        }),
      };
    });
  }
}

/* helpers */

function duplicateRef(receiptNo?: string): FinanceError {
  return new FinanceError(
    'DUPLICATE_TRANSACTION_REF',
    'This transaction reference was already used for another payment.',
    receiptNo ? { receiptNo } : undefined,
  );
}

function audit(
  clock: Clock,
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  studentId?: string,
  before?: unknown,
  after?: unknown,
  reason?: string,
): AuditEntry {
  return {
    at: clock.now(),
    userId,
    action,
    entityType,
    entityId,
    studentId,
    before,
    after,
    reason,
  };
}
