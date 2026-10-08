import { Query } from 'mingo';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import * as M from './models';
import { MODEL_DEFS } from './schema-helpers';
import { ALLOCATION_VALIDATOR, PAYMENT_VALIDATOR, RECEIVABLE_VALIDATOR } from './validators';
import { mk, R } from '../testing/fixtures';

/**
 * SCHEMA CONTRACT TESTS — run without a database. They pin down the constraints that protect the money:
 * if someone removes a unique/partial index or a validator, CI fails.
 */
const defOf = (collection: string) => MODEL_DEFS.find((d) => d.collection === collection)!;
const idx = (collection: string) =>
  (defOf(collection).indexes ?? []).map(([keys, opts]) => ({ keys, opts: opts ?? {} }));
const find = (
  collection: string,
  keys: Record<string, number>,
  pick: (o: Record<string, unknown>) => boolean = () => true,
) =>
  idx(collection).find(
    (i) =>
      JSON.stringify(i.keys) === JSON.stringify(keys) && pick(i.opts as Record<string, unknown>),
  );

describe('collections', () => {
  it('registers all 41 collections once', () => {
    expect(MODEL_DEFS).toHaveLength(41);
    expect(new Set(MODEL_DEFS.map((d) => d.collection)).size).toBe(41);
    expect(new Set(MODEL_DEFS.map((d) => d.name)).size).toBe(41);
    expect(Object.keys(M).filter((k) => /^[A-Z]/.test(k)).length).toBeGreaterThanOrEqual(41);
  });
  it('every business collection is tenant-scoped (institutionId) except platform singletons', () => {
    const exempt = new Set(['institutions', 'counters']);
    for (const def of MODEL_DEFS) {
      if (exempt.has(def.collection)) continue;
      expect(Object.keys(def.fields), def.collection).toContain('institutionId');
    }
  });
  it('indexes are never created implicitly (autoIndex off everywhere)', () => {
    for (const name of mongoose.modelNames())
      expect(mongoose.model(name).schema.get('autoIndex'), name).toBe(false);
  });
  it('mongoose does not add a __v field (we own `version`)', () => {
    for (const name of mongoose.modelNames())
      expect(mongoose.model(name).schema.get('versionKey'), name).toBe(false);
  });
});

describe('uniqueness constraints that prevent duplicates', () => {
  const unique = (
    collection: string,
    keys: Record<string, number>,
    partial?: Record<string, unknown>,
  ) => {
    const hit = find(collection, keys);
    expect(hit, `${collection} ${JSON.stringify(keys)}`).toBeDefined();
    expect((hit!.opts as { unique?: boolean }).unique).toBe(true);
    if (partial)
      expect((hit!.opts as { partialFilterExpression?: unknown }).partialFilterExpression).toEqual(
        partial,
      );
  };
  it('duplicate payments / transaction numbers / transaction references', () => {
    unique('payments', { institutionId: 1, idempotencyKey: 1 });
    unique('payments', { institutionId: 1, paymentNo: 1 });
    unique(
      'payments',
      { institutionId: 1, uniqueRefKey: 1 },
      { uniqueRefKey: { $type: 'string' } },
    );
  });
  it('duplicate receipts / receipt numbers; one receipt per payment', () => {
    unique('receipts', { institutionId: 1, receiptNo: 1 });
    unique('receipts', { paymentId: 1 });
  });
  it('a payment is reversed at most once; an allocation is reversed at most once', () => {
    unique('payment_reversals', { paymentId: 1 });
    unique(
      'payment_allocations',
      { reversesAllocationId: 1 },
      { reversesAllocationId: { $type: 'objectId' } },
    );
  });
  it('duplicate installments / opening-balance receivables / penalties (dedupeKey)', () => {
    unique('receivables', { institutionId: 1, dedupeKey: 1 });
  });
  it('duplicate opening balance for a student-year (only ACTIVE counts)', () => {
    unique('opening_balances', { studentId: 1, academicYearId: 1 }, { status: 'ACTIVE' });
  });
  it('duplicate fee assignment for a student-year (only ACTIVE counts)', () => {
    unique('fee_assignments', { studentId: 1, academicYearId: 1 }, { status: 'ACTIVE' });
  });
  it('duplicate enrollment: one CURRENT enrollment per student per academic year', () => {
    unique('student_enrollments', { studentId: 1, academicYearId: 1 }, { isCurrent: true });
  });
  it('duplicate student identifiers', () => {
    unique('students', { institutionId: 1, studentId: 1 });
    unique('students', { institutionId: 1, admissionNo: 1 });
  });
  it('BRC-B6: ONE current class teacher per division; a teacher is NOT limited to one division', () => {
    unique('teacher_assignments', { divisionId: 1, role: 1 }, { isCurrent: true });
    const all = idx('teacher_assignments');
    const teacherUnique = all.find(
      (i) => (i.opts as { unique?: boolean }).unique && 'teacherId' in i.keys,
    );
    expect(
      teacherUnique,
      'a unique index on teacherId would forbid multiple divisions per teacher',
    ).toBeUndefined();
  });
  it('fee structure slot is unique per year/class/division/category; versions are unique per structure', () => {
    unique('fee_structures', {
      institutionId: 1,
      academicYearId: 1,
      classId: 1,
      divisionId: 1,
      categoryId: 1,
    });
    unique('fee_structure_versions', { structureId: 1, versionNo: 1 });
  });
  it('exactly one current academic year', () => {
    unique('academic_years', { institutionId: 1 }, { isCurrent: true });
    unique('academic_years', { institutionId: 1, label: 1 });
  });
  it('reminders cannot be duplicated by a double-running scanner', () => {
    unique('reminders', { institutionId: 1, dedupeKey: 1 });
  });
  it('idempotency keys are unique per user + route', () => {
    unique('idempotency_keys', { institutionId: 1, userId: 1, route: 1, key: 1 });
  });
  it('import rows are unique per batch', () => {
    unique('import_rows', { batchId: 1, rowNo: 1 });
  });
});

describe('index coverage for the hot paths', () => {
  it('overdue / reminder scans use a partial index on pending receivables', () => {
    expect(find('receivables', { institutionId: 1, dueDate: 1 })?.opts).toMatchObject({
      partialFilterExpression: { pending: { $gt: 0 } },
    });
  });
  it('student 360 and collection screens', () => {
    expect(
      find('receivables', { studentId: 1, academicYearId: 1, paymentStatus: 1, dueDate: 1 }),
    ).toBeDefined();
    expect(find('payments', { studentId: 1, paymentDate: -1 })).toBeDefined();
    expect(find('payment_allocations', { receivableId: 1 })).toBeDefined();
  });
  it('class / division / date reporting', () => {
    expect(
      find('receivables', {
        institutionId: 1,
        academicYearId: 1,
        classId: 1,
        divisionId: 1,
        paymentStatus: 1,
      }),
    ).toBeDefined();
    expect(
      find('payment_allocations', { institutionId: 1, postingDate: 1, classId: 1, divisionId: 1 }),
    ).toBeDefined();
    expect(find('payments', { institutionId: 1, paymentDate: 1, collectedBy: 1 })).toBeDefined();
  });
  it('audit log timelines per entity, student, user and action', () => {
    const wanted: Record<string, number>[] = [
      { entityType: 1, entityId: 1, at: -1 },
      { userId: 1, at: -1 },
      { action: 1, at: -1 },
    ];
    for (const keys of wanted) expect(find('audit_logs', keys)).toBeDefined();
  });
  it('TTL indexes exist for sessions and idempotency keys', () => {
    expect(find('sessions', { expiresAt: 1 })?.opts).toMatchObject({ expireAfterSeconds: 0 });
    expect(find('idempotency_keys', { createdAt: 1 })?.opts).toMatchObject({
      expireAfterSeconds: 172_800,
    });
  });
});

describe('schema-level money validation', () => {
  const validate = async (doc: mongoose.Document): Promise<string[]> => {
    try {
      await doc.validate();
      return [];
    } catch (e) {
      return Object.keys((e as mongoose.Error.ValidationError).errors ?? {});
    }
  };
  it('payments reject fractional paise and zero/negative amounts', async () => {
    const base = {
      institutionId: new mongoose.Types.ObjectId(),
      paymentNo: 'PAY-1',
      studentId: new mongoose.Types.ObjectId(),
      amount: 100,
      allocatedAmount: 100,
      unallocatedAmount: 0,
      method: 'CASH',
      paymentDate: '2026-10-08',
      receivedAt: new Date(),
      collectedBy: new mongoose.Types.ObjectId(),
      allocationStrategy: 'OLDEST_DUE_FIRST',
      idempotencyKey: 'k',
      requestHash: 'h',
      receiptNo: 'REC-1',
    };
    expect(await validate(new M.Payment(base))).toEqual([]);
    expect(await validate(new M.Payment({ ...base, amount: 10.5 }))).toContain('amount');
    expect(await validate(new M.Payment({ ...base, amount: -5 }))).toContain('amount');
    expect(await validate(new M.Payment({ ...base, paymentDate: '08/10/2026' }))).toContain(
      'paymentDate',
    );
  });
  it('opening balance amount must be a positive whole number of paise', async () => {
    const base = {
      institutionId: new mongoose.Types.ObjectId(),
      studentId: new mongoose.Types.ObjectId(),
      academicYearId: new mongoose.Types.ObjectId(),
      amount: 100,
      effectiveDate: '2026-04-01',
      dueDate: '2026-04-01',
      source: 'MIGRATION',
      reason: 'x',
      receivableId: new mongoose.Types.ObjectId(),
    };
    expect(await validate(new M.OpeningBalance(base))).toEqual([]);
    expect(await validate(new M.OpeningBalance({ ...base, amount: 1.5 }))).toContain('amount');
    expect(await validate(new M.OpeningBalance({ ...base, source: 'AUTOMATIC' }))).toContain(
      'source',
    );
  });
  it('a student needs at least one guardian; enums are enforced', async () => {
    const base = {
      institutionId: new mongoose.Types.ObjectId(),
      studentId: 'S1',
      admissionNo: 'A1',
      firstName: 'Rahul',
      fullName: 'Rahul Sharma',
      dob: '2015-05-03',
      gender: 'MALE',
      categoryId: new mongoose.Types.ObjectId(),
      admissionDate: '2026-04-01',
    };
    expect(await validate(new M.Student({ ...base, guardians: [] }))).toContain('guardians');
    expect(
      await validate(
        new M.Student({
          ...base,
          guardians: [{ relation: 'Father', name: 'A', mobile: '9' }],
          status: 'GONE',
        }),
      ),
    ).toContain('status');
    expect(
      await validate(
        new M.Student({ ...base, guardians: [{ relation: 'Father', name: 'A', mobile: '9' }] }),
      ),
    ).toEqual([]);
  });
});

/* ------- DB-level $expr validators, evaluated with mingo against engine-produced documents ------- */
const valid = (validator: object, doc: object): boolean =>
  new Query(validator as never).test(doc as never);

describe('MongoDB collection validators (the database refuses broken arithmetic)', () => {
  const ok = mk({ id: 'a', no: 1, due: '2026-04-10', comps: { TUITION: R(100), LAB: R(50) } });
  it('accepts a healthy receivable', () => {
    expect(valid(RECEIVABLE_VALIDATOR, ok)).toBe(true);
  });
  it('accepts a partly paid + adjusted receivable', () => {
    const c = ok.components.map((x, i) => (i === 0 ? { ...x, paid: R(40), adjusted: R(10) } : x));
    expect(
      valid(RECEIVABLE_VALIDATOR, {
        ...ok,
        components: c,
        paid: R(40),
        adjusted: R(10),
        pending: R(100),
      }),
    ).toBe(true);
  });
  it('rejects: pending ≠ payable − adjusted − transferred − paid', () => {
    expect(valid(RECEIVABLE_VALIDATOR, { ...ok, pending: ok.pending - 1 })).toBe(false);
  });
  it('rejects: over-payment (paid > payable)', () => {
    const c = ok.components.map((x, i) => (i === 0 ? { ...x, paid: R(101) } : x));
    expect(
      valid(RECEIVABLE_VALIDATOR, {
        ...ok,
        components: c,
        paid: R(101),
        pending: ok.payable - R(101),
      }),
    ).toBe(false);
  });
  it('rejects: aggregates that differ from the components, negative values', () => {
    expect(
      valid(RECEIVABLE_VALIDATOR, { ...ok, payable: ok.payable + 1, pending: ok.pending + 1 }),
    ).toBe(false);
    expect(valid(RECEIVABLE_VALIDATOR, { ...ok, paid: -1 })).toBe(false);
  });
  it('rejects: a single component over-paid even if the totals look fine', () => {
    const c = [
      { ...ok.components[0]!, paid: R(120) },
      { ...ok.components[1]!, adjusted: 0, paid: 0 },
    ];
    expect(
      valid(RECEIVABLE_VALIDATOR, {
        ...ok,
        components: c,
        paid: R(120),
        pending: ok.payable - R(120),
      }),
    ).toBe(false);
  });
  it('payments: amount = allocated + unallocated and > 0', () => {
    expect(
      valid(PAYMENT_VALIDATOR, { amount: 100, allocatedAmount: 100, unallocatedAmount: 0 }),
    ).toBe(true);
    expect(
      valid(PAYMENT_VALIDATOR, { amount: 100, allocatedAmount: 60, unallocatedAmount: 40 }),
    ).toBe(true);
    expect(
      valid(PAYMENT_VALIDATOR, { amount: 100, allocatedAmount: 60, unallocatedAmount: 30 }),
    ).toBe(false);
    expect(valid(PAYMENT_VALIDATOR, { amount: 0, allocatedAmount: 0, unallocatedAmount: 0 })).toBe(
      false,
    );
  });
  it('allocations: payments are positive rows, reversals negative rows, component split adds up', () => {
    expect(
      valid(ALLOCATION_VALIDATOR, {
        kind: 'ALLOCATION',
        amount: 100,
        componentSplit: [{ amount: 60 }, { amount: 40 }],
      }),
    ).toBe(true);
    expect(
      valid(ALLOCATION_VALIDATOR, {
        kind: 'REVERSAL',
        amount: -100,
        componentSplit: [{ amount: -100 }],
      }),
    ).toBe(true);
    expect(
      valid(ALLOCATION_VALIDATOR, {
        kind: 'ALLOCATION',
        amount: -100,
        componentSplit: [{ amount: -100 }],
      }),
    ).toBe(false);
    expect(
      valid(ALLOCATION_VALIDATOR, {
        kind: 'REVERSAL',
        amount: 100,
        componentSplit: [{ amount: 100 }],
      }),
    ).toBe(false);
    expect(
      valid(ALLOCATION_VALIDATOR, {
        kind: 'ALLOCATION',
        amount: 100,
        componentSplit: [{ amount: 60 }],
      }),
    ).toBe(false);
    expect(valid(ALLOCATION_VALIDATOR, { kind: 'ALLOCATION', amount: 0, componentSplit: [] })).toBe(
      false,
    );
  });
  it('validators are attached to the right collections', () => {
    expect(defOf('receivables').validator).toBe(RECEIVABLE_VALIDATOR);
    expect(defOf('payments').validator).toBe(PAYMENT_VALIDATOR);
    expect(defOf('payment_allocations').validator).toBe(ALLOCATION_VALIDATOR);
    expect(defOf('opening_balances').validator).toBeDefined();
  });
});
