import mongoose from 'mongoose';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { createLogger } from './config/logger';
import { connectMongo, disconnectMongo } from './db/connection';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  await connectMongo(env.MONGO_URI);
  const app = createApp({
    logger,
    readiness: { mongo: async () => mongoose.connection.readyState === 1 },
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
