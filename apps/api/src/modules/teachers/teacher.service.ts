import { randomBytes } from 'node:crypto';
import type { Clock } from '@sfm/shared';
import {
  planAssign,
  planChange,
  planEnd,
  type AcademicYearRange,
  type TeacherAssignment,
} from '../../domain/academic/teacher-assignment';
import { conflict, notFound } from '../../lib/errors';
import type { DivisionRepo } from '../academic/ports';
import type { AuditRecorder } from '../audit/audit.service';
import type { ClientInfo } from '../auth/auth.service';
import type { Principal } from '../auth/ports';
import type { AcademicYearRecord, AcademicYearRepo } from '../setup/ports';
import { Audited, type SettingsProvider } from '../setup/setup.service';
import {
  DivisionAlreadyAssignedError,
  DuplicateStaffIdError,
  type AssignmentRepo,
  type TeacherDraft,
  type TeacherFilter,
  type TeacherPatch,
  type TeacherRecord,
  type TeacherRepo,
} from './ports';

const newId = (): string => randomBytes(12).toString('hex');
const clean = (s: string): string => s.trim().replace(/\s+/g, ' ');

const pick = (t: TeacherRecord) => ({
  staffId: t.staffId,
  fullName: t.fullName,
  mobile: t.mobile,
  email: t.email ?? null,
  gender: t.gender ?? null,
  qualification: t.qualification ?? null,
  joiningDate: t.joiningDate,
  status: t.status,
  leavingDate: t.leavingDate ?? null,
  remarks: t.remarks ?? null,
});

/* ------------------------------ teachers ------------------------------ */

export class TeacherService extends Audited {
  constructor(
    private readonly repo: TeacherRepo,
    private readonly assignments: AssignmentRepo,
    private readonly divisions: Pick<DivisionRepo, 'findById'>,
    private readonly years: Pick<AcademicYearRepo, 'list'>,
    audit: AuditRecorder,
    clock: Clock,
  ) {
    super(audit, clock);
  }

  async list(filter: TeacherFilter = {}): Promise<TeacherRecord[]> {
    return (await this.repo.list(filter)).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async get(id: string): Promise<TeacherRecord> {
    const t = await this.repo.findById(id);
    if (!t) throw notFound('Teacher not found.', 'TEACHER_NOT_FOUND');
    return t;
  }

  async create(
    actor: Principal,
    input: TeacherDraft,
    info: ClientInfo = {},
  ): Promise<TeacherRecord> {
    // cheap pre-check so a typo does not burn a teacher number (the unique index still decides races)
    const taken = (await this.repo.list({ q: input.staffId.trim() })).some(
      (t) => t.staffId === input.staffId.trim(),
    );
    if (taken)
      throw conflict('STAFF_ID_IN_USE', `Staff ID ${input.staffId.trim()} is already used.`);
    try {
      const t = await this.repo.create({
        ...input,
        fullName: clean(input.fullName),
        staffId: input.staffId.trim(),
        teacherCode: await this.repo.nextCode(),
      });
      await this.record(actor, 'TEACHER_CREATED', 'teacher', t.id, info, {
        after: { teacherCode: t.teacherCode, ...pick(t) },
      });
      return t;
    } catch (e) {
      if (e instanceof DuplicateStaffIdError)
        throw conflict('STAFF_ID_IN_USE', `Staff ID ${input.staffId.trim()} is already used.`);
      throw e;
    }
  }

  /** profile edits only; status changes go through `setStatus` so they get their own checks and audit entry */
  async update(
    actor: Principal,
    id: string,
    patch: Omit<TeacherPatch, 'status' | 'leavingDate'>,
    info: ClientInfo = {},
  ): Promise<TeacherRecord> {
    const before = await this.get(id);
    try {
      const saved = (await this.repo.update(id, {
        ...patch,
        ...(patch.fullName !== undefined ? { fullName: clean(patch.fullName) } : {}),
        ...(patch.staffId !== undefined ? { staffId: patch.staffId.trim() } : {}),
      }))!;
      await this.record(actor, 'TEACHER_UPDATED', 'teacher', id, info, {
        before: pick(before),
        after: pick(saved),
      });
      return saved;
    } catch (e) {
      if (e instanceof DuplicateStaffIdError)
        throw conflict('STAFF_ID_IN_USE', `Staff ID ${patch.staffId?.trim()} is already used.`);
      throw e;
    }
  }

  /**
   * ACTIVE ↔ INACTIVE ↔ LEFT. A teacher who is still the class teacher of a division in a year that
   * is not closed cannot be switched off: the division would silently lose its class teacher.
   */
  async setStatus(
    actor: Principal,
    id: string,
    status: TeacherRecord['status'],
    leavingDate: string | undefined,
    info: ClientInfo = {},
  ): Promise<TeacherRecord> {
    const before = await this.get(id);
    if (before.status === status)
      throw conflict(
        'TEACHER_STATUS_UNCHANGED',
        `This teacher is already ${status.toLowerCase()}.`,
      );
    if (status !== 'ACTIVE') {
      const held = await this.openAssignments(id);
      if (held.length > 0) {
        const where = held.map((h) => `${h.label} (${h.year})`).join(', ');
        throw conflict(
          'TEACHER_HAS_ASSIGNMENTS',
          `${before.fullName} is class teacher of ${where}. Change or end that assignment first.`,
          held,
        );
      }
    }
    const saved = (await this.repo.update(id, {
      status,
      leavingDate: status === 'LEFT' ? leavingDate : undefined,
    }))!;
    await this.record(actor, `TEACHER_${status}`, 'teacher', id, info, {
      before: { status: before.status, leavingDate: before.leavingDate ?? null },
      after: { status: saved.status, leavingDate: saved.leavingDate ?? null },
    });
    return saved;
  }

  private async openAssignments(teacherId: string) {
    const current = await this.assignments.list({ teacherId, currentOnly: true });
    const years = new Map((await this.years.list()).map((y) => [y.id, y]));
    const out: { divisionId: string; label: string; year: string }[] = [];
    for (const a of current) {
      const y = years.get(a.academicYearId);
      if (!y || y.status === 'CLOSED') continue;
      const d = await this.divisions.findById(a.divisionId);
      out.push({
        divisionId: a.divisionId,
        label: d ? `division ${d.name}` : 'a division',
        year: y.label,
      });
    }
    return out;
  }
}

/* ------------------------------ class-teacher assignments ------------------------------ */

const toRange = (y: AcademicYearRecord): AcademicYearRange => ({
  id: y.id,
  startDate: y.startDate,
  endDate: y.endDate,
});

export class AssignmentService extends Audited {
  constructor(
    private readonly repo: AssignmentRepo,
    private readonly teachers: Pick<TeacherRepo, 'findById'>,
    private readonly divisions: Pick<DivisionRepo, 'findById'>,
    private readonly years: Pick<AcademicYearRepo, 'findById'>,
    private readonly settings: SettingsProvider,
    audit: AuditRecorder,
    clock: Clock,
  ) {
    super(audit, clock);
  }

  list(filter: {
    academicYearId?: string | undefined;
    teacherId?: string | undefined;
    divisionId?: string | undefined;
    currentOnly?: boolean | undefined;
  }): Promise<TeacherAssignment[]> {
    return this.repo.list(filter);
  }

  /** every row of one division, newest first — the audit-friendly timeline */
  async divisionHistory(divisionId: string): Promise<TeacherAssignment[]> {
    if (!(await this.divisions.findById(divisionId)))
      throw notFound('Division not found.', 'DIVISION_NOT_FOUND');
    return (await this.repo.list({ divisionId })).sort((a, b) =>
      a.effectiveFrom < b.effectiveFrom ? 1 : -1,
    );
  }

  private async openYear(yearId: string): Promise<AcademicYearRecord> {
    const y = await this.years.findById(yearId);
    if (!y) throw notFound('Academic year not found.', 'YEAR_NOT_FOUND');
    if (y.status === 'CLOSED')
      throw conflict(
        'YEAR_CLOSED',
        `${y.label} is closed. Its class teachers can no longer change.`,
      );
    return y;
  }

  private async currentRow(id: string): Promise<TeacherAssignment> {
    const a = await this.repo.findById(id);
    if (!a) throw notFound('Assignment not found.', 'ASSIGNMENT_NOT_FOUND');
    return a;
  }

  private async teacherRef(id: string) {
    const t = await this.teachers.findById(id);
    if (!t) throw notFound('Teacher not found.', 'TEACHER_NOT_FOUND');
    return t;
  }

  private async rules() {
    const s = await this.settings.get();
    return { allowMultipleDivisions: s['teacher.allowMultipleDivisions'] !== false };
  }

  async assign(
    actor: Principal,
    input: { divisionId: string; teacherId: string; effectiveFrom: string },
    info: ClientInfo = {},
  ): Promise<TeacherAssignment> {
    const division = await this.divisions.findById(input.divisionId);
    if (!division) throw notFound('Division not found.', 'DIVISION_NOT_FOUND');
    if (!division.isActive) throw conflict('DIVISION_INACTIVE', 'This division is switched off.');
    const year = await this.openYear(division.academicYearId);
    const teacher = await this.teacherRef(input.teacherId);
    const plan = planAssign({
      division,
      teacher,
      year: toRange(year),
      effectiveFrom: input.effectiveFrom,
      existing: await this.repo.list({ academicYearId: year.id, currentOnly: true }),
      settings: await this.rules(),
      newId: newId(),
    });
    try {
      const saved = await this.repo.create(plan.create, actor.userId);
      await this.record(actor, 'TEACHER_ASSIGNED', 'teacherAssignment', saved.id, info, {
        after: {
          year: year.label,
          division: division.name,
          teacher: teacher.fullName,
          effectiveFrom: saved.effectiveFrom,
        },
      });
      return saved;
    } catch (e) {
      if (e instanceof DivisionAlreadyAssignedError)
        throw conflict(
          'DIVISION_ALREADY_HAS_TEACHER',
          'Someone just assigned a class teacher to this division. Reload to see them.',
        );
      throw e;
    }
  }

  async change(
    actor: Principal,
    assignmentId: string,
    input: { newTeacherId: string; effectiveFrom: string; reason: string },
    info: ClientInfo = {},
  ): Promise<TeacherAssignment> {
    const current = await this.currentRow(assignmentId);
    const year = await this.openYear(current.academicYearId);
    const [oldTeacher, newTeacher] = await Promise.all([
      this.teacherRef(current.teacherId),
      this.teacherRef(input.newTeacherId),
    ]);
    const plan = planChange({
      current,
      newTeacher,
      year: toRange(year),
      effectiveFrom: input.effectiveFrom,
      reason: input.reason,
      existing: await this.repo.list({ academicYearId: year.id, currentOnly: true }),
      settings: await this.rules(),
      newId: newId(),
    });
    try {
      await this.repo.change(plan.close, plan.create, actor.userId);
    } catch (e) {
      if (e instanceof DivisionAlreadyAssignedError)
        throw conflict(
          'CONCURRENT_CHANGE',
          'Someone else just changed this class teacher. Reload and try again.',
        );
      throw e;
    }
    await this.record(actor, 'TEACHER_CHANGED', 'teacherAssignment', plan.create.id, info, {
      before: { teacher: oldTeacher.fullName, until: plan.close.effectiveTo },
      after: { teacher: newTeacher.fullName, from: plan.create.effectiveFrom },
      reason: plan.create.reason!,
    });
    return plan.create;
  }

  async end(
    actor: Principal,
    assignmentId: string,
    input: { effectiveTo: string; reason: string },
    info: ClientInfo = {},
  ): Promise<void> {
    const current = await this.currentRow(assignmentId);
    const year = await this.openYear(current.academicYearId);
    const teacher = await this.teacherRef(current.teacherId);
    const plan = planEnd({ current, year: toRange(year), ...input });
    try {
      await this.repo.end(plan.close);
    } catch (e) {
      if (e instanceof DivisionAlreadyAssignedError)
        throw conflict(
          'CONCURRENT_CHANGE',
          'Someone else just changed this class teacher. Reload and try again.',
        );
      throw e;
    }
    await this.record(actor, 'TEACHER_ASSIGNMENT_ENDED', 'teacherAssignment', current.id, info, {
      before: { teacher: teacher.fullName, effectiveTo: null },
      after: { effectiveTo: plan.close.effectiveTo },
      reason: input.reason.trim(),
    });
  }
}
