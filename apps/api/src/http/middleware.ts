import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import type { AuthService } from '../modules/auth/auth.service';
import type { Principal } from '../modules/auth/ports';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
      /** parsed + validated input (see `validate`) */
      valid: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

/** Validate params, query and body with strict Zod schemas (unknown keys are rejected → no mass assignment). */
export function validate<
  B extends z.ZodType = z.ZodUndefined,
  Q extends z.ZodType = z.ZodUndefined,
  P extends z.ZodType = z.ZodUndefined,
>(schemas: { body?: B; query?: Q; params?: P }): RequestHandler {
  return (req, _res, next) => {
    try {
      req.valid = {
        ...(schemas.params ? { params: schemas.params.parse(req.params) } : {}),
        ...(schemas.query ? { query: schemas.query.parse(req.query) } : {}),
        ...(schemas.body ? { body: schemas.body.parse(req.body ?? {}) } : {}),
      };
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** typed accessor for validated input */
export const input = <T>(req: Request, part: 'body' | 'query' | 'params'): T =>
  req.valid[part] as T;

export const clientInfo = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get('user-agent') ?? undefined,
  requestId: String(req.id),
});

/** routes a user who MUST change their password is still allowed to reach */
export const PASSWORD_CHANGE_ALLOWED = new Set([
  '/auth/me',
  '/auth/change-password',
  '/auth/logout',
  '/auth/logout-all',
]);

/**
 * Requires a valid access token (`Authorization: Bearer …`) and attaches the principal.
 * Permissions are re-evaluated from server state on every request (see PrincipalResolver).
 */
export function authenticate(
  auth: Pick<AuthService, 'authenticate'>,
  opts: { allowWhenMustChangePassword?: boolean } = {},
): RequestHandler {
  return async (req, _res, next) => {
    try {
      const header = req.get('authorization') ?? '';
      const match = /^Bearer\s+(\S+)$/i.exec(header);
      if (!match) throw unauthorized('UNAUTHENTICATED', 'Please sign in.');
      const principal = await auth.authenticate(match[1] as string);
      if (principal.mustChangePassword && !opts.allowWhenMustChangePassword) {
        throw new AppError(
          403,
          'PASSWORD_CHANGE_REQUIRED',
          'Please change your temporary password before continuing.',
        );
      }
      req.principal = principal;
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** The signed-in user must hold EVERY listed permission. The backend is the only enforcement point that counts. */
export function authorize(...required: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const p = req.principal;
    if (!p) return next(unauthorized());
    const missing = required.filter((r) => !p.permissions.has(r));
    if (missing.length > 0)
      return next(forbidden('You do not have permission to do this.', 'FORBIDDEN'));
    next();
  };
}

export const principalOf = (req: Request): Principal => {
  if (!req.principal) throw unauthorized();
  return req.principal;
};
