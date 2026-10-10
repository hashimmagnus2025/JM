import type { BusinessDate } from '@sfm/shared';
import type { TeacherAssignment } from '../../domain/academic/teacher-assignment';

export type TeacherStatus = 'ACTIVE' | 'INACTIVE' | 'LEFT';
export type Gender = 'MALE' | 'FEMALE' | 'OTHER';

export interface TeacherRecord {
  id: string;
  /** system id, TCH-000001 — never reused */
  teacherCode: string;
  /** the school's own staff / employee number */
  staffId: string;
  fullName: string;
  mobile: string;
  email?: string | undefined;
  gender?: Gender | undefined;
  qualification?: string | undefined;
  joiningDate: BusinessDate;
  status: TeacherStatus;
  leavingDate?: BusinessDate | undefined;
  remarks?: string | undefined;
}

export type TeacherDraft = Omit<TeacherRecord, 'id' | 'teacherCode' | 'status' | 'leavingDate'>;
export type TeacherPatch = Partial<
  Omit<TeacherRecord, 'id' | 'teacherCode' | 'staffId'> & { staffId: string }
>;

export interface TeacherFilter {
  status?: TeacherStatus | undefined;
  /** matches name, staff id, teacher code or mobile */
  q?: string | undefined;
}

export class DuplicateStaffIdError extends Error {
  constructor() {
    super('staff id already exists');
    this.name = 'DuplicateStaffIdError';
  }
}

/** another request became the current class teacher of the division first */
export class DivisionAlreadyAssignedError extends Error {
  constructor() {
    super('division already has a current class teacher');
    this.name = 'DivisionAlreadyAssignedError';
  }
}

export interface TeacherRepo {
  list(filter?: TeacherFilter): Promise<TeacherRecord[]>;
  findById(id: string): Promise<TeacherRecord | null>;
  /** allocates the next TCH number; gaps are allowed, numbers are never reused */
  nextCode(): Promise<string>;
  /** throws DuplicateStaffIdError */
  create(t: TeacherDraft & { teacherCode: string }): Promise<TeacherRecord>;
  /** `undefined` values clear the field; throws DuplicateStaffIdError */
  update(id: string, patch: TeacherPatch): Promise<TeacherRecord | null>;
}

export interface AssignmentClose {
  id: string;
  effectiveTo: BusinessDate;
  isCurrent: false;
  endReason: NonNullable<TeacherAssignment['endReason']>;
}

export interface AssignmentExtras {
  assignedBy?: string | undefined;
  reason?: string | undefined;
}

export interface AssignmentRepo {
  list(filter: {
    academicYearId?: string | undefined;
    teacherId?: string | undefined;
    divisionId?: string | undefined;
    currentOnly?: boolean | undefined;
  }): Promise<TeacherAssignment[]>;
  findById(id: string): Promise<TeacherAssignment | null>;
  /** throws DivisionAlreadyAssignedError */
  create(a: TeacherAssignment, by?: string): Promise<TeacherAssignment>;
  /** close the old row and open the new one together (all or nothing) */
  change(close: AssignmentClose, create: TeacherAssignment, by?: string): Promise<void>;
  end(close: AssignmentClose): Promise<void>;
}
