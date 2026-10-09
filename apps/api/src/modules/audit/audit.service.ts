import { chain, type AuditEntryInput, type ChainedAuditEntry } from './audit-chain';

/** Storage port for the chained audit log. */
export interface AuditStore {
  /** latest entry of the chain, or null when empty */
  head(): Promise<{ seq: number; hash: string } | null>;
  /** insert; MUST throw `AuditSeqConflict` when the sequence number is already taken (unique index) */
  insert(entry: ChainedAuditEntry): Promise<void>;
  list(opts: { fromSeq?: number; limit: number }): Promise<ChainedAuditEntry[]>;
}

export class AuditSeqConflict extends Error {
  constructor() {
    super('audit sequence number already taken');
    this.name = 'AuditSeqConflict';
  }
}

export interface AuditRecorder {
  record(entry: AuditEntryInput): Promise<void>;
}

/**
 * Appends to the chain. Two requests may race for the same sequence number; the unique index lets
 * exactly one win and the loser re-reads the head and retries — the chain can never fork.
 */
export class AuditService implements AuditRecorder {
  /** writers inside this process take turns, so only OTHER processes can ever collide */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: AuditStore,
    private readonly maxAttempts = 60,
  ) {}

  record(input: AuditEntryInput): Promise<void> {
    const run = this.tail.then(() => this.append(input));
    this.tail = run.catch(() => undefined); // one failure must not block later writers
    return run;
  }

  private async append(input: AuditEntryInput): Promise<void> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const entry = chain(await this.store.head(), input);
      try {
        await this.store.insert(entry);
        return;
      } catch (e) {
        if (!(e instanceof AuditSeqConflict)) throw e;
        // another process won this sequence number: back off a little (jittered) and re-read the head
        await new Promise((r) => setTimeout(r, Math.random() * Math.min(40, attempt * 2)));
      }
    }
    throw new Error('could not append to the audit log');
  }
}
