import { randomBytes } from 'node:crypto';
import {
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
} from '../modules/setup/ports';
import {
  DuplicateDivisionError,
  divisionKey,
  type ClassRecord,
  type ClassRepo,
  type DivisionFilter,
  type DivisionRecord,
  type DivisionRepo,
} from '../modules/academic/ports';

const id = (): string => randomBytes(12).toString('hex');
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
const clone = <T>(x: T): T => structuredClone(x);

export class MemoryInstitutionRepo implements InstitutionRepo {
  row: InstitutionRecord | null = {
    id: id(),
    name: 'Demo School',
    code: 'DEMO',
    address: {},
    contact: {},
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    academicStartMonth: 4,
    extra: {},
  };
  async get() {
    await tick();
    return this.row ? clone(this.row) : null;
  }
  async update(patch: InstitutionPatch) {
    await tick();
    if (!this.row) return null;
    Object.assign(this.row, patch, { updatedAt: new Date() });
    return clone(this.row);
  }
}

export class MemorySettingRepo implements SettingRepo {
  rows = new Map<string, StoredSetting>();
  async all() {
    await tick();
    return clone([...this.rows.values()]);
  }
  async set(key: string, value: unknown, by: string | undefined, at: Date) {
    await tick();
    this.rows.set(key, { key, value: clone(value), updatedAt: at, updatedBy: by });
  }
  async remove(key: string) {
    await tick();
    this.rows.delete(key);
  }
}

export class MemoryYearRepo implements AcademicYearRepo {
  rows = new Map<string, AcademicYearRecord>();
  async list() {
    await tick();
    return clone([...this.rows.values()]);
  }
  async findById(i: string) {
    await tick();
    const y = this.rows.get(i);
    return y ? clone(y) : null;
  }
  async create(y: { label: string; startDate: string; endDate: string }) {
    await tick();
    if ([...this.rows.values()].some((x) => x.label === y.label)) throw new DuplicateLabelError();
    const rec: AcademicYearRecord = {
      ...y,
      id: id(),
      status: 'PLANNED',
      isCurrent: false,
      createdAt: new Date(),
    };
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async update(i: string, patch: Parameters<AcademicYearRepo['update']>[1]) {
    await tick();
    const y = this.rows.get(i);
    if (!y) return null;
    if (patch.label && [...this.rows.values()].some((x) => x.id !== i && x.label === patch.label))
      throw new DuplicateLabelError();
    Object.assign(y, patch);
    return clone(y);
  }
  async setCurrent(unsetIds: readonly string[], setId: string) {
    await tick();
    const target = this.rows.get(setId);
    if (!target) return null;
    for (const u of unsetIds) {
      const y = this.rows.get(u);
      if (y) y.isCurrent = false;
    }
    target.isCurrent = true;
    target.status = 'ACTIVE';
    return clone(target);
  }
}

export class MemoryCategoryRepo implements CategoryRepo {
  rows = new Map<string, CategoryRecord>();
  async list() {
    await tick();
    return clone([...this.rows.values()]);
  }
  async findById(i: string) {
    await tick();
    const c = this.rows.get(i);
    return c ? clone(c) : null;
  }
  async create(c: Omit<CategoryRecord, 'id'>) {
    await tick();
    if ([...this.rows.values()].some((x) => x.code === c.code)) throw new DuplicateCodeError();
    const rec = { ...c, id: id() };
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async update(i: string, patch: Parameters<CategoryRepo['update']>[1]) {
    await tick();
    const c = this.rows.get(i);
    if (!c) return null;
    Object.assign(c, patch);
    return clone(c);
  }
}

export class MemoryClassRepo implements ClassRepo {
  rows = new Map<string, ClassRecord>();
  async list() {
    await tick();
    return clone([...this.rows.values()]);
  }
  async findById(i: string) {
    await tick();
    const c = this.rows.get(i);
    return c ? clone(c) : null;
  }
  async create(c: Omit<ClassRecord, 'id'>) {
    await tick();
    if ([...this.rows.values()].some((x) => x.code === c.code)) throw new DuplicateCodeError();
    const rec = { ...c, id: id() };
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async update(i: string, patch: Parameters<ClassRepo['update']>[1]) {
    await tick();
    const c = this.rows.get(i);
    if (!c) return null;
    Object.assign(c, patch);
    return clone(c);
  }
  async setSequences(order: readonly { id: string; sequence: number }[]) {
    await tick();
    for (const o of order) {
      const c = this.rows.get(o.id);
      if (c) c.sequence = o.sequence;
    }
  }
}

export class MemoryDivisionRepo implements DivisionRepo {
  rows = new Map<string, DivisionRecord>();
  async list(f: DivisionFilter = {}) {
    await tick();
    return clone(
      [...this.rows.values()].filter(
        (d) =>
          (!f.academicYearId || d.academicYearId === f.academicYearId) &&
          (!f.classId || d.classId === f.classId),
      ),
    );
  }
  async findById(i: string) {
    await tick();
    const d = this.rows.get(i);
    return d ? clone(d) : null;
  }
  private clash(d: Pick<DivisionRecord, 'academicYearId' | 'classId' | 'name'>, ignore?: string) {
    return [...this.rows.values()].some(
      (x) =>
        x.id !== ignore &&
        x.academicYearId === d.academicYearId &&
        x.classId === d.classId &&
        divisionKey(x.name) === divisionKey(d.name),
    );
  }
  async create(d: Omit<DivisionRecord, 'id'>) {
    await tick();
    if (this.clash(d)) throw new DuplicateDivisionError();
    const rec = { ...d, id: id() };
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async update(i: string, patch: Parameters<DivisionRepo['update']>[1]) {
    await tick();
    const d = this.rows.get(i);
    if (!d) return null;
    if (patch.name !== undefined && this.clash({ ...d, name: patch.name }, i))
      throw new DuplicateDivisionError();
    Object.assign(d, patch);
    return clone(d);
  }
  async countByYear(yearId: string) {
    await tick();
    return [...this.rows.values()].filter((d) => d.academicYearId === yearId).length;
  }
  async countActiveByClass(classId: string) {
    await tick();
    return [...this.rows.values()].filter((d) => d.classId === classId && d.isActive).length;
  }
}
