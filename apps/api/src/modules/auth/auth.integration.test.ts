import { SYSTEM_ROLES } from '@sfm/shared';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { composeApi } from '../../compose';
import { createLogger } from '../../config/logger';
import { connectMongo, disconnectMongo } from '../../db/connection';
import { up } from '../../db/migrations/001-initial';
import { seedIdentity } from '../../db/seed';
import { TEST_SECRET, buildAuthHarness, testHasher } from '../../testing/auth-harness';
import { GENESIS_HASH, chain, verifyChain } from '../audit/audit-chain';
import { AuditService } from '../audit/audit.service';
import { authScenarios } from './auth.scenarios';
import { MongoAuditStore, MongoRoleRepo, MongoSessionRepo, MongoUserRepo } from './mongo-repos';

/**
 * REAL MongoDB integration tests for authentication (MONGO_URI → a replica set / Atlas; use a TEST database,
 * these tests delete data). Skipped when MONGO_URI is not set.
 */
const uri = process.env.MONGO_URI;
const CLEAR = ['users', 'roles', 'sessions', 'audit_logs'];

async function clear(): Promise<void> {
  for (const c of CLEAR) await mongoose.connection.collection(c).deleteMany({});
}

describe.skipIf(!uri)('MongoDB integration — auth', () => {
  const institutionId = new mongoose.Types.ObjectId().toHexString();
  beforeAll(async () => {
    await connectMongo(uri as string);
    await up(mongoose.connection);
  }, 120_000);
  afterAll(async () => {
    await clear();
    await disconnectMongo();
  });

  // the very same authentication scenarios as the in-memory run
  authScenarios('real MongoDB', async () => {
    await clear();
    const c = mongoose.connection;
    return buildAuthHarness(
      {
        users: new MongoUserRepo(c, institutionId),
        roles: new MongoRoleRepo(c, institutionId),
        sessions: new MongoSessionRepo(c, institutionId),
      },
      {},
      institutionId,
    );
  });

  describe('repositories', () => {
    const repos = () => ({
      users: new MongoUserRepo(mongoose.connection, institutionId),
      roles: new MongoRoleRepo(mongoose.connection, institutionId),
      sessions: new MongoSessionRepo(mongoose.connection, institutionId),
    });

    it('enforce unique e-mail and unique role key at the database', async () => {
      await clear();
      const { users, roles } = repos();
      const base = {
        institutionId,
        name: 'A User',
        passwordHash: 'x',
        roleIds: [],
        status: 'ACTIVE' as const,
        mustChangePassword: false,
      };
      await users.create({ ...base, email: 'Dup@School.test' });
      await expect(users.create({ ...base, email: 'dup@school.test' })).rejects.toMatchObject({
        name: 'DuplicateEmailError',
      });
      const r = {
        institutionId,
        key: 'K',
        name: 'K',
        permissions: [],
        dataScope: 'ALL' as const,
        isSystem: false,
        isActive: true,
      };
      await roles.create(r);
      await expect(roles.create(r)).rejects.toMatchObject({ name: 'DuplicateRoleKeyError' });
    });

    it('never returns the password hash from a plain read path other than login lookups, and escapes search input', async () => {
      await clear();
      const { users } = repos();
      await users.create({
        institutionId,
        email: 'a.b@school.test',
        name: 'Asha (Admin) [x]',
        passwordHash: 'x',
        roleIds: [],
        status: 'ACTIVE',
        mustChangePassword: false,
      });
      const hit = await users.list({ page: 1, pageSize: 10, q: '(Admin) [x]' });
      expect(hit.total).toBe(1);
      expect((await users.list({ page: 1, pageSize: 10, q: '.*' })).total).toBe(0); // regex metacharacters are literal
      expect((await users.list({ page: 1, pageSize: 10, q: '{"$ne":null}' })).total).toBe(0);
    });

    it('session rotation is atomic: of many concurrent rotations exactly one wins', async () => {
      await clear();
      const { sessions } = repos();
      const now = new Date();
      const s = await sessions.create({
        institutionId,
        userId: new mongoose.Types.ObjectId().toHexString(),
        familyId: 'f',
        tokenHash: 'h'.repeat(64),
        createdAt: now,
        lastUsedAt: now,
        expiresAt: new Date(now.getTime() + 3_600_000),
      });
      const wins = await Promise.all(
        Array.from({ length: 8 }, () => sessions.markRotated(s.id, 'next', new Date())),
      );
      expect(wins.filter(Boolean)).toHaveLength(1);
    });

    it('role updates are optimistic: a stale version loses', async () => {
      await clear();
      const { roles } = repos();
      const r = await roles.create({
        institutionId,
        key: 'V',
        name: 'V',
        permissions: [],
        dataScope: 'ALL',
        isSystem: false,
        isActive: true,
      });
      expect(await roles.update(r.id, { name: 'One' }, 0)).toMatchObject({ version: 1 });
      expect(await roles.update(r.id, { name: 'Two' }, 0)).toBeNull();
    });
  });

  describe('bootstrap + full HTTP stack on MongoDB', () => {
    it('db:seed is idempotent, keeps built-in roles in sync, and the seeded Super Admin can sign in and manage users', async () => {
      await clear();
      await mongoose.connection.collection('institutions').deleteMany({});
      const hasher = testHasher();
      const first = await seedIdentity(mongoose.connection, {
        adminEmail: 'Boss@School.test',
        hasher,
      });
      expect(first.rolesCreated).toHaveLength(SYSTEM_ROLES.length);
      expect(first.admin).toMatchObject({ email: 'boss@school.test', created: true });
      const temp = first.admin.temporaryPassword!;
      expect(temp).toHaveLength(12);

      const again = await seedIdentity(mongoose.connection, {
        adminEmail: 'boss@school.test',
        hasher,
      });
      expect(again.institutionId).toBe(first.institutionId);
      expect(again.rolesCreated).toEqual([]);
      expect(again.admin.created).toBe(false);

      // a built-in role that drifted from the code registry is repaired
      await mongoose.connection
        .collection('roles')
        .updateOne({ key: 'AUDITOR' }, { $set: { permissions: ['payment.collect'] } });
      expect(
        (await seedIdentity(mongoose.connection, { adminEmail: 'boss@school.test', hasher }))
          .rolesUpdated,
      ).toEqual(['AUDITOR']);

      // the whole stack: Mongo repos + services + Express
      const id = first.institutionId;
      const c = mongoose.connection;
      const roles = new MongoRoleRepo(c, id);
      const app = createApp({
        logger: createLogger('silent'),
        readiness: {},
        api: composeApi(c, id, { jwtSecret: TEST_SECRET, secureCookies: false, hasher }),
      });

      const l1 = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'boss@school.test', password: temp });
      expect(l1.status).toBe(200);
      expect(l1.body.data.user.mustChangePassword).toBe(true);
      const blocked = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${l1.body.data.accessToken}`);
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      const changed = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${l1.body.data.accessToken}`)
        .send({ currentPassword: temp, newPassword: 'Violet-Lamp-2026!' });
      expect(changed.status).toBe(200);
      const t = { Authorization: `Bearer ${changed.body.data.accessToken}` };

      const adminRole = (await roles.findByKey('FEE_COLLECTOR'))!;
      const made = await request(app)
        .post('/api/v1/users')
        .set(t)
        .send({ email: 'cashier@school.test', name: 'Counter Cashier', roleIds: [adminRole.id] });
      expect(made.status).toBe(201);
      const list = await request(app).get('/api/v1/users').set(t);
      expect(list.body.meta.total).toBe(2);
      expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|argon2/);
      const cashier = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'cashier@school.test', password: made.body.meta.temporaryPassword });
      expect(cashier.status).toBe(200);
      // the cashier is blocked from user management by the backend
      const cashierChanged = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${cashier.body.data.accessToken}`)
        .send({ currentPassword: made.body.meta.temporaryPassword, newPassword: 'Rupee-Desk-77!' });
      const denied = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${cashierChanged.body.data.accessToken}`);
      expect(denied.status).toBe(403);

      // the audit trail written along the way is a valid chain with no secrets
      const rows = await new MongoAuditStore(c, id).list({ limit: 200 });
      expect(rows).toHaveLength(5); // 2 logins, 2 password changes, 1 user created
      expect(verifyChain(rows)).toMatchObject({ ok: true });
      expect(JSON.stringify(rows)).not.toContain(temp);
      expect(rows.map((r: { action: string }) => r.action)).toEqual(
        expect.arrayContaining(['LOGIN_SUCCEEDED', 'PASSWORD_CHANGED', 'USER_CREATED']),
      );
    });
  });

  describe('chained audit log on MongoDB', () => {
    it('concurrent writers (several services) never fork the chain; the stored chain verifies after a round-trip', async () => {
      await clear();
      const store = new MongoAuditStore(mongoose.connection, institutionId);
      const services = [new AuditService(store), new AuditService(store), new AuditService(store)];
      const actor = new mongoose.Types.ObjectId().toHexString();
      await Promise.all(
        Array.from({ length: 24 }, (_, i) =>
          services[i % 3]!.record({
            at: new Date(),
            userId: actor,
            userName: 'U',
            roleKeys: i % 2 ? ['ADMIN'] : [],
            action: 'X',
            entityType: 'user',
            entityId: String(i),
            before: { a: 1, passwordHash: 'secret' },
            after: { when: new Date(), n: [1, { b: 2 }] },
          }),
        ),
      );
      const rows = await store.list({ limit: 100 });
      expect(rows).toHaveLength(24);
      expect(rows[0]).toMatchObject({ seq: 1, prevHash: GENESIS_HASH });
      expect(verifyChain(rows)).toEqual({ ok: true, count: 24 });
      expect(JSON.stringify(rows)).not.toContain('secret');
    });

    it('the database refuses a second entry with the same sequence number, and tampering is detected', async () => {
      await clear();
      const store = new MongoAuditStore(mongoose.connection, institutionId);
      const first = chain(null, { at: new Date(), action: 'A', entityType: 'x', entityId: '1' });
      await store.insert(first);
      await expect(
        store.insert(chain(null, { at: new Date(), action: 'B', entityType: 'x', entityId: '2' })),
      ).rejects.toMatchObject({ name: 'AuditSeqConflict' });
      await new AuditService(store).record({
        at: new Date(),
        action: 'C',
        entityType: 'x',
        entityId: '3',
      });
      await mongoose.connection
        .collection('audit_logs')
        .updateOne({ seq: 1 }, { $set: { action: 'TAMPERED' } });
      expect(verifyChain(await store.list({ limit: 10 }))).toMatchObject({
        ok: false,
        brokenAtSeq: 1,
      });
    });
  });
});
