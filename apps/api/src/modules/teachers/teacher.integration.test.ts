import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../../db/connection';
import { up } from '../../db/migrations/001-initial';
import { seedIdentity } from '../../db/seed';
import type { TeacherAssignment } from '../../domain/academic/teacher-assignment';
import { testHasher } from '../../testing/auth-harness';
import { MongoClassRepo, MongoDivisionRepo } from '../academic/mongo-repos';
import { MongoYearRepo } from '../setup/mongo-repos';
import { MongoAssignmentRepo, MongoTeacherRepo } from './mongo-repos';
import { DivisionAlreadyAssignedError, DuplicateStaffIdError } from './ports';

/** REAL MongoDB tests for teachers and class-teacher assignments (needs MONGO_URI → a TEST database). */
const uri = process.env.MONGO_URI;
const CLEAR = [
  'users',
  'roles',
  'sessions',
  'audit_logs',
  'academic_years',
  'classes',
  'divisions',
  'teachers',
  'teacher_assignments',
  'counters',
];
const oidHex = () => new mongoose.Types.ObjectId().toHexString();

describe.skipIf(!uri)('MongoDB integration — teachers', () => {
  let institutionId: string;
  let teachers: MongoTeacherRepo;
  let assignments: MongoAssignmentRepo;
  let ids: { year: string; cls: string; divA: string; divB: string };
  const c = () => mongoose.connection;

  beforeAll(async () => {
    await connectMongo(uri as string);
    await up(mongoose.connection);
  }, 120_000);
  afterAll(async () => {
    for (const n of CLEAR) await c().collection(n).deleteMany({});
    await disconnectMongo();
  });
  beforeEach(async () => {
    for (const n of CLEAR) await c().collection(n).deleteMany({});
    institutionId = (
      await seedIdentity(c(), {
        adminEmail: 'boss@school.test',
        adminPassword: 'Violet-Lamp-2026!',
        hasher: testHasher(),
      })
    ).institutionId;
    teachers = new MongoTeacherRepo(c(), institutionId);
    assignments = new MongoAssignmentRepo(c(), institutionId);
    const year = await new MongoYearRepo(c(), institutionId).create({
      label: '2026-27',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
    });
    const cls = await new MongoClassRepo(c(), institutionId).create({
      code: '5',
      name: 'Class 5',
      sequence: 1,
      isActive: true,
      isFinal: false,
    });
    const divisions = new MongoDivisionRepo(c(), institutionId);
    const mk = (name: string) =>
      divisions.create({ academicYearId: year.id, classId: cls.id, name, isActive: true });
    ids = { year: year.id, cls: cls.id, divA: (await mk('A')).id, divB: (await mk('B')).id };
  });

  const mkTeacher = async (n: number) =>
    teachers.create({
      teacherCode: await teachers.nextCode(),
      staffId: `EMP-${n}`,
      fullName: `Teacher ${n}`,
      mobile: `98765432${10 + n}`,
      joiningDate: '2020-06-01',
    });
  const row = (divisionId: string, teacherId: string, from = '2026-04-01'): TeacherAssignment => ({
    id: oidHex(),
    academicYearId: ids.year,
    classId: ids.cls,
    divisionId,
    teacherId,
    role: 'CLASS_TEACHER',
    effectiveFrom: from,
    effectiveTo: null,
    isCurrent: true,
  });

  it('teacher codes come from an atomic counter; staff id is unique; search and clearing work', async () => {
    const codes = await Promise.all([1, 2, 3, 4, 5].map(() => teachers.nextCode()));
    expect(new Set(codes).size).toBe(5);
    const t = await mkTeacher(1);
    expect(t.teacherCode).toMatch(/^TCH-\d{6}$/);
    await expect(mkTeacher(1)).rejects.toBeInstanceOf(DuplicateStaffIdError);
    const two = await mkTeacher(2);
    await expect(teachers.update(two.id, { staffId: 'EMP-1' })).rejects.toBeInstanceOf(
      DuplicateStaffIdError,
    );
    await teachers.update(t.id, { email: 'a@school.test', fullName: 'Zed Person' });
    expect((await teachers.update(t.id, { email: undefined }))?.email).toBeUndefined();
    expect((await teachers.list({ q: 'zed' })).map((x) => x.id)).toEqual([t.id]);
    expect((await teachers.list({ q: 'EMP-2' })).map((x) => x.id)).toEqual([two.id]);
    expect(await teachers.list({ status: 'LEFT' })).toHaveLength(0);
  });

  it('the database allows only ONE current class teacher per division, even under a race', async () => {
    const ts = await Promise.all([1, 2, 3, 4].map(mkTeacher));
    const results = await Promise.allSettled(
      ts.map((t) => assignments.create(row(ids.divA, t.id))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected'))
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(DivisionAlreadyAssignedError);
    expect(await assignments.list({ divisionId: ids.divA, currentOnly: true })).toHaveLength(1);
  });

  it('one teacher can hold several divisions', async () => {
    const t = await mkTeacher(1);
    await assignments.create(row(ids.divA, t.id));
    await assignments.create(row(ids.divB, t.id));
    expect(await assignments.list({ teacherId: t.id, currentOnly: true })).toHaveLength(2);
  });

  it('change is one transaction: old row closed + new row opened, history kept', async () => {
    const [t1, t2] = [await mkTeacher(1), await mkTeacher(2)];
    const first = await assignments.create(row(ids.divA, t1.id));
    const next = {
      ...row(ids.divA, t2.id, '2026-10-01'),
      replacesAssignmentId: first.id,
      reason: 'Swap',
    };
    await assignments.change(
      { id: first.id, effectiveTo: '2026-09-30', isCurrent: false, endReason: 'CHANGED' },
      next,
    );
    const all = await assignments.list({ divisionId: ids.divA });
    expect(all).toHaveLength(2);
    expect(all.find((a) => a.id === first.id)).toMatchObject({
      isCurrent: false,
      effectiveTo: '2026-09-30',
      endReason: 'CHANGED',
    });
    expect(all.find((a) => a.id === next.id)).toMatchObject({
      isCurrent: true,
      replacesAssignmentId: first.id,
      reason: 'Swap',
    });
  });

  it('a failed change rolls back: the old row stays current', async () => {
    const [t1, t2] = [await mkTeacher(1), await mkTeacher(2)];
    const first = await assignments.create(row(ids.divA, t1.id));
    const broken = { ...row(ids.divA, t2.id, '2026-10-01'), id: first.id }; // duplicate _id
    await expect(
      assignments.change(
        { id: first.id, effectiveTo: '2026-09-30', isCurrent: false, endReason: 'CHANGED' },
        broken,
      ),
    ).rejects.toBeDefined();
    expect(await assignments.findById(first.id)).toMatchObject({
      isCurrent: true,
      effectiveTo: null,
    });
  });

  it('two people changing the same assignment: the second is told, nothing is duplicated', async () => {
    const [t1, t2, t3] = [await mkTeacher(1), await mkTeacher(2), await mkTeacher(3)];
    const first = await assignments.create(row(ids.divA, t1.id));
    const close = {
      id: first.id,
      effectiveTo: '2026-09-30',
      isCurrent: false as const,
      endReason: 'CHANGED' as const,
    };
    const results = await Promise.allSettled([
      assignments.change(close, row(ids.divA, t2.id, '2026-10-01')),
      assignments.change(close, row(ids.divA, t3.id, '2026-10-01')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await assignments.list({ divisionId: ids.divA, currentOnly: true })).toHaveLength(1);
  });

  it('end closes without deleting; ending twice is refused', async () => {
    const t = await mkTeacher(1);
    const a = await assignments.create(row(ids.divA, t.id));
    const close = {
      id: a.id,
      effectiveTo: '2026-08-31',
      isCurrent: false as const,
      endReason: 'LEFT_INSTITUTION' as const,
    };
    await assignments.end(close);
    expect(await assignments.findById(a.id)).toMatchObject({
      isCurrent: false,
      effectiveTo: '2026-08-31',
    });
    await expect(assignments.end(close)).rejects.toBeInstanceOf(DivisionAlreadyAssignedError);
  });
});
