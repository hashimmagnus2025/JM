/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { type Connection } from 'mongoose';
import '../../db/models';
import {
  ConcurrentChangeError,
  DuplicateCodeError,
  DuplicateLabelError,
  type AcademicYearRecord,
  type AcademicYearRepo,
  type CategoryRecord,
  type CategoryRepo,
  type InstitutionPatch,
  type InstitutionRecord,
  type InstitutionRepo,
  type SettingRepo,
  type StoredSetting,
} from './ports';

const HEX24 = /^[a-f0-9]{24}$/i;
const oid = (s: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(s);
const str = (v: unknown): string => String(v);
const dup = (e: unknown): boolean => (e as { code?: number })?.code === 11000;
const t = mongoose.trusted;

const toInstitution = (d: any): InstitutionRecord => ({
  id: str(d._id),
  name: d.name,
  shortName: d.shortName ?? undefined,
  code: d.code,
  logoFileId: d.logoFileId ? str(d.logoFileId) : undefined,
  address: { ...(d.address ?? {}) },
  contact: { ...(d.contact ?? {}) },
  registrationNo: d.registrationNo ?? undefined,
  timezone: d.timezone,
  currency: d.currency,
  academicStartMonth: d.academicStartMonth ?? 4,
  receiptFooter: d.receiptFooter ?? undefined,
  extra: d.extra instanceof Map ? Object.fromEntries(d.extra) : { ...(d.extra ?? {}) },
  updatedAt: d.updatedAt ?? undefined,
});

export class MongoInstitutionRepo implements InstitutionRepo {
  private readonly M: any;
  constructor(
    conn: Connection,
    private readonly institutionId: string,
  ) {
    this.M = conn.model('Institution');
  }
  async get() {
    const d = await this.M.findOne({ _id: oid(this.institutionId) }).lean();
    return d ? toInstitution(d) : null;
  }
  async update(patch: InstitutionPatch) {
    const d = await this.M.findOneAndUpdate(
      { _id: oid(this.institutionId) },
      { $set: patch },
      { new: true },
    ).lean();
    return d ? toInstitution(d) : null;
  }
}

export class MongoSettingRepo implements SettingRepo {
  private readonly M: any;
  private readonly inst: mongoose.Types.ObjectId;
  constructor(conn: Connection, institutionId: string) {
    this.M = conn.model('SystemSetting');
    this.inst = oid(institutionId);
  }
  async all(): Promise<StoredSetting[]> {
    return (await this.M.find({ institutionId: this.inst }).lean()).map((d: any) => ({
      key: d.key,
      value: d.value,
      updatedAt: d.updatedAt,
      updatedBy: d.updatedBy ? str(d.updatedBy) : undefined,
    }));
  }
  async set(key: string, value: unknown, by: string | undefined, at: Date) {
    const $set: Record<string, unknown> = { value, updatedAt: at };
    if (by && HEX24.test(by)) $set.updatedBy = oid(by);
    await this.M.updateOne(
      { institutionId: this.inst, key },
      { $set, $setOnInsert: { schemaVersion: 1, createdAt: at } },
      { upsert: true, timestamps: false },
    );
  }
  async remove(key: string) {
    await this.M.deleteOne({ institutionId: this.inst, key });
  }
}

const toYear = (d: any): AcademicYearRecord => ({
  id: str(d._id),
  label: d.label,
  startDate: d.startDate,
  endDate: d.endDate,
  status: d.status,
  isCurrent: !!d.isCurrent,
  closedAt: d.closedAt ?? undefined,
  closedBy: d.closedBy ? str(d.closedBy) : undefined,
  createdAt: d.createdAt ?? new Date(0),
});

export class MongoYearRepo implements AcademicYearRepo {
  private readonly M: any;
  private readonly inst: mongoose.Types.ObjectId;
  constructor(conn: Connection, institutionId: string) {
    this.M = conn.model('AcademicYear');
    this.inst = oid(institutionId);
  }
  private scope = (extra: Record<string, unknown> = {}) => ({ institutionId: this.inst, ...extra });

  async list() {
    return (await this.M.find(this.scope()).sort({ startDate: -1 }).lean()).map(toYear);
  }
  async findById(id: string) {
    if (!HEX24.test(id)) return null;
    const d = await this.M.findOne(this.scope({ _id: oid(id) })).lean();
    return d ? toYear(d) : null;
  }
  async create(y: { label: string; startDate: string; endDate: string }) {
    try {
      const d = await this.M.create({
        ...y,
        institutionId: this.inst,
        status: 'PLANNED',
        isCurrent: false,
      });
      return toYear(d.toObject());
    } catch (e) {
      if (dup(e)) throw new DuplicateLabelError();
      throw e;
    }
  }
  async update(id: string, patch: Parameters<AcademicYearRepo['update']>[1]) {
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ''> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) $unset[k] = '';
      else $set[k] = k === 'closedBy' && typeof v === 'string' ? oid(v) : v;
    }
    try {
      const d = await this.M.findOneAndUpdate(
        this.scope({ _id: oid(id) }),
        {
          ...(Object.keys($set).length ? { $set } : {}),
          ...(Object.keys($unset).length ? { $unset } : {}),
        },
        { new: true },
      ).lean();
      return d ? toYear(d) : null;
    } catch (e) {
      if (dup(e)) throw new DuplicateLabelError();
      throw e;
    }
  }
  /** old current year is unset FIRST (the unique "one current year" index forbids two), restored if the new one fails */
  async setCurrent(unsetIds: readonly string[], setId: string) {
    if (!HEX24.test(setId)) return null;
    const unset = unsetIds.filter((i) => HEX24.test(i)).map(oid);
    if (unset.length > 0)
      await this.M.updateMany(this.scope({ _id: t({ $in: unset }) }), {
        $set: { isCurrent: false },
      });
    try {
      const d = await this.M.findOneAndUpdate(
        this.scope({ _id: oid(setId) }),
        { $set: { isCurrent: true, status: 'ACTIVE' } },
        { new: true },
      ).lean();
      if (!d) throw new Error('year vanished');
      return toYear(d);
    } catch (e) {
      // the unique index says someone else became current meanwhile: do NOT restore (that would fight them)
      if (dup(e)) throw new ConcurrentChangeError();
      if (unset.length > 0)
        await this.M.updateMany(this.scope({ _id: t({ $in: unset }) }), {
          $set: { isCurrent: true },
        });
      if ((e as Error).message === 'year vanished') return null;
      throw e;
    }
  }
}

const toCategory = (d: any): CategoryRecord => ({
  id: str(d._id),
  code: d.code,
  name: d.name,
  isActive: d.isActive !== false,
  sequence: d.sequence ?? 0,
});

export class MongoCategoryRepo implements CategoryRepo {
  private readonly M: any;
  private readonly inst: mongoose.Types.ObjectId;
  constructor(conn: Connection, institutionId: string) {
    this.M = conn.model('StudentCategory');
    this.inst = oid(institutionId);
  }
  async list() {
    return (await this.M.find({ institutionId: this.inst }).lean()).map(toCategory);
  }
  async findById(id: string) {
    if (!HEX24.test(id)) return null;
    const d = await this.M.findOne({ institutionId: this.inst, _id: oid(id) }).lean();
    return d ? toCategory(d) : null;
  }
  async create(c: Omit<CategoryRecord, 'id'>) {
    try {
      const d = await this.M.create({ ...c, institutionId: this.inst });
      return toCategory(d.toObject());
    } catch (e) {
      if (dup(e)) throw new DuplicateCodeError();
      throw e;
    }
  }
  async update(id: string, patch: Parameters<CategoryRepo['update']>[1]) {
    const d = await this.M.findOneAndUpdate(
      { institutionId: this.inst, _id: oid(id) },
      { $set: patch },
      { new: true },
    ).lean();
    return d ? toCategory(d) : null;
  }
}
