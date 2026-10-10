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
import type { ClassService, DivisionService } from './academic.service';

const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'invalid id');
const idParam = z.strictObject({ id: oid });
const text = (max: number) => z.string().trim().max(max);

const classBody = z.strictObject({
  code: z
    .string()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,11}$/, 'Use upper-case letters, digits, - or _ (max 12)'),
  name: text(40).min(1),
  isFinal: z.boolean().optional(),
});
const classPatch = z.strictObject({
  name: text(40).min(1).optional(),
  isActive: z.boolean().optional(),
  isFinal: z.boolean().optional(),
});
const orderBody = z.strictObject({ ids: z.array(oid).min(1).max(100) });

const capacity = z.number().int().min(1).max(500);
const divisionBody = z.strictObject({
  academicYearId: oid,
  classId: oid,
  name: text(20).min(1),
  capacity: capacity.optional(),
});
const divisionPatch = z.strictObject({
  name: text(20).min(1).optional(),
  capacity: capacity.nullable().optional(),
  isActive: z.boolean().optional(),
});
const divisionQuery = z.strictObject({ academicYearId: oid.optional(), classId: oid.optional() });
const cloneBody = z.strictObject({ fromYearId: oid, toYearId: oid });

export interface AcademicServices {
  classes: ClassService;
  divisions: DivisionService;
}

export function academicRoutes(auth: AuthService, s: AcademicServices): Router {
  const r = Router();
  r.use(authenticate(auth));

  /* classes */
  r.get('/classes', authorize('class.view'), async (_req, res) => {
    res.json({ data: await s.classes.list() });
  });
  r.post('/classes', authorize('class.manage'), validate({ body: classBody }), async (req, res) => {
    res.status(201).json({
      data: await s.classes.create(
        principalOf(req),
        input<z.infer<typeof classBody>>(req, 'body'),
        clientInfo(req),
      ),
    });
  });
  r.put(
    '/classes/order',
    authorize('class.manage'),
    validate({ body: orderBody }),
    async (req, res) => {
      res.json({
        data: await s.classes.reorder(
          principalOf(req),
          input<z.infer<typeof orderBody>>(req, 'body').ids,
          clientInfo(req),
        ),
      });
    },
  );
  r.patch(
    '/classes/:id',
    authorize('class.manage'),
    validate({ params: idParam, body: classPatch }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      res.json({
        data: await s.classes.update(
          principalOf(req),
          id,
          input<z.infer<typeof classPatch>>(req, 'body'),
          clientInfo(req),
        ),
      });
    },
  );

  /* divisions */
  r.get(
    '/divisions',
    authorize('division.view'),
    validate({ query: divisionQuery }),
    async (req, res) => {
      res.json({
        data: await s.divisions.list(input<z.infer<typeof divisionQuery>>(req, 'query')),
      });
    },
  );
  r.post(
    '/divisions',
    authorize('division.manage'),
    validate({ body: divisionBody }),
    async (req, res) => {
      res.status(201).json({
        data: await s.divisions.create(
          principalOf(req),
          input<z.infer<typeof divisionBody>>(req, 'body'),
          clientInfo(req),
        ),
      });
    },
  );
  r.post(
    '/divisions/clone',
    authorize('division.manage'),
    validate({ body: cloneBody }),
    async (req, res) => {
      const b = input<z.infer<typeof cloneBody>>(req, 'body');
      res.json({
        data: await s.divisions.cloneStructure(
          principalOf(req),
          b.fromYearId,
          b.toYearId,
          clientInfo(req),
        ),
      });
    },
  );
  r.patch(
    '/divisions/:id',
    authorize('division.manage'),
    validate({ params: idParam, body: divisionPatch }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      res.json({
        data: await s.divisions.update(
          principalOf(req),
          id,
          input<z.infer<typeof divisionPatch>>(req, 'body'),
          clientInfo(req),
        ),
      });
    },
  );

  return r;
}
