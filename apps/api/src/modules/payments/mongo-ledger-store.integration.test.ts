import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../../db/connection';
import { up } from '../../db/migrations/001-initial';
import * as M from '../../db/models';
import type { Receivable } from '../../domain/finance';
import type { LedgerHarness } from '../../testing/ledger-harness';
import { symbolicCodec } from './id-codec';
import { MongoLedgerStore } from './mongo-ledger-store';
import { makeMappers } from './mongo-mappers';
import { postingScenarios } from './payment-posting.scenarios';

/**
 * REAL MongoDB integration tests — require a replica set:  MONGO_URI=mongodb://localhost:27017/sfm_test?replicaSet=rs0
 * (CI provides one; locally: `docker compose -f ops/docker/compose.dev.yml up -d mongo`). Skipped when MONGO_URI is unset.
 * ⚠ They have never been executed in the authoring sandbox (no MongoDB available there) — CI is the first run.
 */
const uri = process.env.MONGO_URI;
const oid = (): mongoose.Types.ObjectId => new mongoose.Types.ObjectId();
const COLLECTIONS_TO_CLEAR = [
  'payments',
  'receivables',
  'payment_allocations',
  'receipts',
  'payment_reversals',
  'audit_logs',
  'counters',
];

async function clear(): Promise<void> {
  for (const c of COLLECTIONS_TO_CLEAR) await mongoose.connection.collection(c).deleteMany({});
}

async function mongoHarness(): Promise<LedgerHarness> {
  await clear();
  const codec = symbolicCodec();
  const institutionId = oid();
  const mapper = makeMappers(codec);
  const toDoc = (r: Receivable) => ({
    _id: codec.toDb(r.id),
    institutionId,
    studentId: codec.toDb(r.studentId),
    academicYearId: codec.toDb(r.academicYearId),
    kind: r.kind,
    sourceType: 'MANUAL',
    sourceId: r.id,
    ...(r.installmentNo ? { installmentNo: r.installmentNo } : {}),
    label: r.label,
    dueDate: r.dueDate,
    originalDueDate: r.originalDueDate,
    components: r.components,
    payable: r.payable,
    adjusted: r.adjusted,
    transferred: r.transferred,
    paid: r.paid,
    pending: r.pending,
    paymentStatus: r.paymentStatus,
    hasPendingAdjustment: r.hasPendingAdjustment,
    dedupeKey: r.dedupeKey,
    version: r.version,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const all = async (model: string, sort: Record<string, 1 | -1> = { _id: 1 }) =>
    mongoose.model(model).find({}).sort(sort).lean();
  return {
    store: new MongoLedgerStore(mongoose.connection, institutionId.toHexString(), codec),
    newId: () => oid().toHexString(),
    seed: async (rs) => {
      await mongoose.connection.collection('receivables').insertMany(rs.map(toDoc)); // goes through the DB validator
    },
    receivable: async (id) =>
      mapper.receivable(
        await mongoose.connection.collection('receivables').findOne({ _id: codec.toDb(id) }),
      ),
    allReceivables: async () => (await all('Receivable')).map(mapper.receivable),
    payments: async () => (await all('Payment')).map(mapper.payment),
    allocations: async () => (await all('PaymentAllocation')).map(mapper.allocation),
    receipts: async () => (await all('Receipt')).map(mapper.receipt),
    reversals: async () => (await all('PaymentReversal')).map(mapper.reversal),
    audit: async () => (await all('AuditLog')).map(mapper.audit),
  };
}

describe.skipIf(!uri)('MongoDB integration', () => {
  beforeAll(async () => {
    await connectMongo(uri as string);
    await up(mongoose.connection); // collections + validators + indexes, exactly as production
  }, 60_000);
  afterAll(async () => {
    await disconnectMongo();
  });

  // the very same scenarios as the in-memory model
  postingScenarios('real MongoDB', mongoHarness);

  describe('migration', () => {
    it('is idempotent and creates all 41 collections with their indexes', async () => {
      const r = await up(mongoose.connection);
      expect(r.collections).toBe(41);
      const names = new Set((await mongoose.connection.listCollections()).map((c) => c.name));
      for (const c of [
        'receivables',
        'payments',
        'payment_allocations',
        'receipts',
        'teacher_assignments',
        'audit_logs',
      ])
        expect(names.has(c)).toBe(true);
      const idx = (await mongoose.connection.collection('receivables').indexes()).map(
        (i) => i.name,
      );
      expect(idx).toContain('pending_by_due_date');
    });
  });

  const base = (over: Record<string, unknown> = {}) => ({
    institutionId: oid(),
    studentId: oid(),
    academicYearId: oid(),
    kind: 'INSTALLMENT',
    sourceType: 'MANUAL',
    sourceId: 'x',
    label: 'I1',
    dueDate: '2026-04-10',
    originalDueDate: '2026-04-10',
    components: [
      { code: 'TUITION', name: 'Tuition', payable: 100, adjusted: 0, transferred: 0, paid: 0 },
    ],
    payable: 100,
    adjusted: 0,
    transferred: 0,
    paid: 0,
    pending: 100,
    paymentStatus: 'UNPAID',
    hasPendingAdjustment: false,
    dedupeKey: `k-${oid()}`,
    version: 0,
    ...over,
  });

  describe('database-level validators refuse broken arithmetic', () => {
    const insert = (doc: object) => mongoose.connection.collection('receivables').insertOne(doc);
    it('accepts a consistent receivable', async () => {
      await expect(insert(base())).resolves.toBeDefined();
    });
    it('rejects pending ≠ payable − adjusted − transferred − paid', async () => {
      await expect(insert(base({ pending: 99 }))).rejects.toMatchObject({ code: 121 });
    });
    it('rejects over-payment and aggregates that differ from the components', async () => {
      await expect(
        insert(
          base({
            paid: 150,
            pending: -50,
            components: [
              { code: 'TUITION', name: 'T', payable: 100, adjusted: 0, transferred: 0, paid: 150 },
            ],
          }),
        ),
      ).rejects.toMatchObject({ code: 121 });
      await expect(insert(base({ payable: 101, pending: 101 }))).rejects.toMatchObject({
        code: 121,
      });
    });
    it('rejects an UPDATE that would over-pay a receivable', async () => {
      const doc = base();
      await insert(doc);
      await expect(
        mongoose.connection
          .collection('receivables')
          .updateOne({ dedupeKey: doc.dedupeKey }, { $set: { paid: 200 } }),
      ).rejects.toMatchObject({ code: 121 });
    });
    it('payments and allocations are validated too', async () => {
      const pay = { institutionId: oid(), amount: 100, allocatedAmount: 60, unallocatedAmount: 30 };
      await expect(mongoose.connection.collection('payments').insertOne(pay)).rejects.toMatchObject(
        { code: 121 },
      );
      const alloc = {
        institutionId: oid(),
        kind: 'ALLOCATION',
        amount: -100,
        componentSplit: [{ componentCode: 'T', amount: -100 }],
      };
      await expect(
        mongoose.connection.collection('payment_allocations').insertOne(alloc),
      ).rejects.toMatchObject({ code: 121 });
    });
  });

  describe('unique indexes prevent duplicates', () => {
    const dup = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 11000 });
    const col = (n: string) => mongoose.connection.collection(n);
    it('duplicate receivable (installment / opening balance / penalty) by dedupeKey', async () => {
      const inst = oid();
      await col('receivables').insertOne(
        base({ institutionId: inst, dedupeKey: 'FEE_ASSIGNMENT:a1:1' }),
      );
      await dup(
        col('receivables').insertOne(
          base({ institutionId: inst, dedupeKey: 'FEE_ASSIGNMENT:a1:1' }),
        ),
      );
      await expect(
        col('receivables').insertOne(
          base({ institutionId: inst, dedupeKey: 'FEE_ASSIGNMENT:a1:2' }),
        ),
      ).resolves.toBeDefined();
    });
    it('one CURRENT enrollment per student per year; history rows allowed', async () => {
      const [s, y] = [oid(), oid()];
      const row = (isCurrent: boolean) => ({
        institutionId: oid(),
        studentId: s,
        academicYearId: y,
        isCurrent,
        divisionId: oid(),
      });
      await col('student_enrollments').insertOne(row(true));
      await dup(col('student_enrollments').insertOne(row(true)));
      await expect(col('student_enrollments').insertOne(row(false))).resolves.toBeDefined();
    });
    it('BRC-B6: one current teacher per division, but a teacher may take several divisions', async () => {
      const [t, d1, d2] = [oid(), oid(), oid()];
      const row = (
        divisionId: mongoose.Types.ObjectId,
        teacherId: mongoose.Types.ObjectId,
        isCurrent = true,
      ) => ({ institutionId: oid(), divisionId, teacherId, role: 'CLASS_TEACHER', isCurrent });
      await col('teacher_assignments').insertOne(row(d1, t));
      await expect(col('teacher_assignments').insertOne(row(d2, t))).resolves.toBeDefined(); // same teacher, second division ✔
      await dup(col('teacher_assignments').insertOne(row(d1, oid()))); // second current teacher on d1 ✘
      await expect(
        col('teacher_assignments').insertOne(row(d1, oid(), false)),
      ).resolves.toBeDefined(); // history row ✔
    });
    it('one ACTIVE opening balance and one ACTIVE fee assignment per student-year', async () => {
      const [s, y] = [oid(), oid()];
      const ob = (status: string) => ({
        institutionId: oid(),
        studentId: s,
        academicYearId: y,
        status,
        amount: 1,
      });
      await col('opening_balances').insertOne(ob('ACTIVE'));
      await dup(col('opening_balances').insertOne(ob('ACTIVE')));
      await expect(col('opening_balances').insertOne(ob('REVERSED'))).resolves.toBeDefined();
      const fa = (status: string) => ({
        institutionId: oid(),
        studentId: s,
        academicYearId: y,
        status,
      });
      await col('fee_assignments').insertOne(fa('ACTIVE'));
      await dup(col('fee_assignments').insertOne(fa('ACTIVE')));
      await expect(col('fee_assignments').insertOne(fa('CANCELLED'))).resolves.toBeDefined();
    });
    it('exactly one current academic year', async () => {
      const inst = oid();
      await col('academic_years').insertOne({
        institutionId: inst,
        label: '2026-27',
        isCurrent: true,
      });
      await dup(
        col('academic_years').insertOne({ institutionId: inst, label: '2027-28', isCurrent: true }),
      );
      await expect(
        col('academic_years').insertOne({
          institutionId: inst,
          label: '2025-26',
          isCurrent: false,
        }),
      ).resolves.toBeDefined();
    });
    it('receipt numbers, one receipt per payment, one reversal per payment, transaction references', async () => {
      const inst = oid();
      const pid = oid();
      await col('receipts').insertOne({
        institutionId: inst,
        receiptNo: 'REC-2026-000001',
        paymentId: pid,
      });
      await dup(
        col('receipts').insertOne({
          institutionId: inst,
          receiptNo: 'REC-2026-000001',
          paymentId: oid(),
        }),
      );
      await dup(
        col('receipts').insertOne({
          institutionId: inst,
          receiptNo: 'REC-2026-000002',
          paymentId: pid,
        }),
      );
      await col('payment_reversals').insertOne({ paymentId: pid });
      await dup(col('payment_reversals').insertOne({ paymentId: pid }));
      const pay = (extra: object) => ({
        institutionId: inst,
        amount: 1,
        allocatedAmount: 1,
        unallocatedAmount: 0,
        idempotencyKey: `k-${oid()}`,
        paymentNo: `P-${oid()}`,
        ...extra,
      });
      await col('payments').insertOne(pay({ uniqueRefKey: 'UPI||UTR-1' }));
      await dup(col('payments').insertOne(pay({ uniqueRefKey: 'UPI||UTR-1' })));
      await expect(col('payments').insertOne(pay({}))).resolves.toBeDefined(); // cash: no key
    });
  });

  describe('transactions', () => {
    it('are atomic: work done before a failure is rolled back', async () => {
      await clear();
      const store = new MongoLedgerStore(mongoose.connection, oid().toHexString(), symbolicCodec());
      await expect(
        store.runInTransaction(async (tx) => {
          await tx.insertAudit({
            at: new Date(),
            userId: oid().toHexString(),
            action: 'X',
            entityType: 'x',
            entityId: '1',
          });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await M.AuditLog.countDocuments({})).toBe(0);
    });
    it('sequence counters are atomic even when called in parallel', async () => {
      await clear();
      const store = new MongoLedgerStore(mongoose.connection, oid().toHexString(), symbolicCodec());
      const seqs = await Promise.all(
        Array.from({ length: 20 }, () =>
          store.runInTransaction((tx) => tx.nextSequence('receipt:REC:2026')),
        ),
      );
      expect(new Set(seqs).size).toBe(20);
      expect(Math.max(...seqs)).toBe(20);
    });
  });
});
