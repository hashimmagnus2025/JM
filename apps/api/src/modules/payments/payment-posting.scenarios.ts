import { FixedClock } from '@sfm/shared';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { assertReceivable, type Receivable } from '../../domain/finance';
import { R, STUDENT, Y2025, Y2026, mk } from '../../testing/fixtures';
import type { LedgerHarness } from '../../testing/ledger-harness';
import {
  PaymentPostingService,
  type PaymentSettings,
  type PostPaymentCommand,
} from './payment-posting.service';

/**
 * Behavioural scenarios for the payment-posting kernel. They only talk to the LedgerHarness interface, so the
 * SAME scenarios run against the in-memory model (every build) and a real MongoDB replica set (CI).
 */
export interface ScenarioContext {
  h: LedgerHarness;
  svc: PaymentPostingService;
  cfg: PaymentSettings;
  seed: (...rs: Receivable[]) => Promise<void>;
  cmd: (
    n: number | string,
    amount: number,
    extra?: Partial<PostPaymentCommand>,
  ) => PostPaymentCommand;
  assertLedgerConsistent: () => Promise<void>;
}

const KEY = (n: number | string): string => `idem-key-0000000${String(n).padStart(3, '0')}`;
export const defaultSettings = (): PaymentSettings => ({
  finance: { componentPriority: [], advanceEnabled: false },
  numbering: { prefix: 'REC', scope: 'ACADEMIC_YEAR', pad: 6 },
  uniqueReferenceMethods: ['UPI', 'BANK', 'CARD'],
  reversalApprovalThresholdPaise: null,
});

const settle = <T>(ps: Promise<T>[]): Promise<PromiseSettledResult<T>[]> => Promise.allSettled(ps);
const codeOf = (r: PromiseSettledResult<unknown>): string =>
  r.status === 'rejected' ? String((r.reason as { code?: string }).code) : 'OK';
const inst = (
  id: string,
  amount: number,
  due = '2026-07-10',
  extra: Partial<Parameters<typeof mk>[0]> = {},
): Receivable => mk({ id, no: 1, due, amount, ...extra });

export function makeContext(h: LedgerHarness): ScenarioContext {
  const cfg = defaultSettings();
  const svc = new PaymentPostingService({
    store: h.store,
    clock: new FixedClock('2026-10-08T06:00:00Z'),
    settings: () => cfg,
    newId: () => h.newId(),
  });
  const ctx: ScenarioContext = {
    h,
    svc,
    cfg,
    seed: (...rs) => h.seed(rs),
    cmd: (n, amount, extra = {}) => ({
      idempotencyKey: KEY(n),
      studentId: STUDENT,
      amount,
      method: 'CASH',
      paymentDate: '2026-10-08',
      collectedBy: 'cashier-1',
      academicYearLabel: '2026-27',
      ...extra,
    }),
    /** the books must always balance — checked after every scenario */
    assertLedgerConsistent: async () => {
      const rows = await h.allocations();
      for (const r of await h.allReceivables()) {
        assertReceivable(r);
        const mine = rows.filter((a) => a.receivableId === r.id);
        expect(
          mine.reduce((s, a) => s + a.amount, 0),
          `Σ allocations of ${r.id} must equal its paid counter`,
        ).toBe(r.paid);
        for (const c of r.components) {
          const comp = mine
            .flatMap((a) => a.componentSplit)
            .filter((s) => s.componentCode === c.code)
            .reduce((s, x) => s + x.amount, 0);
          expect(comp, `${r.id}/${c.code}`).toBe(c.paid);
        }
      }
      for (const p of await h.payments()) {
        const own = rows
          .filter((a) => a.paymentId === p.id && a.kind === 'ALLOCATION')
          .reduce((s, a) => s + a.amount, 0);
        expect(own).toBe(p.allocatedAmount);
        expect(p.allocatedAmount + p.unallocatedAmount).toBe(p.amount);
      }
      const receiptNos = (await h.receipts()).map((r) => r.receiptNo);
      expect(new Set(receiptNos).size).toBe(receiptNos.length);
      const paymentNos = (await h.payments()).map((p) => p.paymentNo);
      expect(new Set(paymentNos).size).toBe(paymentNos.length);
    },
  };
  return ctx;
}

export function postingScenarios(label: string, makeHarness: () => Promise<LedgerHarness>): void {
  describe(`payment posting kernel — ${label}`, () => {
    let c: ScenarioContext;
    beforeEach(async () => {
      c = makeContext(await makeHarness());
    });
    afterEach(async () => {
      await c.h.dispose?.();
    });

    describe('recording a payment', () => {
      it('normal case: allocates, issues receipt REC-2026-000001, updates the dues, audits — atomically', async () => {
        await c.seed(inst('i1', R(10_000)), inst('i2', R(10_000), '2026-10-10', { no: 2 }));
        const res = await c.svc.post(c.cmd(1, R(12_000)));
        expect(res).toMatchObject({
          receiptNo: 'REC-2026-000001',
          balanceBefore: R(20_000),
          balanceAfter: R(8_000),
          replayed: false,
        });
        expect(res.payment).toMatchObject({
          status: 'POSTED',
          allocatedAmount: R(12_000),
          unallocatedAmount: 0,
          allocationStrategy: 'OLDEST_DUE_FIRST',
          paymentNo: 'PAY-000001',
        });
        expect(res.allocations.map((a) => [a.receivableId, a.amount, a.postingDate])).toEqual([
          ['i1', R(10_000), '2026-10-08'],
          ['i2', R(2_000), '2026-10-08'],
        ]);
        expect(await c.h.receivable('i1')).toMatchObject({ paymentStatus: 'PAID', pending: 0 });
        expect(await c.h.receivable('i2')).toMatchObject({
          paymentStatus: 'PARTIAL',
          pending: R(8_000),
        });
        expect((await c.h.audit()).map((a) => a.action).sort()).toEqual([
          'PAYMENT_CREATED',
          'RECEIPT_GENERATED',
        ]);
        await c.assertLedgerConsistent();
      });

      it('zero / negative / fractional amounts are rejected before anything is touched', async () => {
        await c.seed(inst('i1', R(100)));
        for (const amount of [0, -100, 10.5]) {
          expect(
            codeOf(
              (await settle([c.svc.post(c.cmd(1, amount))]))[0] as PromiseSettledResult<unknown>,
            ),
          ).toBe('PAYMENT_AMOUNT_INVALID');
        }
        expect(await c.h.payments()).toHaveLength(0);
        expect(await c.h.receipts()).toHaveLength(0);
      });

      it('partial then full payment on the same installment', async () => {
        await c.seed(inst('i1', R(1_000)));
        await c.svc.post(c.cmd(1, R(400)));
        expect(await c.h.receivable('i1')).toMatchObject({
          paymentStatus: 'PARTIAL',
          pending: R(600),
        });
        const second = await c.svc.post(c.cmd(2, R(600)));
        expect(second.receiptNo).toBe('REC-2026-000002');
        expect(await c.h.receivable('i1')).toMatchObject({
          paymentStatus: 'PAID',
          pending: 0,
          version: 2,
        });
        await c.assertLedgerConsistent();
      });

      it('OVERPAYMENT is rejected and leaves no trace; with advance enabled the excess is kept as credit', async () => {
        await c.seed(inst('i1', R(1_000)));
        expect(
          codeOf(
            (await settle([c.svc.post(c.cmd(1, R(1_001)))]))[0] as PromiseSettledResult<unknown>,
          ),
        ).toBe('PAYMENT_EXCEEDS_OUTSTANDING');
        expect(await c.h.payments()).toHaveLength(0);
        expect((await c.h.receivable('i1')).paid).toBe(0);
        c.cfg.finance.advanceEnabled = true;
        const res = await c.svc.post(c.cmd(2, R(1_300)));
        expect(res.payment).toMatchObject({ allocatedAmount: R(1_000), unallocatedAmount: R(300) });
        await c.assertLedgerConsistent();
      });

      it('MANUAL allocation is recorded as such', async () => {
        await c.seed(inst('i1', R(500)), inst('i2', R(500), '2026-10-10', { no: 2 }));
        const res = await c.svc.post(
          c.cmd(1, R(300), {
            allocation: { mode: 'MANUAL', items: [{ receivableId: 'i2', amount: R(300) }] },
          }),
        );
        expect(res.payment).toMatchObject({
          allocationMode: 'MANUAL',
          allocationStrategy: 'MANUAL',
        });
        expect((await c.h.receivable('i1')).paid).toBe(0);
        expect((await c.h.receivable('i2')).paid).toBe(R(300));
      });

      it('HISTORICAL ACADEMIC-YEAR SEPARATION: oldest year first, each allocation keeps its own year, reversal restores both', async () => {
        await c.seed(
          inst('old', R(10_000), '2026-01-10', { year: Y2025, no: 4 }),
          inst('cur', R(50_000), '2026-04-10', { year: Y2026 }),
        );
        const res = await c.svc.post(c.cmd(1, R(12_000)));
        expect(res.allocations.map((a) => [a.receivableId, a.academicYearId, a.amount])).toEqual([
          ['old', Y2025, R(10_000)],
          ['cur', Y2026, R(2_000)],
        ]);
        await c.svc.reverse({
          paymentId: res.payment.id,
          reason: 'Wrong student',
          requestedBy: 'acct-1',
        });
        expect(await c.h.receivable('old')).toMatchObject({
          pending: R(10_000),
          paymentStatus: 'UNPAID',
          academicYearId: Y2025,
        });
        expect(await c.h.receivable('cur')).toMatchObject({
          pending: R(50_000),
          academicYearId: Y2026,
        });
        await c.assertLedgerConsistent();
      });

      it('receipt numbering follows the configured prefix and scope', async () => {
        c.cfg.numbering = { prefix: 'FEE', scope: 'CALENDAR_YEAR', pad: 4 };
        await c.seed(inst('i1', R(1_000)));
        expect((await c.svc.post(c.cmd(1, R(10), { paymentDate: '2027-01-05' }))).receiptNo).toBe(
          'FEE-2027-0001',
        );
        expect((await c.svc.post(c.cmd(2, R(10), { paymentDate: '2027-01-06' }))).receiptNo).toBe(
          'FEE-2027-0002',
        );
      });
    });

    describe('DUPLICATE REQUEST / IDEMPOTENCY', () => {
      it('the same request sent again (double click, retry) returns the stored result and posts nothing new', async () => {
        await c.seed(inst('i1', R(1_000)));
        const first = await c.svc.post(c.cmd(1, R(400)));
        const again = await c.svc.post(c.cmd(1, R(400)));
        expect(again.replayed).toBe(true);
        expect(again.payment.id).toBe(first.payment.id);
        expect(again.receiptNo).toBe(first.receiptNo);
        expect(again.allocations.map((a) => a.id)).toEqual(first.allocations.map((a) => a.id));
        expect([again.balanceBefore, again.balanceAfter]).toEqual([R(1_000), R(600)]);
        expect(await c.h.payments()).toHaveLength(1);
        expect(await c.h.receipts()).toHaveLength(1);
        expect((await c.h.receivable('i1')).paid).toBe(R(400));
        expect(await c.h.audit()).toHaveLength(2);
      });

      it('five identical requests at the SAME TIME create exactly one payment', async () => {
        await c.seed(inst('i1', R(1_000)));
        const results = await Promise.all(
          Array.from({ length: 5 }, () => c.svc.post(c.cmd(1, R(400)))),
        );
        expect(new Set(results.map((r) => r.payment.id)).size).toBe(1);
        expect(results.filter((r) => !r.replayed)).toHaveLength(1);
        expect(await c.h.payments()).toHaveLength(1);
        expect((await c.h.receivable('i1')).paid).toBe(R(400));
        await c.assertLedgerConsistent();
      });

      it('the same key with a DIFFERENT request is rejected, never silently merged', async () => {
        await c.seed(inst('i1', R(1_000)));
        await c.svc.post(c.cmd(1, R(400)));
        expect(
          codeOf(
            (await settle([c.svc.post(c.cmd(1, R(500)))]))[0] as PromiseSettledResult<unknown>,
          ),
        ).toBe('IDEMPOTENCY_KEY_REUSED');
        expect(
          codeOf(
            (
              await settle([c.svc.post(c.cmd(1, R(400), { method: 'UPI', referenceNumber: 'X1' }))])
            )[0] as PromiseSettledResult<unknown>,
          ),
        ).toBe('IDEMPOTENCY_KEY_REUSED');
        expect(await c.h.payments()).toHaveLength(1);
      });

      it('a missing / malformed key is refused', async () => {
        await c.seed(inst('i1', R(1_000)));
        expect(
          codeOf(
            (
              await settle([c.svc.post({ ...c.cmd(1, R(1)), idempotencyKey: 'short' })])
            )[0] as PromiseSettledResult<unknown>,
          ),
        ).toBe('IDEMPOTENCY_KEY_REUSED');
      });

      it('duplicate transaction reference (UPI/bank/card) is blocked and points at the original receipt', async () => {
        await c.seed(inst('i1', R(1_000)));
        const first = await c.svc.post(
          c.cmd(1, R(100), { method: 'UPI', referenceNumber: ' utr-123 ' }),
        );
        const dup = await settle([
          c.svc.post(c.cmd(2, R(100), { method: 'UPI', referenceNumber: 'UTR-123' })),
        ]);
        expect(codeOf(dup[0] as PromiseSettledResult<unknown>)).toBe('DUPLICATE_TRANSACTION_REF');
        expect(
          ((dup[0] as PromiseRejectedResult).reason as { details: { receiptNo: string } }).details
            .receiptNo,
        ).toBe(first.receiptNo);
        expect(await c.h.payments()).toHaveLength(1);
        await c.svc.post(c.cmd(3, R(100), { method: 'BANK', referenceNumber: 'UTR-123' }));
        await c.svc.post(c.cmd(4, R(100), { method: 'CASH', referenceNumber: 'UTR-123' }));
        await c.svc.post(c.cmd(5, R(100), { method: 'CASH' }));
        await c.svc.post(c.cmd(6, R(100), { method: 'CASH' }));
        await c.assertLedgerConsistent();
      });

      it('two requests with the same UPI reference at the same time → one wins', async () => {
        await c.seed(inst('i1', R(1_000)));
        const r = await settle([
          c.svc.post(c.cmd(1, R(100), { method: 'UPI', referenceNumber: 'UTR-9' })),
          c.svc.post(c.cmd(2, R(100), { method: 'UPI', referenceNumber: 'UTR-9' })),
        ]);
        expect(r.map(codeOf).sort()).toEqual(['DUPLICATE_TRANSACTION_REF', 'OK']);
        expect(await c.h.payments()).toHaveLength(1);
        await c.assertLedgerConsistent();
      });

      it('after a reversal the reference can be entered again (corrected re-entry)', async () => {
        await c.seed(inst('i1', R(1_000)));
        const first = await c.svc.post(
          c.cmd(1, R(100), { method: 'UPI', referenceNumber: 'UTR-5' }),
        );
        await c.svc.reverse({
          paymentId: first.payment.id,
          reason: 'Entered wrong amount',
          requestedBy: 'acct-1',
        });
        const again = await c.svc.post(
          c.cmd(2, R(150), { method: 'UPI', referenceNumber: 'UTR-5' }),
        );
        expect(again.receiptNo).toBe('REC-2026-000002'); // the cancelled receipt's number is NOT reused
        await c.assertLedgerConsistent();
      });
    });

    describe('CONCURRENT PAYMENT ATTEMPTS — nobody can collect the same rupee twice', () => {
      it('two cashiers pay the full installment at once → exactly one succeeds', async () => {
        await c.seed(inst('i1', R(10_000)));
        const r = await settle([
          c.svc.post(c.cmd(1, R(10_000), { collectedBy: 'c1' })),
          c.svc.post(c.cmd(2, R(10_000), { collectedBy: 'c2' })),
        ]);
        expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
        expect(['NO_PAYABLE_RECEIVABLES', 'PAYMENT_EXCEEDS_OUTSTANDING']).toContain(
          codeOf(r.find((x) => x.status === 'rejected') as PromiseSettledResult<unknown>),
        );
        expect(await c.h.receivable('i1')).toMatchObject({ paid: R(10_000), pending: 0 });
        if (c.h.conflicts) expect(c.h.conflicts()).toBeGreaterThan(0); // the guard really fired
        expect(await c.h.payments()).toHaveLength(1);
        await c.assertLedgerConsistent();
      });

      it('two overlapping partial payments (6,000 + 6,000 on 10,000) → one accepted, the other sees the real balance', async () => {
        await c.seed(inst('i1', R(10_000)));
        const r = await settle([c.svc.post(c.cmd(1, R(6_000))), c.svc.post(c.cmd(2, R(6_000)))]);
        expect(r.map(codeOf).sort()).toEqual(['OK', 'PAYMENT_EXCEEDS_OUTSTANDING']);
        expect((await c.h.receivable('i1')).paid).toBe(R(6_000));
        await c.assertLedgerConsistent();
      });

      it('10 payments of 1,000 at once on 10,000 → all accepted, receipts unique, books balance', async () => {
        await c.seed(inst('i1', R(10_000)));
        const res = await Promise.all(
          Array.from({ length: 10 }, (_, i) => c.svc.post(c.cmd(i, R(1_000)))),
        );
        expect(res).toHaveLength(10);
        expect(await c.h.receivable('i1')).toMatchObject({
          paid: R(10_000),
          pending: 0,
          paymentStatus: 'PAID',
          version: 10,
        });
        const nos = (await c.h.receipts()).map((r) => r.receiptNo);
        expect(new Set(nos).size).toBe(10);
        await c.assertLedgerConsistent();
      });

      it('12 payments of 1,000 at once on 10,000 → exactly 10 succeed, 2 are refused, nothing is over-collected', async () => {
        await c.seed(inst('i1', R(10_000)));
        const r = await settle(
          Array.from({ length: 12 }, (_, i) => c.svc.post(c.cmd(i, R(1_000)))),
        );
        expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(10);
        expect(
          r
            .filter((x) => x.status === 'rejected')
            .map(codeOf)
            .every((code) =>
              ['NO_PAYABLE_RECEIVABLES', 'PAYMENT_EXCEEDS_OUTSTANDING'].includes(code),
            ),
        ).toBe(true);
        expect((await c.h.receivable('i1')).paid).toBe(R(10_000));
        await c.assertLedgerConsistent();
      });

      it('payments for DIFFERENT students run side by side', async () => {
        await c.seed(
          inst('a1', R(1_000), '2026-07-10', { student: 'stu-A' }),
          inst('b1', R(1_000), '2026-07-10', { student: 'stu-B' }),
        );
        const [a, b] = await Promise.all([
          c.svc.post(c.cmd(1, R(500), { studentId: 'stu-A' })),
          c.svc.post(c.cmd(2, R(500), { studentId: 'stu-B' })),
        ]);
        expect(new Set([a.receiptNo, b.receiptNo]).size).toBe(2);
        await c.assertLedgerConsistent();
      });

      it('STRESS: 40 concurrent random payments over 3 students never break an invariant', async () => {
        const students = ['s1', 's2', 's3'];
        for (const s of students)
          await c.seed(
            inst(`${s}-i1`, R(20_000), '2026-04-10', { student: s }),
            inst(`${s}-i2`, R(20_000), '2026-07-10', { student: s, no: 2 }),
          );
        let x = 12345;
        const rnd = (n: number): number => ((x = (x * 1103515245 + 12345) & 0x7fffffff) % n) + 1;
        const results = await settle(
          Array.from({ length: 40 }, (_, i) =>
            c.svc.post(c.cmd(i, R(rnd(3_000)), { studentId: students[i % 3] as string })),
          ),
        );
        const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
          payment: { amount: number };
        }>[];
        expect(ok.length).toBeGreaterThan(0);
        const collected = ok.reduce((s, r) => s + r.value.payment.amount, 0);
        expect((await c.h.allReceivables()).reduce((s, r) => s + r.paid, 0)).toBe(collected);
        results
          .filter((r) => r.status === 'rejected')
          .forEach((r) =>
            expect(['PAYMENT_EXCEEDS_OUTSTANDING', 'NO_PAYABLE_RECEIVABLES']).toContain(codeOf(r)),
          );
        await c.assertLedgerConsistent();
      });
    });

    describe('PAYMENT REVERSAL (BRC-E6)', () => {
      it('creates compensating entries; the original payment and allocations are never edited or deleted', async () => {
        await c.seed(inst('i1', R(1_000)), inst('i2', R(1_000), '2026-10-10', { no: 2 }));
        const paid = await c.svc.post(c.cmd(1, R(1_500)));
        const before = await c.h.allocations();
        const res = await c.svc.reverse({
          paymentId: paid.payment.id,
          reason: 'Collected against the wrong student',
          requestedBy: 'acct-1',
          reversalDate: '2026-10-09',
        });
        const after = await c.h.allocations();
        expect(after.filter((a) => a.kind === 'ALLOCATION')).toEqual(before);
        expect(
          after
            .filter((a) => a.kind === 'REVERSAL')
            .map((a) => [a.amount, a.postingDate])
            .sort(),
        ).toEqual(
          [
            [-R(1_000), '2026-10-09'],
            [-R(500), '2026-10-09'],
          ].sort(),
        );
        expect(await c.h.receivable('i1')).toMatchObject({
          paid: 0,
          pending: R(1_000),
          paymentStatus: 'UNPAID',
        });
        expect(await c.h.receivable('i2')).toMatchObject({ paid: 0, pending: R(1_000) });
        expect((await c.h.payments())[0]).toMatchObject({
          status: 'REVERSED',
          amount: R(1_500),
          reversalId: res.reversal.id,
        });
        expect(res.report).toEqual({
          originalPaymentDate: '2026-10-08',
          originalAmount: R(1_500),
          reversalDate: '2026-10-09',
          reversedAmount: R(1_500),
          reason: 'Collected against the wrong student',
          authorizedBy: 'acct-1',
          receiptNo: 'REC-2026-000001',
        });
        await c.assertLedgerConsistent();
      });

      it('the receipt is cancelled and its number is preserved and never reused', async () => {
        await c.seed(inst('i1', R(1_000)));
        const p1 = await c.svc.post(c.cmd(1, R(100)));
        await c.svc.reverse({
          paymentId: p1.payment.id,
          reason: 'Cheque bounced',
          requestedBy: 'acct-1',
        });
        expect((await c.h.receipts())[0]).toMatchObject({
          receiptNo: 'REC-2026-000001',
          status: 'CANCELLED',
          cancellation: { by: 'acct-1', reason: 'Cheque bounced' },
        });
        expect((await c.svc.post(c.cmd(2, R(100)))).receiptNo).toBe('REC-2026-000002');
        const actions = (await c.h.audit()).map((a) => a.action);
        expect(actions).toContain('PAYMENT_REVERSED');
        expect(actions).toContain('RECEIPT_CANCELLED');
        expect((await c.h.audit()).find((a) => a.action === 'PAYMENT_REVERSED')?.reason).toBe(
          'Cheque bounced',
        );
      });

      it('a reason is mandatory; unknown payments are refused', async () => {
        await c.seed(inst('i1', R(1_000)));
        const p = await c.svc.post(c.cmd(1, R(100)));
        expect(
          codeOf(
            (
              await settle([
                c.svc.reverse({ paymentId: p.payment.id, reason: ' ', requestedBy: 'a' }),
              ])
            )[0] as PromiseSettledResult<unknown>,
          ),
        ).toBe('REVERSAL_REASON_REQUIRED');
        expect(
          codeOf(
            (
              await settle([
                c.svc.reverse({ paymentId: c.h.newId(), reason: 'valid reason', requestedBy: 'a' }),
              ])
            )[0] as PromiseSettledResult<unknown>,
          ),
        ).toBe('PAYMENT_NOT_FOUND');
        expect((await c.h.payments())[0]?.status).toBe('POSTED');
      });

      it('a payment can be reversed only once — also when two people click at the same time', async () => {
        await c.seed(inst('i1', R(1_000)));
        const p = await c.svc.post(c.cmd(1, R(100)));
        const r = await settle([
          c.svc.reverse({ paymentId: p.payment.id, reason: 'first request', requestedBy: 'a1' }),
          c.svc.reverse({ paymentId: p.payment.id, reason: 'second request', requestedBy: 'a2' }),
        ]);
        expect(r.map(codeOf).sort()).toEqual(['OK', 'PAYMENT_ALREADY_REVERSED']);
        expect(await c.h.reversals()).toHaveLength(1);
        expect((await c.h.receivable('i1')).paid).toBe(0); // reversed once, not twice
        await c.assertLedgerConsistent();
      });

      it('second-level approval is driven by a configurable threshold — none by default', async () => {
        await c.seed(inst('i1', R(100_000)));
        const big = await c.svc.post(c.cmd(1, R(60_000)));
        const small = await c.svc.post(c.cmd(2, R(100)));
        await c.svc.reverse({
          paymentId: small.payment.id,
          reason: 'small mistake',
          requestedBy: 'acct-1',
        }); // default: no threshold → no approval

        c.cfg.reversalApprovalThresholdPaise = R(50_000);
        const attempt = (extra: Partial<Parameters<PaymentPostingService['reverse']>[0]> = {}) =>
          settle([
            c.svc.reverse({
              paymentId: big.payment.id,
              reason: 'high value',
              requestedBy: 'acct-1',
              ...extra,
            }),
          ]).then((r) => codeOf(r[0] as PromiseSettledResult<unknown>));
        expect(await attempt()).toBe('REVERSAL_APPROVAL_REQUIRED');
        expect(await attempt({ approver: { id: 'acct-1', hasPermission: true } })).toBe(
          'REVERSAL_APPROVER_INVALID',
        );
        expect(await attempt({ approver: { id: 'admin-1', hasPermission: false } })).toBe(
          'REVERSAL_APPROVER_INVALID',
        );
        expect((await c.h.payments()).find((p) => p.id === big.payment.id)?.status).toBe('POSTED');

        const ok = await c.svc.reverse({
          paymentId: big.payment.id,
          reason: 'high value',
          requestedBy: 'acct-1',
          approver: { id: 'admin-1', hasPermission: true },
        });
        expect(ok.reversal).toMatchObject({
          requestedBy: 'acct-1',
          approvedBy: 'admin-1',
          authorizedBy: 'admin-1',
        });
        expect(ok.report.authorizedBy).toBe('admin-1');
        await c.assertLedgerConsistent();
      });

      it('below the threshold no approval is needed', async () => {
        c.cfg.reversalApprovalThresholdPaise = R(50_000);
        await c.seed(inst('i1', R(100_000)));
        const p = await c.svc.post(c.cmd(1, R(49_999)));
        await expect(
          c.svc.reverse({
            paymentId: p.payment.id,
            reason: 'below the limit',
            requestedBy: 'acct-1',
          }),
        ).resolves.toBeDefined();
      });

      it('reversal after later payments only undoes its own money', async () => {
        await c.seed(inst('i1', R(1_000)));
        const a = await c.svc.post(c.cmd(1, R(300)));
        await c.svc.post(c.cmd(2, R(200)));
        await c.svc.reverse({
          paymentId: a.payment.id,
          reason: 'first was a mistake',
          requestedBy: 'acct-1',
        });
        expect(await c.h.receivable('i1')).toMatchObject({
          paid: R(200),
          pending: R(800),
          paymentStatus: 'PARTIAL',
        });
        await c.assertLedgerConsistent();
      });
    });
  });
}
