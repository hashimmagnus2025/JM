import { createLogger } from '../config/logger';
import { createApp } from '../app';
import { IdentityService } from '../modules/identity/identity.service';
import { buildAuthHarness, type AuthHarness } from './auth-harness';

export interface HttpHarness extends AuthHarness {
  app: ReturnType<typeof createApp>;
  identity: IdentityService;
}

export async function buildHttpHarness(
  opts: { loginLimit?: number; corsOrigins?: string[] } = {},
): Promise<HttpHarness> {
  const h = await buildAuthHarness();
  const identity = new IdentityService({
    users: h.users,
    roles: h.roles,
    sessions: h.sessions,
    hasher: h.hasher,
    audit: h.audit,
    clock: h.clock,
    principals: h.principals,
  });
  const app = createApp({
    logger: createLogger('silent'),
    readiness: {},
    api: {
      auth: h.auth,
      identity,
      routes: {
        secureCookies: false,
        loginRateLimit: { windowMs: 60_000, limit: opts.loginLimit ?? 1000 },
      },
      ...(opts.corsOrigins ? { corsOrigins: opts.corsOrigins } : {}),
    },
  });
  return Object.assign(h, { app, identity });
}
