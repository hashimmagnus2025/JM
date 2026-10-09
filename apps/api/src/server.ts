import mongoose from 'mongoose';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { createLogger } from './config/logger';
import { connectMongo, disconnectMongo } from './db/connection';
import './db/models';
import { SystemClock } from '@sfm/shared';
import { AuditService } from './modules/audit/audit.service';
import { AuthService, DEFAULT_AUTH_CONFIG } from './modules/auth/auth.service';
import {
  MongoAuditStore,
  MongoRoleRepo,
  MongoSessionRepo,
  MongoUserRepo,
} from './modules/auth/mongo-repos';
import { argon2Hasher } from './modules/auth/password';
import { PrincipalResolver } from './modules/auth/principal';
import { IdentityService } from './modules/identity/identity.service';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  await connectMongo(env.MONGO_URI);

  // one institution per deployment (v1): every document is scoped to it
  const inst = await mongoose.connection.collection('institutions').findOne({});
  if (!inst) throw new Error('No institution found. Run `pnpm --filter @sfm/api db:seed` first.');
  const institutionId = String(inst._id);

  const conn = mongoose.connection;
  const users = new MongoUserRepo(conn, institutionId);
  const roles = new MongoRoleRepo(conn, institutionId);
  const sessions = new MongoSessionRepo(conn, institutionId);
  const clock = new SystemClock();
  const hasher = argon2Hasher();
  const audit = new AuditService(new MongoAuditStore(conn, institutionId));
  const principals = new PrincipalResolver(users, roles, sessions, clock);
  const auth = new AuthService({
    users,
    roles,
    sessions,
    hasher,
    audit,
    clock,
    principals,
    config: {
      ...DEFAULT_AUTH_CONFIG,
      jwtSecret: env.JWT_ACCESS_SECRET,
      accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      refreshAbsoluteDays: env.REFRESH_TOKEN_TTL_DAYS,
    },
  });
  const identity = new IdentityService({
    users,
    roles,
    sessions,
    hasher,
    audit,
    clock,
    principals,
  });

  const app = createApp({
    logger,
    readiness: { mongo: async () => mongoose.connection.readyState === 1 },
    api: {
      auth,
      identity,
      routes: { secureCookies: env.NODE_ENV === 'production' },
      corsOrigins: env.CORS_ORIGINS,
    },
  });
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'api listening'));

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void disconnectMongo().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
