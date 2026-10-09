import { ALL_PERMISSIONS, PERMISSION_DEFS } from '@sfm/shared';
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
import type { IdentityService } from './identity.service';

const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'invalid id');
const idParam = z.strictObject({ id: oid });
const email = z.string().trim().toLowerCase().email().max(254);
const name = z.string().trim().min(2).max(120);
const mobile = z
  .string()
  .trim()
  .regex(/^\d{10}$/, 'Enter a 10-digit mobile number');
const roleKey = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{2,39}$/, 'Use upper-case letters, digits and underscores');
const dataScope = z.enum(['ALL', 'OWN_DIVISIONS']);
const permissions = z.array(z.string().max(60)).max(ALL_PERMISSIONS.length);

const listQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(80).optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'INACTIVE', 'LOCKED']).optional(),
});
const createUser = z.strictObject({
  email,
  name,
  mobile: mobile.optional(),
  roleIds: z.array(oid).min(1).max(10),
});
const updateUser = z.strictObject({
  name: name.optional(),
  mobile: mobile.optional(),
  roleIds: z.array(oid).min(1).max(10).optional(),
});
const reasonBody = z.strictObject({ reason: z.string().trim().min(3).max(300) });
const createRole = z.strictObject({
  key: roleKey,
  name,
  description: z.string().trim().max(300).optional(),
  permissions,
  dataScope: dataScope.default('ALL'),
});
const updateRole = z.strictObject({
  version: z.number().int().min(0),
  name: name.optional(),
  description: z.string().trim().max(300).optional(),
  permissions: permissions.optional(),
  dataScope: dataScope.optional(),
});

const meta = (page: number, pageSize: number, total: number) => ({
  page,
  pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
});

export function identityRoutes(auth: AuthService, identity: IdentityService): Router {
  const r = Router();
  r.use(authenticate(auth));

  /* ------------------------------ permission catalogue (read-only) ------------------------------ */
  r.get('/permissions', authorize('role.view'), (_req, res) => {
    res.json({ data: PERMISSION_DEFS });
  });

  /* ------------------------------ users ------------------------------ */
  r.get('/users', authorize('user.view'), validate({ query: listQuery }), async (req, res) => {
    const q = input<z.infer<typeof listQuery>>(req, 'query');
    const { items, total } = await identity.listUsers(q);
    res.json({ data: items, meta: meta(q.page, q.pageSize, total) });
  });

  r.post('/users', authorize('user.manage'), validate({ body: createUser }), async (req, res) => {
    const out = await identity.createUser(
      principalOf(req),
      input<z.infer<typeof createUser>>(req, 'body'),
      clientInfo(req),
    );
    res.status(201).json({
      data: out.user,
      meta: {
        temporaryPassword: out.temporaryPassword,
        note: 'Shown once. The user must change it at first sign-in.',
      },
    });
  });

  r.get('/users/:id', authorize('user.view'), validate({ params: idParam }), async (req, res) => {
    res.json({ data: await identity.getUser(input<z.infer<typeof idParam>>(req, 'params').id) });
  });

  r.patch(
    '/users/:id',
    authorize('user.manage'),
    validate({ params: idParam, body: updateUser }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      res.json({
        data: await identity.updateUser(
          principalOf(req),
          id,
          input<z.infer<typeof updateUser>>(req, 'body'),
          clientInfo(req),
        ),
      });
    },
  );

  r.post(
    '/users/:id/deactivate',
    authorize('user.manage'),
    validate({ params: idParam, body: reasonBody }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      res.json({
        data: await identity.deactivateUser(
          principalOf(req),
          id,
          input<z.infer<typeof reasonBody>>(req, 'body').reason,
          clientInfo(req),
        ),
      });
    },
  );

  r.post(
    '/users/:id/activate',
    authorize('user.manage'),
    validate({ params: idParam }),
    async (req, res) => {
      res.json({
        data: await identity.activateUser(
          principalOf(req),
          input<z.infer<typeof idParam>>(req, 'params').id,
          clientInfo(req),
        ),
      });
    },
  );

  r.post(
    '/users/:id/unlock',
    authorize('user.manage'),
    validate({ params: idParam }),
    async (req, res) => {
      res.json({
        data: await identity.unlockUser(
          principalOf(req),
          input<z.infer<typeof idParam>>(req, 'params').id,
          clientInfo(req),
        ),
      });
    },
  );

  r.post(
    '/users/:id/reset-password',
    authorize('user.manage'),
    validate({ params: idParam }),
    async (req, res) => {
      const out = await identity.resetPassword(
        principalOf(req),
        input<z.infer<typeof idParam>>(req, 'params').id,
        clientInfo(req),
      );
      res.json({
        data: out.user,
        meta: {
          temporaryPassword: out.temporaryPassword,
          note: 'Shown once. The user must change it at next sign-in.',
        },
      });
    },
  );

  /* ------------------------------ roles ------------------------------ */
  r.get('/roles', authorize('role.view'), async (_req, res) => {
    res.json({ data: await identity.listRoles() });
  });

  r.post('/roles', authorize('role.manage'), validate({ body: createRole }), async (req, res) => {
    res.status(201).json({
      data: await identity.createRole(
        principalOf(req),
        input<z.infer<typeof createRole>>(req, 'body'),
        clientInfo(req),
      ),
    });
  });

  r.get('/roles/:id', authorize('role.view'), validate({ params: idParam }), async (req, res) => {
    res.json({ data: await identity.getRole(input<z.infer<typeof idParam>>(req, 'params').id) });
  });

  r.patch(
    '/roles/:id',
    authorize('role.manage'),
    validate({ params: idParam, body: updateRole }),
    async (req, res) => {
      const { id } = input<z.infer<typeof idParam>>(req, 'params');
      const { version, ...patch } = input<z.infer<typeof updateRole>>(req, 'body');
      res.json({
        data: await identity.updateRole(principalOf(req), id, version, patch, clientInfo(req)),
      });
    },
  );

  r.post(
    '/roles/:id/archive',
    authorize('role.manage'),
    validate({ params: idParam }),
    async (req, res) => {
      res.json({
        data: await identity.archiveRole(
          principalOf(req),
          input<z.infer<typeof idParam>>(req, 'params').id,
          clientInfo(req),
        ),
      });
    },
  );

  return r;
}
