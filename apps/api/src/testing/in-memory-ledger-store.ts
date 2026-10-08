import type { PostedAllocation, Receivable } from '../domain/finance';
import {
  DuplicateKeyError,
  WriteConflictError,
  type AuditEntry,
  type LedgerStore,
  type LedgerTx,
  type StoredPayment,
  type StoredReceipt,
  type StoredReversal,
} from '../modules/payments/ports';

/**
 * In-memory LedgerStore used to test the posting kernel without a database.
 *
 * It reproduces the MongoDB transaction semantics the kernel relies on:
 *  - SNAPSHOT ISOLATION: a transaction reads the committed state as of its start
 *  - FIRST-COMMITTER-WINS: if a document the transaction wrote was changed by another committed
 *    transaction after the snapshot → WriteConflictError (retried by runInTransaction)
 *  - UNIQUE INDEXES enforced at commit → DuplicateKeyError
 *  - ATOMICITY: writes are buffered and applied in one synchronous step; any error discards them
 *  - SEQUENCE COUNTERS are atomic increments OUTSIDE the transaction (findOneAndUpdate $inc): they never
 *    conflict, are never rolled back, and may leave gaps — which is exactly what decision BRC-G1 allows
 * Every Tx method yields to the event loop so concurrent transactions genuinely interleave.
 *
 * It is a model of MongoDB, not MongoDB: the real adapter is exercised by the integration tests
 * in CI (mongo-ledger-store.integration.test.ts).
 */

interface Doc<T> {
  v: number;
  data: T;
}

interface State {
  payments: Map<string, Doc<StoredPayment>>;
  receivables: Map<string, Doc<Receivable>>;
  allocations: PostedAllocation[];
  receipts: Map<string, Doc<StoredReceipt>>;
  reversals: Map<string, Doc<StoredReversal>>;
  counters: Map<string, Doc<number>>;
  audit: AuditEntry[];
}

const emptyState = (): State => ({
  payments: new Map(),
  receivables: new Map(),
  allocations: [],
  receipts: new Map(),
  reversals: new Map(),
  counters: new Map(),
  audit: [],
});

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
const clone = <T>(x: T): T => structuredClone(x);

export interface StoreHooks {
  /** called after the work finished but before commit — tests use it to force interleavings */
  beforeCommit?: (txId: number) => Promise<void>;
  /** name of a Tx method that should throw (to test rollback) */
  failOn?: string;
  /** make the next N guarded receivable updates report "someone changed it" (tests the service's reaction) */
  guardFailures?: number;
}

export class InMemoryLedgerStore implements LedgerStore {
  state: State = emptyState();
  hooks: StoreHooks = {};
  commits = 0;
  conflicts = 0;
  private txSeq = 0;

  constructor(private readonly maxAttempts = 50) {}

  /** test helper: put receivables straight into committed state */
  seedReceivables(rs: readonly Receivable[]): void {
    for (const r of rs) this.state.receivables.set(r.id, { v: 1, data: clone(r) });
  }
  receivable(id: string): Receivable {
    return clone((this.state.receivables.get(id) as Doc<Receivable>).data);
  }
  allReceivables(): Receivable[] {
    return [...this.state.receivables.values()].map((d) => clone(d.data));
  }
  payments(): StoredPayment[] {
    return [...this.state.payments.values()].map((d) => clone(d.data));
  }
  receipts(): StoredReceipt[] {
    return [...this.state.receipts.values()].map((d) => clone(d.data));
  }
  allocations(): PostedAllocation[] {
    return clone(this.state.allocations);
  }
  reversals(): StoredReversal[] {
    return [...this.state.reversals.values()].map((d) => clone(d.data));
  }
  audit(): AuditEntry[] {
    return clone(this.state.audit);
  }

  async runInTransaction<T>(work: (tx: LedgerTx) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const tx = new InMemoryTx(this, ++this.txSeq);
      try {
        const result = await work(tx);
        if (this.hooks.beforeCommit) await this.hooks.beforeCommit(tx.id);
        tx.commit();
        this.commits++;
        return result;
      } catch (e) {
        if (e instanceof WriteConflictError) {
          this.conflicts++;
          await tick();
          continue;
        }
        throw e;
      }
    }
    throw new Error('transaction retry limit exceeded');
  }
}

class InMemoryTx implements LedgerTx {
  private readonly snap: State;
  private readonly writes = {
    receivables: new Map<string, { next: Receivable; readV: number }>(),
    payments: [] as StoredPayment[],
    paymentReversals: new Map<string, { reversalId: string; readV: number }>(),
    allocations: [] as PostedAllocation[],
    receipts: [] as StoredReceipt[],
    receiptCancel: new Map<string, { at: Date; by: string; reason: string }>(),
    reversals: [] as StoredReversal[],
    audit: [] as AuditEntry[],
  };

  constructor(
    private readonly store: InMemoryLedgerStore,
    readonly id: number,
  ) {
    this.snap = clone(store.state);
  }

  private async step(name: string): Promise<void> {
    await tick();
    if (this.store.hooks.failOn === name) throw new Error(`injected failure in ${name}`);
  }

  async findPaymentByIdempotencyKey(key: string): Promise<StoredPayment | null> {
    await this.step('findPaymentByIdempotencyKey');
    const own = this.writes.payments.find((p) => p.idempotencyKey === key);
    if (own) return clone(own);
    const hit = [...this.snap.payments.values()].find((d) => d.data.idempotencyKey === key);
    return hit ? clone(hit.data) : null;
  }
  async findPaymentByUniqueRef(uniqueRefKey: string): Promise<StoredPayment | null> {
    await this.step('findPaymentByUniqueRef');
    const hit = [...this.snap.payments.values()].find((d) => d.data.uniqueRefKey === uniqueRefKey);
    return hit ? clone(hit.data) : null;
  }
  async findPayment(id: string): Promise<StoredPayment | null> {
    await this.step('findPayment');
    const d = this.snap.payments.get(id);
    return d ? clone(d.data) : null;
  }
  async loadReceivables(studentId: string): Promise<Receivable[]> {
    await this.step('loadReceivables');
    return [...this.snap.receivables.values()]
      .map((d) => clone(d.data))
      .filter((r) => r.studentId === studentId && r.paymentStatus !== 'VOID');
  }
  async loadReceivablesByIds(ids: readonly string[]): Promise<Receivable[]> {
    await this.step('loadReceivablesByIds');
    return ids.map((id) => clone((this.snap.receivables.get(id) as Doc<Receivable>).data));
  }
  async replaceReceivableGuarded(next: Receivable): Promise<boolean> {
    await this.step('replaceReceivableGuarded');
    const stored = this.snap.receivables.get(next.id);
    if (this.store.hooks.guardFailures && this.store.hooks.guardFailures > 0) {
      this.store.hooks.guardFailures -= 1;
      return false;
    }
    if (!stored || stored.data.version !== next.version - 1) return false;
    this.writes.receivables.set(next.id, { next: clone(next), readV: stored.v });
    return true;
  }
  async insertPayment(p: StoredPayment): Promise<void> {
    await this.step('insertPayment');
    this.writes.payments.push(clone(p));
  }
  async markPaymentReversed(id: string, reversalId: string): Promise<boolean> {
    await this.step('markPaymentReversed');
    const d = this.snap.payments.get(id);
    if (!d || d.data.status !== 'POSTED') return false;
    this.writes.paymentReversals.set(id, { reversalId, readV: d.v });
    return true;
  }
  async loadAllocations(paymentId: string): Promise<PostedAllocation[]> {
    await this.step('loadAllocations');
    return clone(
      [...this.snap.allocations, ...this.writes.allocations].filter(
        (a) => a.paymentId === paymentId,
      ),
    );
  }
  async insertAllocations(rows: readonly PostedAllocation[]): Promise<void> {
    await this.step('insertAllocations');
    this.writes.allocations.push(...clone(rows));
  }
  async nextSequence(counterKey: string): Promise<number> {
    await this.step('nextSequence');
    // atomic, non-transactional increment (survives an aborted transaction → gaps are possible, reuse is not)
    const live = this.store.state.counters;
    const d = live.get(counterKey);
    const value = (d?.data ?? 0) + 1;
    live.set(counterKey, { v: (d?.v ?? 0) + 1, data: value });
    return value;
  }
  async insertReceipt(r: StoredReceipt): Promise<void> {
    await this.step('insertReceipt');
    this.writes.receipts.push(clone(r));
  }
  async findReceiptByPayment(paymentId: string): Promise<StoredReceipt | null> {
    await this.step('findReceiptByPayment');
    const hit = [...this.snap.receipts.values()].find((d) => d.data.paymentId === paymentId);
    return hit ? clone(hit.data) : null;
  }
  async cancelReceipt(
    paymentId: string,
    cancellation: { at: Date; by: string; reason: string },
  ): Promise<void> {
    await this.step('cancelReceipt');
    this.writes.receiptCancel.set(paymentId, cancellation);
  }
  async insertReversal(r: StoredReversal): Promise<void> {
    await this.step('insertReversal');
    this.writes.reversals.push(clone(r));
  }
  async insertAudit(e: AuditEntry): Promise<void> {
    await this.step('insertAudit');
    this.writes.audit.push(clone(e));
  }

  /** Atomic, synchronous commit: validate against LIVE state, then apply everything or nothing. */
  commit(): void {
    const live = this.store.state;

    // first-committer-wins on every document we wrote
    for (const [id, w] of this.writes.receivables) {
      if ((live.receivables.get(id)?.v ?? -1) !== w.readV)
        throw new WriteConflictError(`receivable ${id}`);
    }
    for (const [id, w] of this.writes.paymentReversals) {
      if ((live.payments.get(id)?.v ?? -1) !== w.readV)
        throw new WriteConflictError(`payment ${id}`);
    }

    // unique indexes
    const seen = {
      idem: new Set<string>(),
      no: new Set<string>(),
      ref: new Set<string>(),
      rcpt: new Set<string>(),
      rcptPay: new Set<string>(),
      rev: new Set<string>(),
    };
    const livePayments = [...live.payments.values()].map((d) => d.data);
    for (const p of this.writes.payments) {
      if (
        livePayments.some((x) => x.idempotencyKey === p.idempotencyKey) ||
        seen.idem.has(p.idempotencyKey)
      )
        throw new DuplicateKeyError('payments.idempotencyKey');
      if (livePayments.some((x) => x.paymentNo === p.paymentNo) || seen.no.has(p.paymentNo))
        throw new DuplicateKeyError('payments.paymentNo');
      if (
        p.uniqueRefKey !== undefined &&
        (livePayments.some((x) => x.uniqueRefKey === p.uniqueRefKey) ||
          seen.ref.has(p.uniqueRefKey))
      ) {
        throw new DuplicateKeyError('payments.uniqueRefKey');
      }
      seen.idem.add(p.idempotencyKey);
      seen.no.add(p.paymentNo);
      if (p.uniqueRefKey !== undefined) seen.ref.add(p.uniqueRefKey);
    }
    const liveReceipts = [...live.receipts.values()].map((d) => d.data);
    for (const r of this.writes.receipts) {
      if (liveReceipts.some((x) => x.receiptNo === r.receiptNo) || seen.rcpt.has(r.receiptNo))
        throw new DuplicateKeyError('receipts.receiptNo');
      if (liveReceipts.some((x) => x.paymentId === r.paymentId) || seen.rcptPay.has(r.paymentId))
        throw new DuplicateKeyError('receipts.paymentId');
      seen.rcpt.add(r.receiptNo);
      seen.rcptPay.add(r.paymentId);
    }
    const liveReversals = [...live.reversals.values()].map((d) => d.data);
    for (const r of this.writes.reversals) {
      if (liveReversals.some((x) => x.paymentId === r.paymentId) || seen.rev.has(r.paymentId))
        throw new DuplicateKeyError('reversals.paymentId');
      seen.rev.add(r.paymentId);
    }

    // apply
    for (const [id, w] of this.writes.receivables)
      live.receivables.set(id, { v: w.readV + 1, data: w.next });
    for (const p of this.writes.payments) live.payments.set(p.id, { v: 1, data: p });
    for (const [id, w] of this.writes.paymentReversals) {
      const d = live.payments.get(id) as Doc<StoredPayment>;
      live.payments.set(id, {
        v: d.v + 1,
        data: { ...d.data, status: 'REVERSED', reversalId: w.reversalId, uniqueRefKey: undefined },
      });
    }
    live.allocations.push(...this.writes.allocations);
    for (const r of this.writes.receipts) live.receipts.set(r.id, { v: 1, data: r });
    for (const [paymentId, c] of this.writes.receiptCancel) {
      const d = [...live.receipts.values()].find((x) => x.data.paymentId === paymentId);
      if (d)
        live.receipts.set(d.data.id, {
          v: d.v + 1,
          data: { ...d.data, status: 'CANCELLED', cancellation: c },
        });
    }
    for (const r of this.writes.reversals) live.reversals.set(r.id, { v: 1, data: r });
    live.audit.push(...this.writes.audit);
  }
}
