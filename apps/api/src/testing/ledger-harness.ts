import type { PostedAllocation, Receivable } from '../domain/finance';
import type {
  AuditEntry,
  LedgerStore,
  StoredPayment,
  StoredReceipt,
  StoredReversal,
} from '../modules/payments/ports';
import { InMemoryLedgerStore } from './in-memory-ledger-store';

/** one interface over "a ledger we can seed and inspect" so the SAME scenarios run on every store implementation */
export interface LedgerHarness {
  store: LedgerStore;
  newId(): string;
  seed(rs: Receivable[]): Promise<void>;
  receivable(id: string): Promise<Receivable>;
  allReceivables(): Promise<Receivable[]>;
  payments(): Promise<StoredPayment[]>;
  allocations(): Promise<PostedAllocation[]>;
  receipts(): Promise<StoredReceipt[]>;
  reversals(): Promise<StoredReversal[]>;
  audit(): Promise<AuditEntry[]>;
  /** number of transaction conflicts observed (only meaningful for the in-memory model) */
  conflicts?(): number;
  dispose?(): Promise<void>;
}

export function inMemoryHarness(): LedgerHarness & { memory: InMemoryLedgerStore } {
  const memory = new InMemoryLedgerStore();
  let n = 0;
  return {
    memory,
    store: memory,
    newId: () => `id-${++n}`,
    seed: async (rs) => memory.seedReceivables(rs),
    receivable: async (id) => memory.receivable(id),
    allReceivables: async () => memory.allReceivables(),
    payments: async () => memory.payments(),
    allocations: async () => memory.allocations(),
    receipts: async () => memory.receipts(),
    reversals: async () => memory.reversals(),
    audit: async () => memory.audit(),
    conflicts: () => memory.conflicts,
  };
}
