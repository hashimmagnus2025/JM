import { SystemClock } from '@sfm/shared';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { composeApi } from '../../compose';
import { createLogger } from '../../config/logger';
import { connectMongo, disconnectMongo } from '../../db/connection';
import { up } from '../../db/migrations/001-initial';
import { seedIdentity } from '../../db/seed';
import { TEST_SECRET, testHasher } from '../../testing/auth-harness';
import { AuditService } from '../audit/audit.service';
import { verifyChain } from '../audit/audit-chain';
import { MongoAuditStore } from '../auth/mongo-repos';
import {
  MongoCategoryRepo,
  MongoInstitutionRepo,
  MongoSettingRepo,
  MongoYearRepo,
} from './mongo-repos';
import { AcademicYearService } from './setup.service';

/** REAL MongoDB tests for the setup module (needs MONGO_URI → a TEST database; data is deleted). */
const uri = process.env.MONGO_URI;
const CLEAR = [
  'users',
  'roles',
  'sessions',
  'audit_logs',
  'academic_years',
  'student_categories',
  'system_settings',
  'institutions',
];
const Y = (label: string, y: number) => ({
  label,
  startDate: `${y}-04-01`,
  endDate: `${y + 1}-03-31`,
});

describe.skipIf(!uri)('MongoDB integration — setup', () => {
  let institutionId: string;
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
  });

  describe('seed', () => {
    it('creates the General category once', async () => {
      const cats = await new MongoCategoryRepo(c(), institutionId).list();
      expect(cats.map((x: { code: string }) => x.code)).toEqual(['GENERAL']);
      const again = await seedIdentity(c(), {
        adminEmail: 'boss@school.test',
        hasher: testHasher(),
      });
      expect(again.categoriesCreated).toEqual([]);
    });
  });

  describe('repositories', () => {
    it('institution: reads and updates the profile', async () => {
      const repo = new MongoInstitutionRepo(c(), institutionId);
      const before = await repo.get();
      expect(before).toMatchObject({
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        academicStartMonth: 4,
      });
      const after = await repo.update({
        name: 'Real School',
        address: { city: 'Nagpur' },
        contact: { email: 'a@b.test' },
        extra: { 'UDISE code': '123' },
      });
      expect(after).toMatchObject({
        name: 'Real School',
        address: { city: 'Nagpur' },
        extra: { 'UDISE code': '123' },
      });
    });

    it('settings: upsert, read back as stored, remove', async () => {
      const repo = new MongoSettingRepo(c(), institutionId);
      await repo.set('status.dueSoonDays', 10, undefined, new Date());
      await repo.set(
        'status.dueSoonDays',
        12,
        new mongoose.Types.ObjectId().toHexString(),
        new Date(),
      );
      await repo.set(
        'receipt.numbering',
        { prefix: 'FEE', scope: 'NONE', pad: 5 },
        undefined,
        new Date(),
      );
      const all = await repo.all();
      expect(all.find((s) => s.key === 'status.dueSoonDays')?.value).toBe(12);
      expect(all.find((s) => s.key === 'receipt.numbering')?.value).toEqual({
        prefix: 'FEE',
        scope: 'NONE',
        pad: 5,
      });
      expect(all).toHaveLength(2); // upsert never duplicates a key
      await repo.remove('status.dueSoonDays');
      expect((await repo.all()).map((s) => s.key)).toEqual(['receipt.numbering']);
    });

    it('academic years: duplicate labels are refused by the database; one-current is enforced by the unique index', async () => {
      const repo = new MongoYearRepo(c(), institutionId);
      const a = await repo.create(Y('2026-27', 2026));
      await expect(repo.create(Y('2026-27', 2026))).rejects.toMatchObject({
        name: 'DuplicateLabelError',
      });
      const b = await repo.create(Y('2027-28', 2027));
      await repo.setCurrent([], a.id);
      // two current years can never exist, even if the service were bypassed
      await expect(
        c()
          .collection('academic_years')
          .updateOne({ _id: new mongoose.Types.ObjectId(b.id) }, { $set: { isCurrent: true } }),
      ).rejects.toMatchObject({ code: 11000 });
      const moved = await repo.setCurrent([a.id], b.id);
      expect(moved).toMatchObject({ isCurrent: true, status: 'ACTIVE' });
      expect(
        (await repo.list())
          .filter((y: { isCurrent: boolean }) => y.isCurrent)
          .map((y: { label: string }) => y.label),
      ).toEqual(['2027-28']);
      expect(await repo.setCurrent([], '0123456789abcdef01234567')).toBeNull();
    });

    it('academic years: update can set and clear fields (reopen clears closedAt)', async () => {
      const repo = new MongoYearRepo(c(), institutionId);
      const y = await repo.create(Y('2026-27', 2026));
      const closed = await repo.update(y.id, {
        status: 'CLOSED',
        closedAt: new Date(),
        closedBy: new mongoose.Types.ObjectId().toHexString(),
      });
      expect(closed?.closedAt).toBeInstanceOf(Date);
      const reopened = await repo.update(y.id, {
        status: 'ACTIVE',
        closedAt: undefined,
        closedBy: undefined,
      });
      expect(reopened).toMatchObject({
        status: 'ACTIVE',
        closedAt: undefined,
        closedBy: undefined,
      });
      await repo.create(Y('2027-28', 2027));
      await expect(repo.update(y.id, { label: '2027-28' })).rejects.toMatchObject({
        name: 'DuplicateLabelError',
      });
    });

    it('categories: unique code, update, list', async () => {
      const repo = new MongoCategoryRepo(c(), institutionId);
      await repo.create({ code: 'RTE', name: 'RTE', isActive: true, sequence: 2 });
      await expect(
        repo.create({ code: 'RTE', name: 'Again', isActive: true, sequence: 3 }),
      ).rejects.toMatchObject({ name: 'DuplicateCodeError' });
      const rte = (await repo.list()).find((x: { code: string }) => x.code === 'RTE')!;
      expect(await repo.update(rte.id, { isActive: false })).toMatchObject({ isActive: false });
    });
  });

  describe('concurrency', () => {
    it('two people making DIFFERENT years current at the same moment: never two current years; the loser gets a clear conflict', async () => {
      const repo = new MongoYearRepo(c(), institutionId);
      const audit = new AuditService(new MongoAuditStore(c(), institutionId));
      const svc = new AcademicYearService(repo, audit, new SystemClock());
      const actor = {
        userId: new mongoose.Types.ObjectId().toHexString(),
        name: 'T',
        roleKeys: [],
        permissions: new Set<string>(),
        sessionId: 's',
        institutionId,
        email: 't@t.t',
        dataScope: 'ALL' as const,
        mustChangePassword: false,
      };
      const a = await repo.create(Y('2026-27', 2026));
      const b = await repo.create(Y('2027-28', 2027));
      const old = await repo.create(Y('2025-26', 2025));
      await repo.setCurrent([], old.id);
      const results = await Promise.allSettled([
        svc.setCurrent(actor, a.id),
        svc.setCurrent(actor, b.id),
      ]);
      const current = (await repo.list()).filter((y: { isCurrent: boolean }) => y.isCurrent);
      expect(current).toHaveLength(1); // the unique index guarantees it
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      for (const r of results.filter((x) => x.status === 'rejected'))
        expect((r as PromiseRejectedResult).reason).toMatchObject({
          code: 'CONCURRENT_CHANGE',
          status: 409,
        });
    });
  });

  describe('full HTTP stack on MongoDB', () => {
    it('a Super Admin runs the whole setup journey; every step is audited in one valid chain', async () => {
      const app = createApp({
        logger: createLogger('silent'),
        readiness: {},
        api: composeApi(c(), institutionId, {
          jwtSecret: TEST_SECRET,
          secureCookies: false,
          hasher: testHasher(),
        }),
      });
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'boss@school.test', password: 'Violet-Lamp-2026!' });
      expect(login.status).toBe(200);
      const a = { Authorization: `Bearer ${login.body.data.accessToken}` };
      const call = (m: 'get' | 'post' | 'patch' | 'put' | 'delete', p: string, body?: object) => {
        const agent = request(app);
        return agent[m](`/api/v1${p}`)
          .set(a)
          .send(body ?? {});
      };

      expect(
        (
          await call('patch', '/institution', {
            name: 'Jawahar Memorial School',
            contact: { phone: '0712 1234567' },
          })
        ).body.data.name,
      ).toBe('Jawahar Memorial School');
      expect(
        (await call('put', '/settings/status.dueSoonDays', { value: 5, reason: 'test' })).body.data,
      ).toMatchObject({ value: 5, isDefault: false });
      expect(
        (await call('get', '/settings')).body.data.find(
          (s: { key: string }) => s.key === 'status.dueSoonDays',
        ).value,
      ).toBe(5);

      const y25 = (await call('post', '/academic-years', Y('2025-26', 2025))).body.data;
      const y26 = (await call('post', '/academic-years', Y('2026-27', 2026))).body.data;
      expect(
        (
          await call('post', '/academic-years', {
            label: '2026-27',
            startDate: '2026-09-01',
            endDate: '2027-08-31',
          })
        ).body.error.code,
      ).toBe('YEAR_OVERLAP');
      await call('post', `/academic-years/${y25.id}/set-current`);
      await call('post', `/academic-years/${y26.id}/set-current`);
      expect((await call('get', '/academic-years/current')).body.data.label).toBe('2026-27');
      expect(
        (
          await call('post', `/academic-years/${y25.id}/close`, {
            reason: 'Year ended, books reconciled',
          })
        ).body.data.status,
      ).toBe('CLOSED');
      expect(
        (await call('patch', `/academic-years/${y25.id}`, { endDate: '2026-03-30' })).body.error
          .code,
      ).toBe('YEAR_LOCKED');
      expect(
        (await call('post', '/student-categories', { code: 'RTE', name: 'RTE seat' })).status,
      ).toBe(201);
      expect(
        (await call('get', '/student-categories')).body.data.map((x: { code: string }) => x.code),
      ).toEqual(['GENERAL', 'RTE']);

      const rows = await new MongoAuditStore(c(), institutionId).list({ limit: 200 });
      expect(verifyChain(rows)).toMatchObject({ ok: true });
      expect(rows.map((r: { action: string }) => r.action)).toEqual(
        expect.arrayContaining([
          'LOGIN_SUCCEEDED',
          'INSTITUTION_UPDATED',
          'SETTING_CHANGED',
          'ACADEMIC_YEAR_CREATED',
          'ACADEMIC_YEAR_SET_CURRENT',
          'ACADEMIC_YEAR_CLOSED',
          'STUDENT_CATEGORY_CREATED',
        ]),
      );
    });
  });
});
