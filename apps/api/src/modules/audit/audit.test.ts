import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  chain,
  redactSensitive,
  verifyChain,
  type ChainedAuditEntry,
} from './audit-chain';
import { AuditSeqConflict, AuditService, type AuditStore } from './audit.service';

const at = new Date('2026-10-08T06:00:00Z');
const input = (n: number) => ({
  at,
  action: 'X',
  entityType: 'user',
  entityId: String(n),
  userId: 'u1',
});

class MemStore implements AuditStore {
  rows: ChainedAuditEntry[] = [];
  async head() {
    await new Promise((r) => setImmediate(r));
    const last = this.rows[this.rows.length - 1];
    return last ? { seq: last.seq, hash: last.hash } : null;
  }
  async insert(e: ChainedAuditEntry) {
    await new Promise((r) => setImmediate(r));
    if (this.rows.some((r) => r.seq === e.seq)) throw new AuditSeqConflict();
    this.rows.push(e);
  }
  async list() {
    return [...this.rows].sort((a, b) => a.seq - b.seq);
  }
}

describe('audit hash chain', () => {
  const build = (n: number): ChainedAuditEntry[] => {
    const out: ChainedAuditEntry[] = [];
    for (let i = 1; i <= n; i++) out.push(chain(out[out.length - 1] ?? null, input(i)));
    return out;
  };

  it('starts at the genesis hash and links every entry to the one before', () => {
    const [a, b] = build(2) as [ChainedAuditEntry, ChainedAuditEntry];
    expect(a).toMatchObject({ seq: 1, prevHash: GENESIS_HASH });
    expect(b).toMatchObject({ seq: 2, prevHash: a.hash });
    expect(a.hash).not.toBe(b.hash);
  });
  it('a clean chain verifies', () => {
    expect(verifyChain(build(5))).toEqual({ ok: true, count: 5 });
    expect(verifyChain([])).toEqual({ ok: true, count: 0 });
  });
  it('detects an edited entry, a deleted entry, a reordered entry and a forged hash', () => {
    const rows = build(5);
    const edited = rows.map((r) => (r.seq === 3 ? { ...r, action: 'TAMPERED' } : r));
    expect(verifyChain(edited)).toMatchObject({
      ok: false,
      brokenAtSeq: 3,
      reason: 'entry was modified',
    });
    expect(verifyChain(rows.filter((r) => r.seq !== 3))).toMatchObject({
      ok: false,
      brokenAtSeq: 4,
    });
    const swapped = [rows[0], rows[2], rows[1], ...rows.slice(3)] as ChainedAuditEntry[];
    expect(verifyChain(swapped).ok).toBe(false);
    const forged = rows.map((r) => (r.seq === 2 ? { ...r, hash: 'f'.repeat(64) } : r));
    expect(verifyChain(forged).ok).toBe(false);
    // rewriting entry 2 AND its hash still breaks entry 3's link
    const rewritten = chain(rows[0] as ChainedAuditEntry, { ...input(2), action: 'REWRITTEN' });
    expect(
      verifyChain([rows[0], rewritten, ...rows.slice(2)] as ChainedAuditEntry[]),
    ).toMatchObject({ ok: false, brokenAtSeq: 3 });
  });
  it('never stores secrets, at any depth', () => {
    const e = chain(null, {
      ...input(1),
      before: { passwordHash: 'H', nested: { token: 'T', keep: 1 } },
      after: [{ refreshToken: 'R', name: 'a' }],
    });
    expect(JSON.stringify(e)).not.toMatch(/"H"|"T"|"R"/);
    expect(e.before).toEqual({
      passwordHash: '[REDACTED]',
      nested: { token: '[REDACTED]', keep: 1 },
    });
    expect(redactSensitive(at)).toBe(at);
  });
  it('concurrent writers never fork the chain: sequence is gapless and the chain verifies', async () => {
    const store = new MemStore();
    const svc = new AuditService(store);
    await Promise.all(Array.from({ length: 30 }, (_, i) => svc.record(input(i))));
    expect(store.rows.map((r) => r.seq).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
    expect(verifyChain(await store.list())).toEqual({ ok: true, count: 30 });
  });
  it('several processes (separate services, one store) also never fork the chain', async () => {
    const store = new MemStore();
    const procs = [new AuditService(store), new AuditService(store), new AuditService(store)];
    await Promise.all(
      Array.from({ length: 30 }, (_, i) => (procs[i % 3] as AuditService).record(input(i))),
    );
    expect(verifyChain(await store.list())).toEqual({ ok: true, count: 30 });
  });
  it('a failed write does not block the writers queued behind it', async () => {
    const store = new MemStore();
    let fail = true;
    const flaky: AuditStore = {
      ...store,
      head: () => store.head(),
      list: () => store.list(),
      insert: async (e) => {
        if (fail) {
          fail = false;
          throw new Error('boom');
        }
        return store.insert(e);
      },
    };
    const svc = new AuditService(flaky);
    const results = await Promise.allSettled([svc.record(input(1)), svc.record(input(2))]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
    expect(verifyChain(await store.list())).toEqual({ ok: true, count: 1 });
  });
  it('gives up with an error rather than writing a broken entry', async () => {
    const stuck: AuditStore = {
      head: async () => null,
      insert: async () => {
        throw new AuditSeqConflict();
      },
      list: async () => [],
    };
    await expect(new AuditService(stuck, 3).record(input(1))).rejects.toThrow(/could not append/);
  });
  it('propagates unexpected storage errors', async () => {
    const broken: AuditStore = {
      head: async () => null,
      insert: async () => {
        throw new Error('disk full');
      },
      list: async () => [],
    };
    await expect(new AuditService(broken).record(input(1))).rejects.toThrow('disk full');
  });
});
