import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE GUARDS (run in CI): the finance engine stays pure, and the commercial billing rule
 * stays out of it (decision BRC-K1). Implemented as a test so it needs no lint plugin to enforce.
 */
const ROOT = join(__dirname);
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1] as string);

describe('domain boundaries', () => {
  it('domain/finance imports only @sfm/shared and its own files (no mongoose, express, redis, fs, crypto…)', () => {
    for (const f of files(join(ROOT, 'finance'))) {
      for (const spec of importsOf(f)) {
        const ok = spec === '@sfm/shared' || spec.startsWith('./');
        expect(ok, `${relative(ROOT, f)} imports "${spec}"`).toBe(true);
      }
    }
  });
  it('domain/finance never reads the wall clock', () => {
    for (const f of files(join(ROOT, 'finance'))) {
      const src = readFileSync(f, 'utf8');
      expect(/Date\.now\(|new Date\(\)/.test(src), `${relative(ROOT, f)} uses the system clock`).toBe(false);
    }
  });
  it('domain/billing is isolated from domain/finance (and vice-versa)', () => {
    for (const f of files(join(ROOT, 'billing'))) {
      for (const spec of importsOf(f)) expect(spec.includes('finance'), `${relative(ROOT, f)} → ${spec}`).toBe(false);
    }
    for (const f of files(join(ROOT, 'finance'))) {
      for (const spec of importsOf(f)) expect(spec.includes('billing'), `${relative(ROOT, f)} → ${spec}`).toBe(false);
    }
  });
  it('domain/academic is pure too', () => {
    for (const f of files(join(ROOT, 'academic'))) {
      for (const spec of importsOf(f)) expect(spec === '@sfm/shared' || spec.startsWith('./'), `${relative(ROOT, f)} → ${spec}`).toBe(true);
    }
  });
});
