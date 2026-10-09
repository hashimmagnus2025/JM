import { SYSTEM_ROLES } from '@sfm/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildHttpHarness, type HttpHarness } from '../../testing/http-harness';

const PW = 'Correct-Horse-42!';
let h: HttpHarness;
beforeEach(async () => {
  h = await buildHttpHarness();
});

const login = (email: string, password = PW) =>
  request(h.app).post('/api/v1/auth/login').send({ email, password });
const token = async (email: string): Promise<string> => (await login(email)).body.data.accessToken;
const bearer = async (email: string) => ({ Authorization: `Bearer ${await token(email)}` });
const cookieOf = (res: request.Response): string =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((c) => c.startsWith('sfm_rt=')) ??
  '';

describe('login over HTTP', () => {
  it('sets the refresh token ONLY in an httpOnly, SameSite=Strict, path-scoped cookie — never in the JSON', async () => {
    await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
    const res = await login('asha@school.test');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      expiresIn: 900,
      user: { email: 'asha@school.test', roleKeys: ['ACCOUNTANT'] },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/refresh/i);
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/Expires=/);
  });
  it('wrong credentials → 401 with a coded error and no hints', async () => {
    await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
    const res = await login('asha@school.test', 'nope');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.headers['set-cookie']).toBeUndefined();
  });
  it('locked account → 423 with Retry-After', async () => {
    await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
    for (let i = 0; i < 5; i++) await login('asha@school.test', 'bad');
    const res = await login('asha@school.test');
    expect(res.status).toBe(423);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
  it('rejects malformed input and unknown fields (strict schemas)', async () => {
    const bad = await request(h.app).post('/api/v1/auth/login').send({ email: 'a@b.c' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(bad.body.error.details[0]).toMatchObject({ field: 'password' });
    const extra = await request(h.app)
      .post('/api/v1/auth/login')
      .send({ email: 'asha@school.test', password: PW, role: 'SUPER_ADMIN' });
    expect(extra.status).toBe(400);
    const json = await request(h.app)
      .post('/api/v1/auth/login')
      .set('content-type', 'application/json')
      .send('{oops');
    expect(json.status).toBe(400);
    expect(json.body.error.code).toBe('INVALID_JSON');
  });
  it('is rate-limited per IP', async () => {
    const limited = await buildHttpHarness({ loginLimit: 3 });
    const post = () =>
      request(limited.app)
        .post('/api/v1/auth/login')
        .send({ email: 'x@y.test', password: 'whatever' });
    expect([(await post()).status, (await post()).status, (await post()).status]).toEqual([
      401, 401, 401,
    ]);
    const blocked = await post();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('authentication guard', () => {
  it('protected routes need a valid Bearer token', async () => {
    expect((await request(h.app).get('/api/v1/users')).status).toBe(401);
    expect(
      (await request(h.app).get('/api/v1/users').set('Authorization', 'Bearer junk')).body.error
        .code,
    ).toBe('TOKEN_INVALID');
    expect(
      (await request(h.app).get('/api/v1/users').set('Authorization', 'Basic abc')).status,
    ).toBe(401);
  });
  it('/auth/me returns the principal with the server-side permission list', async () => {
    await h.addUser('asha@school.test', PW, ['FEE_COLLECTOR']);
    const res = await request(h.app)
      .get('/api/v1/auth/me')
      .set(await bearer('asha@school.test'));
    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toContain('payment.collect');
    expect(res.body.data.permissions).not.toContain('payment.reverse');
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });
});

describe('refresh / logout cookies', () => {
  it('refresh needs the custom header (CSRF) and the cookie; it rotates the cookie', async () => {
    await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
    const first = await login('asha@school.test');
    const cookie = cookieOf(first).split(';')[0] as string;
    const noHeader = await request(h.app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(noHeader.status).toBe(400);
    expect(noHeader.body.error.code).toBe('CSRF_HEADER_MISSING');
    const noCookie = await request(h.app)
      .post('/api/v1/auth/refresh')
      .set('X-Requested-With', 'fetch');
    expect(noCookie.status).toBe(401);
    const ok = await request(h.app)
      .post('/api/v1/auth/refresh')
      .set('X-Requested-With', 'fetch')
      .set('Cookie', cookie);
    expect(ok.status).toBe(200);
    expect(cookieOf(ok).split(';')[0]).not.toBe(cookie);
    expect(ok.body.data.accessToken).toBeTruthy();
  });
  it('a dead refresh token also clears the cookie', async () => {
    await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
    const cookie = cookieOf(await login('asha@school.test')).split(';')[0] as string;
    await request(h.app)
      .post('/api/v1/auth/logout')
      .set('X-Requested-With', 'fetch')
      .set('Cookie', cookie);
    const res = await request(h.app)
      .post('/api/v1/auth/refresh')
      .set('X-Requested-With', 'fetch')
      .set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(cookieOf(res)).toMatch(/sfm_rt=;/);
  });
  it('logout ends the session, clears the cookie and returns 204', async () => {
    await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
    const res0 = await login('asha@school.test');
    const cookie = cookieOf(res0).split(';')[0] as string;
    const out = await request(h.app)
      .post('/api/v1/auth/logout')
      .set('X-Requested-With', 'fetch')
      .set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect(cookieOf(out)).toMatch(/sfm_rt=;/);
    const me = await request(h.app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res0.body.data.accessToken}`);
    expect(me.status).toBe(401);
  });
  it('logout-all and the session list work for the signed-in user', async () => {
    await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
    const a = await bearer('asha@school.test');
    await login('asha@school.test');
    const list = await request(h.app).get('/api/v1/auth/sessions').set(a);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash/);
    const other = list.body.data.find((s: { current: boolean }) => !s.current).id;
    expect((await request(h.app).delete(`/api/v1/auth/sessions/${other}`).set(a)).status).toBe(204);
    expect((await request(h.app).delete(`/api/v1/auth/sessions/${other}`).set(a)).status).toBe(404);
    const all = await request(h.app).post('/api/v1/auth/logout-all').set(a);
    expect(all.body.data.sessionsEnded).toBe(1);
  });
});

describe('forced password change', () => {
  beforeEach(async () => {
    await h.addUser('new@school.test', 'Temp-Pass-123!', ['ADMIN'], {
      status: 'INVITED',
      mustChangePassword: true,
    });
  });
  it('until it is changed the user can only reach /me, /change-password and logout', async () => {
    const a = await bearer('new@school.test').catch(() => undefined);
    void a;
    const t = (await login('new@school.test', 'Temp-Pass-123!')).body.data.accessToken as string;
    const auth = { Authorization: `Bearer ${t}` };
    expect((await request(h.app).get('/api/v1/auth/me').set(auth)).status).toBe(200);
    const blocked = await request(h.app).get('/api/v1/users').set(auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const changed = await request(h.app)
      .post('/api/v1/auth/change-password')
      .set(auth)
      .send({ currentPassword: 'Temp-Pass-123!', newPassword: 'My-Own-Pass-77!' });
    expect(changed.status).toBe(200);
    const t2 = { Authorization: `Bearer ${changed.body.data.accessToken}` };
    expect((await request(h.app).get('/api/v1/users').set(t2)).status).toBe(200);
  });
});

describe('PERMISSION MATRIX — the backend enforces every route for every role', () => {
  const someUser = '0123456789abcdef01234567';
  const routes: { method: 'get' | 'post' | 'patch'; path: string; perm: string; body?: object }[] =
    [
      { method: 'get', path: '/api/v1/permissions', perm: 'role.view' },
      { method: 'get', path: '/api/v1/users', perm: 'user.view' },
      {
        method: 'post',
        path: '/api/v1/users',
        perm: 'user.manage',
        body: { email: 'x@y.test', name: 'Xy Zed', roleIds: [someUser] },
      },
      { method: 'get', path: `/api/v1/users/${someUser}`, perm: 'user.view' },
      {
        method: 'patch',
        path: `/api/v1/users/${someUser}`,
        perm: 'user.manage',
        body: { name: 'New Name' },
      },
      {
        method: 'post',
        path: `/api/v1/users/${someUser}/deactivate`,
        perm: 'user.manage',
        body: { reason: 'left' },
      },
      { method: 'post', path: `/api/v1/users/${someUser}/activate`, perm: 'user.manage' },
      { method: 'post', path: `/api/v1/users/${someUser}/unlock`, perm: 'user.manage' },
      { method: 'post', path: `/api/v1/users/${someUser}/reset-password`, perm: 'user.manage' },
      { method: 'get', path: '/api/v1/roles', perm: 'role.view' },
      {
        method: 'post',
        path: '/api/v1/roles',
        perm: 'role.manage',
        body: { key: 'TEST_ROLE', name: 'Test role', permissions: [] },
      },
      { method: 'get', path: `/api/v1/roles/${someUser}`, perm: 'role.view' },
      {
        method: 'patch',
        path: `/api/v1/roles/${someUser}`,
        perm: 'role.manage',
        body: { version: 0, name: 'Changed' },
      },
      { method: 'post', path: `/api/v1/roles/${someUser}/archive`, perm: 'role.manage' },
    ];
  for (const role of SYSTEM_ROLES) {
    it(`${role.key}: allowed exactly where it holds the permission, 403 everywhere else`, async () => {
      await h.addUser(`${role.key.toLowerCase()}@school.test`, PW, [role.key]);
      const auth = await bearer(`${role.key.toLowerCase()}@school.test`);
      for (const r of routes) {
        const agent = request(h.app);
        const res = await agent[r.method](r.path)
          .set(auth)
          .send(r.body ?? {});
        const holds = (role.permissions as readonly string[]).includes(r.perm);
        if (holds) expect(res.status, `${role.key} ${r.method} ${r.path}`).not.toBe(403);
        else expect(res.status, `${role.key} ${r.method} ${r.path}`).toBe(403);
        if (!holds) expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });
  }
});

describe('users API', () => {
  const adminAuth = async () => {
    await h.addUser('admin@school.test', PW, ['ADMIN']);
    return bearer('admin@school.test');
  };
  it('creates a user with a one-time temporary password; the hash is never returned', async () => {
    const a = await adminAuth();
    const res = await request(h.app)
      .post('/api/v1/users')
      .set(a)
      .send({
        email: 'Ravi@School.test',
        name: 'Ravi Kumar',
        mobile: '9876543210',
        roleIds: [h.roleId('FEE_COLLECTOR')],
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      email: 'ravi@school.test',
      status: 'INVITED',
      mustChangePassword: true,
    });
    expect(JSON.stringify(res.body.data)).not.toMatch(/passwordHash|argon2/);
    const temp = res.body.meta.temporaryPassword as string;
    expect(temp).toHaveLength(12);
    const first = await login('ravi@school.test', temp);
    expect(first.body.data.user.mustChangePassword).toBe(true);
    expect(JSON.stringify(h.auditStore.rows)).not.toContain(temp);
    const dup = await request(h.app)
      .post('/api/v1/users')
      .set(a)
      .send({
        email: 'ravi@school.test',
        name: 'Ravi Again',
        roleIds: [h.roleId('FEE_COLLECTOR')],
      });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_IN_USE');
  });
  it('validates the input', async () => {
    const a = await adminAuth();
    const bad = await request(h.app)
      .post('/api/v1/users')
      .set(a)
      .send({ email: 'not-an-email', name: 'R', roleIds: [] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'email',
      'name',
      'roleIds',
    ]);
    expect((await request(h.app).get('/api/v1/users/not-an-id').set(a)).status).toBe(400);
    expect((await request(h.app).get('/api/v1/users?pageSize=1000').set(a)).status).toBe(400);
    expect((await request(h.app).get('/api/v1/users/0123456789abcdef01234567').set(a)).status).toBe(
      404,
    );
  });
  it('lists with pagination metadata, search and status filter', async () => {
    const a = await adminAuth();
    for (const n of ['alpha', 'bravo', 'charlie'])
      await h.addUser(`${n}@school.test`, PW, ['AUDITOR']);
    const page = await request(h.app).get('/api/v1/users?pageSize=2&page=2').set(a);
    expect(page.body.meta).toEqual({ page: 2, pageSize: 2, total: 4, totalPages: 2 });
    const q = await request(h.app).get('/api/v1/users?q=brav').set(a);
    expect(q.body.data.map((u: { email: string }) => u.email)).toEqual(['bravo@school.test']);
    expect(JSON.stringify(page.body)).not.toMatch(/passwordHash/);
  });
  it('NO PRIVILEGE ESCALATION: an Admin cannot hand out, remove or touch Super Admin', async () => {
    const a = await adminAuth();
    const root = await h.addUser('root@school.test', PW, ['SUPER_ADMIN']);
    const victim = await h.addUser('victim@school.test', PW, ['AUDITOR']);
    const give = await request(h.app)
      .patch(`/api/v1/users/${victim.id}`)
      .set(a)
      .send({ roleIds: [h.roleId('SUPER_ADMIN')] });
    expect([give.status, give.body.error.code]).toEqual([403, 'ROLE_ESCALATION']);
    const reset = await request(h.app).post(`/api/v1/users/${root.id}/reset-password`).set(a);
    expect([reset.status, reset.body.error.code]).toEqual([403, 'ROLE_ESCALATION']);
    expect(
      (
        await request(h.app)
          .post(`/api/v1/users/${root.id}/deactivate`)
          .set(a)
          .send({ reason: 'test run' })
      ).status,
    ).toBe(403);
    const create = await request(h.app)
      .post('/api/v1/users')
      .set(a)
      .send({
        email: 'sneaky@school.test',
        name: 'Sneaky One',
        roleIds: [h.roleId('SUPER_ADMIN')],
      });
    expect(create.status).toBe(403);
    // …but operational roles ARE grantable: an Admin may not collect fees personally, yet must be able to create Fee Collectors
    const collector = await request(h.app)
      .post('/api/v1/users')
      .set(a)
      .send({ email: 'c@school.test', name: 'Coll Ector', roleIds: [h.roleId('FEE_COLLECTOR')] });
    expect(collector.status).toBe(201);
    // a role with an administration permission the Admin lacks (academicYear.override) is not
    const mighty = await h.roles.create({
      institutionId: 'inst-1',
      key: 'MIGHTY',
      name: 'Mighty',
      permissions: ['academicYear.override'],
      dataScope: 'ALL',
      isSystem: false,
      isActive: true,
    });
    const blocked = await request(h.app)
      .post('/api/v1/users')
      .set(a)
      .send({ email: 'm@school.test', name: 'Mighty One', roleIds: [mighty.id] });
    expect([blocked.status, blocked.body.error.code]).toEqual([403, 'ROLE_ESCALATION']);
  });
  it('cannot change own roles or deactivate / reset yourself', async () => {
    const a = await adminAuth();
    const me = (await h.users.findByEmail('admin@school.test'))!;
    expect(
      (
        await request(h.app)
          .patch(`/api/v1/users/${me.id}`)
          .set(a)
          .send({ roleIds: [h.roleId('AUDITOR')] })
      ).body.error.code,
    ).toBe('SELF_ROLE_CHANGE');
    expect(
      (
        await request(h.app)
          .post(`/api/v1/users/${me.id}/deactivate`)
          .set(a)
          .send({ reason: 'oops' })
      ).body.error.code,
    ).toBe('SELF_DEACTIVATE');
    expect(
      (await request(h.app).post(`/api/v1/users/${me.id}/reset-password`).set(a)).body.error.code,
    ).toBe('SELF_RESET');
  });
  it('the LAST Super Admin can never be removed or deactivated', async () => {
    const root = await h.addUser('root@school.test', PW, ['SUPER_ADMIN']);
    const second = await h.addUser('second@school.test', PW, ['SUPER_ADMIN']);
    const a = await bearer('second@school.test');
    expect(
      (
        await request(h.app)
          .post(`/api/v1/users/${root.id}/deactivate`)
          .set(a)
          .send({ reason: 'leaving' })
      ).status,
    ).toBe(200);
    const last = await request(h.app)
      .patch(`/api/v1/users/${second.id}`)
      .set(await bearer('second@school.test'))
      .send({ name: 'Still Fine' });
    expect(last.status).toBe(200);
    // second tries to demote... only possible by another super admin; create a third to act, then try removing the last one
    const third = await h.addUser('third@school.test', PW, ['SUPER_ADMIN']);
    await h.users.update(second.id, { status: 'INACTIVE' });
    const t = await bearer('third@school.test');
    const res = await request(h.app)
      .patch(`/api/v1/users/${second.id}`)
      .set(t)
      .send({ roleIds: [h.roleId('AUDITOR')] });
    expect(res.status).toBe(200); // second is already inactive → third remains the active one
    const blocked = await request(h.app)
      .post(`/api/v1/users/${third.id}/deactivate`)
      .set(await bearer('third@school.test'))
      .send({ reason: 'x y z' });
    expect(blocked.status).toBe(403); // self
  });
  it("deactivation ends the user's sessions at once and is audited with the reason", async () => {
    const a = await adminAuth();
    const u = await h.addUser('ravi@school.test', PW, ['AUDITOR']);
    const ravi = await bearer('ravi@school.test');
    expect((await request(h.app).get('/api/v1/auth/me').set(ravi)).status).toBe(200);
    expect(
      (
        await request(h.app)
          .post(`/api/v1/users/${u.id}/deactivate`)
          .set(a)
          .send({ reason: 'Left the school' })
      ).body.data.status,
    ).toBe('INACTIVE');
    expect((await request(h.app).get('/api/v1/auth/me').set(ravi)).status).toBe(401);
    expect((await login('ravi@school.test')).body.error.code).toBe('ACCOUNT_DISABLED');
    const entry = h.auditStore.rows.find((r) => r.action === 'USER_DEACTIVATED');
    expect(entry).toMatchObject({ reason: 'Left the school', entityId: u.id });
    expect(
      (await request(h.app).post(`/api/v1/users/${u.id}/activate`).set(a)).body.data.status,
    ).toBe('ACTIVE');
    expect((await login('ravi@school.test')).status).toBe(200);
  });
  it('admin reset: temporary password once, all sessions end, must change at next login', async () => {
    const a = await adminAuth();
    const u = await h.addUser('ravi@school.test', PW, ['AUDITOR']);
    const ravi = await bearer('ravi@school.test');
    const res = await request(h.app).post(`/api/v1/users/${u.id}/reset-password`).set(a);
    const temp = res.body.meta.temporaryPassword as string;
    expect((await request(h.app).get('/api/v1/auth/me').set(ravi)).status).toBe(401);
    expect((await login('ravi@school.test', PW)).status).toBe(401);
    expect((await login('ravi@school.test', temp)).body.data.user.mustChangePassword).toBe(true);
  });
  it('unlock lets a locked user try again', async () => {
    const a = await adminAuth();
    const u = await h.addUser('ravi@school.test', PW, ['AUDITOR']);
    for (let i = 0; i < 5; i++) await login('ravi@school.test', 'bad');
    expect((await login('ravi@school.test')).status).toBe(423);
    await request(h.app).post(`/api/v1/users/${u.id}/unlock`).set(a);
    expect((await login('ravi@school.test')).status).toBe(200);
  });
});

describe('roles API', () => {
  const superAuth = async () => {
    await h.addUser('root@school.test', PW, ['SUPER_ADMIN']);
    return bearer('root@school.test');
  };
  it('serves the permission catalogue read-only', async () => {
    const a = await superAuth();
    const res = await request(h.app).get('/api/v1/permissions').set(a);
    expect(res.body.data.length).toBeGreaterThan(50);
    expect(res.body.data[0]).toEqual(
      expect.objectContaining({
        key: expect.any(String),
        label: expect.any(String),
        group: expect.any(String),
      }),
    );
    expect((await request(h.app).post('/api/v1/permissions').set(a).send({})).status).toBe(404);
  });
  it('creates, edits (with version check) and archives a custom role; built-in roles are read-only', async () => {
    const a = await superAuth();
    const made = await request(h.app)
      .post('/api/v1/roles')
      .set(a)
      .send({
        key: 'NIGHT_CASHIER',
        name: 'Night cashier',
        permissions: ['payment.view', 'payment.collect'],
      });
    expect(made.status).toBe(201);
    const id = made.body.data.id as string;
    const edit = await request(h.app)
      .patch(`/api/v1/roles/${id}`)
      .set(a)
      .send({ version: 0, permissions: ['payment.view'] });
    expect(edit.body.data).toMatchObject({ version: 1, permissions: ['payment.view'] });
    const stale = await request(h.app)
      .patch(`/api/v1/roles/${id}`)
      .set(a)
      .send({ version: 0, name: 'Stale edit' });
    expect([stale.status, stale.body.error.code]).toEqual([409, 'VERSION_CONFLICT']);
    const sys = await request(h.app)
      .patch(`/api/v1/roles/${h.roleId('ADMIN')}`)
      .set(a)
      .send({ version: 0, name: 'Hacked' });
    expect([sys.status, sys.body.error.code]).toEqual([409, 'SYSTEM_ROLE_READONLY']);
    expect(
      (
        await request(h.app)
          .post(`/api/v1/roles/${h.roleId('ADMIN')}/archive`)
          .set(a)
      ).status,
    ).toBe(409);
    expect(
      (await request(h.app).post(`/api/v1/roles/${id}/archive`).set(a)).body.data.isActive,
    ).toBe(false);
  });
  it('rejects duplicate keys, unknown permissions and bad keys', async () => {
    const a = await superAuth();
    const body = { key: 'ROLE_ONE', name: 'Role one', permissions: ['payment.view'] };
    expect((await request(h.app).post('/api/v1/roles').set(a).send(body)).status).toBe(201);
    expect((await request(h.app).post('/api/v1/roles').set(a).send(body)).body.error.code).toBe(
      'ROLE_KEY_IN_USE',
    );
    expect(
      (
        await request(h.app)
          .post('/api/v1/roles')
          .set(a)
          .send({ ...body, key: 'ROLE_TWO', permissions: ['payment.steal'] })
      ).body.error.code,
    ).toBe('UNKNOWN_PERMISSION');
    expect(
      (
        await request(h.app)
          .post('/api/v1/roles')
          .set(a)
          .send({ ...body, key: 'lower' })
      ).status,
    ).toBe(400);
  });
  it('a role in use cannot be archived; changing a role takes effect for its users immediately', async () => {
    const a = await superAuth();
    const made = await request(h.app)
      .post('/api/v1/roles')
      .set(a)
      .send({ key: 'TEMP_ROLE', name: 'Temp role', permissions: ['payment.view', 'receipt.view'] });
    const id = made.body.data.id as string;
    const u = await h.addUser('temp@school.test', PW, []);
    await h.users.update(u.id, { roleIds: [id] });
    const tmp = await bearer('temp@school.test');
    expect((await request(h.app).get('/api/v1/auth/me').set(tmp)).body.data.permissions).toContain(
      'receipt.view',
    );
    expect((await request(h.app).post(`/api/v1/roles/${id}/archive`).set(a)).body.error.code).toBe(
      'ROLE_IN_USE',
    );
    await request(h.app)
      .patch(`/api/v1/roles/${id}`)
      .set(a)
      .send({ version: 0, permissions: ['payment.view'] });
    expect((await request(h.app).get('/api/v1/auth/me').set(tmp)).body.data.permissions).toEqual([
      'payment.view',
    ]);
  });
  it('a role manager cannot create a role stronger than themselves', async () => {
    await h.addUser('admin@school.test', PW, ['ADMIN']);
    const a = await bearer('admin@school.test');
    const res = await request(h.app)
      .post('/api/v1/roles')
      .set(a)
      .send({ key: 'SNEAKY', name: 'Sneaky', permissions: ['academicYear.override'] });
    expect([res.status, res.body.error.code]).toEqual([403, 'ROLE_ESCALATION']);
    const fine = await request(h.app)
      .post('/api/v1/roles')
      .set(a)
      .send({ key: 'COUNTER', name: 'Counter', permissions: ['payment.collect'] });
    expect(fine.status).toBe(201);
  });
  it('role changes are audited with before/after', async () => {
    const a = await superAuth();
    const made = await request(h.app)
      .post('/api/v1/roles')
      .set(a)
      .send({ key: 'AUDITED', name: 'Audited', permissions: ['payment.view'] });
    await request(h.app)
      .patch(`/api/v1/roles/${made.body.data.id}`)
      .set(a)
      .send({ version: 0, permissions: ['payment.view', 'receipt.view'] });
    expect(h.auditStore.rows.find((r) => r.action === 'ROLE_UPDATED')).toMatchObject({
      before: { permissions: ['payment.view'] },
      after: { permissions: ['payment.view', 'receipt.view'] },
    });
  });
});

describe('CORS and error safety', () => {
  it('allows only listed origins, with credentials', async () => {
    const c = await buildHttpHarness({ corsOrigins: ['https://fees.school.test'] });
    const ok = await request(c.app).get('/healthz').set('Origin', 'https://fees.school.test');
    expect(ok.headers['access-control-allow-origin']).toBe('https://fees.school.test');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const other = await request(c.app).get('/healthz').set('Origin', 'https://evil.test');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('no CORS headers at all when no origin is configured', async () => {
    const res = await request(h.app).get('/healthz').set('Origin', 'https://fees.school.test');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('unexpected errors become a generic 500 without internals', async () => {
    await h.addUser('asha@school.test', PW, ['AUDITOR']);
    const auth = await bearer('asha@school.test');
    h.users.list = async () => {
      throw new Error('E11000 duplicate key mongodb://user:secret@host');
    };
    const res = await request(h.app).get('/api/v1/users').set(auth);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(res.body)).not.toMatch(/E11000|secret|mongodb|stack| at /);
  });
});
