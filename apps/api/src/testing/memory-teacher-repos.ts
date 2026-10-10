import { randomBytes } from 'node:crypto';
import type { TeacherAssignment } from '../domain/academic/teacher-assignment';
import {
  DivisionAlreadyAssignedError,
  DuplicateStaffIdError,
  type AssignmentClose,
  type AssignmentRepo,
  type TeacherDraft,
  type TeacherFilter,
  type TeacherPatch,
  type TeacherRecord,
  type TeacherRepo,
} from '../modules/teachers/ports';

const id = (): string => randomBytes(12).toString('hex');
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
const clone = <T>(x: T): T => structuredClone(x);

export const matchesTeacher = (t: TeacherRecord, f: TeacherFilter): boolean => {
  if (f.status && t.status !== f.status) return false;
  const q = f.q?.trim().toLowerCase();
  if (!q) return true;
  return [t.fullName, t.staffId, t.teacherCode, t.mobile].some((v) => v.toLowerCase().includes(q));
};

export class MemoryTeacherRepo implements TeacherRepo {
  rows = new Map<string, TeacherRecord>();
  private seq = 0;
  async list(f: TeacherFilter = {}) {
    await tick();
    return clone([...this.rows.values()].filter((t) => matchesTeacher(t, f)));
  }
  async findById(i: string) {
    await tick();
    const t = this.rows.get(i);
    return t ? clone(t) : null;
  }
  async nextCode() {
    await tick();
    return `TCH-${String(++this.seq).padStart(6, '0')}`;
  }
  private staffClash(staffId: string, ignore?: string) {
    return [...this.rows.values()].some((t) => t.id !== ignore && t.staffId === staffId);
  }
  async create(t: TeacherDraft & { teacherCode: string }) {
    await tick();
    if (this.staffClash(t.staffId)) throw new DuplicateStaffIdError();
    const rec: TeacherRecord = { ...t, id: id(), status: 'ACTIVE' };
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async update(i: string, patch: TeacherPatch) {
    await tick();
    const t = this.rows.get(i);
    if (!t) return null;
    if (patch.staffId !== undefined && this.staffClash(patch.staffId, i))
      throw new DuplicateStaffIdError();
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (t as unknown as Record<string, unknown>)[k];
      else (t as unknown as Record<string, unknown>)[k] = v;
    }
    return clone(t);
  }
}

export class MemoryAssignmentRepo implements AssignmentRepo {
  rows = new Map<string, TeacherAssignment>();
  async list(f: Parameters<AssignmentRepo['list']>[0]) {
    await tick();
    return clone(
      [...this.rows.values()].filter(
        (a) =>
          (!f.academicYearId || a.academicYearId === f.academicYearId) &&
          (!f.teacherId || a.teacherId === f.teacherId) &&
          (!f.divisionId || a.divisionId === f.divisionId) &&
          (!f.currentOnly || a.isCurrent),
      ),
    );
  }
  async findById(i: string) {
    await tick();
    const a = this.rows.get(i);
    return a ? clone(a) : null;
  }
  private currentOn(divisionId: string) {
    return [...this.rows.values()].some((a) => a.divisionId === divisionId && a.isCurrent);
  }
  async create(a: TeacherAssignment) {
    await tick();
    if (this.currentOn(a.divisionId)) throw new DivisionAlreadyAssignedError();
    this.rows.set(a.id, clone(a));
    return clone(a);
  }
  private close(c: AssignmentClose) {
    const row = this.rows.get(c.id);
    if (!row || !row.isCurrent) return false;
    Object.assign(row, { effectiveTo: c.effectiveTo, isCurrent: false, endReason: c.endReason });
    return true;
  }
  async change(c: AssignmentClose, create: TeacherAssignment) {
    await tick();
    if (!this.close(c)) throw new DivisionAlreadyAssignedError();
    this.rows.set(create.id, clone(create));
  }
  async end(c: AssignmentClose) {
    await tick();
    if (!this.close(c)) throw new DivisionAlreadyAssignedError();
  }
}
