export type AcademicErrorCode =
  | 'TEACHER_NOT_ACTIVE'
  | 'EFFECTIVE_DATE_OUTSIDE_YEAR'
  | 'DIVISION_ALREADY_HAS_TEACHER'
  | 'TEACHER_ALREADY_ASSIGNED'
  | 'ASSIGNMENT_NOT_CURRENT'
  | 'ASSIGNMENT_CHANGE_INVALID'
  | 'ASSIGNMENT_YEAR_MISMATCH';

export class AcademicError extends Error {
  constructor(
    public readonly code: AcademicErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AcademicError';
  }
}
