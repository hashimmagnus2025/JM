import { isBusinessDate } from '@sfm/shared';
import { Router } from 'express';
import { z } from 'zod';
import {
  authenticate,
  authorize,
  clientInfo,
  input,
  principalOf,
  validate,
} from '../../http/middleware';
import type { AuthService } from '../auth/auth.service';
import type { AssignmentService, TeacherService } from './teacher.service';

const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'invalid id');
const idParam = z.strictObject({ id: oid });
const businessDate = z.string().refine(isBusinessDate, 'Enter a valid date');
const text = (max: number) => z.string().trim().max(max);

/** "+91 98765 43210", "098765-43210" → 9876543210; Indian mobiles start with 6-9 */
const mobile = z
  .string()
  .transform((v) => v.replace(/[\s()-]/g, '').replace(/^(\+?91|0)(?=\d{10}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'));

/** a cleared optional field arrives as null/empty and is stored as "not set" */
const optional = <T extends z.ZodType>(schema: T) =>
  z.union([z.literal('').transform(() => undefined), schema]).optional();
const nullable = <T extends z.ZodType>(schema: T) =>
  z.union([z.literal('').transform(() => undefined), z.null().transform(() => undefined), schema]);

const base = {
  staffId: text(30).min(1, 'Enter the staff ID'),
  fullName: text(100).min(2, 'Enter the full name'),
  mobile,
  joiningDate: businessDate,
};
const teacherBody = z.strictObject({
  ...base,
  email: optional(z.string().trim().toLowerCase().email().max(254)),
  gender: optional(z.enum(['MALE', 'FEMALE', 'OTHER'])),
  qualification: optional(text(100)),
  remarks: optional(text(300)),
});
const teacherPatch = z.strictObject({
  staffId: base.staffId.optional(),
  fullName: base.fullName.optional(),
  mobile: mobile.optional(),
  joiningDate: businessDate.optional(),
  email: nullable(z.string().trim().toLowerCase().email().max(254)).optional(),
  gender: nullable(z.enum(['MALE', 'FEMALE', 'OTHER'])).optional(),
  qualification: nullable(text(100)).optional(),
  remarks: nullable(text(300)).optional(),
});
const teacherQuery = z.strictObject({
  status: z.enum(['ACTIVE', 'INACTIVE', 'LEFT']).optional(),
  q: text(60).optional(),
});
const statusBody = z
  .strictObject({
    status: z.enum(['ACTIVE', 'INACTIVE', 'LEFT']),
    leavingDate: businessDate.optional(),
  })
  .refine((b) => b.status !== 'LEFT' || !!b.leavingDate, {
    message: 'Enter the leaving date',
    path: ['leavingDate'],
  });

const assignQuery = z.strictObject({
  academicYearId: oid.optional(),
  teacherId: oid.optional(),
  currentOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
const assignBody = z.strictObject({
  divisionId: oid,
  teacherId: oid,
  effectiveFrom: businessDate,
});
const changeBody = z.strictObject({
  newTeacherId: oid,
  effectiveFrom: businessDate,
  reason: text(300).min(3, 'Enter a reason'),
});
const endBody = z.strictObject({
  effectiveTo: businessDate,
  reason: text(300).min(3, 'Enter a reason'),
});

export interface TeacherServices {
  teachers: TeacherService;
  assignments: AssignmentService;
}

export function teacherRoutes(auth: AuthService, s: TeacherServices): Router {
  const r = Router();
  r.use(authenticate(auth));

  /* teachers */
  r.get(
    '/teachers',
    authorize('teacher.view'),
    validate({ query: teacherQuery }),
    async (req, res) => {
      res.json({ data: await s.teachers.list(input<z.infer<typeof teacherQuery>>(req, 'query')) });
    },
  );
  r.post(
    '/teachers',
    authorize('teacher.create'),
    validate({ body: teacherBody }),
    async (req, res) => {
      res.status(201).json({
        data: await s.teachers.create(
          principalOf(req),
          input<z.infer<typeof teacherBody>>(req, 'body'),
          clientInfo(req),
        ),
      });
    },
  );
  r.get(
    '/teachers/:id',
    authorize('teacher.view'),
    validate({ params: idParam }),
    async (req, res) => {
      res.json({ data: await s.teachers.get(input<z.infer<typeof idParam>>(req, 'params').id) });
    },
  );
  r.patch(
    '/teachers/:id',
    authorize('teacher.update'),
    validate({ params: idParam, body: teacherPatch }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      res.json({
        data: await s.teachers.update(
          principalOf(req),
          id,
          input<z.infer<typeof teacherPatch>>(req, 'body'),
          clientInfo(req),
        ),
      });
    },
  );
  r.post(
    '/teachers/:id/status',
    authorize('teacher.deactivate'),
    validate({ params: idParam, body: statusBody }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      const b = input<z.infer<typeof statusBody>>(req, 'body');
      res.json({
        data: await s.teachers.setStatus(
          principalOf(req),
          id,
          b.status,
          b.leavingDate,
          clientInfo(req),
        ),
      });
    },
  );
  r.get(
    '/teachers/:id/assignments',
    authorize('teacherAssignment.view'),
    validate({ params: idParam }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      res.json({ data: await s.assignments.list({ teacherId: id }) });
    },
  );

  /* class-teacher assignments */
  r.get(
    '/teacher-assignments',
    authorize('teacherAssignment.view'),
    validate({ query: assignQuery }),
    async (req, res) => {
      res.json({
        data: await s.assignments.list(input<z.infer<typeof assignQuery>>(req, 'query')),
      });
    },
  );
  r.post(
    '/teacher-assignments',
    authorize('teacherAssignment.assign'),
    validate({ body: assignBody }),
    async (req, res) => {
      res.status(201).json({
        data: await s.assignments.assign(
          principalOf(req),
          input<z.infer<typeof assignBody>>(req, 'body'),
          clientInfo(req),
        ),
      });
    },
  );
  r.post(
    '/teacher-assignments/:id/change',
    authorize('teacherAssignment.change'),
    validate({ params: idParam, body: changeBody }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      res.json({
        data: await s.assignments.change(
          principalOf(req),
          id,
          input<z.infer<typeof changeBody>>(req, 'body'),
          clientInfo(req),
        ),
      });
    },
  );
  r.post(
    '/teacher-assignments/:id/end',
    authorize('teacherAssignment.change'),
    validate({ params: idParam, body: endBody }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      await s.assignments.end(
        principalOf(req),
        id,
        input<z.infer<typeof endBody>>(req, 'body'),
        clientInfo(req),
      );
      res.json({ data: { ended: true } });
    },
  );
  r.get(
    '/divisions/:id/assignment-history',
    authorize('teacherAssignment.view'),
    validate({ params: idParam }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      res.json({ data: await s.assignments.divisionHistory(id) });
    },
  );

  return r;
}
