import { FixedClock, SYSTEM_ROLES } from '@sfm/shared';
import { AuditService, type AuditStore } from '../modules/audit/audit.service';
import { AuditSeqConflict } from '../modules/audit/audit.service';
import type { ChainedAuditEntry } from '../modules/audit/audit-chain';
import { AuthService, DEFAULT_AUTH_CONFIG, type AuthConfig } from '../modules/auth/auth.service';
import { argon2Hasher, type PasswordHasher } from '../modules/auth/password';
import type { RoleRepo, SessionRepo, UserRecord, UserRepo } from '../modules/auth/ports';
import { PrincipalResolver } from '../modules/auth/principal';
import { MemoryRoleRepo, MemorySessionRepo, MemoryUserRepo } from './memory-auth-repos';

export class MemoryAuditStore implements AuditStore {
  rows: ChainedAuditEntry[] = [];
  async head() {
    const last = this.rows[this.rows.length - 1];
    return last ? { seq: last.seq, hash: last.hash } : null;
  }
  async insert(e: ChainedAuditEntry) {
    if (this.rows.some((r) => r.seq === e.seq)) throw new AuditSeqConflict();
    this.rows.push(e);
  }
  async list() {
    return [...this.rows];
  }
}

/** cheap Argon2id for tests (still the real algorithm, just small parameters) */
export const testHasher = (): PasswordHasher =>
  argon2Hasher({ memoryCost: 8192, timeCost: 1, parallelism: 1 });

export const TEST_SECRET = 'test-secret-test-secret-test-secret-123456';
export const INSTITUTION = 'inst-1';

export interface AuthHarness {
  clock: FixedClock;
  users: UserRepo;
  roles: RoleRepo;
  sessions: SessionRepo;
  auditStore: MemoryAuditStore;
  audit: AuditService;
  hasher: PasswordHasher;
  principals: PrincipalResolver;
  auth: AuthService;
  config: AuthConfig;
  roleId(key: string): string;
  /** create an ACTIVE user with the given roles and a known password */
  addUser(
    email: string,
    password: string,
    roleKeys: string[],
    over?: Partial<UserRecord>,
  ): Promise<UserRecord>;
  dispose?(): Promise<void>;
}

export interface HarnessRepos {
  users: UserRepo;
  roles: RoleRepo;
  sessions: SessionRepo;
}

/** build the service graph over any repositories (in-memory by default, MongoDB in the integration suite) */
export async function buildAuthHarness(
  repos: HarnessRepos = {
    users: new MemoryUserRepo(),
    roles: new MemoryRoleRepo(),
    sessions: new MemorySessionRepo(),
  },
  over: Partial<AuthConfig> = {},
  institutionId: string = INSTITUTION,
): Promise<AuthHarness> {
  const clock = new FixedClock('2026-10-08T06:00:00Z');
  const hasher = testHasher();
  const auditStore = new MemoryAuditStore();
  const audit = new AuditService(auditStore);
  const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, jwtSecret: TEST_SECRET, ...over };
  const principals = new PrincipalResolver(repos.users, repos.roles, repos.sessions, clock, 0); // ttl 0: always fresh in tests
  const roleIds = new Map<string, string>();
  for (const def of SYSTEM_ROLES) {
    const r = await repos.roles.create({
      institutionId,
      key: def.key,
      name: def.name,
      description: def.description,
      permissions: [...def.permissions],
      dataScope: def.dataScope,
      isSystem: true,
      isActive: true,
    });
    roleIds.set(def.key, r.id);
  }
  const auth = new AuthService({ ...repos, hasher, audit, clock, config, principals });
  return {
    clock,
    ...repos,
    auditStore,
    audit,
    hasher,
    principals,
    auth,
    config,
    roleId: (key) => roleIds.get(key) as string,
    addUser: async (email, password, roleKeys, extra = {}) =>
      repos.users.create({
        institutionId,
        email,
        name: email.split('@')[0] as string,
        passwordHash: await hasher.hash(password),
        roleIds: roleKeys.map((k) => roleIds.get(k) as string),
        status: 'ACTIVE',
        mustChangePassword: false,
        ...extra,
      }),
  };
}
