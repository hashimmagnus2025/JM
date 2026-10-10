import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import './http/middleware'; // Express type augmentation (req.id, req.principal, req.valid)
import { toErrorBody } from './lib/errors';
import { authRoutes, type AuthRouteOptions } from './modules/auth/auth.routes';
import type { AuthService } from './modules/auth/auth.service';
import { identityRoutes } from './modules/identity/identity.routes';
import type { IdentityService } from './modules/identity/identity.service';
import { academicRoutes, type AcademicServices } from './modules/academic/academic.routes';
import { setupRoutes, type SetupServices } from './modules/setup/setup.routes';

export interface ApiModules {
  auth: AuthService;
  identity: IdentityService;
  setup: SetupServices;
  academic: AcademicServices;
  routes: AuthRouteOptions;
  /** exact origins allowed to call the API from a browser (credentials are allowed for these only) */
  corsOrigins?: string[];
}

export interface AppDeps {
  logger: Logger;
  /** readiness probes (Mongo, Redis, storage …) — `/readyz` is green only if all pass */
  readiness: Record<string, () => Promise<boolean>>;
  api?: ApiModules;
}

/** HTTP shell: request id, structured logs, secure headers, CORS allow-list, health probes, safe errors, /api/v1. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Nginx
  app.use((req, res, next) => {
    const incoming = req.header('x-request-id');
    const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', id);
    req.id = id;
    next();
  });
  app.use(pinoHttp({ logger: deps.logger, genReqId: (req) => (req as Request).id }));
  app.use(helmet());
  if (deps.api?.corsOrigins?.length) {
    const allowed = new Set(deps.api.corsOrigins);
    app.use(
      cors({
        origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
        credentials: true,
        allowedHeaders: [
          'Authorization',
          'Content-Type',
          'Idempotency-Key',
          'If-Match',
          'X-Requested-With',
          'X-Request-Id',
        ],
        exposedHeaders: ['X-Request-Id', 'Retry-After'],
        maxAge: 600,
      }),
    );
  }
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/readyz', async (_req, res) => {
    const checks: Record<string, boolean> = {};
    for (const [name, probe] of Object.entries(deps.readiness)) {
      try {
        checks[name] = await probe();
      } catch {
        checks[name] = false;
      }
    }
    const ready = Object.values(checks).every(Boolean);
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'degraded', checks });
  });

  if (deps.api) {
    app.use('/api/v1/auth', authRoutes(deps.api.auth, deps.api.routes));
    app.use('/api/v1', identityRoutes(deps.api.auth, deps.api.identity));
    app.use('/api/v1', setupRoutes(deps.api.auth, deps.api.setup));
    app.use('/api/v1', academicRoutes(deps.api.auth, deps.api.academic));
  }

  app.use((req, res) => {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Not found.', requestId: String(req.id) } });
  });

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const out = toErrorBody(err, String(req.id));
    if (out.unexpected) deps.logger.error({ err, requestId: String(req.id) }, 'unhandled error');
    for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
    // never leak internals or stack traces to the client
    res.status(out.status).json(out.body);
  });
  return app;
}
