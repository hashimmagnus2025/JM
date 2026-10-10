/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { type Connection } from 'mongoose';
import '../../db/models';
import type { TeacherAssignment } from '../../domain/academic/teacher-assignment';
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
} from './ports';

const HEX24 = /^[a-f0-9]{24}$/i;
const oid = (s: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(s);
const dup = (e: unknown): boolean => (e as { code?: number })?.code === 11000;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const searchKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

const toTeacher = (d: any): TeacherRecord => ({
  id: String(d._id),
  teacherCode: d.teacherCode,
  staffId: d.staffId,
  fullName: d.fullName,
  mobile: d.mobile,
  email: d.email ?? undefined,
  gender: d.gender ?? undefined,
  qualification: d.qualification ?? undefined,
  joiningDate: d.joiningDate,
  status: d.status,
  leavingDate: d.leavingDate ?? undefined,
  remarks: d.remarks ?? undefined,
});

export class MongoTeacherRepo implements TeacherRepo {
  private readonly M: any;
  private readonly Counter: any;
  private readonly inst: mongoose.Types.ObjectId;
  constructor(conn: Connection, institutionId: string) {
    this.M = conn.model('Teacher');
    this.Counter = conn.model('Counter');
    this.inst = oid(institutionId);
  }
  private scope = (extra: Record<string, unknown> = {}) => ({ institutionId: this.inst, ...extra });

  async list(f: TeacherFilter = {}): Promise<TeacherRecord[]> {
    const q = f.q?.trim();
    const filter: Record<string, unknown> = this.scope(f.status ? { status: f.status } : {});
    if (q) {
      const re = new RegExp(escapeRe(q), 'i');
      filter.$or = [{ nameSearch: re }, { staffId: re }, { teacherCode: re }, { mobile: re }];
    }
    return (await this.M.find(filter).sort({ nameSearch: 1 }).lean()).map(toTeacher);
  }
  async findById(id: string) {
    if (!HEX24.test(id)) return null;
    const d = await this.M.findOne(this.scope({ _id: oid(id) })).lean();
    return d ? toTeacher(d) : null;
  }
  /** atomic `$inc`: concurrent requests never get the same number */
  async nextCode() {
    const row = await this.Counter.findOneAndUpdate(
      { _id: `${this.inst.toHexString()}:teacher` },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    ).lean();
    return `TCH-${String(row.seq).padStart(6, '0')}`;
  }
  async create(t: TeacherDraft & { teacherCode: string }) {
    try {
      const d = await this.M.create({
        ...t,
        nameSearch: searchKey(t.fullName),
        status: 'ACTIVE',
        institutionId: this.inst,
      });
      return toTeacher(d.toObject());
    } catch (e) {
      if (dup(e)) throw new DuplicateStaffIdError();
      throw e;
    }
  }
  async update(id: string, patch: TeacherPatch) {
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ''> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) $unset[k] = '';
      else $set[k] = v;
    }
    if (typeof patch.fullName === 'string') $set.nameSearch = searchKey(patch.fullName);
    try {
      const d = await this.M.findOneAndUpdate(
        this.scope({ _id: oid(id) }),
        {
          ...(Object.keys($set).length ? { $set } : {}),
          ...(Object.keys($unset).length ? { $unset } : {}),
        },
        { new: true },
      ).lean();
      return d ? toTeacher(d) : null;
    } catch (e) {
      if (dup(e)) throw new DuplicateStaffIdError();
      throw e;
    }
  }
}

const toAssignment = (d: any): TeacherAssignment => ({
  id: String(d._id),
  academicYearId: String(d.academicYearId),
  classId: String(d.classId),
  divisionId: String(d.divisionId),
  teacherId: String(d.teacherId),
  role: d.role,
  effectiveFrom: d.effectiveFrom,
  effectiveTo: d.effectiveTo ?? null,
  isCurrent: !!d.isCurrent,
  ...(d.endReason ? { endReason: d.endReason } : {}),
  ...(d.replacesAssignmentId ? { replacesAssignmentId: String(d.replacesAssignmentId) } : {}),
  ...(d.reason ? { reason: d.reason } : {}),
});

export class MongoAssignmentRepo implements AssignmentRepo {
  private readonly M: any;
  private readonly inst: mongoose.Types.ObjectId;
  constructor(
    private readonly conn: Connection,
    institutionId: string,
  ) {
    this.M = conn.model('TeacherAssignment');
    this.inst = oid(institutionId);
  }
  private scope = (extra: Record<string, unknown> = {}) => ({ institutionId: this.inst, ...extra });

  async list(f: Parameters<AssignmentRepo['list']>[0]): Promise<TeacherAssignment[]> {
    const q: Record<string, unknown> = this.scope();
    for (const [key, value] of [
      ['academicYearId', f.academicYearId],
      ['teacherId', f.teacherId],
      ['divisionId', f.divisionId],
    ] as const) {
      if (value) {
        if (!HEX24.test(value)) return [];
        q[key] = oid(value);
      }
    }
    if (f.currentOnly) q.isCurrent = true;
    return (await this.M.find(q).sort({ effectiveFrom: 1 }).lean()).map(toAssignment);
  }
  async findById(id: string) {
    if (!HEX24.test(id)) return null;
    const d = await this.M.findOne(this.scope({ _id: oid(id) })).lean();
    return d ? toAssignment(d) : null;
  }

  private doc(a: TeacherAssignment, by?: string) {
    return {
      _id: oid(a.id),
      institutionId: this.inst,
      academicYearId: oid(a.academicYearId),
      classId: oid(a.classId),
      divisionId: oid(a.divisionId),
      teacherId: oid(a.teacherId),
      role: a.role,
      effectiveFrom: a.effectiveFrom,
      isCurrent: true,
      ...(a.replacesAssignmentId ? { replacesAssignmentId: oid(a.replacesAssignmentId) } : {}),
      ...(a.reason ? { reason: a.reason } : {}),
      ...(by && HEX24.test(by) ? { assignedBy: oid(by) } : {}),
    };
  }

  async create(a: TeacherAssignment, by?: string) {
    try {
      const d = await this.M.create(this.doc(a, by));
      return toAssignment(d.toObject());
    } catch (e) {
      if (dup(e)) throw new DivisionAlreadyAssignedError();
      throw e;
    }
  }

  private closeUpdate(c: AssignmentClose) {
    return {
      filter: this.scope({ _id: oid(c.id), isCurrent: true }),
      update: { $set: { effectiveTo: c.effectiveTo, isCurrent: false, endReason: c.endReason } },
    };
  }

  /** one transaction: the old row closes and the new one opens, or nothing changes */
  async change(c: AssignmentClose, create: TeacherAssignment, by?: string) {
    const session = await this.conn.startSession();
    try {
      await session.withTransaction(async () => {
        const { filter, update } = this.closeUpdate(c);
        const res = await this.M.updateOne(filter, update, { session });
        if (res.modifiedCount !== 1) throw new DivisionAlreadyAssignedError();
        await this.M.create([this.doc(create, by)], { session });
      });
    } catch (e) {
      if (dup(e)) throw new DivisionAlreadyAssignedError();
      throw e;
    } finally {
      await session.endSession();
    }
  }

  async end(c: AssignmentClose) {
    const { filter, update } = this.closeUpdate(c);
    const res = await this.M.updateOne(filter, update);
    if (res.modifiedCount !== 1) throw new DivisionAlreadyAssignedError();
  }
}
