import {
  SETTING_DEFS,
  isSettingKey,
  resolveSettings,
  settingDef,
  type Clock,
  type SettingKey,
  type Settings,
} from '@sfm/shared';
import {
  assertEditable,
  assertNoOverlap,
  assertTransition,
  closeBlockers,
  planSetCurrent,
  suggestNextYear,
  validateYearInput,
  type YearRange,
} from '../../domain/academic/academic-year';
import { badRequest, conflict, notFound } from '../../lib/errors';
import type { AuditRecorder } from '../audit/audit.service';
import type { ClientInfo } from '../auth/auth.service';
import type { Principal } from '../auth/ports';
import {
  ConcurrentChangeError,
  DuplicateCodeError,
  DuplicateLabelError,
  NO_YEAR_GUARDS,
  type AcademicYearRecord,
  type AcademicYearRepo,
  type CategoryRecord,
  type CategoryRepo,
  type InstitutionPatch,
  type InstitutionRecord,
  type InstitutionRepo,
  type SettingRepo,
  type YearGuards,
} from './ports';

/** audit helper shared by the setup services */
export class Audited {
  constructor(
    protected readonly audit: AuditRecorder,
    protected readonly clock: Clock,
  ) {}
  protected record(
    actor: Principal,
    action: string,
    entityType: string,
    entityId: string,
    info: ClientInfo,
    change?: { before?: unknown; after?: unknown; reason?: string },
  ): Promise<void> {
    return this.audit.record({
      at: this.clock.now(),
      userId: actor.userId,
      userName: actor.name,
      roleKeys: actor.roleKeys,
      action,
      entityType,
      entityId,
      ...change,
      ip: info.ip,
      userAgent: info.userAgent?.slice(0, 300),
      requestId: info.requestId,
    });
  }
}

/* ------------------------------ institution ------------------------------ */

export class InstitutionService extends Audited {
  constructor(
    private readonly repo: InstitutionRepo,
    audit: AuditRecorder,
    clock: Clock,
  ) {
    super(audit, clock);
  }

  async get(): Promise<InstitutionRecord> {
    const i = await this.repo.get();
    if (!i) throw notFound('The institution is not set up yet.', 'INSTITUTION_NOT_FOUND');
    return i;
  }

  async update(
    actor: Principal,
    patch: InstitutionPatch,
    info: ClientInfo = {},
  ): Promise<InstitutionRecord> {
    const before = await this.get();
    const saved = await this.repo.update(patch);
    if (!saved) throw notFound('The institution is not set up yet.', 'INSTITUTION_NOT_FOUND');
    const pick = (i: InstitutionRecord) => ({
      name: i.name,
      shortName: i.shortName,
      address: i.address,
      contact: i.contact,
      registrationNo: i.registrationNo,
      academicStartMonth: i.academicStartMonth,
      receiptFooter: i.receiptFooter,
      extra: i.extra,
    });
    await this.record(actor, 'INSTITUTION_UPDATED', 'institution', saved.id, info, {
      before: pick(before),
      after: pick(saved),
    });
    return saved;
  }
}

/* ------------------------------ settings ------------------------------ */

export interface SettingView {
  key: string;
  group: string;
  label: string;
  description: string;
  rule?: string | undefined;
  value: unknown;
  default: unknown;
  isDefault: boolean;
  updatedAt?: Date | undefined;
  updatedBy?: string | undefined;
}

/** what other modules depend on: the current typed settings (cached briefly, refreshed on every change) */
export interface SettingsProvider {
  get(): Promise<Settings>;
}

export class SettingsService extends Audited implements SettingsProvider {
  private cache: { settings: Settings; expiresAt: number } | null = null;

  constructor(
    private readonly repo: SettingRepo,
    audit: AuditRecorder,
    clock: Clock,
    private readonly ttlMs = 10_000,
  ) {
    super(audit, clock);
  }

  async get(): Promise<Settings> {
    const now = this.clock.now().getTime();
    if (this.cache && this.cache.expiresAt > now) return this.cache.settings;
    const stored = await this.repo.all();
    const { settings } = resolveSettings(Object.fromEntries(stored.map((s) => [s.key, s.value])));
    this.cache = { settings, expiresAt: now + this.ttlMs };
    return settings;
  }

  async list(): Promise<SettingView[]> {
    const stored = new Map((await this.repo.all()).map((s) => [s.key, s]));
    const { settings } = resolveSettings(
      Object.fromEntries([...stored].map(([k, s]) => [k, s.value])),
    );
    return SETTING_DEFS.map((d) => {
      const s = stored.get(d.key);
      const value = settings[d.key as SettingKey];
      return {
        key: d.key,
        group: d.group,
        label: d.label,
        description: d.description,
        rule: 'rule' in d ? d.rule : undefined,
        value,
        default: d.default,
        isDefault: !s || JSON.stringify(value) === JSON.stringify(d.default),
        updatedAt: s?.updatedAt,
        updatedBy: s?.updatedBy,
      };
    });
  }

  /** validates against the setting's own schema; the change is audited with before/after and an optional reason */
  async update(
    actor: Principal,
    key: string,
    value: unknown,
    reason: string | undefined,
    info: ClientInfo = {},
  ): Promise<SettingView> {
    if (!isSettingKey(key)) throw notFound('Unknown setting.', 'SETTING_NOT_FOUND');
    const parsed = settingDef(key).schema.safeParse(value);
    if (!parsed.success) {
      throw badRequest(
        'SETTING_INVALID',
        parsed.error.issues[0]?.message ?? 'Invalid value.',
        parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      );
    }
    const before = (await this.get())[key];
    await this.repo.set(key, parsed.data, actor.userId, this.clock.now());
    this.cache = null;
    await this.record(actor, 'SETTING_CHANGED', 'setting', key, info, {
      before: { value: before },
      after: { value: parsed.data },
      ...(reason ? { reason } : {}),
    });
    return (await this.list()).find((s) => s.key === key) as SettingView;
  }

  /** back to the default value */
  async reset(actor: Principal, key: string, info: ClientInfo = {}): Promise<SettingView> {
    if (!isSettingKey(key)) throw notFound('Unknown setting.', 'SETTING_NOT_FOUND');
    const before = (await this.get())[key];
    await this.repo.remove(key);
    this.cache = null;
    await this.record(actor, 'SETTING_RESET', 'setting', key, info, {
      before: { value: before },
      after: { value: settingDef(key).default },
    });
    return (await this.list()).find((s) => s.key === key) as SettingView;
  }
}

/* ------------------------------ academic years ------------------------------ */

const toRange = (y: AcademicYearRecord): YearRange => ({
  id: y.id,
  label: y.label,
  startDate: y.startDate,
  endDate: y.endDate,
  status: y.status,
  isCurrent: y.isCurrent,
});

export class AcademicYearService extends Audited {
  constructor(
    private readonly repo: AcademicYearRepo,
    audit: AuditRecorder,
    clock: Clock,
    private readonly guards: YearGuards = NO_YEAR_GUARDS,
  ) {
    super(audit, clock);
  }

  async list(
    filter: { status?: AcademicYearRecord['status'] | undefined } = {},
  ): Promise<AcademicYearRecord[]> {
    const all = await this.repo.list();
    return all
      .filter((y) => !filter.status || y.status === filter.status)
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  }

  async get(id: string): Promise<AcademicYearRecord> {
    const y = await this.repo.findById(id);
    if (!y) throw notFound('Academic year not found.', 'YEAR_NOT_FOUND');
    return y;
  }

  async current(): Promise<AcademicYearRecord | null> {
    return (await this.repo.list()).find((y) => y.isCurrent) ?? null;
  }

  async suggestNext() {
    return suggestNextYear(await this.repo.list());
  }

  async create(
    actor: Principal,
    input: { label: string; startDate: string; endDate: string },
    info: ClientInfo = {},
  ): Promise<AcademicYearRecord> {
    validateYearInput(input);
    assertNoOverlap({ id: '', ...input }, (await this.repo.list()).map(toRange));
    try {
      const y = await this.repo.create(input);
      await this.record(actor, 'ACADEMIC_YEAR_CREATED', 'academicYear', y.id, info, {
        after: { label: y.label, startDate: y.startDate, endDate: y.endDate },
      });
      return y;
    } catch (e) {
      if (e instanceof DuplicateLabelError)
        throw conflict('YEAR_LABEL_IN_USE', `${input.label} already exists.`);
      throw e;
    }
  }

  async update(
    actor: Principal,
    id: string,
    patch: {
      label?: string | undefined;
      startDate?: string | undefined;
      endDate?: string | undefined;
    },
    info: ClientInfo = {},
  ): Promise<AcademicYearRecord> {
    const before = await this.get(id);
    assertEditable(before);
    const next = {
      label: patch.label ?? before.label,
      startDate: patch.startDate ?? before.startDate,
      endDate: patch.endDate ?? before.endDate,
    };
    validateYearInput(next);
    assertNoOverlap({ id, ...next }, (await this.repo.list()).map(toRange));
    try {
      const saved = (await this.repo.update(id, next))!;
      await this.record(actor, 'ACADEMIC_YEAR_UPDATED', 'academicYear', id, info, {
        before: { label: before.label, startDate: before.startDate, endDate: before.endDate },
        after: next,
      });
      return saved;
    } catch (e) {
      if (e instanceof DuplicateLabelError)
        throw conflict('YEAR_LABEL_IN_USE', `${next.label} already exists.`);
      throw e;
    }
  }

  async activate(actor: Principal, id: string, info: ClientInfo = {}): Promise<AcademicYearRecord> {
    const y = await this.get(id);
    assertTransition(y.status, 'ACTIVE');
    const saved = (await this.repo.update(id, { status: 'ACTIVE' }))!;
    await this.record(actor, 'ACADEMIC_YEAR_ACTIVATED', 'academicYear', id, info, {
      before: { status: y.status },
      after: { status: 'ACTIVE' },
    });
    return saved;
  }

  /** ACTIVE → PLANNED: only when the year is not current and carries no data yet */
  async deactivate(
    actor: Principal,
    id: string,
    info: ClientInfo = {},
  ): Promise<AcademicYearRecord> {
    const y = await this.get(id);
    assertTransition(y.status, 'PLANNED');
    if (y.isCurrent)
      throw conflict(
        'YEAR_IS_CURRENT',
        'This is the current academic year. Make another year current first.',
      );
    if (await this.guards.hasData(id))
      throw conflict(
        'YEAR_HAS_DATA',
        'This year already has divisions, students or fees and cannot go back to planned.',
      );
    const saved = (await this.repo.update(id, { status: 'PLANNED' }))!;
    await this.record(actor, 'ACADEMIC_YEAR_DEACTIVATED', 'academicYear', id, info, {
      before: { status: y.status },
      after: { status: 'PLANNED' },
    });
    return saved;
  }

  /** exactly one current year; a planned year that becomes current is activated with it */
  async setCurrent(
    actor: Principal,
    id: string,
    info: ClientInfo = {},
  ): Promise<AcademicYearRecord> {
    const years = await this.repo.list();
    const plan = planSetCurrent(years.map(toRange), id);
    const before = years.find((y) => y.isCurrent);
    let saved;
    try {
      saved = await this.repo.setCurrent(plan.unset, plan.set);
    } catch (e) {
      if (e instanceof ConcurrentChangeError)
        throw conflict(
          'CONCURRENT_CHANGE',
          'Someone else just changed the current academic year. Reload and try again.',
        );
      throw e;
    }
    if (!saved) throw notFound('Academic year not found.', 'YEAR_NOT_FOUND');
    await this.record(actor, 'ACADEMIC_YEAR_SET_CURRENT', 'academicYear', id, info, {
      before: { current: before?.label ?? null },
      after: { current: saved.label },
    });
    return saved;
  }

  async close(
    actor: Principal,
    id: string,
    reason: string,
    info: ClientInfo = {},
  ): Promise<AcademicYearRecord> {
    const y = await this.get(id);
    assertTransition(y.status, 'CLOSED');
    const blockers = closeBlockers(toRange(y), { blockers: await this.guards.closeBlockers(id) });
    if (blockers.length > 0)
      throw conflict('YEAR_CLOSE_BLOCKED', 'This year cannot be closed yet.', blockers);
    const saved = (await this.repo.update(id, {
      status: 'CLOSED',
      closedAt: this.clock.now(),
      closedBy: actor.userId,
    }))!;
    await this.record(actor, 'ACADEMIC_YEAR_CLOSED', 'academicYear', id, info, {
      before: { status: y.status },
      after: { status: 'CLOSED' },
      reason,
    });
    return saved;
  }

  /** deliberate, audited correction: a closed year becomes active again */
  async reopen(
    actor: Principal,
    id: string,
    reason: string,
    info: ClientInfo = {},
  ): Promise<AcademicYearRecord> {
    const y = await this.get(id);
    assertTransition(y.status, 'ACTIVE');
    if (y.status !== 'CLOSED')
      throw conflict('YEAR_NOT_CLOSED', 'Only a closed year can be reopened.');
    const saved = (await this.repo.update(id, {
      status: 'ACTIVE',
      closedAt: undefined,
      closedBy: undefined,
    }))!;
    await this.record(actor, 'ACADEMIC_YEAR_REOPENED', 'academicYear', id, info, {
      before: { status: 'CLOSED' },
      after: { status: 'ACTIVE' },
      reason,
    });
    return saved;
  }
}

/* ------------------------------ student categories ------------------------------ */

export class CategoryService extends Audited {
  constructor(
    private readonly repo: CategoryRepo,
    audit: AuditRecorder,
    clock: Clock,
  ) {
    super(audit, clock);
  }

  async list(): Promise<CategoryRecord[]> {
    return (await this.repo.list()).sort(
      (a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name),
    );
  }

  async create(
    actor: Principal,
    input: { code: string; name: string; sequence?: number | undefined },
    info: ClientInfo = {},
  ): Promise<CategoryRecord> {
    try {
      const sequence =
        input.sequence ?? (await this.repo.list()).reduce((m, c) => Math.max(m, c.sequence), 0) + 1;
      const c = await this.repo.create({
        code: input.code,
        name: input.name.trim(),
        isActive: true,
        sequence,
      });
      await this.record(actor, 'STUDENT_CATEGORY_CREATED', 'studentCategory', c.id, info, {
        after: { code: c.code, name: c.name },
      });
      return c;
    } catch (e) {
      if (e instanceof DuplicateCodeError)
        throw conflict('CATEGORY_CODE_IN_USE', 'A category with this code already exists.');
      throw e;
    }
  }

  /** the code is permanent (fee structures refer to it); everything else can change and nothing is ever deleted */
  async update(
    actor: Principal,
    id: string,
    patch: {
      name?: string | undefined;
      isActive?: boolean | undefined;
      sequence?: number | undefined;
    },
    info: ClientInfo = {},
  ): Promise<CategoryRecord> {
    const before = await this.repo.findById(id);
    if (!before) throw notFound('Student category not found.', 'CATEGORY_NOT_FOUND');
    const saved = (await this.repo.update(id, {
      ...patch,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    }))!;
    await this.record(actor, 'STUDENT_CATEGORY_UPDATED', 'studentCategory', id, info, {
      before: { name: before.name, isActive: before.isActive, sequence: before.sequence },
      after: { name: saved.name, isActive: saved.isActive, sequence: saved.sequence },
    });
    return saved;
  }
}
