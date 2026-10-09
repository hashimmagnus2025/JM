import { describe, expect, it } from 'vitest';
import { buildAuthHarness } from '../../testing/auth-harness';
import { authScenarios } from './auth.scenarios';
import {
  argon2Hasher,
  assertPasswordAcceptable,
  generateTemporaryPassword,
  passwordProblems,
} from './password';
import {
  hashRefreshToken,
  newFamilyId,
  newRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from './tokens';

authScenarios('in-memory repositories', () => buildAuthHarness());

describe('password hashing', () => {
  const hasher = argon2Hasher({ memoryCost: 8192, timeCost: 1, parallelism: 1 });
  it('uses Argon2id with a unique salt and verifies correctly', async () => {
    const a = await hasher.hash('Correct-Horse-42!');
    const b = await hasher.hash('Correct-Horse-42!');
    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toBe(b);
    expect(await hasher.verify(a, 'Correct-Horse-42!')).toBe(true);
    expect(await hasher.verify(a, 'correct-horse-42!')).toBe(false);
  });
  it('never throws on a corrupt stored hash — it simply does not authenticate', async () => {
    expect(await hasher.verify('not-a-hash', 'x')).toBe(false);
    expect(await hasher.verify('', 'x')).toBe(false);
  });
  it('provides a dummy hash for equal-timing checks', async () => {
    expect(await hasher.dummyHash()).toMatch(/^\$argon2id\$/);
    expect(await hasher.dummyHash()).toBe(await hasher.dummyHash());
  });
});

describe('password policy', () => {
  it('accepts a strong password', () => {
    expect(passwordProblems('Correct-Horse-42!')).toEqual([]);
    expect(() => assertPasswordAcceptable('Correct-Horse-42!')).not.toThrow();
  });
  it('rejects short, common, repeated, single-class, and personal passwords', () => {
    expect(passwordProblems('Ab1!')).toContain('Use at least 10 characters.');
    expect(passwordProblems('password123')).toContain('This password is too common.');
    expect(passwordProblems('aaaaaaaaaaaa')).toContain('Do not repeat a single character.');
    expect(passwordProblems('onlylowercaseletters')).toContain(
      'Mix at least three of: lower-case, upper-case, digits, symbols.',
    );
    expect(passwordProblems('Rahul-Sharma-99', { name: 'Rahul Sharma' })).toContain(
      'Do not include your name.',
    );
    expect(passwordProblems('Xasha.mehta-99', { email: 'asha.mehta@school.test' })).toContain(
      'Do not include your e-mail name.',
    );
    expect(passwordProblems('x'.repeat(200))).toContain('Use at most 128 characters.');
  });
  it('throws a coded, user-readable error', () => {
    try {
      assertPasswordAcceptable('short');
    } catch (e) {
      expect(e).toMatchObject({ status: 400, code: 'WEAK_PASSWORD' });
      return;
    }
    throw new Error('expected a throw');
  });
  it('generated temporary passwords satisfy the policy and are unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generateTemporaryPassword();
      expect(p).toHaveLength(12);
      expect(passwordProblems(p), p).toEqual([]);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});

describe('tokens', () => {
  const secret = 'a'.repeat(40);
  it('round-trips claims and expires', async () => {
    const now = new Date('2026-10-08T06:00:00Z');
    const t = await signAccessToken({ sub: 'u', sid: 's', tv: 3 }, { secret, ttlSeconds: 60, now });
    expect(await verifyAccessToken(t, { secret, now })).toEqual({ sub: 'u', sid: 's', tv: 3 });
    await expect(
      verifyAccessToken(t, { secret, now: new Date(now.getTime() + 61_000) }),
    ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });
  it('refresh tokens are 256-bit random, hashed deterministically, family ids unique', () => {
    const a = newRefreshToken();
    expect(a).not.toBe(newRefreshToken());
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(hashRefreshToken(a)).toBe(hashRefreshToken(a));
    expect(hashRefreshToken(a)).toHaveLength(64);
    expect(newFamilyId()).not.toBe(newFamilyId());
  });
});
