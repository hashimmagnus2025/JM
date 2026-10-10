import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../../db/connection';
import { up } from '../../db/migrations/001-initial';
import { seedIdentity } from '../../db/seed';
import { testHasher } from '../../testing/auth-harness';
import { DuplicateCodeError } from '../setup/ports';
import { MongoYearRepo } from '../setup/mongo-repos';
import { MongoClassRepo, MongoDivisionRepo } from './mongo-repos';
import { DuplicateDivisionError } from './ports';

/** REAL MongoDB tests for classes and divisions (needs MONGO_URI → a TEST database; data is deleted). */
const uri = process.env.MONGO_URI;
const CLEAR = [
  'users',
  'roles',
  'sessions',
  'audit_logs',
  'academic_years',
  'classes',
  'divisions',
];

describe.skipIf(!uri)('MongoDB integration — classes and divisions', () => {
  let institutionId: string;
  let classes: MongoClassRepo;
  let divisions: MongoDivisionRepo;
  let yearId: string;
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
    classes = new MongoClassRepo(c(), institutionId);
    divisions = new MongoDivisionRepo(c(), institutionId);
    yearId = (
      await new MongoYearRepo(c(), institutionId).create({
        label: '2026-27',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
      })
    ).id;
  });

  const mk = (code: string, sequence: number) =>
    classes.create({ code, name: `Class ${code}`, sequence, isActive: true, isFinal: false });

  it('class codes are unique; reordering swaps sequences in one write', async () => {
    const a = await mk('1', 1);
    const b = await mk('2', 2);
    await expect(mk('1', 3)).rejects.toBeInstanceOf(DuplicateCodeError);
    await classes.setSequences([
      { id: a.id, sequence: 2 },
      { id: b.id, sequence: 1 },
    ]);
    const order = (await classes.list()).sort((x, y) => x.sequence - y.sequence);
    expect(order.map((x) => x.code)).toEqual(['2', '1']);
  });

  it('a division name is unique per class and year, ignoring case', async () => {
    const cls = await mk('5', 1);
    const other = await mk('6', 2);
    const base = { academicYearId: yearId, classId: cls.id, isActive: true };
    await divisions.create({ ...base, name: 'A', capacity: 40 });
    await expect(divisions.create({ ...base, name: 'a' })).rejects.toBeInstanceOf(
      DuplicateDivisionError,
    );
    await divisions.create({ ...base, classId: other.id, name: 'A' });
    const b = await divisions.create({ ...base, name: 'B' });
    await expect(divisions.update(b.id, { name: 'a' })).rejects.toBeInstanceOf(
      DuplicateDivisionError,
    );
  });

  it('clears capacity, filters by year and class, and counts', async () => {
    const cls = await mk('5', 1);
    const d = await divisions.create({
      academicYearId: yearId,
      classId: cls.id,
      name: 'A',
      capacity: 40,
      isActive: true,
    });
    expect((await divisions.update(d.id, { capacity: undefined }))?.capacity).toBeUndefined();
    expect(await divisions.list({ academicYearId: yearId, classId: cls.id })).toHaveLength(1);
    expect(await divisions.list({ academicYearId: 'f'.repeat(24) })).toHaveLength(0);
    expect(await divisions.countByYear(yearId)).toBe(1);
    expect(await divisions.countActiveByClass(cls.id)).toBe(1);
    await divisions.update(d.id, { isActive: false });
    expect(await divisions.countActiveByClass(cls.id)).toBe(0);
  });

  it('the migration is repeatable and the old unique sequence index is gone', async () => {
    await up(c());
    const idx = await c().collection('classes').indexes();
    const seq = idx.find((i) => i.name === 'institutionId_1_sequence_1');
    expect(seq?.unique).toBeFalsy();
  });
});
