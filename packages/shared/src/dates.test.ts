import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DateError,
  FixedClock,
  SystemClock,
  addDays,
  assertBusinessDate,
  businessDateFromInstant,
  compareDates,
  dateRange,
  diffDays,
  fromEpochDay,
  isAfter,
  isBefore,
  isBusinessDate,
  maxDate,
  minDate,
  parseAcademicYearLabel,
  toEpochDay,
} from './dates';

describe('business date validation', () => {
  it('accepts real calendar dates only', () => {
    expect(isBusinessDate('2026-10-08')).toBe(true);
    expect(isBusinessDate('2028-02-29')).toBe(true); // leap
    expect(isBusinessDate('2026-02-29')).toBe(false);
    expect(isBusinessDate('2026-13-01')).toBe(false);
    expect(isBusinessDate('2026-04-31')).toBe(false);
    expect(isBusinessDate('2026-4-1')).toBe(false);
    expect(isBusinessDate('2026-10-08T00:00:00Z')).toBe(false);
    expect(isBusinessDate(20261008)).toBe(false);
    expect(() => assertBusinessDate('nope')).toThrowError(DateError);
  });
});

describe('date arithmetic', () => {
  it('epoch-day conversion is exact', () => {
    expect(toEpochDay('1970-01-01')).toBe(0);
    expect(toEpochDay('2000-03-01')).toBe(11017);
    expect(fromEpochDay(0)).toBe('1970-01-01');
    expect(fromEpochDay(11017)).toBe('2000-03-01');
  });

  it('adds days across month, year and leap boundaries', () => {
    expect(addDays('2026-10-08', 2)).toBe('2026-10-10');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(() => addDays('2026-01-01', 1.5)).toThrowError(DateError);
  });

  it('diffs reproduce the worked-example aging days (§7.11)', () => {
    expect(diffDays('2026-04-10', '2026-10-08')).toBe(181);
    expect(diffDays('2026-07-10', '2026-10-08')).toBe(90);
    expect(diffDays('2026-10-08', '2026-10-10')).toBe(2);
    expect(diffDays('2026-10-10', '2026-10-08')).toBe(-2);
  });

  it('compares and clamps', () => {
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDates('2026-01-02', '2026-01-02')).toBe(0);
    expect(compareDates('2026-01-03', '2026-01-02')).toBe(1);
    expect(isBefore('2026-01-01', '2026-01-02')).toBe(true);
    expect(isAfter('2026-01-01', '2026-01-02')).toBe(false);
    expect(maxDate('2026-01-01', '2026-02-01')).toBe('2026-02-01');
    expect(minDate('2026-01-01', '2026-02-01')).toBe('2026-01-01');
  });

  it('dateRange is inclusive and guarded', () => {
    expect(dateRange('2026-10-08', '2026-10-10')).toEqual(['2026-10-08', '2026-10-09', '2026-10-10']);
    expect(dateRange('2026-10-10', '2026-10-08')).toEqual([]);
    expect(() => dateRange('2000-01-01', '2026-01-01')).toThrowError(/exceeds/);
  });

  it('PROPERTY: addDays/diffDays are inverse and epoch round-trips', () => {
    fc.assert(
      fc.property(fc.integer({ min: -20_000, max: 40_000 }), fc.integer({ min: -3_000, max: 3_000 }), (e, n) => {
        const d = fromEpochDay(e);
        expect(isBusinessDate(d)).toBe(true);
        expect(toEpochDay(d)).toBe(e);
        expect(diffDays(d, addDays(d, n))).toBe(n);
      }),
    );
  });
});

describe('IST handling (no UTC-midnight bugs)', () => {
  it('maps instants to the IST calendar day', () => {
    // IST = UTC+05:30 → 18:30 UTC is exactly IST midnight
    expect(businessDateFromInstant(new Date('2026-10-07T18:29:59Z'))).toBe('2026-10-07');
    expect(businessDateFromInstant(new Date('2026-10-07T18:30:00Z'))).toBe('2026-10-08');
    expect(businessDateFromInstant(new Date('2026-10-08T00:00:00Z'))).toBe('2026-10-08'); // 05:30 IST
    expect(businessDateFromInstant(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01'); // year boundary
    expect(businessDateFromInstant(new Date('2026-10-08T00:00:00Z'), 'UTC')).toBe('2026-10-08');
    expect(() => businessDateFromInstant(new Date('x'))).toThrowError(DateError);
  });

  it('FixedClock / SystemClock', () => {
    const c = new FixedClock('2026-10-07T23:59:59Z'); // 05:29:59 IST on the 8th
    expect(c.today()).toBe('2026-10-08');
    c.set('2026-10-07T18:29:59Z');
    expect(c.today()).toBe('2026-10-07');
    expect(c.now().toISOString()).toBe('2026-10-07T18:29:59.000Z');
    expect(isBusinessDate(new SystemClock().today())).toBe(true);
    expect(new SystemClock().now()).toBeInstanceOf(Date);
  });
});

describe('academic year labels', () => {
  it('parses consecutive labels', () => {
    expect(parseAcademicYearLabel('2026-27')).toEqual({ startYear: 2026, endYear: 2027 });
    expect(parseAcademicYearLabel('2099-00')).toEqual({ startYear: 2099, endYear: 2100 });
    expect(() => parseAcademicYearLabel('2026-28')).toThrowError(/consecutive/);
    expect(() => parseAcademicYearLabel('26-27')).toThrowError(DateError);
  });
});
