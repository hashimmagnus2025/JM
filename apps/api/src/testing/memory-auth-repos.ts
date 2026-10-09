import { randomBytes } from 'node:crypto';
import {
  DuplicateEmailError,
  DuplicateRoleKeyError,
  type NewRole,
  type NewUser,
  type RoleRecord,
  type RoleRepo,
  type SessionRecord,
  type SessionRepo,
  type UserListQuery,
  type UserRecord,
  type UserRepo,
} from '../modules/auth/ports';

const id = (): string => randomBytes(12).toString('hex');
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
const clone = <T>(x: T): T => structuredClone(x);

export class MemoryUserRepo implements UserRepo {
  rows = new Map<string, UserRecord>();
  async findById(i: string) {
    await tick();
    const u = this.rows.get(i);
    return u ? clone(u) : null;
  }
  async findByEmail(email: string) {
    await tick();
    const u = [...this.rows.values()].find((x) => x.email === email.trim().toLowerCase());
    return u ? clone(u) : null;
  }
  async create(user: NewUser) {
    await tick();
    const email = user.email.trim().toLowerCase();
    if ([...this.rows.values()].some((x) => x.email === email)) throw new DuplicateEmailError();
    const rec: UserRecord = {
      ...user,
      email,
      id: id(),
      createdAt: new Date(),
      failedLoginCount: 0,
      tokenVersion: 0,
    };
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async update(i: string, patch: Parameters<UserRepo['update']>[1]) {
    await tick();
    const u = this.rows.get(i);
    if (!u) return null;
    Object.assign(u, patch);
    return clone(u);
  }
  async incrementFailedLogin(i: string) {
    await tick();
    const u = this.rows.get(i) as UserRecord;
    u.failedLoginCount += 1;
    return u.failedLoginCount;
  }
  async lockUntil(i: string, until: Date) {
    await tick();
    (this.rows.get(i) as UserRecord).lockedUntil = until;
  }
  async unlock(i: string) {
    await tick();
    const u = this.rows.get(i) as UserRecord;
    u.failedLoginCount = 0;
    u.lockedUntil = null;
  }
  async registerSuccessfulLogin(i: string, at: Date) {
    await tick();
    const u = this.rows.get(i) as UserRecord;
    u.failedLoginCount = 0;
    u.lockedUntil = null;
    u.lastLoginAt = at;
  }
  async setPassword(
    i: string,
    passwordHash: string,
    opts: { mustChangePassword: boolean; activate: boolean },
  ) {
    await tick();
    const u = this.rows.get(i);
    if (!u) return null;
    u.passwordHash = passwordHash;
    u.tokenVersion += 1;
    u.failedLoginCount = 0;
    u.lockedUntil = null;
    u.mustChangePassword = opts.mustChangePassword;
    if (opts.activate && u.status === 'INVITED') u.status = 'ACTIVE';
    return clone(u);
  }
  async list(q: UserListQuery) {
    await tick();
    let items = [...this.rows.values()];
    if (q.status) items = items.filter((u) => u.status === q.status);
    if (q.q) {
      const needle = q.q.toLowerCase();
      items = items.filter(
        (u) => u.name.toLowerCase().includes(needle) || u.email.includes(needle),
      );
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return {
      items: clone(items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize)),
      total: items.length,
    };
  }
  async countActiveWithRole(roleId: string, excludeUserId?: string) {
    await tick();
    return [...this.rows.values()].filter(
      (u) => u.status === 'ACTIVE' && u.roleIds.includes(roleId) && u.id !== excludeUserId,
    ).length;
  }
  async countUsersWithRole(roleId: string) {
    await tick();
    return [...this.rows.values()].filter((u) => u.roleIds.includes(roleId)).length;
  }
}

export class MemoryRoleRepo implements RoleRepo {
  rows = new Map<string, RoleRecord>();
  async findById(i: string) {
    await tick();
    const r = this.rows.get(i);
    return r ? clone(r) : null;
  }
  async findByIds(ids: readonly string[]) {
    await tick();
    return ids
      .map((i) => this.rows.get(i))
      .filter((r): r is RoleRecord => !!r)
      .map(clone);
  }
  async findByKey(key: string) {
    await tick();
    const r = [...this.rows.values()].find((x) => x.key === key);
    return r ? clone(r) : null;
  }
  async list() {
    await tick();
    return [...this.rows.values()].map(clone);
  }
  async create(role: NewRole) {
    await tick();
    if ([...this.rows.values()].some((x) => x.key === role.key)) throw new DuplicateRoleKeyError();
    const rec: RoleRecord = { ...role, id: id(), version: 0 };
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async update(i: string, patch: Parameters<RoleRepo['update']>[1], expectedVersion: number) {
    await tick();
    const r = this.rows.get(i);
    if (!r || r.version !== expectedVersion) return null;
    Object.assign(r, patch, { version: r.version + 1 });
    return clone(r);
  }
}

export class MemorySessionRepo implements SessionRepo {
  rows = new Map<string, SessionRecord>();
  async create(s: Omit<SessionRecord, 'id'>) {
    await tick();
    const rec: SessionRecord = { ...s, id: id() };
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async findByTokenHash(hash: string) {
    await tick();
    const s = [...this.rows.values()].find((x) => x.tokenHash === hash);
    return s ? clone(s) : null;
  }
  async findById(i: string) {
    await tick();
    const s = this.rows.get(i);
    return s ? clone(s) : null;
  }
  async markRotated(i: string, replacedBy: string | undefined, at: Date) {
    await tick();
    const s = this.rows.get(i);
    if (!s || s.revokedAt) return false; // guarded: only the first caller wins
    s.revokedAt = at;
    s.replacedBy = replacedBy;
    return true;
  }
  async touch(i: string, at: Date) {
    await tick();
    const s = this.rows.get(i);
    if (s) s.lastUsedAt = at;
  }
  async revoke(i: string, at: Date) {
    await tick();
    const s = this.rows.get(i);
    if (s && !s.revokedAt) s.revokedAt = at;
  }
  async revokeFamily(familyId: string, at: Date) {
    await tick();
    for (const s of this.rows.values())
      if (s.familyId === familyId && !s.revokedAt) s.revokedAt = at;
  }
  async revokeAllForUser(userId: string, at: Date, except?: string) {
    await tick();
    let n = 0;
    for (const s of this.rows.values()) {
      if (s.userId === userId && !s.revokedAt && s.id !== except) {
        s.revokedAt = at;
        n++;
      }
    }
    return n;
  }
  async listActiveForUser(userId: string, now: Date) {
    await tick();
    return [...this.rows.values()]
      .filter((s) => s.userId === userId && !s.revokedAt && s.expiresAt > now)
      .map(clone);
  }
}
