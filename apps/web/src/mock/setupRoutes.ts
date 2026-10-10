/**
 * DEMO MODE: replaces `fetch` for /api/v1 so the real screens run with no server. Everything lives in memory
 * and is lost on reload. The real backend is untouched; this file is not part of the production build.
 */
import { SETTING_DEFS, SYSTEM_ROLES, isSettingKey, resolveSettings, settingDef } from '@sfm/shared';
import {
  addDaysISO,
  assignments,
  categories,
  classes,
  divisions,
  institution,
  teachers,
  years,
  type DYear,
} from './data';
import { useMockRole } from './role';

export type Handler = (ctx: {
  params: string[];
  query: URLSearchParams;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: Record<string, string>;
}) => Out;
export type Out = {
  status?: number;
  data?: unknown;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
};

export const ok = (data: unknown, status = 200): Out => ({ status, data });
export const fail = (status: number, code: string, message: string, details?: unknown): Out => ({
  status,
  error: { code, message, ...(details !== undefined ? { details } : {}) },
});
const newId = (p: string): string => `${p}${Math.random().toString(36).slice(2, 9)}`;

const PEOPLE: Record<string, { id: string; name: string; email: string }> = {
  SUPER_ADMIN: { id: 'u1', name: 'Anil Kulkarni', email: 'principal@jms.example' },
  ADMIN: { id: 'u2', name: 'Rekha Deshmukh', email: 'admin@jms.example' },
  REGISTRAR: { id: 'u7', name: 'Shobha Gaikwad', email: 'registrar@jms.example' },
  ACCOUNTANT: { id: 'u6', name: 'Vikas Pande', email: 'accounts@jms.example' },
  FEE_COLLECTOR: { id: 'u3', name: 'Sandeep Rao', email: 'sandeep@jms.example' },
  AUDITOR: { id: 'u8', name: 'CA Mohan Lal', email: 'audit@jms.example' },
};
export const personFor = (role: string) => PEOPLE[role] ?? PEOPLE.SUPER_ADMIN!;

let signedOut = false;
const session = () => {
  const role = useMockRole.getState().role;
  const p = personFor(role);
  return {
    accessToken: 'demo-token',
    expiresIn: 900,
    user: { ...p, roleKeys: [role], mustChangePassword: false },
  };
};
const principal = () => {
  const role = useMockRole.getState().role;
  const r = SYSTEM_ROLES.find((x) => x.key === role) ?? SYSTEM_ROLES[0]!;
  return {
    ...personFor(role),
    roleKeys: [role],
    permissions: [...r.permissions],
    dataScope: 'ALL',
    mustChangePassword: false,
  };
};

const settingValues: Record<string, unknown> = {};
const settingMeta: Record<string, string> = {};
const settingView = (key: string) => {
  const d = SETTING_DEFS.find((x) => x.key === key)!;
  const { settings } = resolveSettings(settingValues);
  const value = (settings as Record<string, unknown>)[key];
  return {
    key: d.key,
    group: d.group,
    label: d.label,
    description: d.description,
    rule: 'rule' in d ? d.rule : undefined,
    value,
    default: d.default,
    isDefault: !(key in settingValues) || JSON.stringify(value) === JSON.stringify(d.default),
    updatedAt: settingMeta[key],
  };
};

const find = <T extends { id: string }>(a: T[], id: string | undefined): T | undefined =>
  a.find((x) => x.id === id);
const activeAssignments = (divisionId: string) =>
  assignments.find((a) => a.divisionId === divisionId && a.isCurrent);
const yearById = (id: string) => years.find((y) => y.id === id);

export const setupRoutes: [string, RegExp, Handler][] = [
  /* auth */
  [
    'POST',
    /^\/auth\/login$/,
    () => {
      signedOut = false;
      return ok(session());
    },
  ],
  [
    'POST',
    /^\/auth\/refresh$/,
    () => (signedOut ? fail(401, 'UNAUTHENTICATED', 'Please sign in.') : ok(session())),
  ],
  [
    'POST',
    /^\/auth\/logout$/,
    () => {
      signedOut = true;
      return ok({ ok: true });
    },
  ],
  ['GET', /^\/auth\/me$/, () => ok(principal())],

  /* institution & settings */
  ['GET', /^\/institution$/, () => ok(institution)],
  ['PATCH', /^\/institution$/, ({ body }) => ok(Object.assign(institution, body))],
  ['GET', /^\/settings$/, () => ok(SETTING_DEFS.map((d) => settingView(d.key)))],
  [
    'PUT',
    /^\/settings\/([\w.]+)$/,
    ({ params, body }) => {
      const key = params[0]!;
      if (!isSettingKey(key)) return fail(404, 'SETTING_NOT_FOUND', 'Unknown setting.');
      const parsed = settingDef(key).schema.safeParse(body.value);
      if (!parsed.success)
        return fail(400, 'SETTING_INVALID', parsed.error.issues[0]?.message ?? 'Invalid value.');
      settingValues[key] = parsed.data;
      settingMeta[key] = new Date().toISOString();
      return ok(settingView(key));
    },
  ],
  [
    'DELETE',
    /^\/settings\/([\w.]+)$/,
    ({ params }) => {
      delete settingValues[params[0]!];
      return ok(settingView(params[0]!));
    },
  ],

  /* academic years */
  [
    'GET',
    /^\/academic-years$/,
    ({ query }) => {
      const st = query.get('status');
      return ok(
        years
          .filter((y) => !st || y.status === st)
          .sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
      );
    },
  ],
  ['GET', /^\/academic-years\/current$/, () => ok(years.find((y) => y.isCurrent) ?? null)],
  [
    'GET',
    /^\/academic-years\/suggest-next$/,
    () => {
      const last = [...years].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0]!;
      const y = Number(last.startDate.slice(0, 4)) + 1;
      return ok({
        label: `${y}-${String((y + 1) % 100).padStart(2, '0')}`,
        startDate: `${y}-04-01`,
        endDate: `${y + 1}-03-31`,
      });
    },
  ],
  [
    'POST',
    /^\/academic-years$/,
    ({ body }) => {
      if (years.some((y) => y.label === body.label))
        return fail(409, 'YEAR_LABEL_IN_USE', `${body.label} already exists.`);
      if (years.some((y) => body.startDate <= y.endDate && body.endDate >= y.startDate))
        return fail(422, 'YEAR_OVERLAP', 'These dates overlap with another academic year.');
      const y: DYear = {
        id: newId('y'),
        label: body.label,
        startDate: body.startDate,
        endDate: body.endDate,
        status: 'PLANNED',
        isCurrent: false,
      };
      years.push(y);
      return ok(y, 201);
    },
  ],
  [
    'PATCH',
    /^\/academic-years\/(\w+)$/,
    ({ params, body }) => {
      const y = yearById(params[0]!);
      if (!y) return fail(404, 'YEAR_NOT_FOUND', 'Academic year not found.');
      if (y.status !== 'PLANNED')
        return fail(
          422,
          'YEAR_LOCKED',
          'This year is no longer planned, so it cannot be edited any more.',
        );
      return ok(Object.assign(y, body));
    },
  ],
  [
    'POST',
    /^\/academic-years\/(\w+)\/(activate|deactivate|set-current|close|reopen)$/,
    ({ params }) => {
      const y = yearById(params[0]!);
      if (!y) return fail(404, 'YEAR_NOT_FOUND', 'Academic year not found.');
      const act = params[1]!;
      if (act === 'activate') y.status = 'ACTIVE';
      if (act === 'deactivate') {
        if (y.isCurrent)
          return fail(
            409,
            'YEAR_IS_CURRENT',
            'This is the current academic year. Make another year current first.',
          );
        if (divisions.some((d) => d.academicYearId === y.id))
          return fail(
            409,
            'YEAR_HAS_DATA',
            'This year already has divisions, students or fees and cannot go back to planned.',
          );
        y.status = 'PLANNED';
      }
      if (act === 'set-current') {
        for (const o of years) o.isCurrent = false;
        y.isCurrent = true;
        y.status = 'ACTIVE';
      }
      if (act === 'close') {
        if (y.isCurrent)
          return fail(409, 'YEAR_CLOSE_BLOCKED', 'This year cannot be closed yet.', [
            'It is the current academic year.',
          ]);
        y.status = 'CLOSED';
      }
      if (act === 'reopen') y.status = 'ACTIVE';
      return ok(y);
    },
  ],

  /* categories */
  [
    'GET',
    /^\/student-categories$/,
    () => ok([...categories].sort((a, b) => a.sequence - b.sequence)),
  ],
  [
    'POST',
    /^\/student-categories$/,
    ({ body }) => {
      if (categories.some((c) => c.code === body.code))
        return fail(409, 'CATEGORY_CODE_IN_USE', 'A category with this code already exists.');
      const c = {
        id: newId('cat'),
        code: body.code,
        name: body.name,
        isActive: true,
        sequence: categories.length + 1,
      };
      categories.push(c);
      return ok(c, 201);
    },
  ],
  [
    'PATCH',
    /^\/student-categories\/(\w+)$/,
    ({ params, body }) => {
      const c = find(categories, params[0]);
      return c
        ? ok(Object.assign(c, body))
        : fail(404, 'CATEGORY_NOT_FOUND', 'Student category not found.');
    },
  ],

  /* classes */
  ['GET', /^\/classes$/, () => ok([...classes].sort((a, b) => a.sequence - b.sequence))],
  [
    'POST',
    /^\/classes$/,
    ({ body }) => {
      if (classes.some((c) => c.code === body.code))
        return fail(409, 'CLASS_CODE_IN_USE', 'A class with this code already exists.');
      const c = {
        id: newId('c'),
        code: body.code,
        name: body.name,
        sequence: classes.length + 1,
        isActive: true,
        isFinal: !!body.isFinal,
      };
      classes.push(c);
      return ok(c, 201);
    },
  ],
  [
    'PUT',
    /^\/classes\/order$/,
    ({ body }) => {
      (body.ids as string[]).forEach((id, i) => {
        const c = find(classes, id);
        if (c) c.sequence = i + 1;
      });
      return ok([...classes].sort((a, b) => a.sequence - b.sequence));
    },
  ],
  [
    'PATCH',
    /^\/classes\/(\w+)$/,
    ({ params, body }) => {
      const c = find(classes, params[0]);
      if (!c) return fail(404, 'CLASS_NOT_FOUND', 'Class not found.');
      if (body.isActive === false && divisions.some((d) => d.classId === c.id && d.isActive))
        return fail(
          409,
          'CLASS_HAS_ACTIVE_DIVISIONS',
          'This class still has active divisions. Deactivate them first.',
        );
      return ok(Object.assign(c, body));
    },
  ],

  /* divisions */
  [
    'GET',
    /^\/divisions$/,
    ({ query }) => {
      const y = query.get('academicYearId');
      const c = query.get('classId');
      return ok(divisions.filter((d) => (!y || d.academicYearId === y) && (!c || d.classId === c)));
    },
  ],
  [
    'POST',
    /^\/divisions\/clone$/,
    ({ body }) => {
      let created = 0;
      let skipped = 0;
      for (const d of divisions.filter((x) => x.academicYearId === body.fromYearId && x.isActive)) {
        if (
          divisions.some(
            (x) =>
              x.academicYearId === body.toYearId &&
              x.classId === d.classId &&
              x.name.toUpperCase() === d.name.toUpperCase(),
          )
        )
          skipped++;
        else {
          divisions.push({ ...d, id: newId('d'), academicYearId: body.toYearId });
          created++;
        }
      }
      return ok({ created, skipped });
    },
  ],
  [
    'POST',
    /^\/divisions$/,
    ({ body }) => {
      const yr = yearById(body.academicYearId);
      if (yr?.status === 'CLOSED')
        return fail(
          409,
          'YEAR_CLOSED',
          `${yr.label} is closed. Reopen it to change its divisions.`,
        );
      if (
        divisions.some(
          (d) =>
            d.academicYearId === body.academicYearId &&
            d.classId === body.classId &&
            d.name.toUpperCase() === String(body.name).toUpperCase(),
        )
      )
        return fail(409, 'DIVISION_EXISTS', `${body.name} already exists in this class and year.`);
      const d = {
        id: newId('d'),
        academicYearId: body.academicYearId,
        classId: body.classId,
        name: String(body.name).trim(),
        capacity: body.capacity,
        isActive: true,
      };
      divisions.push(d);
      return ok(d, 201);
    },
  ],
  [
    'PATCH',
    /^\/divisions\/(\w+)$/,
    ({ params, body }) => {
      const d = find(divisions, params[0]);
      if (!d) return fail(404, 'DIVISION_NOT_FOUND', 'Division not found.');
      if (body.capacity === null) delete d.capacity;
      return ok(
        Object.assign(d, { ...body, ...(body.capacity === null ? { capacity: undefined } : {}) }),
      );
    },
  ],

  /* teachers & class teachers */
  [
    'GET',
    /^\/teachers$/,
    ({ query }) => {
      const q = (query.get('q') ?? '').toLowerCase();
      const st = query.get('status');
      return ok(
        teachers
          .filter(
            (t) =>
              (!st || t.status === st) &&
              (!q ||
                [t.fullName, t.staffId, t.teacherCode, t.mobile].some((v) =>
                  v.toLowerCase().includes(q),
                )),
          )
          .sort((a, b) => a.fullName.localeCompare(b.fullName)),
      );
    },
  ],
  [
    'POST',
    /^\/teachers$/,
    ({ body }) => {
      if (teachers.some((t) => t.staffId === body.staffId))
        return fail(409, 'STAFF_ID_IN_USE', `Staff ID ${body.staffId} is already used.`);
      const t = {
        ...body,
        id: newId('t'),
        teacherCode: `TCH-${String(teachers.length + 1).padStart(6, '0')}`,
        status: 'ACTIVE' as const,
        mobile: String(body.mobile).replace(/\D/g, '').slice(-10),
      };
      teachers.push(t);
      return ok(t, 201);
    },
  ],
  [
    'GET',
    /^\/teachers\/(\w+)\/assignments$/,
    ({ params }) => ok(assignments.filter((a) => a.teacherId === params[0])),
  ],
  [
    'GET',
    /^\/teachers\/(\w+)$/,
    ({ params }) => {
      const t = find(teachers, params[0]);
      return t ? ok(t) : fail(404, 'TEACHER_NOT_FOUND', 'Teacher not found.');
    },
  ],
  [
    'PATCH',
    /^\/teachers\/(\w+)$/,
    ({ params, body }) => {
      const t = find(teachers, params[0]);
      if (!t) return fail(404, 'TEACHER_NOT_FOUND', 'Teacher not found.');
      const clean = Object.fromEntries(
        Object.entries(body).map(([k, v]) => [k, v === null ? undefined : v]),
      );
      return ok(Object.assign(t, clean));
    },
  ],
  [
    'POST',
    /^\/teachers\/(\w+)\/status$/,
    ({ params, body }) => {
      const t = find(teachers, params[0]);
      if (!t) return fail(404, 'TEACHER_NOT_FOUND', 'Teacher not found.');
      const held = assignments.filter((a) => a.teacherId === t.id && a.isCurrent);
      if (body.status !== 'ACTIVE' && held.length > 0) {
        const d = find(divisions, held[0]!.divisionId);
        const cls = classes.find((c) => c.id === d?.classId);
        return fail(
          409,
          'TEACHER_HAS_ASSIGNMENTS',
          `${t.fullName} is class teacher of ${cls?.name ?? ''} ${d?.name ?? ''} (2026-27). Change or end that assignment first.`,
        );
      }
      t.status = body.status;
      if (body.status === 'LEFT') t.leavingDate = body.leavingDate;
      else delete t.leavingDate;
      return ok(t);
    },
  ],
  [
    'GET',
    /^\/teacher-assignments$/,
    ({ query }) => {
      const y = query.get('academicYearId');
      const t = query.get('teacherId');
      const cur = query.get('currentOnly') === 'true';
      return ok(
        assignments.filter(
          (a) =>
            (!y || a.academicYearId === y) && (!t || a.teacherId === t) && (!cur || a.isCurrent),
        ),
      );
    },
  ],
  [
    'POST',
    /^\/teacher-assignments$/,
    ({ body }) => {
      const d = find(divisions, body.divisionId);
      if (!d) return fail(404, 'DIVISION_NOT_FOUND', 'Division not found.');
      if (activeAssignments(d.id))
        return fail(
          422,
          'DIVISION_ALREADY_HAS_TEACHER',
          'This division already has a class teacher. Use "Change teacher" instead.',
        );
      const a = {
        id: newId('as'),
        academicYearId: d.academicYearId,
        classId: d.classId,
        divisionId: d.id,
        teacherId: body.teacherId,
        role: 'CLASS_TEACHER' as const,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: null,
        isCurrent: true,
      };
      assignments.push(a);
      return ok(a, 201);
    },
  ],
  [
    'POST',
    /^\/teacher-assignments\/(\w+)\/change$/,
    ({ params, body }) => {
      const old = find(assignments, params[0]);
      if (!old || !old.isCurrent)
        return fail(422, 'ASSIGNMENT_NOT_CURRENT', 'Only the current assignment can be changed.');
      if (body.effectiveFrom <= old.effectiveFrom)
        return fail(
          422,
          'ASSIGNMENT_CHANGE_INVALID',
          'The change must take effect after the current assignment started.',
        );
      old.isCurrent = false;
      old.effectiveTo = addDaysISO(body.effectiveFrom, -1);
      old.endReason = 'CHANGED';
      const a = {
        ...old,
        id: newId('as'),
        teacherId: body.newTeacherId,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: null,
        isCurrent: true,
        endReason: undefined,
        reason: body.reason,
      };
      assignments.push(a);
      return ok(a);
    },
  ],
  [
    'POST',
    /^\/teacher-assignments\/(\w+)\/end$/,
    ({ params, body }) => {
      const a = find(assignments, params[0]);
      if (!a || !a.isCurrent)
        return fail(422, 'ASSIGNMENT_NOT_CURRENT', 'Only the current assignment can be ended.');
      a.isCurrent = false;
      a.effectiveTo = body.effectiveTo;
      a.endReason = 'LEFT_INSTITUTION';
      return ok({ ended: true });
    },
  ],
  [
    'GET',
    /^\/divisions\/(\w+)\/assignment-history$/,
    ({ params }) =>
      ok(
        assignments
          .filter((a) => a.divisionId === params[0])
          .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1)),
      ),
  ],
];
