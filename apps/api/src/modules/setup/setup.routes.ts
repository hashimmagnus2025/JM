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
import type {
  AcademicYearService,
  CategoryService,
  InstitutionService,
  SettingsService,
} from './setup.service';

const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'invalid id');
const idParam = z.strictObject({ id: oid });
const businessDate = z.string().refine(isBusinessDate, 'Enter a valid date');
const text = (max: number) => z.string().trim().max(max);

const address = z.strictObject({
  line1: text(120).optional(),
  line2: text(120).optional(),
  city: text(60).optional(),
  state: text(60).optional(),
  pincode: text(10).optional(),
  country: text(60).optional(),
});
const contact = z.strictObject({
  phone: text(20).optional(),
  altPhone: text(20).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  website: z.string().trim().url().max(200).optional(),
});
const institutionPatch = z.strictObject({
  name: text(150).min(2).optional(),
  shortName: text(40).optional(),
  address: address.optional(),
  contact: contact.optional(),
  registrationNo: text(60).optional(),
  academicStartMonth: z.number().int().min(1).max(12).optional(),
  receiptFooter: text(300).optional(),
  extra: z
    .record(z.string().max(40), text(200))
    .refine((r) => Object.keys(r).length <= 20, 'At most 20 extra details')
    .optional(),
});

const settingKey = z.strictObject({ key: z.string().regex(/^[a-zA-Z.]{3,60}$/) });
const settingBody = z.strictObject({ value: z.unknown(), reason: text(300).optional() });

const yearBody = z.strictObject({
  label: z.string().regex(/^\d{4}-\d{2}$/, 'Use a label like 2026-27'),
  startDate: businessDate,
  endDate: businessDate,
});
const yearPatch = yearBody.partial();
const yearList = z.strictObject({ status: z.enum(['PLANNED', 'ACTIVE', 'CLOSED']).optional() });
const reasonBody = z.strictObject({ reason: text(300).min(3) });

const categoryBody = z.strictObject({
  code: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'Use upper-case letters, digits and underscores'),
  name: text(60).min(2),
  sequence: z.number().int().min(0).max(999).optional(),
});
const categoryPatch = z.strictObject({
  name: text(60).min(2).optional(),
  isActive: z.boolean().optional(),
  sequence: z.number().int().min(0).max(999).optional(),
});

export interface SetupServices {
  institution: InstitutionService;
  settings: SettingsService;
  years: AcademicYearService;
  categories: CategoryService;
}

export function setupRoutes(auth: AuthService, s: SetupServices): Router {
  const r = Router();
  r.use(authenticate(auth));

  /* institution */
  r.get('/institution', authorize('institution.view'), async (_req, res) => {
    res.json({ data: await s.institution.get() });
  });
  r.patch(
    '/institution',
    authorize('institution.manage'),
    validate({ body: institutionPatch }),
    async (req, res) => {
      res.json({
        data: await s.institution.update(
          principalOf(req),
          input<z.infer<typeof institutionPatch>>(req, 'body'),
          clientInfo(req),
        ),
      });
    },
  );

  /* settings */
  r.get('/settings', authorize('settings.view'), async (_req, res) => {
    res.json({ data: await s.settings.list() });
  });
  r.put(
    '/settings/:key',
    authorize('settings.manage'),
    validate({ params: settingKey, body: settingBody }),
    async (req, res) => {
      const { key } = input<z.infer<typeof settingKey>>(req, 'params');
      const b = input<z.infer<typeof settingBody>>(req, 'body');
      res.json({
        data: await s.settings.update(principalOf(req), key, b.value, b.reason, clientInfo(req)),
      });
    },
  );
  r.delete(
    '/settings/:key',
    authorize('settings.manage'),
    validate({ params: settingKey }),
    async (req, res) => {
      res.json({
        data: await s.settings.reset(
          principalOf(req),
          input<z.infer<typeof settingKey>>(req, 'params').key,
          clientInfo(req),
        ),
      });
    },
  );

  /* academic years */
  r.get(
    '/academic-years',
    authorize('academicYear.view'),
    validate({ query: yearList }),
    async (req, res) => {
      res.json({ data: await s.years.list(input<z.infer<typeof yearList>>(req, 'query')) });
    },
  );
  r.get('/academic-years/current', authorize('academicYear.view'), async (_req, res) => {
    res.json({ data: await s.years.current() });
  });
  r.get('/academic-years/suggest-next', authorize('academicYear.manage'), async (_req, res) => {
    res.json({ data: await s.years.suggestNext() });
  });
  r.post(
    '/academic-years',
    authorize('academicYear.manage'),
    validate({ body: yearBody }),
    async (req, res) => {
      res.status(201).json({
        data: await s.years.create(
          principalOf(req),
          input<z.infer<typeof yearBody>>(req, 'body'),
          clientInfo(req),
        ),
      });
    },
  );
  r.get(
    '/academic-years/:id',
    authorize('academicYear.view'),
    validate({ params: idParam }),
    async (req, res) => {
      res.json({ data: await s.years.get(input<z.infer<typeof idParam>>(req, 'params').id) });
    },
  );
  r.patch(
    '/academic-years/:id',
    authorize('academicYear.manage'),
    validate({ params: idParam, body: yearPatch }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      res.json({
        data: await s.years.update(
          principalOf(req),
          id,
          input<z.infer<typeof yearPatch>>(req, 'body'),
          clientInfo(req),
        ),
      });
    },
  );
  for (const [path, fn] of [
    ['activate', 'activate'],
    ['deactivate', 'deactivate'],
    ['set-current', 'setCurrent'],
  ] as const) {
    r.post(
      `/academic-years/:id/${path}`,
      authorize('academicYear.manage'),
      validate({ params: idParam }),
      async (req, res) => {
        const { id } = input<z.infer<typeof idParam>>(req, 'params');
        res.json({ data: await s.years[fn](principalOf(req), id, clientInfo(req)) });
      },
    );
  }
  r.post(
    '/academic-years/:id/close',
    authorize('academicYear.close'),
    validate({ params: idParam, body: reasonBody }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      res.json({
        data: await s.years.close(
          principalOf(req),
          id,
          input<z.infer<typeof reasonBody>>(req, 'body').reason,
          clientInfo(req),
        ),
      });
    },
  );
  r.post(
    '/academic-years/:id/reopen',
    authorize('academicYear.close'),
    validate({ params: idParam, body: reasonBody }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      res.json({
        data: await s.years.reopen(
          principalOf(req),
          id,
          input<z.infer<typeof reasonBody>>(req, 'body').reason,
          clientInfo(req),
        ),
      });
    },
  );

  /* student categories */
  r.get('/student-categories', authorize('studentCategory.view'), async (_req, res) => {
    res.json({ data: await s.categories.list() });
  });
  r.post(
    '/student-categories',
    authorize('studentCategory.manage'),
    validate({ body: categoryBody }),
    async (req, res) => {
      res.status(201).json({
        data: await s.categories.create(
          principalOf(req),
          input<z.infer<typeof categoryBody>>(req, 'body'),
          clientInfo(req),
        ),
      });
    },
  );
  r.patch(
    '/student-categories/:id',
    authorize('studentCategory.manage'),
    validate({ params: idParam, body: categoryPatch }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      res.json({
        data: await s.categories.update(
          principalOf(req),
          id,
          input<z.infer<typeof categoryPatch>>(req, 'body'),
          clientInfo(req),
        ),
      });
    },
  );

  return r;
}
