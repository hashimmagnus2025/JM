import { DEFAULT_SETTINGS, SETTING_DEFS, SYSTEM_ROLES } from '@sfm/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildHttpHarness, type HttpHarness } from '../../testing/http-harness';
import { verifyChain } from '../audit/audit-chain';

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

const Y = (label: string, y: number) => ({
  label,
  startDate: `${y}-04-01`,
  endDate: `${y + 1}-03-31`,
});

describe('institution', () => {
  it('Admin reads and edits the profile; changes are audited with before/after', async () => {
    const a = await as('ADMIN');
    expect((await api('get', '/institution', a)).body.data).toMatchObject({
      name: 'Demo School',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    });
    const res = await api('patch', '/institution', a, {
      name: 'Jawahar Memorial School',
      shortName: 'JMS',
      address: {
        line1: '12 Station Road',
        city: 'Nagpur',
        state: 'Maharashtra',
        pincode: '440001',
      },
      contact: { phone: '0712 2345678', email: 'OFFICE@jms.test' },
      academicStartMonth: 6,
      receiptFooter: 'Fees once paid are not refundable.',
      extra: { 'UDISE code': '27011234567' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'Jawahar Memorial School',
      contact: { email: 'office@jms.test' },
      academicStartMonth: 6,
    });
    const e = h.auditStore.rows.find((r) => r.action === 'INSTITUTION_UPDATED');
    expect(e).toMatchObject({
      before: { name: 'Demo School' },
      after: { name: 'Jawahar Memorial School' },
    });
  });
  it('rejects bad values and fields that must not be edited (time zone, currency, code)', async () => {
    const a = await as('ADMIN');
    expect((await api('patch', '/institution', a, { timezone: 'UTC' })).status).toBe(400);
    expect((await api('patch', '/institution', a, { currency: 'USD' })).status).toBe(400);
    expect((await api('patch', '/institution', a, { code: 'HACK' })).status).toBe(400);
    expect((await api('patch', '/institution', a, { academicStartMonth: 13 })).status).toBe(400);
    expect((await api('patch', '/institution', a, { contact: { email: 'nope' } })).status).toBe(
      400,
    );
    expect((await api('patch', '/institution', a, { name: 'X' })).status).toBe(400);
  });
  it('a Fee Collector can neither view nor edit it', async () => {
    const c = await as('FEE_COLLECTOR');
    expect((await api('get', '/institution', c)).status).toBe(403);
    expect((await api('patch', '/institution', c, { name: 'Mine' })).status).toBe(403);
  });
});

describe('settings', () => {
  it('lists every setting with its default, current value and rule reference', async () => {
    const a = await as('ADMIN');
    const res = await api('get', '/settings', a);
    expect(res.body.data).toHaveLength(SETTING_DEFS.length);
    const due = res.body.data.find((s: { key: string }) => s.key === 'status.dueSoonDays');
    expect(due).toMatchObject({
      value: 7,
      default: 7,
      isDefault: true,
      rule: 'BRC-I1',
      group: 'Fees & status',
    });
  });
  it('changes a setting, validates it, audits it, and the typed provider sees it immediately', async () => {
    const a = await as('ADMIN');
    const res = await api('put', '/settings/status.dueSoonDays', a, {
      value: 10,
      reason: 'Parents asked for earlier notice',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ value: 10, isDefault: false });
    expect((await h.setup.settings.get())['status.dueSoonDays']).toBe(10);
    expect(h.auditStore.rows.find((r) => r.action === 'SETTING_CHANGED')).toMatchObject({
      entityId: 'status.dueSoonDays',
      before: { value: 7 },
      after: { value: 10 },
      reason: 'Parents asked for earlier notice',
    });
  });
  it("rejects invalid values with the setting's own message; unknown keys are 404", async () => {
    const a = await as('ADMIN');
    expect(
      (await api('put', '/settings/status.dueSoonDays', a, { value: -3 })).body.error.code,
    ).toBe('SETTING_INVALID');
    expect(
      (await api('put', '/settings/aging.boundaries', a, { value: [90, 60, 30] })).body.error
        .message,
    ).toMatch(/larger/);
    expect(
      (
        await api('put', '/settings/receipt.numbering', a, {
          value: { prefix: 'rec', scope: 'NONE', pad: 6 },
        })
      ).status,
    ).toBe(400);
    expect((await api('put', '/settings/no.such.key', a, { value: 1 })).status).toBe(404);
    expect(
      (await api('put', '/settings/status.dueSoonDays', a, { value: 5, extra: 1 })).status,
    ).toBe(400);
  });
  it('the reversal-approval threshold has no hard-coded amount: null by default, settable, clearable (BRC-E6)', async () => {
    const a = await as('ADMIN');
    expect((await h.setup.settings.get())['reversal.approval.thresholdPaise']).toBeNull();
    await api('put', '/settings/reversal.approval.thresholdPaise', a, { value: 5_000_000 });
    expect((await h.setup.settings.get())['reversal.approval.thresholdPaise']).toBe(5_000_000);
    expect(
      (await api('put', '/settings/reversal.approval.thresholdPaise', a, { value: 0 })).status,
    ).toBe(400);
    await api('put', '/settings/reversal.approval.thresholdPaise', a, { value: null });
    expect((await h.setup.settings.get())['reversal.approval.thresholdPaise']).toBeNull();
  });
  it('reset returns to the default and is audited', async () => {
    const a = await as('ADMIN');
    await api('put', '/settings/advance.enabled', a, { value: true });
    expect((await h.setup.settings.get())['advance.enabled']).toBe(true);
    const res = await api('delete', '/settings/advance.enabled', a);
    expect(res.body.data).toMatchObject({ value: false, isDefault: true });
    expect(h.auditStore.rows.map((r) => r.action)).toContain('SETTING_RESET');
  });
  it('a stored value that no longer validates falls back to the default instead of breaking the system', async () => {
    await h.setup.repos.settings.set('status.dueSoonDays', 'garbage', undefined, new Date());
    expect((await h.setup.settings.get())['status.dueSoonDays']).toBe(
      DEFAULT_SETTINGS['status.dueSoonDays'],
    );
  });
  it('only settings.manage may change them; the Auditor can only look', async () => {
    const au = await as('AUDITOR');
    expect((await api('get', '/settings', au)).status).toBe(200);
    expect((await api('put', '/settings/status.dueSoonDays', au, { value: 3 })).status).toBe(403);
    expect((await api('delete', '/settings/status.dueSoonDays', au)).status).toBe(403);
    const col = await as('FEE_COLLECTOR');
    expect((await api('get', '/settings', col)).status).toBe(403);
  });
});

describe('academic years', () => {
  it('creates, lists (newest first) and reads years; label must agree with the dates', async () => {
    const a = await as('REGISTRAR');
    const made = await api('post', '/academic-years', a, Y('2025-26', 2025));
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ label: '2025-26', status: 'PLANNED', isCurrent: false });
    await api('post', '/academic-years', a, Y('2026-27', 2026));
    expect(
      (await api('get', '/academic-years', a)).body.data.map((y: { label: string }) => y.label),
    ).toEqual(['2026-27', '2025-26']);
    expect((await api('get', `/academic-years/${made.body.data.id}`, a)).body.data.label).toBe(
      '2025-26',
    );
    expect(
      (
        await api('post', '/academic-years', a, {
          label: '2027-28',
          startDate: '2026-04-01',
          endDate: '2027-03-31',
        })
      ).body.error.code,
    ).toBe('YEAR_INVALID');
    expect(
      (
        await api('post', '/academic-years', a, {
          label: '2027-28',
          startDate: '2027-02-30',
          endDate: '2028-03-31',
        })
      ).status,
    ).toBe(400);
    expect((await api('get', '/academic-years/not-an-id', a)).status).toBe(400);
    expect((await api('get', '/academic-years/0123456789abcdef01234567', a)).body.error.code).toBe(
      'YEAR_NOT_FOUND',
    );
  });
  it('refuses overlapping dates and duplicate labels', async () => {
    const a = await as('REGISTRAR');
    await api('post', '/academic-years', a, Y('2026-27', 2026));
    const overlap = await api('post', '/academic-years', a, {
      label: '2026-27',
      startDate: '2026-10-01',
      endDate: '2027-09-30',
    });
    expect([overlap.status, overlap.body.error.code]).toEqual([422, 'YEAR_OVERLAP']);
    const dup = await api('post', '/academic-years', a, {
      label: '2026-27',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
    });
    expect(dup.status).toBe(422); // same dates → overlap is checked first
    await h.setup.repos.years.rows.clear();
    await api('post', '/academic-years', a, Y('2026-27', 2026));
    expect(
      (
        await api('post', '/academic-years', a, {
          label: '2026-27',
          startDate: '2027-04-01',
          endDate: '2028-03-31',
        })
      ).body.error.code,
    ).toBe('YEAR_INVALID');
  });
  it('exactly one current year: setting a new one unsets the old and activates a planned year', async () => {
    const a = await as('REGISTRAR');
    const y26 = (await api('post', '/academic-years', a, Y('2026-27', 2026))).body.data;
    const y27 = (await api('post', '/academic-years', a, Y('2027-28', 2027))).body.data;
    const first = await api('post', `/academic-years/${y26.id}/set-current`, a);
    expect(first.body.data).toMatchObject({ isCurrent: true, status: 'ACTIVE' });
    const second = await api('post', `/academic-years/${y27.id}/set-current`, a);
    expect(second.body.data).toMatchObject({ isCurrent: true, status: 'ACTIVE' });
    const all = (await api('get', '/academic-years', a)).body.data as {
      isCurrent: boolean;
      label: string;
      status: string;
    }[];
    expect(all.filter((y) => y.isCurrent).map((y) => y.label)).toEqual(['2027-28']);
    expect(all.find((y) => y.label === '2026-27')).toMatchObject({
      isCurrent: false,
      status: 'ACTIVE',
    });
    expect((await api('get', '/academic-years/current', a)).body.data.label).toBe('2027-28');
    expect(
      h.auditStore.rows.filter((r) => r.action === 'ACADEMIC_YEAR_SET_CURRENT').pop(),
    ).toMatchObject({ before: { current: '2026-27' }, after: { current: '2027-28' } });
  });
  it('no current year yet → null', async () => {
    const a = await as('REGISTRAR');
    expect((await api('get', '/academic-years/current', a)).body.data).toBeNull();
  });
  it('only a PLANNED year can be edited — history stays unchanged (SOW §4)', async () => {
    const a = await as('REGISTRAR');
    const y = (await api('post', '/academic-years', a, Y('2026-27', 2026))).body.data;
    const edit = await api('patch', `/academic-years/${y.id}`, a, { endDate: '2027-03-30' });
    expect(edit.body.data.endDate).toBe('2027-03-30');
    expect(h.auditStore.rows.find((r) => r.action === 'ACADEMIC_YEAR_UPDATED')).toMatchObject({
      before: { endDate: '2027-03-31' },
      after: { endDate: '2027-03-30' },
    });
    await api('post', `/academic-years/${y.id}/activate`, a);
    const locked = await api('patch', `/academic-years/${y.id}`, a, { endDate: '2027-03-31' });
    expect([locked.status, locked.body.error.code]).toEqual([422, 'YEAR_LOCKED']);
  });
  it('activate / deactivate follow the allowed transitions; the current year and a year with data cannot go back to planned', async () => {
    const a = await as('REGISTRAR');
    const y = (await api('post', '/academic-years', a, Y('2026-27', 2026))).body.data;
    expect((await api('post', `/academic-years/${y.id}/deactivate`, a)).body.error.code).toBe(
      'YEAR_STATUS_INVALID',
    );
    expect((await api('post', `/academic-years/${y.id}/activate`, a)).body.data.status).toBe(
      'ACTIVE',
    );
    expect((await api('post', `/academic-years/${y.id}/activate`, a)).body.error.code).toBe(
      'YEAR_STATUS_INVALID',
    );
    h.setup.guards.current = { closeBlockers: async () => [], hasData: async () => true };
    expect((await api('post', `/academic-years/${y.id}/deactivate`, a)).body.error.code).toBe(
      'YEAR_HAS_DATA',
    );
    h.setup.guards.current = { closeBlockers: async () => [], hasData: async () => false };
    expect((await api('post', `/academic-years/${y.id}/deactivate`, a)).body.data.status).toBe(
      'PLANNED',
    );
    await api('post', `/academic-years/${y.id}/set-current`, a);
    expect((await api('post', `/academic-years/${y.id}/deactivate`, a)).body.error.code).toBe(
      'YEAR_IS_CURRENT',
    );
  });
  it('closing needs academicYear.close, a reason, no blockers, and never works on the current year; reopening is audited', async () => {
    const reg = await as('REGISTRAR');
    const adm = await as('ADMIN');
    const old = (await api('post', '/academic-years', reg, Y('2025-26', 2025))).body.data;
    const cur = (await api('post', '/academic-years', reg, Y('2026-27', 2026))).body.data;
    await api('post', `/academic-years/${old.id}/activate`, reg);
    await api('post', `/academic-years/${cur.id}/set-current`, reg);
    expect(
      (await api('post', `/academic-years/${old.id}/close`, reg, { reason: 'year ended' })).status,
    ).toBe(403); // Registrar lacks academicYear.close
    expect((await api('post', `/academic-years/${old.id}/close`, adm, {})).status).toBe(400); // reason required
    const bad = await api('post', `/academic-years/${cur.id}/close`, adm, {
      reason: 'ended early',
    });
    expect([bad.status, bad.body.error.code]).toEqual([409, 'YEAR_CLOSE_BLOCKED']);
    expect(bad.body.error.details[0]).toMatch(/current academic year/);
    h.setup.guards.current = {
      closeBlockers: async () => ['2 payment reversals are waiting for approval'],
      hasData: async () => false,
    };
    expect(
      (await api('post', `/academic-years/${old.id}/close`, adm, { reason: 'year ended' })).body
        .error.details,
    ).toEqual(['2 payment reversals are waiting for approval']);
    h.setup.guards.current = { closeBlockers: async () => [], hasData: async () => false };
    const closed = await api('post', `/academic-years/${old.id}/close`, adm, {
      reason: 'Year ended, books reconciled',
    });
    expect(closed.body.data).toMatchObject({ status: 'CLOSED' });
    expect(closed.body.data.closedAt).toBeTruthy();
    expect((await api('post', `/academic-years/${old.id}/set-current`, adm)).body.error.code).toBe(
      'YEAR_CLOSED',
    );
    expect(
      (await api('patch', `/academic-years/${old.id}`, reg, { label: '2025-26' })).body.error.code,
    ).toBe('YEAR_LOCKED');
    const reopened = await api('post', `/academic-years/${old.id}/reopen`, adm, {
      reason: 'Late fee correction',
    });
    expect(reopened.body.data.status).toBe('ACTIVE');
    expect(h.auditStore.rows.find((r) => r.action === 'ACADEMIC_YEAR_REOPENED')).toMatchObject({
      reason: 'Late fee correction',
    });
    expect(
      (await api('post', `/academic-years/${old.id}/reopen`, adm, { reason: 'again' })).body.error
        .code,
    ).toBe('YEAR_STATUS_INVALID');
  });
  it('only a CLOSED year can be reopened — reopening must never be a back door for activating a planned year', async () => {
    const adm = await as('ADMIN');
    const planned = (await api('post', '/academic-years', adm, Y('2026-27', 2026))).body.data;
    const res = await api('post', `/academic-years/${planned.id}/reopen`, adm, {
      reason: 'trying to activate',
    });
    expect([res.status, res.body.error.code]).toEqual([409, 'YEAR_NOT_CLOSED']);
    expect((await api('get', `/academic-years/${planned.id}`, adm)).body.data.status).toBe(
      'PLANNED',
    );
  });
  it('suggests the next year', async () => {
    const a = await as('REGISTRAR');
    expect((await api('get', '/academic-years/suggest-next', a)).body.data).toBeNull();
    await api('post', '/academic-years', a, Y('2026-27', 2026));
    expect((await api('get', '/academic-years/suggest-next', a)).body.data).toEqual({
      label: '2027-28',
      startDate: '2027-04-01',
      endDate: '2028-03-31',
    });
  });
  it('permissions: collectors may view years but not manage; nobody without view sees them', async () => {
    const reg = await as('REGISTRAR');
    await api('post', '/academic-years', reg, Y('2026-27', 2026));
    const col = await as('FEE_COLLECTOR');
    expect((await api('get', '/academic-years', col)).status).toBe(200);
    expect((await api('post', '/academic-years', col, Y('2027-28', 2027))).status).toBe(403);
    const comms = await as('COMMS_OFFICER');
    expect((await api('get', '/academic-years', comms)).status).toBe(200);
    expect(
      (await api('post', '/academic-years/0123456789abcdef01234567/set-current', comms)).status,
    ).toBe(403);
  });
});

describe('student categories', () => {
  it('creates, orders, renames, deactivates; the code is permanent and unique; nothing is deleted', async () => {
    const a = await as('REGISTRAR');
    const g = await api('post', '/student-categories', a, { code: 'GENERAL', name: 'General' });
    expect(g.status).toBe(201);
    await api('post', '/student-categories', a, { code: 'RTE', name: 'RTE (free seat)' });
    await api('post', '/student-categories', a, {
      code: 'STAFF_WARD',
      name: 'Staff ward',
      sequence: 0,
    });
    expect(
      (await api('get', '/student-categories', a)).body.data.map((c: { code: string }) => c.code),
    ).toEqual(['STAFF_WARD', 'GENERAL', 'RTE']);
    expect(
      (await api('post', '/student-categories', a, { code: 'GENERAL', name: 'Again' })).body.error
        .code,
    ).toBe('CATEGORY_CODE_IN_USE');
    expect(
      (await api('post', '/student-categories', a, { code: 'general', name: 'Bad code' })).status,
    ).toBe(400);
    const upd = await api('patch', `/student-categories/${g.body.data.id}`, a, {
      name: 'General category',
      isActive: false,
    });
    expect(upd.body.data).toMatchObject({
      code: 'GENERAL',
      name: 'General category',
      isActive: false,
    });
    expect(
      (await api('patch', `/student-categories/${g.body.data.id}`, a, { code: 'CHANGED' })).status,
    ).toBe(400);
    expect(
      (await api('patch', '/student-categories/0123456789abcdef01234567', a, { name: 'Nope' })).body
        .error.code,
    ).toBe('CATEGORY_NOT_FOUND');
    expect((await api('delete', `/student-categories/${g.body.data.id}`, a)).status).toBe(404);
  });
  it('viewing needs studentCategory.view; managing needs studentCategory.manage', async () => {
    const col = await as('FEE_COLLECTOR');
    expect((await api('get', '/student-categories', col)).status).toBe(403);
    const acc = await as('ACCOUNTANT');
    expect((await api('get', '/student-categories', acc)).status).toBe(200);
    expect((await api('post', '/student-categories', acc, { code: 'X1', name: 'Xx' })).status).toBe(
      403,
    );
  });
});

describe('PERMISSION MATRIX for the setup routes', () => {
  const some = '0123456789abcdef01234567';
  const routes: {
    method: 'get' | 'post' | 'patch' | 'put' | 'delete';
    path: string;
    perm: string;
    body?: object;
  }[] = [
    { method: 'get', path: '/institution', perm: 'institution.view' },
    {
      method: 'patch',
      path: '/institution',
      perm: 'institution.manage',
      body: { name: 'Some School' },
    },
    { method: 'get', path: '/settings', perm: 'settings.view' },
    {
      method: 'put',
      path: '/settings/status.dueSoonDays',
      perm: 'settings.manage',
      body: { value: 7 },
    },
    { method: 'delete', path: '/settings/status.dueSoonDays', perm: 'settings.manage' },
    { method: 'get', path: '/academic-years', perm: 'academicYear.view' },
    { method: 'get', path: '/academic-years/current', perm: 'academicYear.view' },
    { method: 'get', path: '/academic-years/suggest-next', perm: 'academicYear.manage' },
    {
      method: 'post',
      path: '/academic-years',
      perm: 'academicYear.manage',
      body: Y('2030-31', 2030),
    },
    { method: 'get', path: `/academic-years/${some}`, perm: 'academicYear.view' },
    {
      method: 'patch',
      path: `/academic-years/${some}`,
      perm: 'academicYear.manage',
      body: { label: '2031-32' },
    },
    { method: 'post', path: `/academic-years/${some}/activate`, perm: 'academicYear.manage' },
    { method: 'post', path: `/academic-years/${some}/deactivate`, perm: 'academicYear.manage' },
    { method: 'post', path: `/academic-years/${some}/set-current`, perm: 'academicYear.manage' },
    {
      method: 'post',
      path: `/academic-years/${some}/close`,
      perm: 'academicYear.close',
      body: { reason: 'done' },
    },
    {
      method: 'post',
      path: `/academic-years/${some}/reopen`,
      perm: 'academicYear.close',
      body: { reason: 'fix' },
    },
    { method: 'get', path: '/student-categories', perm: 'studentCategory.view' },
    {
      method: 'post',
      path: '/student-categories',
      perm: 'studentCategory.manage',
      body: { code: 'ZZ', name: 'Zed zed' },
    },
    {
      method: 'patch',
      path: `/student-categories/${some}`,
      perm: 'studentCategory.manage',
      body: { name: 'Renamed' },
    },
  ];
  for (const role of SYSTEM_ROLES) {
    it(`${role.key}: 403 exactly where the permission is missing`, async () => {
      const auth = await as(role.key);
      for (const r of routes) {
        const res = await api(r.method, r.path, auth, r.body);
        const holds = (role.permissions as readonly string[]).includes(r.perm);
        if (holds) expect(res.status, `${role.key} ${r.method} ${r.path}`).not.toBe(403);
        else expect(res.status, `${role.key} ${r.method} ${r.path}`).toBe(403);
      }
    });
  }
});

describe('audit trail of the setup actions', () => {
  it('forms one valid hash chain', async () => {
    const adm = await as('ADMIN');
    await api('patch', '/institution', adm, { name: 'Audit School' });
    await api('put', '/settings/advance.enabled', adm, { value: true });
    const reg = await as('REGISTRAR');
    await api('post', '/academic-years', reg, Y('2026-27', 2026));
    expect(verifyChain(h.auditStore.rows)).toMatchObject({ ok: true });
    expect(h.auditStore.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['INSTITUTION_UPDATED', 'SETTING_CHANGED', 'ACADEMIC_YEAR_CREATED']),
    );
  });
});
