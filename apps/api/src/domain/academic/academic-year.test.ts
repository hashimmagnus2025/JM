import { describe, expect, it } from 'vitest';
import {
  assertEditable,
  assertNoOverlap,
  assertTransition,
  closeBlockers,
  overlaps,
  planSetCurrent,
  suggestNextYear,
  validateYearInput,
  yearContaining,
  type YearRange,
} from './academic-year';

const y = (
  label: string,
  start: string,
  end: string,
  over: Partial<YearRange> = {},
): YearRange => ({
  id: label,
  label,
  startDate: start,
  endDate: end,
  status: 'PLANNED',
  isCurrent: false,
  ...over,
});
const Y25 = y('2025-26', '2025-04-01', '2026-03-31', { status: 'CLOSED' });
const Y26 = y('2026-27', '2026-04-01', '2027-03-31', { status: 'ACTIVE', isCurrent: true });
const Y27 = y('2027-28', '2027-04-01', '2028-03-31');
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as { code: string }).code;
  }
  return 'OK';
};

describe('year input validation', () => {
  it('accepts a normal April–March year and a calendar year', () => {
    expect(
      code(() =>
        validateYearInput({ label: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' }),
      ),
    ).toBe('OK');
    expect(
      code(() =>
        validateYearInput({ label: '2026-27', startDate: '2026-01-01', endDate: '2026-12-31' }),
      ),
    ).toBe('OK');
  });
  it('rejects a label that disagrees with the dates, a bad label, and impossible ranges', () => {
    const v = (label: string, startDate: string, endDate: string): string =>
      code(() => validateYearInput({ label, startDate, endDate }));
    expect(v('2026-27', '2025-04-01', '2026-03-31')).toBe('YEAR_INVALID'); // label starts 2026, dates start 2025
    expect(v('2026-28', '2026-04-01', '2027-03-31')).toBe('YEAR_INVALID'); // non-consecutive label
    expect(v('26-27', '2026-04-01', '2027-03-31')).toBe('YEAR_INVALID');
    expect(v('2026-27', '2027-03-31', '2026-04-01')).toBe('YEAR_INVALID'); // end before start
    expect(v('2026-27', '2026-04-01', '2026-04-01')).toBe('YEAR_INVALID');
    expect(v('2026-27', '2026-04-01', '2026-04-04')).toBe('YEAR_INVALID'); // 4-day "year"
    expect(v('2026-27', '2026-04-01', '2028-03-31')).toBe('YEAR_INVALID'); // two years
    expect(v('2026-27', '2026-04-01', '2027-08-31')).toBe('YEAR_INVALID'); // too long
  });
});

describe('overlap', () => {
  it('touching dates overlap; adjacent days do not', () => {
    expect(overlaps(Y26, y('x', '2027-03-31', '2028-03-30'))).toBe(true);
    expect(overlaps(Y26, Y27)).toBe(false);
    expect(overlaps(Y27, Y26)).toBe(false);
    expect(overlaps(Y26, y('inside', '2026-06-01', '2026-07-01'))).toBe(true);
  });
  it('a year never overlaps itself when edited; clashes name the other year', () => {
    expect(code(() => assertNoOverlap(Y26, [Y25, Y26, Y27]))).toBe('OK');
    try {
      assertNoOverlap({ id: 'new', startDate: '2026-12-01', endDate: '2027-11-30' }, [Y26]);
    } catch (e) {
      expect(e).toMatchObject({ code: 'YEAR_OVERLAP', details: { overlapsWith: '2026-27' } });
      return;
    }
    throw new Error('expected a throw');
  });
});

describe('status transitions', () => {
  it('PLANNED→ACTIVE, ACTIVE→PLANNED/CLOSED, CLOSED→ACTIVE (reopen) only', () => {
    expect(code(() => assertTransition('PLANNED', 'ACTIVE'))).toBe('OK');
    expect(code(() => assertTransition('ACTIVE', 'PLANNED'))).toBe('OK');
    expect(code(() => assertTransition('ACTIVE', 'CLOSED'))).toBe('OK');
    expect(code(() => assertTransition('CLOSED', 'ACTIVE'))).toBe('OK');
    expect(code(() => assertTransition('PLANNED', 'CLOSED'))).toBe('YEAR_STATUS_INVALID');
    expect(code(() => assertTransition('CLOSED', 'PLANNED'))).toBe('YEAR_STATUS_INVALID');
    expect(code(() => assertTransition('ACTIVE', 'ACTIVE'))).toBe('YEAR_STATUS_INVALID');
  });
  it('only a PLANNED year can be edited (history stays unchanged, SOW §4)', () => {
    expect(code(() => assertEditable(Y27))).toBe('OK');
    expect(code(() => assertEditable(Y26))).toBe('YEAR_LOCKED');
    expect(code(() => assertEditable(Y25))).toBe('YEAR_LOCKED');
  });
});

describe('current year', () => {
  it('exactly one current: the old one is unset, the new one set', () => {
    expect(planSetCurrent([Y25, Y26, { ...Y27, status: 'ACTIVE' }], '2027-28')).toEqual({
      unset: ['2026-27'],
      set: '2027-28',
    });
  });
  it('re-selecting the current year changes nothing; unknown and closed years are refused', () => {
    expect(planSetCurrent([Y26], '2026-27')).toEqual({ unset: [], set: '2026-27' });
    expect(code(() => planSetCurrent([Y26], 'nope'))).toBe('YEAR_NOT_FOUND');
    expect(code(() => planSetCurrent([Y25, Y26], '2025-26'))).toBe('YEAR_CLOSED');
  });
  it('a PLANNED (future) year can become current', () => {
    expect(planSetCurrent([Y26, Y27], '2027-28').set).toBe('2027-28');
  });
});

describe('closing', () => {
  it('the current year cannot be closed; blockers are reported in plain language', () => {
    expect(closeBlockers(Y26, { blockers: [] })).toEqual([
      'This is the current academic year. Make another year current first.',
    ]);
    expect(
      closeBlockers(
        { ...Y26, isCurrent: false },
        { blockers: ['2 payment reversals are waiting for approval'] },
      ),
    ).toEqual(['2 payment reversals are waiting for approval']);
    expect(closeBlockers({ ...Y26, isCurrent: false }, { blockers: [] })).toEqual([]);
    expect(closeBlockers(Y25, { blockers: [] })).toEqual(['This year is already closed.']);
  });
});

describe('helpers', () => {
  it('finds the year that contains a date', () => {
    expect(yearContaining([Y25, Y26, Y27], '2026-10-08')?.label).toBe('2026-27');
    expect(yearContaining([Y25, Y26, Y27], '2027-03-31')?.label).toBe('2026-27');
    expect(yearContaining([Y25, Y26, Y27], '2027-04-01')?.label).toBe('2027-28');
    expect(yearContaining([Y25], '2030-01-01')).toBeNull();
  });
  it('suggests the next year after the latest one', () => {
    expect(suggestNextYear([Y25, Y26])).toEqual({
      label: '2027-28',
      startDate: '2027-04-01',
      endDate: '2028-03-31',
    });
    expect(suggestNextYear([y('2099-00', '2099-04-01', '2100-03-31')])?.label).toBe('2100-01');
    expect(suggestNextYear([])).toBeNull();
  });
});
