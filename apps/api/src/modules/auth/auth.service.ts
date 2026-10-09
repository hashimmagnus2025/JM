import type { Clock } from '@sfm/shared';
import { AppError, forbidden, unauthorized } from '../../lib/errors';
import type { AuditRecorder } from '../audit/audit.service';
import { assertPasswordAcceptable, type PasswordHasher } from './password';
import type { PrincipalResolver } from './principal';
import type {
  Principal,
  RoleRepo,
  SessionRecord,
  SessionRepo,
  UserRecord,
  UserRepo,
} from './ports';
import {
  hashRefreshToken,
  newFamilyId,
  newRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from './tokens';

export interface AuthConfig {
  jwtSecret: string;
  accessTtlSeconds: number;
  /** absolute session lifetime */
  refreshAbsoluteDays: number;
  /** sliding inactivity timeout */
  idleHours: number;
  maxFailedLogins: number;
  lockMinutes: number;
  /** a just-rotated refresh token presented again inside this window is a multi-tab race, not theft */
  rotationGraceSeconds: number;
}

export const DEFAULT_AUTH_CONFIG: Omit<AuthConfig, 'jwtSecret'> = {
  accessTtlSeconds: 900,
  refreshAbsoluteDays: 7,
  idleHours: 8,
  maxFailedLogins: 5,
  lockMinutes: 15,
  rotationGraceSeconds: 10,
};

export interface ClientInfo {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  roleKeys: string[];
  mustChangePassword: boolean;
}

export interface IssuedSession {
  accessToken: string;
  /** seconds until the access token expires */
  expiresIn: number;
  /** goes into an httpOnly cookie — never into JSON the browser can read */
  refreshToken: string;
  refreshExpiresAt: Date;
  user: PublicUser;
}

const INVALID = (): AppError =>
  unauthorized('INVALID_CREDENTIALS', 'E-mail or password is incorrect.');

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export class AuthService {
  constructor(
    private readonly deps: {
      users: UserRepo;
      roles: RoleRepo;
      sessions: SessionRepo;
      hasher: PasswordHasher;
      audit: AuditRecorder;
      clock: Clock;
      config: AuthConfig;
      principals: PrincipalResolver;
    },
  ) {}

  private get cfg(): AuthConfig {
    return this.deps.config;
  }

  /* ------------------------------ login ------------------------------ */

  async login(input: { email: string; password: string } & ClientInfo): Promise<IssuedSession> {
    const { users, hasher, clock } = this.deps;
    const now = clock.now();
    const email = normalizeEmail(input.email);
    const user = await users.findByEmail(email);

    if (!user) {
      await hasher.verify(await hasher.dummyHash(), input.password); // same work as a real attempt
      await this.audit('LOGIN_FAILED', 'user', 'unknown', input, {
        after: { email, reason: 'UNKNOWN_EMAIL' },
      });
      throw INVALID();
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      await this.audit('LOGIN_BLOCKED', 'user', user.id, input, {
        user,
        after: { reason: 'LOCKED' },
      });
      throw this.lockedError(user.lockedUntil, now);
    }

    const ok = await hasher.verify(user.passwordHash, input.password);
    if (!ok) {
      const count = await users.incrementFailedLogin(user.id);
      await this.audit('LOGIN_FAILED', 'user', user.id, input, {
        user,
        after: { failedLoginCount: count },
      });
      if (count >= this.cfg.maxFailedLogins) {
        const until = new Date(now.getTime() + this.cfg.lockMinutes * 60_000);
        await users.lockUntil(user.id, until);
        this.deps.principals.invalidateUser(user.id);
        await this.audit('ACCOUNT_LOCKED', 'user', user.id, input, {
          user,
          after: { lockedUntil: until },
        });
      }
      throw INVALID();
    }

    if (user.status === 'INACTIVE' || user.status === 'LOCKED') {
      await this.audit('LOGIN_BLOCKED', 'user', user.id, input, {
        user,
        after: { reason: user.status },
      });
      throw forbidden(
        'This account is disabled. Please contact your administrator.',
        'ACCOUNT_DISABLED',
      );
    }

    await users.registerSuccessfulLogin(user.id, now);
    const issued = await this.issue(user, newFamilyId(), undefined, input);
    await this.audit('LOGIN_SUCCEEDED', 'session', issued.sessionId, input, { user });
    return issued.session;
  }

  private lockedError(until: Date, now: Date): AppError {
    const seconds = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
    return new AppError(
      423,
      'ACCOUNT_LOCKED',
      'Too many failed attempts. Please try again later.',
      { retryAfterSeconds: seconds },
      { 'Retry-After': String(seconds) },
    );
  }

  /* ------------------------------ refresh (rotation + reuse detection) ------------------------------ */

  async refresh(input: { refreshToken: string } & ClientInfo): Promise<IssuedSession> {
    const { sessions, users, clock } = this.deps;
    const now = clock.now();
    const old = await sessions.findByTokenHash(hashRefreshToken(input.refreshToken));
    if (!old)
      throw unauthorized('REFRESH_INVALID', 'Your session has ended. Please sign in again.');

    if (old.revokedAt) {
      const sinceMs = now.getTime() - old.revokedAt.getTime();
      if (old.replacedBy && sinceMs <= this.cfg.rotationGraceSeconds * 1000) {
        // two tabs refreshed at the same moment: not an attack, the browser already holds the new cookie
        throw new AppError(409, 'REFRESH_RACE', 'Your session was just renewed. Please retry.');
      }
      if (old.replacedBy) {
        // a token that was already rotated is being replayed → assume theft, end the whole login family
        await sessions.revokeFamily(old.familyId, now);
        this.deps.principals.invalidateAll();
        await this.audit(
          'TOKEN_REUSE_DETECTED',
          'session',
          old.id,
          input,
          { after: { familyId: old.familyId, userId: old.userId } },
          old.userId,
        );
        throw unauthorized(
          'REFRESH_REUSED',
          'Your session was ended for security. Please sign in again.',
        );
      }
      throw unauthorized('REFRESH_INVALID', 'Your session has ended. Please sign in again.');
    }

    const idleMs = this.cfg.idleHours * 3_600_000;
    if (old.expiresAt <= now || old.lastUsedAt.getTime() + idleMs <= now.getTime()) {
      await sessions.revoke(old.id, now);
      throw unauthorized('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    }

    const user = await users.findById(old.userId);
    if (!user || user.status === 'INACTIVE' || user.status === 'LOCKED') {
      await sessions.revokeFamily(old.familyId, now);
      throw unauthorized('SESSION_ENDED', 'Your session has ended. Please sign in again.');
    }

    // rotate: the new session keeps the SAME absolute expiry (a refresh never extends the 7-day limit)
    const issued = await this.issue(user, old.familyId, old.expiresAt, input);
    const won = await sessions.markRotated(old.id, issued.sessionId, now);
    if (!won) {
      await sessions.revoke(issued.sessionId, now); // lost the race → discard the extra session
      throw new AppError(409, 'REFRESH_RACE', 'Your session was just renewed. Please retry.');
    }
    this.deps.principals.invalidateSession(old.id);
    return issued.session;
  }

  /* ------------------------------ logout ------------------------------ */

  /** idempotent: an unknown or already-ended token is simply ignored */
  async logout(input: { refreshToken?: string | undefined } & ClientInfo): Promise<void> {
    if (!input.refreshToken) return;
    const s = await this.deps.sessions.findByTokenHash(hashRefreshToken(input.refreshToken));
    if (!s || s.revokedAt) return;
    await this.deps.sessions.revoke(s.id, this.deps.clock.now());
    this.deps.principals.invalidateSession(s.id);
    await this.audit('LOGOUT', 'session', s.id, input, undefined, s.userId);
  }

  async logoutAll(userId: string, info: ClientInfo = {}): Promise<number> {
    const n = await this.deps.sessions.revokeAllForUser(userId, this.deps.clock.now());
    this.deps.principals.invalidateAll();
    await this.audit('LOGOUT_ALL', 'user', userId, info, { after: { sessions: n } }, userId);
    return n;
  }

  /* ------------------------------ password ------------------------------ */

  async changePassword(
    principal: Principal,
    input: { currentPassword: string; newPassword: string } & ClientInfo,
  ): Promise<IssuedSession> {
    const { users, hasher, sessions, clock } = this.deps;
    const user = await users.findById(principal.userId);
    if (!user) throw unauthorized();
    if (!(await hasher.verify(user.passwordHash, input.currentPassword))) {
      await this.audit('PASSWORD_CHANGE_FAILED', 'user', user.id, input, { user });
      throw new AppError(400, 'CURRENT_PASSWORD_WRONG', 'The current password is not correct.');
    }
    assertPasswordAcceptable(input.newPassword, { email: user.email, name: user.name });
    if (await hasher.verify(user.passwordHash, input.newPassword)) {
      throw new AppError(
        400,
        'PASSWORD_UNCHANGED',
        'Choose a password you have not used just now.',
      );
    }
    const updated = await users.setPassword(user.id, await hasher.hash(input.newPassword), {
      mustChangePassword: false,
      activate: true,
    });
    if (!updated) throw unauthorized();
    await sessions.revokeAllForUser(user.id, clock.now()); // every device is signed out
    this.deps.principals.invalidateAll();
    await this.audit('PASSWORD_CHANGED', 'user', user.id, input, { user });
    const issued = await this.issue(updated, newFamilyId(), undefined, input);
    return issued.session;
  }

  /* ------------------------------ per-request authentication ------------------------------ */

  async authenticate(accessToken: string): Promise<Principal> {
    const claims = await verifyAccessToken(accessToken, {
      secret: this.cfg.jwtSecret,
      now: this.deps.clock.now(),
    });
    return this.deps.principals.resolve(claims);
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    return this.deps.sessions.listActiveForUser(userId, this.deps.clock.now());
  }

  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const s = await this.deps.sessions.findById(sessionId);
    if (!s || s.userId !== userId || s.revokedAt) return false;
    await this.deps.sessions.revoke(s.id, this.deps.clock.now());
    this.deps.principals.invalidateSession(s.id);
    return true;
  }

  /* ------------------------------ internals ------------------------------ */

  private async issue(
    user: UserRecord,
    familyId: string,
    absoluteExpiry: Date | undefined,
    info: ClientInfo,
  ): Promise<{ session: IssuedSession; sessionId: string }> {
    const now = this.deps.clock.now();
    const refreshToken = newRefreshToken();
    const refreshExpiresAt =
      absoluteExpiry ?? new Date(now.getTime() + this.cfg.refreshAbsoluteDays * 86_400_000);
    const record = await this.deps.sessions.create({
      institutionId: user.institutionId,
      userId: user.id,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      userAgent: info.userAgent?.slice(0, 300),
      ip: info.ip,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: refreshExpiresAt,
    });
    const accessToken = await signAccessToken(
      { sub: user.id, sid: record.id, tv: user.tokenVersion },
      { secret: this.cfg.jwtSecret, ttlSeconds: this.cfg.accessTtlSeconds, now },
    );
    const roles = await this.deps.roles.findByIds(user.roleIds);
    return {
      sessionId: record.id,
      session: {
        accessToken,
        expiresIn: this.cfg.accessTtlSeconds,
        refreshToken,
        refreshExpiresAt,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          roleKeys: roles.map((r) => r.key),
          mustChangePassword: user.mustChangePassword,
        },
      },
    };
  }

  private async audit(
    action: string,
    entityType: string,
    entityId: string,
    info: ClientInfo,
    extra?: { user?: UserRecord; after?: unknown },
    userId?: string,
  ): Promise<void> {
    await this.deps.audit.record({
      at: this.deps.clock.now(),
      userId: extra?.user?.id ?? userId,
      userName: extra?.user?.name,
      action,
      entityType,
      entityId,
      after: extra?.after,
      ip: info.ip,
      userAgent: info.userAgent?.slice(0, 300),
      requestId: info.requestId,
    });
  }
}
