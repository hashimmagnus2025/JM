import mongoose from 'mongoose';
import { createApp } from './app';
import { composeApi } from './compose';
import { loadEnv } from './config/env';
import { createLogger } from './config/logger';
import { connectMongo, disconnectMongo } from './db/connection';
import './db/models';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  await connectMongo(env.MONGO_URI);

  // one institution per deployment (v1): every document is scoped to it
  const inst = await mongoose.connection.collection('institutions').findOne({});
  if (!inst) throw new Error('No institution found. Run `pnpm --filter @sfm/api db:seed` first.');

  const api = composeApi(mongoose.connection, String(inst._id), {
    jwtSecret: env.JWT_ACCESS_SECRET,
    accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
    refreshAbsoluteDays: env.REFRESH_TOKEN_TTL_DAYS,
    secureCookies: env.NODE_ENV === 'production',
    corsOrigins: env.CORS_ORIGINS,
  });
  const app = createApp({
    logger,
    readiness: { mongo: async () => mongoose.connection.readyState === 1 },
    api,
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
