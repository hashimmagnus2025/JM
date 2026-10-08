/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PostedAllocation, Receivable } from '../../domain/finance';
import type { IdCodec } from './id-codec';
import type { AuditEntry, StoredPayment, StoredReceipt, StoredReversal } from './ports';

/** lean Mongo documents → domain/port shapes (shared by the adapter and the integration-test harness) */
export function makeMappers(codec: IdCodec) {
  const str = (v: unknown): string => codec.fromDb(v);
  return {
    payment(d: any): StoredPayment {
      return {
        id: str(d._id),
        paymentNo: d.paymentNo,
        studentId: str(d.studentId),
        amount: d.amount,
        allocatedAmount: d.allocatedAmount,
        unallocatedAmount: d.unallocatedAmount,
        method: d.method,
        referenceNumber: d.reference?.number,
        referenceBank: d.reference?.bank,
        uniqueRefKey: d.uniqueRefKey ?? undefined,
        paymentDate: d.paymentDate,
        receivedAt: d.receivedAt,
        collectedBy: str(d.collectedBy),
        source: d.source,
        allocationMode: d.allocationMode,
        allocationStrategy: d.allocationStrategy,
        remarks: d.remarks ?? undefined,
        idempotencyKey: d.idempotencyKey,
        requestHash: d.requestHash,
        status: d.status,
        receiptNo: d.receiptNo,
        reversalId: d.reversalId ? str(d.reversalId) : undefined,
      };
    },
    receivable(d: any): Receivable {
      const r: Receivable = {
        id: str(d._id),
        studentId: str(d.studentId),
        academicYearId: str(d.academicYearId),
        kind: d.kind,
        label: d.label,
        dueDate: d.dueDate,
        originalDueDate: d.originalDueDate,
        components: d.components.map((c: any) => ({
          code: c.code,
          name: c.name,
          payable: c.payable,
          adjusted: c.adjusted,
          transferred: c.transferred,
          paid: c.paid,
        })),
        payable: d.payable,
        adjusted: d.adjusted,
        transferred: d.transferred,
        paid: d.paid,
        pending: d.pending,
        paymentStatus: d.paymentStatus,
        hasPendingAdjustment: !!d.hasPendingAdjustment,
        dedupeKey: d.dedupeKey,
        version: d.version,
      };
      if (d.classId) r.classId = str(d.classId);
      if (d.divisionId) r.divisionId = str(d.divisionId);
      if (d.installmentNo !== undefined && d.installmentNo !== null)
        r.installmentNo = d.installmentNo;
      if (d.parentReceivableId) r.parentReceivableId = str(d.parentReceivableId);
      if (d.periodKey) r.periodKey = d.periodKey;
      return r;
    },
    allocation(d: any): PostedAllocation {
      const a: PostedAllocation = {
        id: str(d._id),
        paymentId: str(d.paymentId),
        receivableId: str(d.receivableId),
        studentId: str(d.studentId),
        academicYearId: str(d.academicYearId),
        kind: d.kind,
        amount: d.amount,
        componentSplit: d.componentSplit.map((s: any) => ({
          componentCode: s.componentCode,
          amount: s.amount,
        })),
        postingDate: d.postingDate,
      };
      if (d.reversesAllocationId) a.reversesAllocationId = str(d.reversesAllocationId);
      return a;
    },
    receipt(d: any): StoredReceipt {
      return {
        id: str(d._id),
        receiptNo: d.receiptNo,
        paymentId: str(d.paymentId),
        studentId: str(d.studentId),
        status: d.status,
        issuedAt: d.issuedAt,
        balances: {
          previousBalance: d.balances.previousBalance,
          paidNow: d.balances.paidNow,
          remainingBalance: d.balances.remainingBalance,
        },
        cancellation: d.cancellation?.at
          ? { at: d.cancellation.at, by: str(d.cancellation.by), reason: d.cancellation.reason }
          : undefined,
      };
    },
    reversal(d: any): StoredReversal {
      return {
        id: str(d._id),
        paymentId: str(d.paymentId),
        reason: d.reasonText,
        requestedBy: str(d.requestedBy),
        approvedBy: d.approvedBy ? str(d.approvedBy) : undefined,
        authorizedBy: str(d.authorizedBy),
        originalPaymentDate: d.originalPaymentDate,
        originalAmount: d.originalAmount,
        reversalDate: d.reversalDate,
        reversedAmount: d.reversedAmount,
        reversedAt: d.completedAt,
        status: d.status,
      };
    },
    audit(d: any): AuditEntry {
      return {
        at: d.at,
        userId: str(d.userId),
        action: d.action,
        entityType: d.entityType,
        entityId: d.entityId,
        studentId: d.studentId ? str(d.studentId) : undefined,
        before: d.before,
        after: d.after,
        reason: d.reason,
      };
    },
  };
}
