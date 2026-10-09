/* eslint-disable @typescript-eslint/no-explicit-any */
import { SYSTEM_ROLES } from '@sfm/shared';
import mongoose, { type Connection } from 'mongoose';
import { loadEnv } from '../config/env';
import {
  argon2Hasher,
  assertPasswordAcceptable,
  generateTemporaryPassword,
  type PasswordHasher,
} from '../modules/auth/password';
import { MongoRoleRepo, MongoUserRepo } from '../modules/auth/mongo-repos';
import { connectMongo, disconnectMongo } from './connection';
import './models';

export interface SeedOptions {
  institutionName?: string;
  institutionCode?: string;
  adminEmail: string;
  adminName?: string;
  /** when omitted a one-time temporary password is generated and returned */
  adminPassword?: string;
  hasher?: PasswordHasher;
}

export interface SeedResult {
  institutionId: string;
  rolesCreated: string[];
  rolesUpdated: string[];
  categoriesCreated: string[];
  admin: { email: string; created: boolean; temporaryPassword?: string };
}

/**
 * Idempotent bootstrap: institution → built-in roles (kept in sync with the code registry) → first Super Admin.
 * Safe to run on every deploy. Never overwrites an existing user or password.
 */
export async function seedIdentity(conn: Connection, opts: SeedOptions): Promise<SeedResult> {
  const hasher = opts.hasher ?? argon2Hasher();

  const Institution = conn.model('Institution') as any;
  let inst = await Institution.findOne({}).lean();
  if (!inst) {
    inst = (
      await Institution.create({
        name: opts.institutionName ?? 'My Institution',
        code: opts.institutionCode ?? 'MAIN',
      })
    ).toObject();
  }
  const institutionId = String(inst._id);

  const roles = new MongoRoleRepo(conn, institutionId);
  const users = new MongoUserRepo(conn, institutionId);
  const created: string[] = [];
  const updated: string[] = [];

  for (const def of SYSTEM_ROLES) {
    const existing = await roles.findByKey(def.key);
    if (!existing) {
      await roles.create({
        institutionId,
        key: def.key,
        name: def.name,
        description: def.description,
        permissions: [...def.permissions],
        dataScope: def.dataScope,
        isSystem: true,
        isActive: true,
      });
      created.push(def.key);
    } else {
      const same =
        existing.isSystem &&
        existing.permissions.length === def.permissions.length &&
        def.permissions.every((p) => existing.permissions.includes(p));
      if (!same) {
        // built-in roles follow the code registry (the registry is what the backend enforces)
        await conn.model('Role').updateOne(
          { _id: new mongoose.Types.ObjectId(existing.id) },
          {
            $set: {
              permissions: [...def.permissions],
              isSystem: true,
              isActive: true,
              name: def.name,
            },
            $inc: { version: 1 },
          },
        );
        updated.push(def.key);
      }
    }
  }

  // every student needs a category to select a fee structure: start with "General" (more are added in the UI)
  const Category = conn.model('StudentCategory') as any;
  const categoriesCreated: string[] = [];
  if ((await Category.countDocuments({ institutionId: inst._id })) === 0) {
    await Category.create({
      institutionId: inst._id,
      code: 'GENERAL',
      name: 'General',
      sequence: 1,
      isActive: true,
    });
    categoriesCreated.push('GENERAL');
  }

  const email = opts.adminEmail.trim().toLowerCase();
  const superRole = (await roles.findByKey('SUPER_ADMIN'))!;
  const existingAdmin = await users.findByEmail(email);
  if (existingAdmin)
    return {
      institutionId,
      rolesCreated: created,
      rolesUpdated: updated,
      categoriesCreated,
      admin: { email, created: false },
    };

  const given = opts.adminPassword !== undefined;
  const password = opts.adminPassword ?? generateTemporaryPassword();
  if (given) assertPasswordAcceptable(password, { email, name: opts.adminName ?? 'Super Admin' });
  await users.create({
    institutionId,
    email,
    name: opts.adminName ?? 'Super Admin',
    passwordHash: await hasher.hash(password),
    roleIds: [superRole.id],
    status: given ? 'ACTIVE' : 'INVITED',
    mustChangePassword: !given,
  });
  return {
    institutionId,
    rolesCreated: created,
    rolesUpdated: updated,
    categoriesCreated,
    admin: { email, created: true, ...(given ? {} : { temporaryPassword: password }) },
  };
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.SEED_ADMIN_EMAIL)
    throw new Error(
      'Set SEED_ADMIN_EMAIL (and optionally SEED_ADMIN_PASSWORD) in .env, then run db:seed again.',
    );
  await connectMongo(env.MONGO_URI);
  const r = await seedIdentity(mongoose.connection, {
    adminEmail: env.SEED_ADMIN_EMAIL,
    ...(env.SEED_ADMIN_PASSWORD ? { adminPassword: env.SEED_ADMIN_PASSWORD } : {}),
  });
  /* eslint-disable no-console */
  console.log(
    `roles created: [${r.rolesCreated.join(', ')}]  updated: [${r.rolesUpdated.join(', ')}]`,
  );
  if (!r.admin.created)
    console.log(`Super Admin ${r.admin.email} already exists — nothing changed.`);
  else if (r.admin.temporaryPassword)
    console.log(
      `Super Admin created: ${r.admin.email}\nTemporary password (shown ONCE, must be changed at first sign-in): ${r.admin.temporaryPassword}`,
    );
  else console.log(`Super Admin created: ${r.admin.email} (password from SEED_ADMIN_PASSWORD)`);
  await disconnectMongo();
}

if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
