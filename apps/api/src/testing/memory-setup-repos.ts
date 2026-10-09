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
