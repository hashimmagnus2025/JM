import type { DataScope } from '@sfm/shared';

export type UserStatus = 'INVITED' | 'ACTIVE' | 'INACTIVE' | 'LOCKED';

export interface UserRecord {
  id: string;
  institutionId: string;
  email: string;
  name: string;
  mobile?: string | undefined;
  passwordHash: string;
  roleIds: string[];
  status: UserStatus;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil?: Date | null | undefined;
  lastLoginAt?: Date | undefined;
  /** bumped on password change / reset: every older access token dies immediately */
  tokenVersion: number;
  createdAt: Date;
}

export type NewUser = Omit<UserRecord, 'id' | 'createdAt' | 'failedLoginCount' | 'tokenVersion'>;

export interface RoleRecord {
  id: string;
  institutionId: string;
  key: string;
  name: string;
  description?: string | undefined;
  permissions: string[];
  dataScope: DataScope;
  isSystem: boolean;
  isActive: boolean;
  version: number;
}

export type NewRole = Omit<RoleRecord, 'id' | 'version'>;

export interface SessionRecord {
  id: string;
  institutionId: string;
  userId: string;
  /** all tokens descended from one login share a family; reuse of a rotated token revokes the family */
  familyId: string;
  /** SHA-256 of the opaque refresh token — the token itself is never stored */
  tokenHash: string;
  userAgent?: string | undefined;
  ip?: string | undefined;
  createdAt: Date;
  lastUsedAt: Date;
  /** absolute lifetime */
  expiresAt: Date;
  revokedAt?: Date | undefined;
  replacedBy?: string | undefined;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super('email already in use');
    this.name = 'DuplicateEmailError';
  }
}

export class DuplicateRoleKeyError extends Error {
  constructor() {
    super('role key already in use');
    this.name = 'DuplicateRoleKeyError';
  }
}

export interface UserListQuery {
  page: number;
  pageSize: number;
  q?: string | undefined;
  status?: UserStatus | undefined;
}

export interface UserRepo {
  findById(id: string): Promise<UserRecord | null>;
  /** emails are matched case-insensitively (stored lower-case) */
  findByEmail(email: string): Promise<UserRecord | null>;
  create(user: NewUser): Promise<UserRecord>;
  update(
    id: string,
    patch: Partial<
      Pick<
        UserRecord,
        'name' | 'mobile' | 'roleIds' | 'status' | 'lockedUntil' | 'mustChangePassword'
      >
    >,
  ): Promise<UserRecord | null>;
  /** atomic increment; returns the new count */
  incrementFailedLogin(id: string): Promise<number>;
  lockUntil(id: string, until: Date): Promise<void>;
  /** admin action: clears the failed-login counter and any temporary lock */
  unlock(id: string): Promise<void>;
  registerSuccessfulLogin(id: string, at: Date): Promise<void>;
  /** sets the hash, bumps tokenVersion, clears failures/lock, optionally forces a change at next login */
  setPassword(
    id: string,
    passwordHash: string,
    opts: { mustChangePassword: boolean; activate: boolean },
  ): Promise<UserRecord | null>;
  list(q: UserListQuery): Promise<{ items: UserRecord[]; total: number }>;
  /** users that are ACTIVE and hold the role (used to protect the last Super Admin) */
  countActiveWithRole(roleId: string, excludeUserId?: string): Promise<number>;
  countUsersWithRole(roleId: string): Promise<number>;
}

export interface RoleRepo {
  findById(id: string): Promise<RoleRecord | null>;
  findByIds(ids: readonly string[]): Promise<RoleRecord[]>;
  findByKey(key: string): Promise<RoleRecord | null>;
  list(): Promise<RoleRecord[]>;
  create(role: NewRole): Promise<RoleRecord>;
  /** optimistic: fails (null) when `expectedVersion` is stale */
  update(
    id: string,
    patch: Partial<
      Pick<RoleRecord, 'name' | 'description' | 'permissions' | 'dataScope' | 'isActive'>
    >,
    expectedVersion: number,
  ): Promise<RoleRecord | null>;
}

export interface SessionRepo {
  create(s: Omit<SessionRecord, 'id'>): Promise<SessionRecord>;
  findByTokenHash(hash: string): Promise<SessionRecord | null>;
  findById(id: string): Promise<SessionRecord | null>;
  /** guarded: succeeds for exactly ONE caller; the loser gets false (token already used) */
  markRotated(id: string, replacedBy: string | undefined, at: Date): Promise<boolean>;
  touch(id: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date, exceptSessionId?: string): Promise<number>;
  listActiveForUser(userId: string, now: Date): Promise<SessionRecord[]>;
}

/** what the rest of the app knows about the signed-in person */
export interface Principal {
  userId: string;
  sessionId: string;
  institutionId: string;
  name: string;
  email: string;
  roleKeys: string[];
  permissions: ReadonlySet<string>;
  dataScope: DataScope;
  mustChangePassword: boolean;
}
