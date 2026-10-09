import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyChain } from '../audit/audit-chain';
import { TEST_SECRET, type AuthHarness } from '../../testing/auth-harness';
import { hashRefreshToken, signAccessToken } from './tokens';

const PW = 'Correct-Horse-42!';
const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? 'NO_CODE';
  }
  return 'OK';
};
const minutes = (n: number): number => n * 60_000;
const hours = (n: number): number => n * 3_600_000;

/**
 * Behavioural scenarios for authentication. They run on the in-memory repositories (every build) and on
 * MongoDB (when MONGO_URI is set) through the same AuthHarness.
 */
export function authScenarios(label: string, make: () => Promise<AuthHarness>): void {
  describe(`authentication — ${label}`, () => {
    let h: AuthHarness;
    beforeEach(async () => {
      h = await make();
    });
    afterEach(async () => {
      await h.dispose?.();
    });
    const advance = (ms: number): void => h.clock.set(new Date(h.clock.now().getTime() + ms));
    const login = (email = 'asha@school.test', password = PW) =>
      h.auth.login({ email, password, ip: '10.0.0.1', userAgent: 'vitest' });
    const actions = (): string[] => h.auditStore.rows.map((r) => r.action);

    describe('login', () => {
      it('signs in, issues an access token + opaque refresh token, and the token authenticates', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const s = await login();
        expect(s.expiresIn).toBe(900);
        expect(s.refreshToken.length).toBeGreaterThanOrEqual(40);
        expect(s.user).toMatchObject({
          email: 'asha@school.test',
          roleKeys: ['ACCOUNTANT'],
          mustChangePassword: false,
        });
        const p = await h.auth.authenticate(s.accessToken);
        expect(p).toMatchObject({
          email: 'asha@school.test',
          roleKeys: ['ACCOUNTANT'],
          dataScope: 'ALL',
        });
        expect(p.permissions.has('payment.collect')).toBe(true);
        expect(p.permissions.has('user.manage')).toBe(false);
      });

      it('e-mail is case-insensitive and trimmed', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        await expect(login('  ASHA@School.TEST ')).resolves.toBeDefined();
      });

      it('wrong password and unknown e-mail give the SAME answer (no account enumeration)', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const wrong = await h.auth
          .login({ email: 'asha@school.test', password: 'nope' })
          .catch((e) => e);
        const unknown = await h.auth
          .login({ email: 'ghost@school.test', password: 'nope' })
          .catch((e) => e);
        expect([wrong.status, wrong.code, wrong.message]).toEqual([
          unknown.status,
          unknown.code,
          unknown.message,
        ]);
        expect(wrong.code).toBe('INVALID_CREDENTIALS');
      });

      it('audits successes and failures, and the audit chain stays valid and secret-free', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        await code(login('asha@school.test', 'wrong-password'));
        await code(login('ghost@school.test', 'wrong-password'));
        await login();
        expect(actions()).toEqual(['LOGIN_FAILED', 'LOGIN_FAILED', 'LOGIN_SUCCEEDED']);
        expect(verifyChain(h.auditStore.rows)).toMatchObject({ ok: true, count: 3 });
        const dump = JSON.stringify(h.auditStore.rows);
        expect(dump).not.toContain('wrong-password');
        expect(dump).not.toContain(PW);
        expect(dump).not.toMatch(/argon2id/);
      });

      it('locks the account after 5 wrong passwords — even the right password is refused while locked', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        for (let i = 0; i < 5; i++)
          expect(await code(login('asha@school.test', 'bad'))).toBe('INVALID_CREDENTIALS');
        const locked = await login().catch((e) => e);
        expect(locked).toMatchObject({ status: 423, code: 'ACCOUNT_LOCKED' });
        expect(locked.details.retryAfterSeconds).toBeGreaterThan(0);
        expect(locked.headers['Retry-After']).toBe(String(locked.details.retryAfterSeconds));
        expect(actions()).toContain('ACCOUNT_LOCKED');
        advance(minutes(14));
        expect(await code(login())).toBe('ACCOUNT_LOCKED');
        advance(minutes(2));
        await expect(login()).resolves.toBeDefined(); // lock expired; success resets the counter
        for (let i = 0; i < 4; i++) await code(login('asha@school.test', 'bad'));
        await expect(login()).resolves.toBeDefined(); // 4 failures < limit again
      });

      it('after a lock expires a single further failure locks again (no fresh set of 5 guesses)', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        for (let i = 0; i < 5; i++) await code(login('asha@school.test', 'bad'));
        advance(minutes(16));
        await code(login('asha@school.test', 'bad'));
        expect(await code(login())).toBe('ACCOUNT_LOCKED');
      });

      it('a disabled account is refused only AFTER the right password (wrong password reveals nothing)', async () => {
        await h.addUser('off@school.test', PW, ['ACCOUNTANT'], { status: 'INACTIVE' });
        expect(await code(login('off@school.test', 'wrong'))).toBe('INVALID_CREDENTIALS');
        expect(await code(login('off@school.test', PW))).toBe('ACCOUNT_DISABLED');
      });

      it('a user who must change the password is told so', async () => {
        await h.addUser('new@school.test', PW, ['REGISTRAR'], {
          status: 'INVITED',
          mustChangePassword: true,
        });
        const s = await login('new@school.test');
        expect(s.user.mustChangePassword).toBe(true);
        expect((await h.auth.authenticate(s.accessToken)).mustChangePassword).toBe(true);
      });
    });

    describe('access tokens', () => {
      it('expire after 15 minutes', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const s = await login();
        advance(minutes(14));
        await expect(h.auth.authenticate(s.accessToken)).resolves.toBeDefined();
        advance(minutes(2));
        expect(await code(h.auth.authenticate(s.accessToken))).toBe('TOKEN_EXPIRED');
      });

      it('forged tokens are rejected: wrong secret, alg=none, garbage, wrong audience', async () => {
        const u = await h.addUser('asha@school.test', PW, ['SUPER_ADMIN']);
        const s = await login();
        const real = await h.auth.authenticate(s.accessToken);
        const forged = await signAccessToken(
          { sub: u.id, sid: real.sessionId, tv: 0 },
          { secret: 'x'.repeat(40), ttlSeconds: 900, now: h.clock.now() },
        );
        expect(await code(h.auth.authenticate(forged))).toBe('TOKEN_INVALID');
        const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: u.id, sid: real.sessionId, tv: 0 })).toString('base64url')}.`;
        expect(await code(h.auth.authenticate(none))).toBe('TOKEN_INVALID');
        expect(await code(h.auth.authenticate('not.a.jwt'))).toBe('TOKEN_INVALID');
        const wrongAud = await new SignJWT({ sid: real.sessionId, tv: 0 })
          .setProtectedHeader({ alg: 'HS256' })
          .setSubject(u.id)
          .setIssuer('sfm-api')
          .setAudience('someone-else')
          .setIssuedAt(Math.floor(h.clock.now().getTime() / 1000))
          .setExpirationTime(Math.floor(h.clock.now().getTime() / 1000) + 900)
          .sign(new TextEncoder().encode(TEST_SECRET));
        expect(await code(h.auth.authenticate(wrongAud))).toBe('TOKEN_INVALID');
      });

      it('permissions come from the server, not the token: removing a role takes effect on the next request', async () => {
        const u = await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const s = await login();
        expect((await h.auth.authenticate(s.accessToken)).permissions.has('payment.collect')).toBe(
          true,
        );
        await h.users.update(u.id, { roleIds: [h.roleId('AUDITOR')] });
        h.principals.invalidateUser(u.id);
        const after = await h.auth.authenticate(s.accessToken);
        expect(after.permissions.has('payment.collect')).toBe(false);
        expect(after.permissions.has('audit.view')).toBe(true);
      });

      it('permissions are the union of all roles; inactive roles and unknown permission keys are ignored', async () => {
        const u = await h.addUser('asha@school.test', PW, ['FEE_COLLECTOR', 'COMMS_OFFICER']);
        const s = await login();
        const p = await h.auth.authenticate(s.accessToken);
        expect(p.permissions.has('payment.collect')).toBe(true);
        expect(p.permissions.has('reminder.send')).toBe(true);
        expect(p.roleKeys.sort()).toEqual(['COMMS_OFFICER', 'FEE_COLLECTOR']);
        const stale = await h.roles.create({
          institutionId: u.institutionId,
          key: 'STALE',
          name: 'Stale',
          permissions: ['payment.reverse', 'made.up'],
          dataScope: 'ALL',
          isSystem: false,
          isActive: true,
        });
        await h.users.update(u.id, { roleIds: [...u.roleIds, stale.id] });
        h.principals.invalidateUser(u.id);
        expect((await h.auth.authenticate(s.accessToken)).permissions.has('payment.reverse')).toBe(
          true,
        );
        expect((await h.auth.authenticate(s.accessToken)).permissions.has('made.up')).toBe(false);
        const cur = (await h.roles.findById(stale.id))!;
        await h.roles.update(stale.id, { isActive: false }, cur.version);
        h.principals.invalidateAll();
        expect((await h.auth.authenticate(s.accessToken)).permissions.has('payment.reverse')).toBe(
          false,
        );
      });

      it('the token version alone kills old access tokens (defence in depth, even if no session was revoked)', async () => {
        const u = await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const s = await login();
        await h.users.setPassword(u.id, await h.hasher.hash('Another-Pass-77!'), {
          mustChangePassword: false,
          activate: false,
        });
        h.principals.invalidateAll();
        expect(
          (await h.sessions.findByTokenHash(hashRefreshToken(s.refreshToken)))?.revokedAt,
        ).toBeUndefined(); // session itself is still live
        expect(await code(h.auth.authenticate(s.accessToken))).toBe('SESSION_ENDED');
      });

      it('a deactivated user is cut off on the very next request', async () => {
        const u = await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const s = await login();
        await h.users.update(u.id, { status: 'INACTIVE' });
        h.principals.invalidateUser(u.id);
        expect(await code(h.auth.authenticate(s.accessToken))).toBe('ACCOUNT_DISABLED');
      });
    });

    describe('refresh — rotation and reuse detection', () => {
      it('issues a NEW refresh token each time; the absolute expiry never extends', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const s1 = await login();
        advance(minutes(30));
        const s2 = await h.auth.refresh({ refreshToken: s1.refreshToken });
        expect(s2.refreshToken).not.toBe(s1.refreshToken);
        expect(s2.refreshExpiresAt.getTime()).toBe(s1.refreshExpiresAt.getTime());
        await expect(h.auth.authenticate(s2.accessToken)).resolves.toBeDefined();
        const stored = await h.sessions.findByTokenHash(hashRefreshToken(s2.refreshToken));
        expect(stored?.tokenHash).not.toBe(s2.refreshToken); // only the hash is stored
      });

      it('REUSE of a rotated token ends the WHOLE login family (the thief and the real user)', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const s1 = await login();
        advance(minutes(1));
        const s2 = await h.auth.refresh({ refreshToken: s1.refreshToken });
        advance(minutes(5)); // well past the multi-tab grace window
        expect(await code(h.auth.refresh({ refreshToken: s1.refreshToken }))).toBe(
          'REFRESH_REUSED',
        );
        expect(await code(h.auth.refresh({ refreshToken: s2.refreshToken }))).toBe(
          'REFRESH_INVALID',
        ); // family is dead
        expect(await code(h.auth.authenticate(s2.accessToken))).toBe('SESSION_ENDED');
        expect(actions()).toContain('TOKEN_REUSE_DETECTED');
      });

      it('replay inside the grace window is a multi-tab race: refused but the family survives', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const s1 = await login();
        const s2 = await h.auth.refresh({ refreshToken: s1.refreshToken });
        advance(3_000);
        expect(await code(h.auth.refresh({ refreshToken: s1.refreshToken }))).toBe('REFRESH_RACE');
        await expect(h.auth.refresh({ refreshToken: s2.refreshToken })).resolves.toBeDefined();
        expect(actions()).not.toContain('TOKEN_REUSE_DETECTED');
      });

      it('two simultaneous refreshes of the same token: exactly one wins', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const s1 = await login();
        const r = await Promise.allSettled(
          Array.from({ length: 5 }, () => h.auth.refresh({ refreshToken: s1.refreshToken })),
        );
        expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
        for (const x of r.filter((y) => y.status === 'rejected'))
          expect((x as PromiseRejectedResult).reason.code).toBe('REFRESH_RACE');
      });

      it('idle timeout: 8 hours without activity ends the session', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const s1 = await login();
        advance(hours(7));
        const s2 = await h.auth.refresh({ refreshToken: s1.refreshToken }); // activity resets the idle clock
        advance(hours(7));
        const s3 = await h.auth.refresh({ refreshToken: s2.refreshToken });
        advance(hours(9));
        expect(await code(h.auth.refresh({ refreshToken: s3.refreshToken }))).toBe(
          'SESSION_EXPIRED',
        );
      });

      it('absolute lifetime: 7 days after login the session ends however active the user is', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        let s = await login();
        for (let i = 0; i < 27; i++) {
          advance(hours(6));
          s = await h.auth.refresh({ refreshToken: s.refreshToken });
        }
        advance(hours(6)); // now 7 days + 6 h after login
        expect(await code(h.auth.refresh({ refreshToken: s.refreshToken }))).toBe(
          'SESSION_EXPIRED',
        );
      });

      it('unknown tokens are refused; a deactivated user cannot refresh', async () => {
        const u = await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        expect(await code(h.auth.refresh({ refreshToken: 'x'.repeat(43) }))).toBe(
          'REFRESH_INVALID',
        );
        const s = await login();
        await h.users.update(u.id, { status: 'INACTIVE' });
        expect(await code(h.auth.refresh({ refreshToken: s.refreshToken }))).toBe('SESSION_ENDED');
      });
    });

    describe('logout', () => {
      it('ends the session: the refresh token and the access token both stop working', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const s = await login();
        await h.auth.logout({ refreshToken: s.refreshToken });
        expect(await code(h.auth.refresh({ refreshToken: s.refreshToken }))).toBe(
          'REFRESH_INVALID',
        );
        expect(await code(h.auth.authenticate(s.accessToken))).toBe('SESSION_ENDED');
        expect(actions()).toContain('LOGOUT');
      });
      it('is idempotent and tolerates missing / unknown tokens', async () => {
        await expect(h.auth.logout({})).resolves.toBeUndefined();
        await expect(h.auth.logout({ refreshToken: 'nope' })).resolves.toBeUndefined();
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const s = await login();
        await h.auth.logout({ refreshToken: s.refreshToken });
        await expect(h.auth.logout({ refreshToken: s.refreshToken })).resolves.toBeUndefined();
      });
      it('logout-all signs the user out of every device, other users are untouched', async () => {
        const a = await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        await h.addUser('ravi@school.test', PW, ['ACCOUNTANT']);
        const [d1, d2] = [await login(), await login()];
        const other = await login('ravi@school.test');
        expect(await h.auth.logoutAll(a.id)).toBe(2);
        expect(await code(h.auth.authenticate(d1.accessToken))).toBe('SESSION_ENDED');
        expect(await code(h.auth.authenticate(d2.accessToken))).toBe('SESSION_ENDED');
        await expect(h.auth.authenticate(other.accessToken)).resolves.toBeDefined();
      });
      it('a user can list and revoke only their own sessions', async () => {
        const a = await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const b = await h.addUser('ravi@school.test', PW, ['ACCOUNTANT']);
        await login();
        await login();
        const mine = await h.auth.listSessions(a.id);
        expect(mine).toHaveLength(2);
        const theirs = await login('ravi@school.test');
        const theirSession = await h.sessions.findByTokenHash(
          hashRefreshToken(theirs.refreshToken),
        );
        expect(await h.auth.revokeSession(a.id, theirSession!.id)).toBe(false);
        expect(await h.auth.revokeSession(a.id, mine[0]!.id)).toBe(true);
        expect(await h.auth.listSessions(a.id)).toHaveLength(1);
        expect(await h.auth.listSessions(b.id)).toHaveLength(1);
      });
    });

    describe('change password', () => {
      const change = async (email: string, current: string, next: string) => {
        const s = await login(email, current);
        const p = await h.auth.authenticate(s.accessToken);
        return {
          s,
          p,
          run: () => h.auth.changePassword(p, { currentPassword: current, newPassword: next }),
        };
      };

      it('rejects a wrong current password, a weak new one and an unchanged one', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const { s, p } = await change('asha@school.test', PW, 'x');
        expect(
          await code(
            h.auth.changePassword(p, {
              currentPassword: 'wrong',
              newPassword: 'Brand-New-Pass-9!',
            }),
          ),
        ).toBe('CURRENT_PASSWORD_WRONG');
        expect(
          await code(h.auth.changePassword(p, { currentPassword: PW, newPassword: 'short' })),
        ).toBe('WEAK_PASSWORD');
        expect(
          await code(
            h.auth.changePassword(p, { currentPassword: PW, newPassword: 'asha@school.test1' }),
          ),
        ).toBe('WEAK_PASSWORD');
        expect(await code(h.auth.changePassword(p, { currentPassword: PW, newPassword: PW }))).toBe(
          'PASSWORD_UNCHANGED',
        );
        await expect(h.auth.authenticate(s.accessToken)).resolves.toBeDefined(); // nothing changed
      });

      it('signs out every device, kills old tokens, issues fresh ones, and the new password works', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const other = await login();
        const { s, run } = await change('asha@school.test', PW, 'Brand-New-Pass-9!');
        const fresh = await run();
        expect(await code(h.auth.authenticate(s.accessToken))).toBe('SESSION_ENDED');
        expect(await code(h.auth.authenticate(other.accessToken))).toBe('SESSION_ENDED');
        expect(await code(h.auth.refresh({ refreshToken: s.refreshToken }))).toBe(
          'REFRESH_INVALID',
        );
        await expect(h.auth.authenticate(fresh.accessToken)).resolves.toBeDefined();
        expect(await code(login('asha@school.test', PW))).toBe('INVALID_CREDENTIALS');
        await expect(login('asha@school.test', 'Brand-New-Pass-9!')).resolves.toBeDefined();
        expect(actions()).toContain('PASSWORD_CHANGED');
        expect(JSON.stringify(h.auditStore.rows)).not.toContain('Brand-New-Pass-9!');
      });

      it('first-time change activates an invited user and clears the must-change flag', async () => {
        await h.addUser('new@school.test', 'Temp-Pass-123!', ['REGISTRAR'], {
          status: 'INVITED',
          mustChangePassword: true,
        });
        const { run } = await change('new@school.test', 'Temp-Pass-123!', 'My-Own-Pass-77!');
        const fresh = await run();
        expect(fresh.user.mustChangePassword).toBe(false);
        const u = await h.users.findByEmail('new@school.test');
        expect(u).toMatchObject({ status: 'ACTIVE', mustChangePassword: false });
      });

      it('clears the failed-login counter and any lock', async () => {
        await h.addUser('asha@school.test', PW, ['ACCOUNTANT']);
        const { run } = await change('asha@school.test', PW, 'Brand-New-Pass-9!');
        for (let i = 0; i < 3; i++) await code(login('asha@school.test', 'bad'));
        await run();
        expect((await h.users.findByEmail('asha@school.test'))?.failedLoginCount).toBe(0);
      });
    });
  });
}
