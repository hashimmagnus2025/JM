import type { BusinessDate } from '@sfm/shared';
import type { YearStatus } from '../../domain/academic/academic-year';

export interface Address {
  line1?: string | undefined;
  line2?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  pincode?: string | undefined;
  country?: string | undefined;
}

export interface Contact {
  phone?: string | undefined;
  altPhone?: string | undefined;
  email?: string | undefined;
  website?: string | undefined;
}

export interface InstitutionRecord {
  id: string;
  name: string;
  shortName?: string | undefined;
  code: string;
  logoFileId?: string | undefined;
  address: Address;
  contact: Contact;
  registrationNo?: string | undefined;
  timezone: string;
  currency: string;
  academicStartMonth: number;
  receiptFooter?: string | undefined;
  extra: Record<string, string>;
  updatedAt?: Date | undefined;
}

export type InstitutionPatch = Partial<
  Pick<
    InstitutionRecord,
    | 'name'
    | 'shortName'
    | 'address'
    | 'contact'
    | 'registrationNo'
    | 'academicStartMonth'
    | 'receiptFooter'
    | 'extra'
  >
>;

export interface InstitutionRepo {
  get(): Promise<InstitutionRecord | null>;
  update(patch: InstitutionPatch): Promise<InstitutionRecord | null>;
}

export interface StoredSetting {
  key: string;
  value: unknown;
  updatedAt: Date;
  updatedBy?: string | undefined;
}

export interface SettingRepo {
  all(): Promise<StoredSetting[]>;
  set(key: string, value: unknown, by: string | undefined, at: Date): Promise<void>;
  /** back to the default */
  remove(key: string): Promise<void>;
}

export interface AcademicYearRecord {
  id: string;
  label: string;
  startDate: BusinessDate;
  endDate: BusinessDate;
  status: YearStatus;
  isCurrent: boolean;
  closedAt?: Date | undefined;
  closedBy?: string | undefined;
  createdAt: Date;
}

export class DuplicateLabelError extends Error {
  constructor() {
    super('academic year label already exists');
    this.name = 'DuplicateLabelError';
  }
}

/** two people changed the same thing at the same moment; the loser is told to retry */
export class ConcurrentChangeError extends Error {
  constructor() {
    super('concurrent change');
    this.name = 'ConcurrentChangeError';
  }
}

export class DuplicateCodeError extends Error {
  constructor() {
    super('code already exists');
    this.name = 'DuplicateCodeError';
  }
}

export interface AcademicYearRepo {
  list(): Promise<AcademicYearRecord[]>;
  findById(id: string): Promise<AcademicYearRecord | null>;
  create(y: {
    label: string;
    startDate: BusinessDate;
    endDate: BusinessDate;
  }): Promise<AcademicYearRecord>;
  update(
    id: string,
    patch: Partial<
      Pick<
        AcademicYearRecord,
        'label' | 'startDate' | 'endDate' | 'status' | 'closedAt' | 'closedBy'
      >
    >,
  ): Promise<AcademicYearRecord | null>;
  /**
   * Make `setId` the one current year (and ACTIVE). The old current year is unset FIRST so the unique "one current
   * year" index is never violated; if setting fails the old one is restored.
   */
  setCurrent(unsetIds: readonly string[], setId: string): Promise<AcademicYearRecord | null>;
}

/** hooks for modules that do not exist yet (divisions, enrollments, finance): they plug in as the phases arrive */
export interface YearGuards {
  /** plain-language reasons why this year cannot be closed yet */
  closeBlockers(yearId: string): Promise<string[]>;
  /** the year already carries divisions, enrollments or fees */
  hasData(yearId: string): Promise<boolean>;
}

export const NO_YEAR_GUARDS: YearGuards = {
  closeBlockers: async () => [],
  hasData: async () => false,
};

export interface CategoryRecord {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sequence: number;
}

export interface CategoryRepo {
  list(): Promise<CategoryRecord[]>;
  findById(id: string): Promise<CategoryRecord | null>;
  create(c: Omit<CategoryRecord, 'id'>): Promise<CategoryRecord>;
  update(
    id: string,
    patch: Partial<Pick<CategoryRecord, 'name' | 'isActive' | 'sequence'>>,
  ): Promise<CategoryRecord | null>;
}
