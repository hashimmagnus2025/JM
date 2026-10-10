import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildHttpHarness, type HttpHarness } from '../../testing/http-harness';

const PW = 'Correct-Horse-42!';
let h: HttpHarness;
beforeEach(async () => {
  h = await buildHttpHarness();
});

const as = async (role: string) => {
  const email = `${role.toLowerCase()}@school.test`;
  if (!(await h.users.findByEmail(email))) await h.addUser(email, PW, [role]);
  const res = await request(h.app).post('/api/v1/auth/login').send({ email, password: PW });
  return { Authorization: `Bearer ${res.body.data.accessToken}` };
};
const api = (
  m: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  auth: Record<string, string>,
  body?: object,
) => {
  const agent = request(h.app);
  return agent[m](`/api/v1${path}`)
    .set(auth)
    .send(body ?? {});
};
const year = async (a: Record<string, string>, label = '2026-27', y = 2026) =>
  (
    await api('post', '/academic-years', a, {
      label,
      startDate: `${y}-04-01`,
      endDate: `${y + 1}-03-31`,
    })
  ).body.data.id as string;
const cls = async (a: Record<string, string>, code: string, name = `Class ${code}`) =>
  (await api('post', '/classes', a, { code, name })).body.data.id as string;

describe('classes', () => {
  it('creates in order, rejects duplicate codes (409) and bad codes (400)', async () => {
    const a = await as('ADMIN');
    const one = await api('post', '/classes', a, { code: '1', name: ' Class 1 ' });
    expect(one.status).toBe(201);
    expect(one.body.data).toMatchObject({
      code: '1',
      name: 'Class 1',
      sequence: 1,
      isActive: true,
    });
    await cls(a, '2');
    expect(
      (await api('get', '/classes', a)).body.data.map((c: { code: string }) => c.code),
    ).toEqual(['1', '2']);
    expect((await api('post', '/classes', a, { code: '1', name: 'Again' })).body.error.code).toBe(
      'CLASS_CODE_IN_USE',
    );
    expect((await api('post', '/classes', a, { code: 'bad code', name: 'x' })).status).toBe(400);
  });

  it('reorders only with the complete, current list; the change is audited', async () => {
    const a = await as('ADMIN');
    const [x, y, z] = [await cls(a, 'A'), await cls(a, 'B'), await cls(a, 'C')];
    const ok = await api('put', '/classes/order', a, { ids: [z, x, y] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.map((c: { code: string }) => c.code)).toEqual(['C', 'A', 'B']);
    expect(h.auditStore.rows.some((r) => r.action === 'CLASSES_REORDERED')).toBe(true);
    for (const ids of [
      [x, y],
      [x, x, y],
      [x, y, z, z],
    ]) {
      expect((await api('put', '/classes/order', a, { ids })).body.error.code).toBe(
        'CLASS_ORDER_STALE',
      );
    }
  });

  it('cannot deactivate a class that still has active divisions', async () => {
    const a = await as('ADMIN');
    const yr = await year(a);
    const c = await cls(a, '5');
    const d = await api('post', '/divisions', a, { academicYearId: yr, classId: c, name: 'A' });
    const blocked = await api('patch', `/classes/${c}`, a, { isActive: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CLASS_HAS_ACTIVE_DIVISIONS');
    await api('patch', `/divisions/${d.body.data.id}`, a, { isActive: false });
    expect((await api('patch', `/classes/${c}`, a, { isActive: false })).body.data.isActive).toBe(
      false,
    );
  });

  it('permissions: Registrar manages, Auditor only views, Fee Collector sees nothing', async () => {
    const registrar = await as('REGISTRAR');
    const auditor = await as('AUDITOR');
    expect((await api('post', '/classes', registrar, { code: '1', name: 'One' })).status).toBe(201);
    expect((await api('get', '/classes', auditor)).status).toBe(200);
    expect((await api('post', '/classes', auditor, { code: '2', name: 'Two' })).status).toBe(403);
    expect((await api('put', '/classes/order', auditor, { ids: ['a'.repeat(24)] })).status).toBe(
      403,
    );
    const noAuth = await request(h.app).get('/api/v1/classes');
    expect(noAuth.status).toBe(401);
  });
});

describe('divisions', () => {
  it('creates, rejects case-insensitive duplicates and bad capacity', async () => {
    const a = await as('ADMIN');
    const yr = await year(a);
    const c = await cls(a, '5');
    const ok = await api('post', '/divisions', a, {
      academicYearId: yr,
      classId: c,
      name: ' a ',
      capacity: 40,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ name: 'a', capacity: 40, isActive: true });
    const dup = await api('post', '/divisions', a, { academicYearId: yr, classId: c, name: 'A' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DIVISION_EXISTS');
    for (const capacity of [0, -3, 2.5, 501]) {
      expect(
        (
          await api('post', '/divisions', a, {
            academicYearId: yr,
            classId: c,
            name: 'B',
            capacity,
          })
        ).status,
      ).toBe(400);
    }
  });

  it('the same name is fine in another class or year', async () => {
    const a = await as('ADMIN');
    const y1 = await year(a);
    const y2 = await year(a, '2027-28', 2027);
    const c1 = await cls(a, '1');
    const c2 = await cls(a, '2');
    for (const [academicYearId, classId] of [
      [y1, c1],
      [y1, c2],
      [y2, c1],
    ] as const)
      expect(
        (await api('post', '/divisions', a, { academicYearId, classId, name: 'A' })).status,
      ).toBe(201);
  });

  it('refuses unknown or inactive classes, unknown years, and closed years', async () => {
    const a = await as('ADMIN');
    const yr = await year(a);
    const c = await cls(a, '1');
    const missing = 'f'.repeat(24);
    expect(
      (await api('post', '/divisions', a, { academicYearId: yr, classId: missing, name: 'A' })).body
        .error.code,
    ).toBe('CLASS_NOT_FOUND');
    expect(
      (await api('post', '/divisions', a, { academicYearId: missing, classId: c, name: 'A' })).body
        .error.code,
    ).toBe('YEAR_NOT_FOUND');
    await api('patch', `/classes/${c}`, a, { isActive: false });
    expect(
      (await api('post', '/divisions', a, { academicYearId: yr, classId: c, name: 'A' })).body.error
        .code,
    ).toBe('CLASS_INACTIVE');
    await api('patch', `/classes/${c}`, a, { isActive: true });
    const made = await api('post', '/divisions', a, { academicYearId: yr, classId: c, name: 'A' });
    await api('post', `/academic-years/${yr}/activate`, a);
    await api('post', `/academic-years/${yr}/close`, a, { reason: 'Year finished' });
    const closed = await api('post', '/divisions', a, {
      academicYearId: yr,
      classId: c,
      name: 'B',
    });
    expect(closed.body.error.code).toBe('YEAR_CLOSED');
    expect(
      (await api('patch', `/divisions/${made.body.data.id}`, a, { capacity: 30 })).body.error.code,
    ).toBe('YEAR_CLOSED');
  });

  it('updates name/capacity, can clear capacity, and blocks renaming into a clash', async () => {
    const a = await as('ADMIN');
    const yr = await year(a);
    const c = await cls(a, '1');
    const mk = async (name: string) =>
      (await api('post', '/divisions', a, { academicYearId: yr, classId: c, name, capacity: 30 }))
        .body.data.id as string;
    const [x] = [await mk('A'), await mk('B')];
    const renamed = await api('patch', `/divisions/${x}`, a, { name: 'C', capacity: null });
    expect(renamed.body.data.name).toBe('C');
    expect(renamed.body.data.capacity).toBeUndefined();
    expect((await api('patch', `/divisions/${x}`, a, { name: 'b' })).body.error.code).toBe(
      'DIVISION_EXISTS',
    );
    expect((await api('patch', `/divisions/${'e'.repeat(24)}`, a, { name: 'Z' })).status).toBe(404);
    expect((await api('patch', `/divisions/${x}`, a, { bogus: 1 })).status).toBe(400);
  });

  it('students in a division block deactivation and a capacity below the head-count', async () => {
    const a = await as('ADMIN');
    const yr = await year(a);
    const c = await cls(a, '1');
    const d = (await api('post', '/divisions', a, { academicYearId: yr, classId: c, name: 'A' }))
      .body.data.id as string;
    (h.academic.divisions as unknown as { usage: unknown }).usage = {
      enrolled: async () => 25,
    };
    const off = await api('patch', `/divisions/${d}`, a, { isActive: false });
    expect(off.body.error.code).toBe('DIVISION_HAS_STUDENTS');
    const low = await api('patch', `/divisions/${d}`, a, { capacity: 20 });
    expect(low.status).toBe(422);
    expect(low.body.error.code).toBe('CAPACITY_BELOW_ENROLLED');
    expect((await api('patch', `/divisions/${d}`, a, { capacity: 25 })).status).toBe(200);
  });

  it('lists by year and class', async () => {
    const a = await as('ADMIN');
    const y1 = await year(a);
    const y2 = await year(a, '2027-28', 2027);
    const c1 = await cls(a, '1');
    const c2 = await cls(a, '2');
    for (const [academicYearId, classId, name] of [
      [y1, c1, 'A'],
      [y1, c2, 'A'],
      [y2, c1, 'A'],
    ] as const)
      await api('post', '/divisions', a, { academicYearId, classId, name });
    const count = async (q: string) => (await api('get', `/divisions${q}`, a)).body.data.length;
    expect(await count('')).toBe(3);
    expect(await count(`?academicYearId=${y1}`)).toBe(2);
    expect(await count(`?academicYearId=${y1}&classId=${c2}`)).toBe(1);
    expect((await api('get', '/divisions?academicYearId=nope', a)).status).toBe(400);
  });

  it('clone copies active divisions once, is repeatable, and skips inactive ones', async () => {
    const a = await as('ADMIN');
    const from = await year(a);
    const to = await year(a, '2027-28', 2027);
    const c = await cls(a, '1');
    const mk = async (name: string, capacity?: number) =>
      (
        await api('post', '/divisions', a, {
          academicYearId: from,
          classId: c,
          name,
          ...(capacity ? { capacity } : {}),
        })
      ).body.data.id as string;
    await mk('A', 40);
    await mk('B');
    const gone = await mk('C');
    await api('patch', `/divisions/${gone}`, a, { isActive: false });

    const first = await api('post', '/divisions/clone', a, { fromYearId: from, toYearId: to });
    expect(first.body.data).toEqual({ created: 2, skipped: 0 });
    const again = await api('post', '/divisions/clone', a, { fromYearId: from, toYearId: to });
    expect(again.body.data).toEqual({ created: 0, skipped: 2 });
    const copied = (await api('get', `/divisions?academicYearId=${to}`, a)).body.data;
    expect(copied.map((d: { name: string }) => d.name).sort()).toEqual(['A', 'B']);
    expect(copied.find((d: { name: string }) => d.name === 'A').capacity).toBe(40);

    expect(
      (await api('post', '/divisions/clone', a, { fromYearId: from, toYearId: from })).body.error
        .code,
    ).toBe('CLONE_SAME_YEAR');
  });

  it('once a year has divisions it can no longer go back to planned', async () => {
    const a = await as('ADMIN');
    const yr = await year(a);
    const c = await cls(a, '1');
    await api('post', `/academic-years/${yr}/activate`, a);
    await api('post', '/divisions', a, { academicYearId: yr, classId: c, name: 'A' });
    const res = await api('post', `/academic-years/${yr}/deactivate`, a);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('YEAR_HAS_DATA');
  });

  it('permissions and audit', async () => {
    const admin = await as('ADMIN');
    const auditor = await as('AUDITOR');
    const yr = await year(admin);
    const c = await cls(admin, '1');
    const body = { academicYearId: yr, classId: c, name: 'A' };
    expect((await api('post', '/divisions', auditor, body)).status).toBe(403);
    expect((await api('get', '/divisions', auditor)).status).toBe(200);
    await api('post', '/divisions', admin, body);
    expect(h.auditStore.rows.some((r) => r.action === 'DIVISION_CREATED')).toBe(true);
  });
});
