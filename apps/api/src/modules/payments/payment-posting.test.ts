import { describe, expect, it } from 'vitest';
import { R, mk } from '../../testing/fixtures';
import { inMemoryHarness } from '../../testing/ledger-harness';
import { makeContext, postingScenarios } from './payment-posting.scenarios';

// the shared behavioural scenarios, on the in-memory model of MongoDB's transaction semantics
postingScenarios('in-memory model', async () => inMemoryHarness());

// tests that need fault injection / the model's internals
describe('in-memory model only — atomicity and guards in isolation', () => {
  const inst = (id: string, amount: number, extra: Partial<Parameters<typeof mk>[0]> = {}) =>
    mk({ id, no: 1, due: '2026-07-10', amount, ...extra });

  it.each([
    'replaceReceivableGuarded',
    'insertPayment',
    'insertAllocations',
    'insertReceipt',
    'insertAudit',
  ])('a failure in %s leaves the books untouched', async (step) => {
    const h = inMemoryHarness();
    const c = makeContext(h);
    await c.seed(inst('i1', R(1_000)));
    h.memory.hooks.failOn = step;
    await expect(c.svc.post(c.cmd(1, R(400)))).rejects.toThrow(/injected failure/);
    expect(await h.receivable('i1')).toMatchObject({ paid: 0, pending: R(1_000), version: 0 });
    expect(await h.payments()).toHaveLength(0);
    expect(await h.allocations()).toHaveLength(0);
    expect(await h.receipts()).toHaveLength(0);
    expect(await h.audit()).toHaveLength(0);
    h.memory.hooks.failOn = undefined;
    expect((await c.svc.post(c.cmd(1, R(400)))).payment.status).toBe('POSTED');
    await c.assertLedgerConsistent();
  });

  it('an aborted payment may leave a GAP in receipt numbers (allowed, BRC-G1) but a number is never reused', async () => {
    const h = inMemoryHarness();
    const c = makeContext(h);
    await c.seed(inst('i1', R(1_000)));
    h.memory.hooks.failOn = 'insertReceipt';
    await expect(c.svc.post(c.cmd(1, R(100)))).rejects.toThrow();
    h.memory.hooks.failOn = undefined;
    expect((await c.svc.post(c.cmd(1, R(100)))).receiptNo).toBe('REC-2026-000002'); // 000001 stays unused
    expect((await c.svc.post(c.cmd(2, R(100)))).receiptNo).toBe('REC-2026-000003');
  });

  it('a failed GUARDED receivable update aborts the attempt and retries on fresh data — it is never ignored', async () => {
    const h = inMemoryHarness();
    const c = makeContext(h);
    await c.seed(inst('i1', R(1_000)));
    h.memory.hooks.guardFailures = 2;
    const res = await c.svc.post(c.cmd(1, R(400)));
    expect(res.payment.status).toBe('POSTED');
    expect(h.memory.conflicts).toBe(2);
    expect((await h.receivable('i1')).paid).toBe(R(400)); // applied exactly once
    await c.assertLedgerConsistent();
  });

  it('payments for different students never conflict (no global serialisation point)', async () => {
    const h = inMemoryHarness();
    const c = makeContext(h);
    await c.seed(
      inst('a1', R(1_000), { student: 'stu-A' }),
      inst('b1', R(1_000), { student: 'stu-B' }),
    );
    await Promise.all([
      c.svc.post(c.cmd(1, R(500), { studentId: 'stu-A' })),
      c.svc.post(c.cmd(2, R(500), { studentId: 'stu-B' })),
    ]);
    expect(h.memory.conflicts).toBe(0);
  });

  it("payments for the SAME due do conflict, and the loser retries against the winner's result", async () => {
    const h = inMemoryHarness();
    const c = makeContext(h);
    await c.seed(inst('i1', R(1_000)));
    const r = await Promise.allSettled([
      c.svc.post(c.cmd(1, R(700))),
      c.svc.post(c.cmd(2, R(700))),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(h.memory.conflicts).toBeGreaterThan(0);
  });

  it('contended retries reuse the reserved receipt number instead of burning one per attempt', async () => {
    const h = inMemoryHarness();
    const c = makeContext(h);
    await c.seed(inst('i1', R(10_000)));
    await Promise.all(Array.from({ length: 10 }, (_, i) => c.svc.post(c.cmd(i, R(1_000)))));
    const nos = (await h.receipts()).map((r) => r.receiptNo).sort();
    expect(nos).toEqual(
      Array.from({ length: 10 }, (_, i) => `REC-2026-${String(i + 1).padStart(6, '0')}`),
    );
    expect(h.memory.conflicts).toBeGreaterThan(0);
  });
});
