import {
  diffDays,
  isAfter,
  isBefore,
  parseAcademicYearLabel,
  type BusinessDate,
} from '@sfm/shared';
import { AcademicError, type AcademicErrorCode } from './errors';

export type YearStatus = 'PLANNED' | 'ACTIVE' | 'CLOSED';

export interface YearRange {
  id: string;
  label: string;
  startDate: BusinessDate;
  endDate: BusinessDate;
  status: YearStatus;
  isCurrent: boolean;
}

const fail = (
  code: AcademicErrorCode,
  message: string,
  details?: Record<string, unknown>,
): never => {
  throw new AcademicError(code, message, details);
};

/**
 * An academic year is a label ("2026-27") plus a date range. The label must agree with the dates and the range
 * must look like a school year (about 12 months) so a typo can never create a 3-day or 3-year "year".
 */
export function validateYearInput(input: {
  label: string;
  startDate: BusinessDate;
  endDate: BusinessDate;
}): void {
  let parsed;
  try {
    parsed = parseAcademicYearLabel(input.label);
  } catch {
    return fail('YEAR_INVALID', 'Use a label like 2026-27.');
  }
  if (!isAfter(input.endDate, input.startDate))
    fail('YEAR_INVALID', 'The end date must be after the start date.');
  const startYear = Number(input.startDate.slice(0, 4));
  const endYear = Number(input.endDate.slice(0, 4));
  if (startYear !== parsed.startYear)
    fail('YEAR_INVALID', `The label ${input.label} must start in ${parsed.startYear}.`);
  if (endYear !== startYear && endYear !== startYear + 1)
    fail('YEAR_INVALID', 'The end date must be in the same or the next calendar year.');
  const days = diffDays(input.startDate, input.endDate) + 1;
  if (days < 300 || days > 400)
    fail('YEAR_INVALID', 'An academic year should last about 12 months (300–400 days).', { days });
}

export const overlaps = (
  a: Pick<YearRange, 'startDate' | 'endDate'>,
  b: Pick<YearRange, 'startDate' | 'endDate'>,
): boolean => !isAfter(a.startDate, b.endDate) && !isAfter(b.startDate, a.endDate);

export function assertNoOverlap(
  candidate: Pick<YearRange, 'id' | 'startDate' | 'endDate'>,
  others: readonly YearRange[],
): void {
  const clash = others.find((o) => o.id !== candidate.id && overlaps(candidate, o));
  if (clash)
    fail('YEAR_OVERLAP', `These dates overlap with ${clash.label}.`, { overlapsWith: clash.label });
}

const ALLOWED: Record<YearStatus, readonly YearStatus[]> = {
  PLANNED: ['ACTIVE'],
  ACTIVE: ['PLANNED', 'CLOSED'],
  CLOSED: ['ACTIVE'], // reopening is a deliberate, audited correction
};

export function assertTransition(from: YearStatus, to: YearStatus): void {
  if (!ALLOWED[from].includes(to))
    fail('YEAR_STATUS_INVALID', `A ${from.toLowerCase()} year cannot become ${to.toLowerCase()}.`, {
      from,
      to,
    });
}

/**
 * Historical academic-year records stay unchanged (SOW §4): label and dates can only be edited while the year is
 * still PLANNED. Later corrections go through reopen / authorised correction flows.
 */
export function assertEditable(year: Pick<YearRange, 'status' | 'label'>): void {
  if (year.status !== 'PLANNED')
    fail(
      'YEAR_LOCKED',
      `${year.label} is ${year.status.toLowerCase()} and can no longer be edited.`,
    );
}

/** exactly one current year: unset the old one, set the new one */
export function planSetCurrent(
  years: readonly YearRange[],
  targetId: string,
): { unset: string[]; set: string } {
  const target = years.find((y) => y.id === targetId);
  if (!target) return fail('YEAR_NOT_FOUND', 'Academic year not found.');
  if (target.status === 'CLOSED')
    fail('YEAR_CLOSED', `${target.label} is closed. Reopen it before making it current.`);
  return {
    unset: years.filter((y) => y.isCurrent && y.id !== targetId).map((y) => y.id),
    set: targetId,
  };
}

export interface CloseContext {
  /** items that must be settled first (pending adjustments, pending reversals, unassigned divisions …) */
  blockers: readonly string[];
}

export function closeBlockers(year: YearRange, ctx: CloseContext): string[] {
  const out: string[] = [];
  if (year.isCurrent)
    out.push('This is the current academic year. Make another year current first.');
  if (year.status === 'CLOSED') out.push('This year is already closed.');
  return [...out, ...ctx.blockers];
}

/** the academic year whose range contains `date` (null if none) */
export function yearContaining(years: readonly YearRange[], date: BusinessDate): YearRange | null {
  return years.find((y) => !isBefore(date, y.startDate) && !isAfter(date, y.endDate)) ?? null;
}

/** suggested next year: same length, starting the day after the latest year ends (used by the "create next year" form) */
export function suggestNextYear(
  years: readonly Pick<YearRange, 'label' | 'startDate' | 'endDate'>[],
): { label: string; startDate: BusinessDate; endDate: BusinessDate } | null {
  if (years.length === 0) return null;
  const last = [...years].sort((a, b) =>
    a.startDate < b.startDate ? 1 : -1,
  )[0] as (typeof years)[number];
  const { startYear } = parseAcademicYearLabel(last.label);
  const shift = (d: BusinessDate): BusinessDate => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
  const next = startYear + 1;
  return {
    label: `${next}-${String((next + 1) % 100).padStart(2, '0')}`,
    startDate: shift(last.startDate),
    endDate: shift(last.endDate),
  };
}
