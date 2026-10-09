import { isPermissionKey, type Clock, type DataScope } from '@sfm/shared';
import { forbidden, unauthorized } from '../../lib/errors';
import type { AccessClaims } from './tokens';
import type { Principal, RoleRecord, RoleRepo, SessionRepo, UserRecord, UserRepo } from './ports';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Authorization is evaluated from SERVER state on every request — the JWT only says who you are, never what
 * you may do. A tiny in-process TTL cache keeps this cheap; changes made through this process invalidate it
 * at once, other instances catch up within `ttlMs` (a Redis-backed invalidation can replace it later).
 */
export class PrincipalResolver {
  private users = new Map<string, Entry<{ user: UserRecord; roles: RoleRecord[] }>>();
  private sessions = new Map<string, Entry<boolean>>();

  constructor(
    private readonly userRepo: UserRepo,
    private readonly roleRepo: RoleRepo,
    private readonly sessionRepo: SessionRepo,
    private readonly clock: Clock,
    private readonly ttlMs = 10_000,
  ) {}

  invalidateUser(userId: string): void {
    this.users.delete(userId);
  }
  invalidateSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
  /** a role changed: every cached user may be affected */
  invalidateAll(): void {
    this.users.clear();
    this.sessions.clear();
  }

  private fresh<T>(e: Entry<T> | undefined): T | undefined {
    return e && e.expiresAt > this.clock.now().getTime() ? e.value : undefined;
  }

  async resolve(claims: AccessClaims): Promise<Principal> {
    const now = this.clock.now();

    let sessionActive = this.fresh(this.sessions.get(claims.sid));
    if (sessionActive === undefined) {
      const s = await this.sessionRepo.findById(claims.sid);
      sessionActive = !!s && !s.revokedAt && s.expiresAt > now && s.userId === claims.sub;
      this.sessions.set(claims.sid, {
        value: sessionActive,
        expiresAt: now.getTime() + this.ttlMs,
      });
    }
    if (!sessionActive)
      throw unauthorized('SESSION_ENDED', 'You have been signed out. Please sign in again.');

    let cached = this.fresh(this.users.get(claims.sub));
    if (!cached) {
      const user = await this.userRepo.findById(claims.sub);
      if (!user)
        throw unauthorized('TOKEN_INVALID', 'Your session is not valid. Please sign in again.');
      const roles = (await this.roleRepo.findByIds(user.roleIds)).filter((r) => r.isActive);
      cached = { user, roles };
      this.users.set(claims.sub, { value: cached, expiresAt: now.getTime() + this.ttlMs });
    }
    const { user, roles } = cached;

    if (user.tokenVersion !== claims.tv)
      throw unauthorized('SESSION_ENDED', 'Your password changed. Please sign in again.');
    if (user.status === 'INACTIVE' || user.status === 'LOCKED') {
      throw forbidden(
        'This account is disabled. Please contact your administrator.',
        'ACCOUNT_DISABLED',
      );
    }

    const permissions = new Set<string>();
    for (const r of roles)
      for (const p of r.permissions) if (isPermissionKey(p)) permissions.add(p);
    const dataScope: DataScope = roles.some((r) => r.dataScope === 'ALL')
      ? 'ALL'
      : roles.length > 0
        ? 'OWN_DIVISIONS'
        : 'ALL';

    return {
      userId: user.id,
      sessionId: claims.sid,
      institutionId: user.institutionId,
      name: user.name,
      email: user.email,
      roleKeys: roles.map((r) => r.key),
      permissions,
      dataScope,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
