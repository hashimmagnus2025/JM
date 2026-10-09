import { randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { badRequest } from '../../lib/errors';

/** Argon2id (OWASP minimum: 19 MiB, 2 passes, 1 lane). Tests pass cheaper parameters. */
export interface HasherOptions {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}
export const PRODUCTION_HASHER: HasherOptions = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
  /** a hash to compare against when the user does not exist → equal timing for known/unknown e-mails */
  dummyHash(): Promise<string>;
}

export function argon2Hasher(opts: HasherOptions = PRODUCTION_HASHER): PasswordHasher {
  let dummy: Promise<string> | undefined;
  return {
    hash: (password) => hash(password, opts),
    async verify(passwordHash, password) {
      try {
        return await verify(passwordHash, password);
      } catch {
        return false; // malformed stored hash → never authenticates
      }
    },
    dummyHash: () => (dummy ??= hash('timing-equaliser-not-a-password', opts)),
  };
}

/* ------------------------------ policy ------------------------------ */

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

/** very common passwords refused outright (a breached-password list can replace this later) */
const COMMON = new Set(
  [
    'password',
    'password1',
    'password12',
    'password123',
    'passw0rd123',
    'qwertyuiop',
    'qwerty12345',
    '1234567890',
    '12345678910',
    'admin12345',
    'administrator',
    'welcome123',
    'letmein123',
    'iloveyou123',
    'school12345',
    'changeme123',
    'abc1234567',
    'india12345',
  ].map((p) => p.toLowerCase()),
);

export interface PasswordContext {
  email?: string;
  name?: string;
}

/** Returns the list of problems in plain language (empty = acceptable). */
export function passwordProblems(password: string, ctx: PasswordContext = {}): string[] {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH)
    problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (password.length > MAX_PASSWORD_LENGTH)
    problems.push(`Use at most ${MAX_PASSWORD_LENGTH} characters.`);
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) problems.push('This password is too common.');
  if (/^(.)\1+$/.test(password)) problems.push('Do not repeat a single character.');
  const local = ctx.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local))
    problems.push('Do not include your e-mail name.');
  for (const part of (ctx.name ?? '').toLowerCase().split(/\s+/)) {
    if (part.length >= 4 && lower.includes(part)) {
      problems.push('Do not include your name.');
      break;
    }
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes < 3) problems.push('Mix at least three of: lower-case, upper-case, digits, symbols.');
  return problems;
}

export function assertPasswordAcceptable(password: string, ctx: PasswordContext = {}): void {
  const problems = passwordProblems(password, ctx);
  if (problems.length > 0) throw badRequest('WEAK_PASSWORD', problems[0] as string, problems);
}

/** readable one-time password for new users / resets (shown once, must be changed at first login) */
export function generateTemporaryPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%*?';
  const pick = (set: string): string => set[randomInt(set.length)] as string;
  const chars = [
    pick(upper),
    pick(upper),
    pick(lower),
    pick(lower),
    pick(lower),
    pick(lower),
    pick(digits),
    pick(digits),
    pick(digits),
    pick(symbols),
    pick(lower),
    pick(upper),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}
