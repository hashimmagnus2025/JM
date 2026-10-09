import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from './connection';
import { up } from './migrations/001-initial';
import { seedIdentity } from './seed';
// the credentials file lives next to the Playwright tests (apps/api/src/db → repo root → e2e)
const HERE = fileURLToPath(new URL('../../../../e2e/', import.meta.url));

/**
 * Runs BEFORE the API starts (see playwright.config.ts): wipes the throwaway database and seeds an institution,
 * the built-in roles and ONE Super Admin with a temporary password.
 */
async function prepare(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  if (
    !/e2e|test/i.test(
      new URL(uri.replace('mongodb+srv', 'https').replace('mongodb', 'https')).pathname,
    )
  ) {
    throw new Error('Refusing to wipe a database whose name does not contain "e2e" or "test".');
  }
  await connectMongo(uri);
  await up(mongoose.connection);
  for (const c of await mongoose.connection.db!.listCollections().toArray()) {
    await mongoose.connection.collection(c.name).deleteMany({});
  }
  const r = await seedIdentity(mongoose.connection, {
    adminEmail: 'owner@school.test',
    adminName: 'Asha Mehta',
  });
  await disconnectMongo();
  writeFileSync(
    join(HERE, '.e2e-credentials.json'),
    JSON.stringify({ email: 'owner@school.test', temporaryPassword: r.admin.temporaryPassword }),
  );
}

prepare().then(
  () => process.exit(0),
  (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  },
);
