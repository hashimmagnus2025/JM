import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildHttpHarness, type HttpHarness } from '../../testing/http-harness';

const PW = 'Correct-Horse-42!';
let h: HttpHarness;
beforeEach(async () => {
  h = await buildHttpHarness();
});

type Auth = Record<string, string>;
const as = async (role: string): Promise<Auth> => {
  const email = `${role.toLowerCase()}@school.test`;
  if (!(await h.users.findByEmail(email))) await h.addUser(email, PW, [role]);
  const res = await request(h.app).post('/api/v1/auth/login').send({ email, password: PW });
  return { Authorization: `Bearer ${res.body.data.accessToken}` };
};
const api = (
  m: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  auth: Auth,
  body?: object,
) => {
  const agent = request(h.app);
  return agent[m](`/api/v1${path}`)
    .set(auth)
    .send(body ?? {});
};

const teacherBody = (n: number, over: object = {}) => ({
  staffId: `EMP-${n}`,
  fullName: `Teacher ${n}`,
  mobile: `98765432${String(10 + n)}`,
  joiningDate: '2020-06-01',
  ...over,
});
const mkTeacher = async (a: Auth, n: number, over: object = {}) =>
  (await api('post', '/teachers', a, teacherBody(n, over))).body.data.id as string;

/** one open year with one class and `count` divisions */
async function school(a: Auth, count = 2, yearLabel = '2026-27', y = 2026) {
  const year = (
    await api('post', '/academic-years', a, {
      label: yearLabel,
      startDate: `${y}-04-01`,
      endDate: `${y + 1}-03-31`,
    })
  ).body.data.id as string;
  const cls = (await api('post', '/classes', a, { code: '5', name: 'Class 5' })).body.data
    .id as string;
  const divs: string[] = [];
  for (const name of ['A', 'B', 'C'].slice(0, count))
    divs.push(
      (await api('post', '/divisions', a, { academicYearId: year, classId: cls, name })).body.data
        .id,
    );
  return { year, cls, divs };
}

describe('teacher master', () => {
  it('creates with a system code, normalises the mobile, and rejects a duplicate staff id', async () => {
    const a = await as('ADMIN');
    const res = await api('post', '/teachers', a, {
      ...teacherBody(1),
      mobile: '+91 98765-43210',
      fullName: '  Asha   Mehta ',
      email: 'ASHA@school.test',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      teacherCode: 'TCH-000001',
      fullName: 'Asha Mehta',
      mobile: '9876543210',
      email: 'asha@school.test',
      status: 'ACTIVE',
    });
    expect(
      (await api('post', '/teachers', a, teacherBody(1, { fullName: 'Other' }))).body.error.code,
    ).toBe('STAFF_ID_IN_USE');
    const second = await api('post', '/teachers', a, teacherBody(2));
    expect(second.body.data.teacherCode).toBe('TCH-000002'); // a rejected duplicate wastes no number
  });

  it('validates the input', async () => {
    const a = await as('ADMIN');
    for (const bad of [
      { mobile: '12345' },
      { mobile: '5876543210' },
      { fullName: 'A' },
      { staffId: '  ' },
      { joiningDate: '2020-13-40' },
      { email: 'nope' },
      { gender: 'X' },
      { surprise: 1 },
    ])
      expect((await api('post', '/teachers', a, teacherBody(1, bad))).status).toBe(400);
  });

  it('edits, clears optional fields, blocks a staff id clash, and audits before/after', async () => {
    const a = await as('ADMIN');
    const one = await mkTeacher(a, 1, { email: 'one@school.test', qualification: 'B.Ed' });
    await mkTeacher(a, 2);
    const res = await api('patch', `/teachers/${one}`, a, {
      fullName: 'Renamed Teacher',
      email: null,
      qualification: '',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe('Renamed Teacher');
    expect(res.body.data.email).toBeUndefined();
    expect(res.body.data.qualification).toBeUndefined();
    expect((await api('patch', `/teachers/${one}`, a, { staffId: 'EMP-2' })).body.error.code).toBe(
      'STAFF_ID_IN_USE',
    );
    const e = h.auditStore.rows.find((r) => r.action === 'TEACHER_UPDATED');
    expect(e).toMatchObject({
      before: { fullName: 'Teacher 1', email: 'one@school.test' },
      after: { fullName: 'Renamed Teacher', email: null },
    });
    expect(
      (await api('patch', `/teachers/${'e'.repeat(24)}`, a, { fullName: 'Nobody' })).status,
    ).toBe(404);
  });

  it('searches by name, staff id, code and mobile; filters by status', async () => {
    const a = await as('ADMIN');
    await mkTeacher(a, 1, { fullName: 'Rahul Sharma' });
    const two = await mkTeacher(a, 2, { fullName: 'Meera Iyer' });
    await api('post', `/teachers/${two}/status`, a, { status: 'INACTIVE' });
    const find = async (q: string) =>
      (await api('get', `/teachers${q}`, a)).body.data.map((t: { fullName: string }) => t.fullName);
    expect(await find('?q=rahul')).toEqual(['Rahul Sharma']);
    expect(await find('?q=EMP-2')).toEqual(['Meera Iyer']);
    expect(await find('?q=TCH-000001')).toEqual(['Rahul Sharma']);
    expect(await find('?q=9876543212')).toEqual(['Meera Iyer']);
    expect(await find('?status=INACTIVE')).toEqual(['Meera Iyer']);
    expect(await find('')).toEqual(['Meera Iyer', 'Rahul Sharma']);
  });

  it('LEFT needs a leaving date; status changes are audited; no-op change is refused', async () => {
    const a = await as('ADMIN');
    const t = await mkTeacher(a, 1);
    expect((await api('post', `/teachers/${t}/status`, a, { status: 'LEFT' })).status).toBe(400);
    const left = await api('post', `/teachers/${t}/status`, a, {
      status: 'LEFT',
      leavingDate: '2026-09-30',
    });
    expect(left.body.data).toMatchObject({ status: 'LEFT', leavingDate: '2026-09-30' });
    expect(h.auditStore.rows.some((r) => r.action === 'TEACHER_LEFT')).toBe(true);
    const back = await api('post', `/teachers/${t}/status`, a, { status: 'ACTIVE' });
    expect(back.body.data.status).toBe('ACTIVE');
    expect(back.body.data.leavingDate).toBeUndefined();
    expect((await api('post', `/teachers/${t}/status`, a, { status: 'ACTIVE' })).status).toBe(409);
  });

  it('permissions: Registrar manages teachers; Auditor only views', async () => {
    const admin = await as('ADMIN');
    const registrar = await as('REGISTRAR');
    const auditor = await as('AUDITOR');
    const t = await mkTeacher(admin, 1);
    expect((await api('get', '/teachers', auditor)).status).toBe(200);
    expect((await api('post', '/teachers', auditor, teacherBody(9))).status).toBe(403);
    expect(
      (await api('patch', `/teachers/${t}`, registrar, { fullName: 'Edited Name' })).status,
    ).toBe(200);
    expect(
      (await api('post', `/teachers/${t}/status`, auditor, { status: 'INACTIVE' })).status,
    ).toBe(403);
    expect((await request(h.app).get('/api/v1/teachers')).status).toBe(401);
  });
});

describe('class-teacher assignment', () => {
  it('assigns, shows it as current, and one division can have only one class teacher', async () => {
    const a = await as('ADMIN');
    const { year, divs } = await school(a);
    const [t1, t2] = [await mkTeacher(a, 1), await mkTeacher(a, 2)];
    const body = { divisionId: divs[0], teacherId: t1, effectiveFrom: '2026-04-01' };
    const ok = await api('post', '/teacher-assignments', a, body);
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({
      isCurrent: true,
      effectiveTo: null,
      role: 'CLASS_TEACHER',
    });
    const second = await api('post', '/teacher-assignments', a, { ...body, teacherId: t2 });
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('DIVISION_ALREADY_HAS_TEACHER');
    const list = await api(
      'get',
      `/teacher-assignments?academicYearId=${year}&currentOnly=true`,
      a,
    );
    expect(list.body.data).toHaveLength(1);
    expect(h.auditStore.rows.some((r) => r.action === 'TEACHER_ASSIGNED')).toBe(true);
  });

  it('one teacher may take several divisions (default)', async () => {
    const a = await as('ADMIN');
    const { divs } = await school(a);
    const t = await mkTeacher(a, 1);
    for (const d of divs)
      expect(
        (
          await api('post', '/teacher-assignments', a, {
            divisionId: d,
            teacherId: t,
            effectiveFrom: '2026-04-01',
          })
        ).status,
      ).toBe(201);
  });

  it('with the setting switched off a teacher can hold only one division per year', async () => {
    const a = await as('ADMIN');
    const { divs } = await school(a);
    const t = await mkTeacher(a, 1);
    expect(
      (await api('put', '/settings/teacher.allowMultipleDivisions', a, { value: false })).status,
    ).toBe(200);
    const at = (d: string | undefined) =>
      api('post', '/teacher-assignments', a, {
        divisionId: d,
        teacherId: t,
        effectiveFrom: '2026-04-01',
      });
    expect((await at(divs[0])).status).toBe(201);
    const second = await at(divs[1]);
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('TEACHER_ALREADY_ASSIGNED');
  });

  it('only an active teacher, a date inside the year, and an open year', async () => {
    const a = await as('ADMIN');
    const { year, divs } = await school(a);
    const t = await mkTeacher(a, 1);
    await api('post', `/teachers/${t}/status`, a, { status: 'INACTIVE' });
    const base = { divisionId: divs[0], teacherId: t, effectiveFrom: '2026-04-01' };
    expect((await api('post', '/teacher-assignments', a, base)).body.error.code).toBe(
      'TEACHER_NOT_ACTIVE',
    );
    await api('post', `/teachers/${t}/status`, a, { status: 'ACTIVE' });
    expect(
      (await api('post', '/teacher-assignments', a, { ...base, effectiveFrom: '2025-01-01' })).body
        .error.code,
    ).toBe('EFFECTIVE_DATE_OUTSIDE_YEAR');
    expect(
      (await api('post', '/teacher-assignments', a, { ...base, divisionId: 'f'.repeat(24) })).body
        .error.code,
    ).toBe('DIVISION_NOT_FOUND');
    await api('post', `/academic-years/${year}/activate`, a);
    await api('post', `/academic-years/${year}/close`, a, { reason: 'Year finished' });
    expect((await api('post', '/teacher-assignments', a, base)).body.error.code).toBe(
      'YEAR_CLOSED',
    );
  });

  it('switched-off division cannot get a class teacher', async () => {
    const a = await as('ADMIN');
    const { divs } = await school(a);
    const t = await mkTeacher(a, 1);
    await api('patch', `/divisions/${divs[0]}`, a, { isActive: false });
    const res = await api('post', '/teacher-assignments', a, {
      divisionId: divs[0],
      teacherId: t,
      effectiveFrom: '2026-04-01',
    });
    expect(res.body.error.code).toBe('DIVISION_INACTIVE');
  });

  it('change closes the old row and opens a new one — history is kept, reason is mandatory', async () => {
    const a = await as('ADMIN');
    const { divs } = await school(a);
    const [t1, t2] = [await mkTeacher(a, 1), await mkTeacher(a, 2)];
    const first = (
      await api('post', '/teacher-assignments', a, {
        divisionId: divs[0],
        teacherId: t1,
        effectiveFrom: '2026-04-01',
      })
    ).body.data;
    const change = (over: object = {}) =>
      api('post', `/teacher-assignments/${first.id}/change`, a, {
        newTeacherId: t2,
        effectiveFrom: '2026-10-01',
        reason: 'Transferred to Class 6',
        ...over,
      });
    expect((await change({ reason: '' })).status).toBe(400);
    expect((await change({ effectiveFrom: '2026-04-01' })).body.error.code).toBe(
      'ASSIGNMENT_CHANGE_INVALID',
    );
    expect((await change({ newTeacherId: t1 })).body.error.code).toBe('ASSIGNMENT_CHANGE_INVALID');
    const ok = await change();
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      teacherId: t2,
      replacesAssignmentId: first.id,
      isCurrent: true,
    });

    const history = (await api('get', `/divisions/${divs[0]}/assignment-history`, a)).body.data;
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      id: first.id,
      isCurrent: false,
      effectiveTo: '2026-09-30',
      endReason: 'CHANGED',
    });
    // the closed row cannot be changed again
    expect((await change()).body.error.code).toBe('ASSIGNMENT_NOT_CURRENT');
    expect(h.auditStore.rows.find((r) => r.action === 'TEACHER_CHANGED')).toMatchObject({
      reason: 'Transferred to Class 6',
    });
  });

  it('end leaves the division without a class teacher and frees the teacher', async () => {
    const a = await as('ADMIN');
    const { divs } = await school(a);
    const t = await mkTeacher(a, 1);
    const row = (
      await api('post', '/teacher-assignments', a, {
        divisionId: divs[0],
        teacherId: t,
        effectiveFrom: '2026-04-01',
      })
    ).body.data;
    await api('post', `/teachers/${t}/status`, a, { status: 'INACTIVE' }).then((r) => {
      expect(r.body.error.code).toBe('TEACHER_HAS_ASSIGNMENTS');
      expect(r.body.error.message).toMatch(/class teacher of division A \(2026-27\)/);
    });
    const end = await api('post', `/teacher-assignments/${row.id}/end`, a, {
      effectiveTo: '2026-08-31',
      reason: 'Resigned',
    });
    expect(end.status).toBe(200);
    expect((await api('post', `/teachers/${t}/status`, a, { status: 'INACTIVE' })).status).toBe(
      200,
    );
    const list = await api('get', `/teacher-assignments?teacherId=${t}`, a);
    expect(list.body.data[0]).toMatchObject({ isCurrent: false, effectiveTo: '2026-08-31' });
    // a new teacher can now be assigned from September
    const t2 = await mkTeacher(a, 2);
    expect(
      (
        await api('post', '/teacher-assignments', a, {
          divisionId: divs[0],
          teacherId: t2,
          effectiveFrom: '2026-09-01',
        })
      ).status,
    ).toBe(201);
  });

  it('two simultaneous assignments to one division: exactly one wins', async () => {
    const a = await as('ADMIN');
    const { divs } = await school(a);
    const ids = [await mkTeacher(a, 1), await mkTeacher(a, 2), await mkTeacher(a, 3)];
    const results = await Promise.all(
      ids.map((teacherId) =>
        api('post', '/teacher-assignments', a, {
          divisionId: divs[0],
          teacherId,
          effectiveFrom: '2026-04-01',
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      results.filter((r) => r.status !== 201).every((r) => [409, 422].includes(r.status)),
    ).toBe(true);
  });

  it('permissions: Registrar assigns and changes; Auditor only views', async () => {
    const admin = await as('ADMIN');
    const registrar = await as('REGISTRAR');
    const auditor = await as('AUDITOR');
    const { divs } = await school(admin);
    const [t1, t2] = [await mkTeacher(admin, 1), await mkTeacher(admin, 2)];
    const body = { divisionId: divs[0], teacherId: t1, effectiveFrom: '2026-04-01' };
    expect((await api('post', '/teacher-assignments', auditor, body)).status).toBe(403);
    const made = await api('post', '/teacher-assignments', registrar, body);
    expect(made.status).toBe(201);
    expect((await api('get', '/teacher-assignments', auditor)).status).toBe(200);
    const change = { newTeacherId: t2, effectiveFrom: '2026-10-01', reason: 'Swap needed' };
    const denied = await api(
      'post',
      `/teacher-assignments/${made.body.data.id}/change`,
      auditor,
      change,
    );
    expect(denied.status).toBe(403);
  });
});
