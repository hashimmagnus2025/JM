import mongoose, { type ClientSession, type Connection, type Types } from 'mongoose';
import type { PostedAllocation, Receivable } from '../../domain/finance';
import '../../db/models';
import { hexCodec, type IdCodec } from './id-codec';
import { makeMappers } from './mongo-mappers';
import {
  DuplicateKeyError,
  WriteConflictError,
  type AuditEntry,
  type LedgerStore,
  type LedgerTx,
  type StoredPayment,
  type StoredReceipt,
  type StoredReversal,
} from './ports';

/**
 * MongoDB implementation of the ledger port (transactional).
 *
 * ⚠ Written against the MongoDB transaction semantics but NOT executed in the authoring sandbox (no mongod
 * available there). It is exercised by `mongo-ledger-store.integration.test.ts`, which runs the SAME
 * scenarios as the in-memory store against a real replica set (CI service container / `MONGO_URI`).
 *
 * Guarantees it provides:
 *  - one transaction per command (`readConcern: snapshot`, `writeConcern: majority`)
 *  - guarded receivable updates: `updateOne({_id, version: expected}, …)` → modifiedCount must be 1
 *  - unique-index violations surface as DuplicateKeyError; transient conflicts are retried
 *  - sequence counters are atomic `$inc`s OUTSIDE the transaction (never conflict, gaps allowed — BRC-G1)
 */
export class MongoLedgerStore implements LedgerStore {
  constructor(
    private readonly conn: Connection,
    private readonly institutionId: string,
    private readonly codec: IdCodec = hexCodec,
    private readonly maxAttempts = 25,
  ) {}

  async runInTransaction<T>(work: (tx: LedgerTx) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.conn.transaction(
          async (session) => work(new MongoTx(this.conn, session, this.institutionId, this.codec)),
          { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
        );
      } catch (e) {
        if (e instanceof WriteConflictError) continue; // domain asked for a retry on fresh data
        throw mapMongoError(e);
      }
    }
    throw new Error('transaction retry limit exceeded');
  }
}

/** E11000 → DuplicateKeyError(<collection>.<field>) so the kernel can react precisely */
export function mapMongoError(e: unknown): unknown {
  const err = e as { code?: number; message?: string; keyPattern?: Record<string, number> };
  if (err?.code === 11000) {
    const msg = err.message ?? '';
    const coll = /collection: [\w-]+\.([\w_]+)/.exec(msg)?.[1] ?? 'unknown';
    const field = Object.keys(err.keyPattern ?? {}).find((k) => k !== 'institutionId') ?? 'unknown';
    return new DuplicateKeyError(`${coll}.${field}`);
  }
  return e;
}

class MongoTx implements LedgerTx {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly m: Record<string, any>;
  private readonly inst: Types.ObjectId;

  constructor(
    conn: Connection,
    private readonly session: ClientSession,
    institutionId: string,
    private readonly codec: IdCodec,
  ) {
    this.m = Object.fromEntries(
      [
        'Payment',
        'Receivable',
        'PaymentAllocation',
        'Receipt',
        'PaymentReversal',
        'AuditLog',
        'Counter',
      ].map((n) => [n, conn.model(n)]),
    );
    this.inst = new mongoose.Types.ObjectId(institutionId);
    this.mapper = makeMappers(codec);
  }

  private id = (s: string): Types.ObjectId => this.codec.toDb(s);
  private str = (v: unknown): string => this.codec.fromDb(v);
  private scope = (extra: Record<string, unknown> = {}) => ({ institutionId: this.inst, ...extra });

  private readonly mapper: ReturnType<typeof makeMappers>;
  private toPayment = (d: unknown): StoredPayment => this.mapper.payment(d);
  private toReceivable = (d: unknown): Receivable => this.mapper.receivable(d);
  private toAllocation = (d: unknown): PostedAllocation => this.mapper.allocation(d);
  private toReceipt = (d: unknown): StoredReceipt => this.mapper.receipt(d);

  /* ---- reads ---- */
  async findPaymentByIdempotencyKey(key: string): Promise<StoredPayment | null> {
    const d = await this.m
      .Payment!.findOne(this.scope({ idempotencyKey: key }))
      .session(this.session)
      .lean();
    return d ? this.toPayment(d) : null;
  }
  async findPaymentByUniqueRef(uniqueRefKey: string): Promise<StoredPayment | null> {
    const d = await this.m
      .Payment!.findOne(this.scope({ uniqueRefKey }))
      .session(this.session)
      .lean();
    return d ? this.toPayment(d) : null;
  }
  async findPayment(id: string): Promise<StoredPayment | null> {
    const d = await this.m
      .Payment!.findOne(this.scope({ _id: this.id(id) }))
      .session(this.session)
      .lean();
    return d ? this.toPayment(d) : null;
  }
  async loadReceivables(studentId: string): Promise<Receivable[]> {
    const docs = await this.m
      .Receivable!.find(
        this.scope({
          studentId: this.id(studentId),
          paymentStatus: mongoose.trusted({ $ne: 'VOID' }),
        }),
      )
      .session(this.session)
      .lean();
    return docs.map((d: unknown) => this.toReceivable(d));
  }
  async loadReceivablesByIds(ids: readonly string[]): Promise<Receivable[]> {
    const docs = await this.m
      .Receivable!.find(this.scope({ _id: mongoose.trusted({ $in: ids.map(this.id) }) }))
      .session(this.session)
      .lean();
    const byId = new Map<string, Receivable>(
      docs.map((d: { _id: unknown }) => [this.str(d._id), this.toReceivable(d)]),
    );
    return ids.map((id) => byId.get(id) as Receivable);
  }
  async loadAllocations(paymentId: string): Promise<PostedAllocation[]> {
    const docs = await this.m
      .PaymentAllocation!.find(this.scope({ paymentId: this.id(paymentId) }))
      .sort({ _id: 1 })
      .session(this.session)
      .lean();
    return docs.map((d: unknown) => this.toAllocation(d));
  }
  async findReceiptByPayment(paymentId: string): Promise<StoredReceipt | null> {
    const d = await this.m
      .Receipt!.findOne(this.scope({ paymentId: this.id(paymentId) }))
      .session(this.session)
      .lean();
    return d ? this.toReceipt(d) : null;
  }

  /* ---- writes ---- */
  async replaceReceivableGuarded(next: Receivable): Promise<boolean> {
    const res = await this.m.Receivable!.updateOne(
      this.scope({ _id: this.id(next.id), version: next.version - 1 }),
      {
        $set: {
          components: next.components,
          payable: next.payable,
          adjusted: next.adjusted,
          transferred: next.transferred,
          paid: next.paid,
          pending: next.pending,
          paymentStatus: next.paymentStatus,
          hasPendingAdjustment: next.hasPendingAdjustment,
          version: next.version,
        },
      },
      { session: this.session },
    );
    return res.modifiedCount === 1;
  }
  async insertPayment(p: StoredPayment): Promise<void> {
    await this.m.Payment!.create(
      [
        {
          _id: this.id(p.id),
          institutionId: this.inst,
          paymentNo: p.paymentNo,
          studentId: this.id(p.studentId),
          amount: p.amount,
          allocatedAmount: p.allocatedAmount,
          unallocatedAmount: p.unallocatedAmount,
          method: p.method,
          reference: { number: p.referenceNumber, bank: p.referenceBank },
          ...(p.uniqueRefKey ? { uniqueRefKey: p.uniqueRefKey } : {}),
          paymentDate: p.paymentDate,
          receivedAt: p.receivedAt,
          collectedBy: this.id(p.collectedBy),
          source: p.source,
          allocationMode: p.allocationMode,
          allocationStrategy: p.allocationStrategy,
          remarks: p.remarks,
          idempotencyKey: p.idempotencyKey,
          requestHash: p.requestHash,
          status: p.status,
          receiptNo: p.receiptNo,
        },
      ],
      { session: this.session },
    );
  }
  async markPaymentReversed(id: string, reversalId: string): Promise<boolean> {
    const res = await this.m.Payment!.updateOne(
      this.scope({ _id: this.id(id), status: 'POSTED' }),
      {
        $set: { status: 'REVERSED', reversalId: this.id(reversalId) },
        $unset: { uniqueRefKey: '' },
      },
      { session: this.session },
    );
    return res.modifiedCount === 1;
  }
  async insertAllocations(rows: readonly PostedAllocation[]): Promise<void> {
    if (rows.length === 0) return;
    await this.m.PaymentAllocation!.insertMany(
      rows.map((a) => ({
        _id: this.id(a.id),
        institutionId: this.inst,
        paymentId: this.id(a.paymentId),
        studentId: this.id(a.studentId),
        receivableId: this.id(a.receivableId),
        academicYearId: this.id(a.academicYearId),
        kind: a.kind,
        amount: a.amount,
        componentSplit: a.componentSplit,
        postingDate: a.postingDate,
        ...(a.reversesAllocationId
          ? { reversesAllocationId: this.id(a.reversesAllocationId) }
          : {}),
      })),
      { session: this.session },
    );
  }
  /** atomic increment OUTSIDE the transaction: never conflicts, never rolled back (gaps allowed, reuse impossible) */
  async nextSequence(counterKey: string): Promise<number> {
    const _id = `${this.inst.toHexString()}:${counterKey}`;
    for (let i = 0; i < 3; i++) {
      try {
        const d = await this.m
          .Counter!.findOneAndUpdate({ _id }, { $inc: { seq: 1 } }, { upsert: true, new: true })
          .lean();
        return (d as { seq: number }).seq;
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e; // two first-ever upserts racing → retry
      }
    }
    throw new Error('could not allocate a sequence number');
  }
  async insertReceipt(r: StoredReceipt): Promise<void> {
    await this.m.Receipt!.create(
      [
        {
          _id: this.id(r.id),
          institutionId: this.inst,
          receiptNo: r.receiptNo,
          paymentId: this.id(r.paymentId),
          studentId: this.id(r.studentId),
          status: r.status,
          issuedAt: r.issuedAt,
          balances: r.balances,
        },
      ],
      { session: this.session },
    );
  }
  async cancelReceipt(
    paymentId: string,
    c: { at: Date; by: string; reason: string },
  ): Promise<void> {
    await this.m.Receipt!.updateOne(
      this.scope({ paymentId: this.id(paymentId) }),
      {
        $set: {
          status: 'CANCELLED',
          cancellation: { at: c.at, by: this.id(c.by), reason: c.reason },
        },
      },
      { session: this.session },
    );
  }
  async insertReversal(r: StoredReversal): Promise<void> {
    await this.m.PaymentReversal!.create(
      [
        {
          _id: this.id(r.id),
          institutionId: this.inst,
          paymentId: this.id(r.paymentId),
          reasonText: r.reason,
          requestedBy: this.id(r.requestedBy),
          ...(r.approvedBy ? { approvedBy: this.id(r.approvedBy) } : {}),
          authorizedBy: this.id(r.authorizedBy),
          originalPaymentDate: r.originalPaymentDate,
          originalAmount: r.originalAmount,
          reversalDate: r.reversalDate,
          reversedAmount: r.reversedAmount,
          approvalRequired: !!r.approvedBy,
          status: r.status,
          completedAt: r.reversedAt,
        },
      ],
      { session: this.session },
    );
  }
  async insertAudit(e: AuditEntry): Promise<void> {
    await this.m.AuditLog!.create(
      [
        {
          institutionId: this.inst,
          at: e.at,
          userId: this.id(e.userId),
          action: e.action,
          entityType: e.entityType,
          entityId: e.entityId,
          ...(e.studentId ? { studentId: this.id(e.studentId) } : {}),
          before: e.before,
          after: e.after,
          reason: e.reason,
        },
      ],
      { session: this.session },
    );
  }
}
