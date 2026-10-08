import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';

export interface AppDeps {
  logger: Logger;
  /** readiness probes (Mongo, Redis, storage …) — `/readyz` is green only if all pass */
  readiness: Record<string, () => Promise<boolean>>;
}

/** Base HTTP shell (Phase 0): request id, structured request logs, secure headers, health probes, safe errors. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Nginx
  app.use((req, res, next) => {
    const incoming = req.header('x-request-id');
    const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', id);
    (req as Request & { id: string }).id = id;
    next();
  });
  app.use(
    pinoHttp({ logger: deps.logger, genReqId: (req) => (req as Request & { id: string }).id }),
  );
  app.use(helmet());
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

  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Not found.',
        requestId: (req as Request & { id: string }).id,
      },
    });
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = (req as Request & { id: string }).id;
    deps.logger.error({ err, requestId }, 'unhandled error');
    // never leak internals or stack traces to the client
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Please try again.',
        requestId,
      },
    });
  });
  return app;
}
