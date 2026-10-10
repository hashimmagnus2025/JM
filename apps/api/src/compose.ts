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
import {
  ClassService,
  DivisionService,
  DivisionYearGuards,
} from './modules/academic/academic.service';
import { MongoClassRepo, MongoDivisionRepo } from './modules/academic/mongo-repos';
import { MongoAssignmentRepo, MongoTeacherRepo } from './modules/teachers/mongo-repos';
import { AssignmentService, TeacherService } from './modules/teachers/teacher.service';
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
  const yearRepo = new MongoYearRepo(conn, institutionId);
  const classRepo = new MongoClassRepo(conn, institutionId);
  const divisionRepo = new MongoDivisionRepo(conn, institutionId);
  const teacherRepo = new MongoTeacherRepo(conn, institutionId);
  const assignmentRepo = new MongoAssignmentRepo(conn, institutionId);
  const settings = new SettingsService(new MongoSettingRepo(conn, institutionId), audit, clock);
  const setup = {
    institution: new InstitutionService(
      new MongoInstitutionRepo(conn, institutionId),
      audit,
      clock,
    ),
    settings,
    years: new AcademicYearService(yearRepo, audit, clock, new DivisionYearGuards(divisionRepo)),
    categories: new CategoryService(new MongoCategoryRepo(conn, institutionId), audit, clock),
  };
  const academic = {
    classes: new ClassService(classRepo, divisionRepo, audit, clock),
    divisions: new DivisionService(divisionRepo, classRepo, yearRepo, audit, clock),
  };
  const teachers = {
    teachers: new TeacherService(teacherRepo, assignmentRepo, divisionRepo, yearRepo, audit, clock),
    assignments: new AssignmentService(
      assignmentRepo,
      teacherRepo,
      divisionRepo,
      yearRepo,
      settings,
      audit,
      clock,
    ),
  };
  return {
    auth,
    identity,
    setup,
    academic,
    teachers,
    routes: { secureCookies: o.secureCookies },
    ...(o.corsOrigins ? { corsOrigins: o.corsOrigins } : {}),
  };
}
