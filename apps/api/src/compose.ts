import { SystemClock, type Clock } from '@sfm/shared';
import type { Connection } from 'mongoose';
import type { ApiModules } from './app';
import { AuditService } from './modules/audit/audit.service';
import { AuthService, DEFAULT_AUTH_CONFIG, type AuthConfig } from './modules/auth/auth.service';
import {
  MongoAuditStore,
  MongoRoleRepo,
  MongoSessionRepo,
  MongoUserRepo,
} from './modules/auth/mongo-repos';
import { argon2Hasher, type PasswordHasher } from './modules/auth/password';
import { PrincipalResolver } from './modules/auth/principal';
import { IdentityService } from './modules/identity/identity.service';
import {
  MongoCategoryRepo,
  MongoInstitutionRepo,
  MongoSettingRepo,
  MongoYearRepo,
} from './modules/setup/mongo-repos';
import {
  AcademicYearService,
  CategoryService,
  InstitutionService,
  SettingsService,
} from './modules/setup/setup.service';

export interface ComposeOptions {
  jwtSecret: string;
  accessTtlSeconds?: number;
  refreshAbsoluteDays?: number;
  secureCookies: boolean;
  corsOrigins?: string[];
  clock?: Clock;
  hasher?: PasswordHasher;
  authConfig?: Partial<AuthConfig>;
}

/** the one place where repositories, services and routes are wired together (server + integration tests) */
export function composeApi(conn: Connection, institutionId: string, o: ComposeOptions): ApiModules {
  const clock = o.clock ?? new SystemClock();
  const hasher = o.hasher ?? argon2Hasher();
  const users = new MongoUserRepo(conn, institutionId);
  const roles = new MongoRoleRepo(conn, institutionId);
  const sessions = new MongoSessionRepo(conn, institutionId);
  const audit = new AuditService(new MongoAuditStore(conn, institutionId));
  const principals = new PrincipalResolver(users, roles, sessions, clock);
  const auth = new AuthService({
    users,
    roles,
    sessions,
    hasher,
    audit,
    clock,
    principals,
    config: {
      ...DEFAULT_AUTH_CONFIG,
      jwtSecret: o.jwtSecret,
      ...(o.accessTtlSeconds ? { accessTtlSeconds: o.accessTtlSeconds } : {}),
      ...(o.refreshAbsoluteDays ? { refreshAbsoluteDays: o.refreshAbsoluteDays } : {}),
      ...o.authConfig,
    },
  });
  const identity = new IdentityService({
    users,
    roles,
    sessions,
    hasher,
    audit,
    clock,
    principals,
  });
  const setup = {
    institution: new InstitutionService(
      new MongoInstitutionRepo(conn, institutionId),
      audit,
      clock,
    ),
    settings: new SettingsService(new MongoSettingRepo(conn, institutionId), audit, clock),
    years: new AcademicYearService(new MongoYearRepo(conn, institutionId), audit, clock),
    categories: new CategoryService(new MongoCategoryRepo(conn, institutionId), audit, clock),
  };
  return {
    auth,
    identity,
    setup,
    routes: { secureCookies: o.secureCookies },
    ...(o.corsOrigins ? { corsOrigins: o.corsOrigins } : {}),
  };
}
