import mongoose from 'mongoose';
import { loadEnv } from '../config/env';
import { connectMongo, disconnectMongo } from './connection';
import { up } from './migrations/001-initial';

async function main(): Promise<void> {
  const env = loadEnv();
  await connectMongo(env.MONGO_URI);
  const result = await up(mongoose.connection);
  // eslint-disable-next-line no-console
  console.log(
    `migration 001 applied: ${result.collections} collections, ${result.indexes} indexes`,
  );
  await disconnectMongo();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
