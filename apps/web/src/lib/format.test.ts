import { describe, expect, it } from 'vitest';
import {
  cn,
  formatDate,
  formatDateTime,
  formatRange,
  initials,
  isValidYearLabel,
  yearLabelFor,
} from './format';

describe('formatting', () => {
  it('formats business dates without any time-zone shift', () => {
    expect(formatDate('2026-10-10')).toBe('10 Oct 2026');
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDate('2027-03-31')).toBe('31 Mar 2027');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('garbage')).toBe('—');
    expect(formatDate('2026-02-30')).toBe('—');
    expect(formatRange('2026-04-01', '2027-03-31')).toBe('1 Apr 2026 – 31 Mar 2027');
  });
  it('formats instants in IST', () => {
    expect(formatDateTime('2026-10-08T18:30:00Z')).toMatch(/9 Oct 2026/); // IST midnight → next day
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('nope')).toBe('—');
  });
  it('initials', () => {
    expect(initials('Rahul Sharma')).toBe('RS');
    expect(initials('Madonna')).toBe('M');
    expect(initials('  anil kumar singh ')).toBe('AS');
    expect(initials('')).toBe('?');
  });
  it('year labels', () => {
    expect(yearLabelFor('2026-04-01')).toBe('2026-27');
    expect(yearLabelFor('2099-04-01')).toBe('2099-00');
    expect(yearLabelFor('bad')).toBeNull();
    expect(isValidYearLabel('2026-27')).toBe(true);
    expect(isValidYearLabel('2026-28')).toBe(false);
  });
  it('cn joins truthy class names', () => {
    expect(cn('a', false, undefined, 'b', { c: true, d: false })).toBe('a b c');
  });
});
