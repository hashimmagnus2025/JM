import type { Clock } from '@sfm/shared';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import type { AuditRecorder } from '../audit/audit.service';
import type { ClientInfo } from '../auth/auth.service';
import type { Principal } from '../auth/ports';
import { DuplicateCodeError, type AcademicYearRepo, type YearGuards } from '../setup/ports';
import { Audited } from '../setup/setup.service';
import {
  NO_DIVISION_USAGE,
  DuplicateDivisionError,
  type ClassRecord,
  type ClassRepo,
  type DivisionFilter,
  type DivisionRecord,
  type DivisionRepo,
  type DivisionUsage,
} from './ports';

/* ------------------------------ classes ------------------------------ */

export class ClassService extends Audited {
  constructor(
    private readonly repo: ClassRepo,
    private readonly divisions: DivisionRepo,
    audit: AuditRecorder,
    clock: Clock,
  ) {
    super(audit, clock);
  }

  async list(): Promise<ClassRecord[]> {
    return (await this.repo.list()).sort((a, b) => a.sequence - b.sequence);
  }

  private async get(id: string): Promise<ClassRecord> {
    const c = await this.repo.findById(id);
    if (!c) throw notFound('Class not found.', 'CLASS_NOT_FOUND');
    return c;
  }

  async create(
    actor: Principal,
    input: { code: string; name: string; isFinal?: boolean | undefined },
    info: ClientInfo = {},
  ): Promise<ClassRecord> {
    const sequence = (await this.repo.list()).reduce((m, c) => Math.max(m, c.sequence), 0) + 1;
    try {
      const c = await this.repo.create({
        code: input.code,
        name: input.name.trim(),
        sequence,
        isActive: true,
        isFinal: input.isFinal ?? false,
      });
      await this.record(actor, 'CLASS_CREATED', 'class', c.id, info, {
        after: { code: c.code, name: c.name, isFinal: c.isFinal },
      });
      return c;
    } catch (e) {
      if (e instanceof DuplicateCodeError)
        throw conflict('CLASS_CODE_IN_USE', 'A class with this code already exists.');
      throw e;
    }
  }

  /** the code is permanent (fee structures and history refer to it); a class is never deleted, only deactivated */
  async update(
    actor: Principal,
    id: string,
    patch: {
      name?: string | undefined;
      isActive?: boolean | undefined;
      isFinal?: boolean | undefined;
    },
    info: ClientInfo = {},
  ): Promise<ClassRecord> {
    const before = await this.get(id);
    if (patch.isActive === false && before.isActive) {
      const active = await this.divisions.countActiveByClass(id);
      if (active > 0)
        throw conflict(
          'CLASS_HAS_ACTIVE_DIVISIONS',
          `This class still has ${active} active division${active === 1 ? '' : 's'}. Deactivate them first.`,
        );
    }
    const saved = (await this.repo.update(id, {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      ...(patch.isFinal !== undefined ? { isFinal: patch.isFinal } : {}),
    }))!;
    await this.record(actor, 'CLASS_UPDATED', 'class', id, info, {
      before: { name: before.name, isActive: before.isActive, isFinal: before.isFinal },
      after: { name: saved.name, isActive: saved.isActive, isFinal: saved.isFinal },
    });
    return saved;
  }

  /** `ids` is the complete new order: every class exactly once (so two people can never half-overwrite each other) */
  async reorder(
    actor: Principal,
    ids: readonly string[],
    info: ClientInfo = {},
  ): Promise<ClassRecord[]> {
    const current = await this.list();
    const known = new Set(current.map((c) => c.id));
    const sameSet =
      ids.length === current.length &&
      new Set(ids).size === ids.length &&
      ids.every((i) => known.has(i));
    if (!sameSet)
      throw conflict(
        'CLASS_ORDER_STALE',
        'The class list changed while you were reordering. Reload and try again.',
      );
    const unchanged = current.every((c, i) => c.id === ids[i]);
    if (!unchanged) {
      await this.repo.setSequences(ids.map((id, i) => ({ id, sequence: i + 1 })));
      const code = new Map(current.map((c) => [c.id, c.code]));
      await this.record(actor, 'CLASSES_REORDERED', 'class', 'order', info, {
        before: { order: current.map((c) => c.code) },
        after: { order: ids.map((i) => code.get(i)) },
      });
    }
    return this.list();
  }
}

/* ------------------------------ divisions ------------------------------ */

export class DivisionService extends Audited {
  constructor(
    private readonly repo: DivisionRepo,
    private readonly classes: ClassRepo,
    private readonly years: Pick<AcademicYearRepo, 'findById'>,
    audit: AuditRecorder,
    clock: Clock,
    private readonly usage: DivisionUsage = NO_DIVISION_USAGE,
  ) {
    super(audit, clock);
  }

  async list(filter: DivisionFilter = {}): Promise<DivisionRecord[]> {
    return this.repo.list(filter);
  }

  private async get(id: string): Promise<DivisionRecord> {
    const d = await this.repo.findById(id);
    if (!d) throw notFound('Division not found.', 'DIVISION_NOT_FOUND');
    return d;
  }

  /** divisions of a closed year are history: they cannot be added to or changed */
  private async editableYear(yearId: string) {
    const y = await this.years.findById(yearId);
    if (!y) throw notFound('Academic year not found.', 'YEAR_NOT_FOUND');
    if (y.status === 'CLOSED')
      throw conflict('YEAR_CLOSED', `${y.label} is closed. Reopen it to change its divisions.`);
    return y;
  }

  async create(
    actor: Principal,
    input: {
      academicYearId: string;
      classId: string;
      name: string;
      capacity?: number | undefined;
    },
    info: ClientInfo = {},
  ): Promise<DivisionRecord> {
    const year = await this.editableYear(input.academicYearId);
    const cls = await this.classes.findById(input.classId);
    if (!cls) throw notFound('Class not found.', 'CLASS_NOT_FOUND');
    if (!cls.isActive)
      throw conflict(
        'CLASS_INACTIVE',
        `${cls.name} is inactive. Activate it before adding divisions.`,
      );
    try {
      const d = await this.repo.create({
        academicYearId: input.academicYearId,
        classId: input.classId,
        name: input.name.trim().replace(/\s+/g, ' '),
        capacity: input.capacity,
        isActive: true,
      });
      await this.record(actor, 'DIVISION_CREATED', 'division', d.id, info, {
        after: { year: year.label, class: cls.code, name: d.name, capacity: d.capacity ?? null },
      });
      return d;
    } catch (e) {
      if (e instanceof DuplicateDivisionError)
        throw conflict(
          'DIVISION_EXISTS',
          `${cls.name} ${input.name.trim()} already exists in ${year.label}.`,
        );
      throw e;
    }
  }

  async update(
    actor: Principal,
    id: string,
    patch: {
      name?: string | undefined;
      capacity?: number | null | undefined;
      isActive?: boolean | undefined;
    },
    info: ClientInfo = {},
  ): Promise<DivisionRecord> {
    const before = await this.get(id);
    await this.editableYear(before.academicYearId);
    const enrolled = await this.usage.enrolled(id);
    if (patch.isActive === false && before.isActive && enrolled > 0)
      throw conflict(
        'DIVISION_HAS_STUDENTS',
        `${enrolled} student${enrolled === 1 ? ' is' : 's are'} in this division. Move them first.`,
      );
    if (typeof patch.capacity === 'number' && patch.capacity < enrolled)
      throw unprocessable(
        'CAPACITY_BELOW_ENROLLED',
        `${enrolled} students are already in this division, so the capacity cannot be ${patch.capacity}.`,
      );
    try {
      const saved = (await this.repo.update(id, {
        ...(patch.name !== undefined ? { name: patch.name.trim().replace(/\s+/g, ' ') } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        ...(patch.capacity !== undefined ? { capacity: patch.capacity ?? undefined } : {}),
      }))!;
      await this.record(actor, 'DIVISION_UPDATED', 'division', id, info, {
        before: { name: before.name, capacity: before.capacity ?? null, isActive: before.isActive },
        after: { name: saved.name, capacity: saved.capacity ?? null, isActive: saved.isActive },
      });
      return saved;
    } catch (e) {
      if (e instanceof DuplicateDivisionError)
        throw conflict('DIVISION_EXISTS', `A division named ${patch.name?.trim()} already exists.`);
      throw e;
    }
  }

  /**
   * Copy the active divisions of one year into another (the usual "set up next year" step).
   * Existing divisions are left alone, so it is safe to run twice. No students are copied.
   */
  async cloneStructure(
    actor: Principal,
    fromYearId: string,
    toYearId: string,
    info: ClientInfo = {},
  ): Promise<{ created: number; skipped: number }> {
    if (fromYearId === toYearId)
      throw unprocessable('CLONE_SAME_YEAR', 'Choose two different academic years.');
    const from = await this.years.findById(fromYearId);
    if (!from) throw notFound('Academic year not found.', 'YEAR_NOT_FOUND');
    const to = await this.editableYear(toYearId);
    const activeClasses = new Set(
      (await this.classes.list()).filter((c) => c.isActive).map((c) => c.id),
    );
    const source = (await this.repo.list({ academicYearId: fromYearId })).filter(
      (d) => d.isActive && activeClasses.has(d.classId),
    );
    let created = 0;
    let skipped = 0;
    for (const d of source) {
      try {
        await this.repo.create({
          academicYearId: toYearId,
          classId: d.classId,
          name: d.name,
          capacity: d.capacity,
          isActive: true,
        });
        created++;
      } catch (e) {
        if (!(e instanceof DuplicateDivisionError)) throw e;
        skipped++;
      }
    }
    await this.record(actor, 'DIVISIONS_CLONED', 'division', toYearId, info, {
      after: { from: from.label, to: to.label, created, skipped },
    });
    return { created, skipped };
  }
}

/** lets the academic-year service refuse to roll a year back to "planned" once it has divisions */
export class DivisionYearGuards implements YearGuards {
  constructor(private readonly divisions: Pick<DivisionRepo, 'countByYear'>) {}
  async closeBlockers(): Promise<string[]> {
    return [];
  }
  async hasData(yearId: string): Promise<boolean> {
    return (await this.divisions.countByYear(yearId)) > 0;
  }
}
