import { z } from 'zod';

/**
 * Environment is validated at boot (fail fast): a missing or malformed variable stops the process
 * with a readable message instead of failing later in the middle of a payment.
 */
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),

  MONGO_URI: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, 'MONGO_URI must be a MongoDB connection string')
    .refine(
      (u) => /replicaSet=|mongodb\+srv:/.test(u),
      'MONGO_URI must target a replica set (transactions need one): add ?replicaSet=rs0',
    ),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'REDIS_URL must be a redis:// URL'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),

  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool.default(false),

  SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && /change-me/i.test(env.JWT_ACCESS_SECRET)) {
    throw new Error(
      'Invalid environment configuration:\n  - JWT_ACCESS_SECRET: the example secret must not be used in production',
    );
  }
  return env;
}
