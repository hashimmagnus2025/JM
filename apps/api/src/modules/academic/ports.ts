export interface ClassRecord {
  id: string;
  code: string;
  name: string;
  /** display order (1, 2, 3 …) — a class never changes its code, only its place in the list */
  sequence: number;
  isActive: boolean;
  /** the last class of a stage: students leaving it graduate instead of being promoted */
  isFinal: boolean;
}

export interface DivisionRecord {
  id: string;
  academicYearId: string;
  classId: string;
  name: string;
  capacity?: number | undefined;
  isActive: boolean;
}

export class DuplicateDivisionError extends Error {
  constructor() {
    super('division already exists in this class and year');
    this.name = 'DuplicateDivisionError';
  }
}

export interface ClassRepo {
  list(): Promise<ClassRecord[]>;
  findById(id: string): Promise<ClassRecord | null>;
  /** throws DuplicateCodeError */
  create(c: Omit<ClassRecord, 'id'>): Promise<ClassRecord>;
  update(
    id: string,
    patch: Partial<Pick<ClassRecord, 'name' | 'isActive' | 'isFinal'>>,
  ): Promise<ClassRecord | null>;
  setSequences(order: readonly { id: string; sequence: number }[]): Promise<void>;
}

export interface DivisionFilter {
  academicYearId?: string | undefined;
  classId?: string | undefined;
}

export interface DivisionRepo {
  list(filter?: DivisionFilter): Promise<DivisionRecord[]>;
  findById(id: string): Promise<DivisionRecord | null>;
  /** throws DuplicateDivisionError (same class + year + name, ignoring case) */
  create(d: Omit<DivisionRecord, 'id'>): Promise<DivisionRecord>;
  update(
    id: string,
    patch: Partial<Pick<DivisionRecord, 'name' | 'capacity' | 'isActive'>>,
  ): Promise<DivisionRecord | null>;
  countByYear(academicYearId: string): Promise<number>;
  countActiveByClass(classId: string): Promise<number>;
}

/** how many students sit in a division — plugged in by the student module; until then nobody does */
export interface DivisionUsage {
  enrolled(divisionId: string): Promise<number>;
}

export const NO_DIVISION_USAGE: DivisionUsage = { enrolled: async () => 0 };

/** "a " and "A" are the same division name */
export const divisionKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toUpperCase();
