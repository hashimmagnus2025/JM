import { createLogger } from '../config/logger';
import { createApp } from '../app';
import { IdentityService } from '../modules/identity/identity.service';
import { NO_YEAR_GUARDS, type YearGuards } from '../modules/setup/ports';
import {
  AcademicYearService,
  CategoryService,
  InstitutionService,
  SettingsService,
} from '../modules/setup/setup.service';
import { buildAuthHarness, type AuthHarness } from './auth-harness';
import {
  MemoryCategoryRepo,
  MemoryInstitutionRepo,
  MemorySettingRepo,
  MemoryYearRepo,
} from './memory-setup-repos';

export interface HttpHarness extends AuthHarness {
  app: ReturnType<typeof createApp>;
  identity: IdentityService;
  setup: {
    institution: InstitutionService;
    settings: SettingsService;
    years: AcademicYearService;
    categories: CategoryService;
    repos: {
      institution: MemoryInstitutionRepo;
      settings: MemorySettingRepo;
      years: MemoryYearRepo;
      categories: MemoryCategoryRepo;
    };
    guards: { current: YearGuards };
  };
}

export async function buildHttpHarness(
  opts: { loginLimit?: number; corsOrigins?: string[] } = {},
): Promise<HttpHarness> {
  const h = await buildAuthHarness();
  const identity = new IdentityService({
    users: h.users,
    roles: h.roles,
    sessions: h.sessions,
    hasher: h.hasher,
    audit: h.audit,
    clock: h.clock,
    principals: h.principals,
  });
  const repos = {
    institution: new MemoryInstitutionRepo(),
    settings: new MemorySettingRepo(),
    years: new MemoryYearRepo(),
    categories: new MemoryCategoryRepo(),
  };
  // the guards are swappable so tests can pretend later phases (divisions, fees) already hold data
  const guards = { current: NO_YEAR_GUARDS };
  const delegating: YearGuards = {
    closeBlockers: (id) => guards.current.closeBlockers(id),
    hasData: (id) => guards.current.hasData(id),
  };
  const setup = {
    institution: new InstitutionService(repos.institution, h.audit, h.clock),
    settings: new SettingsService(repos.settings, h.audit, h.clock, 0),
    years: new AcademicYearService(repos.years, h.audit, h.clock, delegating),
    categories: new CategoryService(repos.categories, h.audit, h.clock),
  };
  const app = createApp({
    logger: createLogger('silent'),
    readiness: {},
    api: {
      auth: h.auth,
      identity,
      setup,
      routes: {
        secureCookies: false,
        loginRateLimit: { windowMs: 60_000, limit: opts.loginLimit ?? 1000 },
      },
      ...(opts.corsOrigins ? { corsOrigins: opts.corsOrigins } : {}),
    },
  });
  return Object.assign(h, { app, identity, setup: { ...setup, repos, guards } });
}
