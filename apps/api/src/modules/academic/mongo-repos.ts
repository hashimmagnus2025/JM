/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { type Connection } from 'mongoose';
import '../../db/models';
import { DuplicateCodeError } from '../setup/ports';
import {
  DuplicateDivisionError,
  divisionKey,
  type ClassRecord,
  type ClassRepo,
  type DivisionFilter,
  type DivisionRecord,
  type DivisionRepo,
} from './ports';

const HEX24 = /^[a-f0-9]{24}$/i;
const oid = (s: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(s);
const dup = (e: unknown): boolean => (e as { code?: number })?.code === 11000;

const toClass = (d: any): ClassRecord => ({
  id: String(d._id),
  code: d.code,
  name: d.name,
  sequence: d.sequence ?? 0,
  isActive: d.isActive !== false,
  isFinal: !!d.isFinal,
});

export class MongoClassRepo implements ClassRepo {
  private readonly M: any;
  private readonly inst: mongoose.Types.ObjectId;
  constructor(conn: Connection, institutionId: string) {
    this.M = conn.model('Class');
    this.inst = oid(institutionId);
  }
  async list(): Promise<ClassRecord[]> {
    return (await this.M.find({ institutionId: this.inst }).lean()).map(toClass);
  }
  async findById(id: string) {
    if (!HEX24.test(id)) return null;
    const d = await this.M.findOne({ institutionId: this.inst, _id: oid(id) }).lean();
    return d ? toClass(d) : null;
  }
  async create(c: Omit<ClassRecord, 'id'>) {
    try {
      const d = await this.M.create({ ...c, institutionId: this.inst });
      return toClass(d.toObject());
    } catch (e) {
      if (dup(e)) throw new DuplicateCodeError();
      throw e;
    }
  }
  async update(id: string, patch: Parameters<ClassRepo['update']>[1]) {
    const d = await this.M.findOneAndUpdate(
      { institutionId: this.inst, _id: oid(id) },
      { $set: patch },
      { new: true },
    ).lean();
    return d ? toClass(d) : null;
  }
  async setSequences(order: readonly { id: string; sequence: number }[]) {
    if (order.length === 0) return;
    await this.M.bulkWrite(
      order
        .filter((o) => HEX24.test(o.id))
        .map((o) => ({
          updateOne: {
            filter: { institutionId: this.inst, _id: oid(o.id) },
            update: { $set: { sequence: o.sequence } },
          },
        })),
    );
  }
}

const toDivision = (d: any): DivisionRecord => ({
  id: String(d._id),
  academicYearId: String(d.academicYearId),
  classId: String(d.classId),
  name: d.name,
  capacity: d.capacity ?? undefined,
  isActive: d.isActive !== false,
});

export class MongoDivisionRepo implements DivisionRepo {
  private readonly M: any;
  private readonly inst: mongoose.Types.ObjectId;
  constructor(conn: Connection, institutionId: string) {
    this.M = conn.model('Division');
    this.inst = oid(institutionId);
  }
  private scope = (extra: Record<string, unknown> = {}) => ({ institutionId: this.inst, ...extra });

  async list(f: DivisionFilter = {}): Promise<DivisionRecord[]> {
    const q = this.scope({
      ...(f.academicYearId && HEX24.test(f.academicYearId)
        ? { academicYearId: oid(f.academicYearId) }
        : {}),
      ...(f.classId && HEX24.test(f.classId) ? { classId: oid(f.classId) } : {}),
    });
    return (await this.M.find(q).sort({ nameKey: 1 }).lean()).map(toDivision);
  }
  async findById(id: string) {
    if (!HEX24.test(id)) return null;
    const d = await this.M.findOne(this.scope({ _id: oid(id) })).lean();
    return d ? toDivision(d) : null;
  }
  async create(d: Omit<DivisionRecord, 'id'>) {
    try {
      const row = await this.M.create({
        institutionId: this.inst,
        academicYearId: oid(d.academicYearId),
        classId: oid(d.classId),
        name: d.name,
        nameKey: divisionKey(d.name),
        ...(d.capacity !== undefined ? { capacity: d.capacity } : {}),
        isActive: d.isActive,
      });
      return toDivision(row.toObject());
    } catch (e) {
      if (dup(e)) throw new DuplicateDivisionError();
      throw e;
    }
  }
  async update(id: string, patch: Parameters<DivisionRepo['update']>[1]) {
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ''> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) $unset[k] = '';
      else $set[k] = v;
    }
    if (typeof patch.name === 'string') $set.nameKey = divisionKey(patch.name);
    try {
      const d = await this.M.findOneAndUpdate(
        this.scope({ _id: oid(id) }),
        {
          ...(Object.keys($set).length ? { $set } : {}),
          ...(Object.keys($unset).length ? { $unset } : {}),
        },
        { new: true },
      ).lean();
      return d ? toDivision(d) : null;
    } catch (e) {
      if (dup(e)) throw new DuplicateDivisionError();
      throw e;
    }
  }
  async countByYear(yearId: string) {
    if (!HEX24.test(yearId)) return 0;
    return this.M.countDocuments(this.scope({ academicYearId: oid(yearId) }));
  }
  async countActiveByClass(classId: string) {
    if (!HEX24.test(classId)) return 0;
    return this.M.countDocuments(this.scope({ classId: oid(classId), isActive: true }));
  }
}
