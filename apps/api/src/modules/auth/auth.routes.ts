import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, clientInfo, input, principalOf, validate } from '../../http/middleware';
import { AppError, badRequest } from '../../lib/errors';
import type { AuthService, IssuedSession } from './auth.service';

export const REFRESH_COOKIE = 'sfm_rt';
export const REFRESH_PATH = '/api/v1/auth';

export interface AuthRouteOptions {
  secureCookies: boolean;
  /** login attempts allowed per IP per window (a second, per-account lock lives in AuthService) */
  loginRateLimit?: { windowMs: number; limit: number };
}

const loginBody = z.strictObject({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(256),
});
const changeBody = z.strictObject({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});
const idParam = z.strictObject({ id: z.string().regex(/^[a-f0-9]{24}$/i, 'invalid id') });

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name)
      return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** Cookie-authenticated endpoints must come from our own SPA: SameSite=Strict + a custom header browsers cannot add cross-site without CORS approval. */
const requireAjaxHeader = (req: Request): void => {
  if (req.get('x-requested-with') !== 'fetch')
    throw badRequest('CSRF_HEADER_MISSING', 'Missing X-Requested-With header.');
};

export function authRoutes(auth: AuthService, opts: AuthRouteOptions): Router {
  const r = Router();
  const setCookie = (res: Response, s: IssuedSession): void => {
    res.cookie(REFRESH_COOKIE, s.refreshToken, {
      httpOnly: true,
      secure: opts.secureCookies,
      sameSite: 'strict',
      path: REFRESH_PATH,
      expires: s.refreshExpiresAt,
    });
  };
  const clearCookie = (res: Response): void => {
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: opts.secureCookies,
      sameSite: 'strict',
      path: REFRESH_PATH,
    });
  };
  /** the refresh token only travels in the httpOnly cookie, never in the JSON body */
  const body = (s: IssuedSession) => ({
    data: { accessToken: s.accessToken, expiresIn: s.expiresIn, user: s.user },
  });

  const limiter = rateLimit({
    windowMs: opts.loginRateLimit?.windowMs ?? 60_000,
    limit: opts.loginRateLimit?.limit ?? 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(
        new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a moment and try again.'),
      ),
  });

  r.post('/login', limiter, validate({ body: loginBody }), async (req, res) => {
    const b = input<z.infer<typeof loginBody>>(req, 'body');
    const s = await auth.login({ ...b, ...clientInfo(req) });
    setCookie(res, s);
    res.json(body(s));
  });

  r.post('/refresh', async (req, res) => {
    requireAjaxHeader(req);
    const token = readCookie(req, REFRESH_COOKIE);
    if (!token)
      throw new AppError(401, 'REFRESH_INVALID', 'Your session has ended. Please sign in again.');
    try {
      const s = await auth.refresh({ refreshToken: token, ...clientInfo(req) });
      setCookie(res, s);
      res.json(body(s));
    } catch (e) {
      // a dead session must not leave a dead cookie behind (a multi-tab race keeps it: the other tab already refreshed)
      if (e instanceof AppError && e.status === 401) clearCookie(res);
      throw e;
    }
  });

  r.post('/logout', async (req, res) => {
    requireAjaxHeader(req);
    await auth.logout({ refreshToken: readCookie(req, REFRESH_COOKIE), ...clientInfo(req) });
    clearCookie(res);
    res.status(204).end();
  });

  r.post(
    '/logout-all',
    authenticate(auth, { allowWhenMustChangePassword: true }),
    async (req, res) => {
      const n = await auth.logoutAll(principalOf(req).userId, clientInfo(req));
      clearCookie(res);
      res.json({ data: { sessionsEnded: n } });
    },
  );

  r.get('/me', authenticate(auth, { allowWhenMustChangePassword: true }), (req, res) => {
    const p = principalOf(req);
    res.json({
      data: {
        id: p.userId,
        name: p.name,
        email: p.email,
        roleKeys: p.roleKeys,
        permissions: [...p.permissions].sort(),
        dataScope: p.dataScope,
        mustChangePassword: p.mustChangePassword,
      },
    });
  });

  r.post(
    '/change-password',
    authenticate(auth, { allowWhenMustChangePassword: true }),
    validate({ body: changeBody }),
    async (req, res) => {
      const b = input<z.infer<typeof changeBody>>(req, 'body');
      const s = await auth.changePassword(principalOf(req), { ...b, ...clientInfo(req) });
      setCookie(res, s);
      res.json(body(s));
    },
  );

  r.get('/sessions', authenticate(auth), async (req, res) => {
    const p = principalOf(req);
    const list = await auth.listSessions(p.userId);
    res.json({
      data: list.map((s) => ({
        id: s.id,
        current: s.id === p.sessionId,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        expiresAt: s.expiresAt,
      })),
    });
  });

  r.delete('/sessions/:id', authenticate(auth), validate({ params: idParam }), async (req, res) => {
    const { id } = input<z.infer<typeof idParam>>(req, 'params');
    const ended = await auth.revokeSession(principalOf(req).userId, id);
    if (!ended) throw new AppError(404, 'NOT_FOUND', 'Session not found.');
    res.status(204).end();
  });

  return r;
}
