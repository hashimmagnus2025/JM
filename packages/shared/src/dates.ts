/**
 * Business dates.
 *
 * Academic/financial dates (due dates, payment dates, effective dates…) are CALENDAR days in the
 * institution's time zone, represented as 'YYYY-MM-DD' strings. They are never converted through
 * UTC instants, which removes the whole class of "UTC-midnight" off-by-one bugs. Instants are only
 * converted to a business date at the edge, through an injectable Clock.
 */

export type BusinessDate = string;

export const IST = 'Asia/Kolkata';

export class DateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateError';
  }
}

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y: number, m: number): number =>
  m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;

export function isBusinessDate(value: unknown): value is BusinessDate {
  if (typeof value !== 'string') return false;
  const match = RE.exec(value);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return y >= 1900 && y <= 2999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function assertBusinessDate(value: unknown, label = 'date'): asserts value is BusinessDate {
  if (!isBusinessDate(value)) throw new DateError(`${label} must be a valid YYYY-MM-DD date`);
}

/** Days since 1970-01-01 (proleptic Gregorian; integer arithmetic only). */
export function toEpochDay(date: BusinessDate): number {
  assertBusinessDate(date);
  const y0 = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromEpochDay(epochDay: number): BusinessDate {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const year = m <= 2 ? y + 1 : y;
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const addDays = (date: BusinessDate, days: number): BusinessDate => {
  if (!Number.isInteger(days)) throw new DateError('days must be an integer');
  return fromEpochDay(toEpochDay(date) + days);
};

/** Whole days from `from` to `to` (positive when `to` is later). */
export const diffDays = (from: BusinessDate, to: BusinessDate): number =>
  toEpochDay(to) - toEpochDay(from);

export const compareDates = (a: BusinessDate, b: BusinessDate): -1 | 0 | 1 => {
  const d = toEpochDay(a) - toEpochDay(b);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
};
export const isBefore = (a: BusinessDate, b: BusinessDate): boolean => compareDates(a, b) < 0;
export const isAfter = (a: BusinessDate, b: BusinessDate): boolean => compareDates(a, b) > 0;
export const maxDate = (a: BusinessDate, b: BusinessDate): BusinessDate => (isAfter(a, b) ? a : b);
export const minDate = (a: BusinessDate, b: BusinessDate): BusinessDate => (isBefore(a, b) ? a : b);

/** Every date from `from` to `to`, inclusive. Guarded against runaway ranges. */
export function dateRange(from: BusinessDate, to: BusinessDate, maxDays = 3660): BusinessDate[] {
  const n = diffDays(from, to);
  if (n < 0) return [];
  if (n + 1 > maxDays) throw new DateError(`date range exceeds ${maxDays} days`);
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

/** The calendar date at `instant` in `timeZone` (default IST). */
export function businessDateFromInstant(instant: Date, timeZone: string = IST): BusinessDate {
  if (Number.isNaN(instant.getTime())) throw new DateError('invalid instant');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Injectable time source — domain code never calls `Date.now()` directly. */
export interface Clock {
  now(): Date;
  today(): BusinessDate;
}

export class SystemClock implements Clock {
  constructor(private readonly timeZone: string = IST) {}
  now(): Date {
    return new Date();
  }
  today(): BusinessDate {
    return businessDateFromInstant(this.now(), this.timeZone);
  }
}

export class FixedClock implements Clock {
  private instant: Date;
  constructor(
    instant: Date | string,
    private readonly timeZone: string = IST,
  ) {
    this.instant = new Date(instant);
  }
  set(instant: Date | string): void {
    this.instant = new Date(instant);
  }
  now(): Date {
    return new Date(this.instant);
  }
  today(): BusinessDate {
    return businessDateFromInstant(this.instant, this.timeZone);
  }
}

/* ------------------------------ academic year labels ------------------------------ */

export interface AcademicYearLabel {
  startYear: number;
  endYear: number;
}

/** '2026-27' → { startYear: 2026, endYear: 2027 }. The two-digit suffix must equal (start+1) mod 100. */
export function parseAcademicYearLabel(label: string): AcademicYearLabel {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) throw new DateError(`"${label}" is not an academic-year label like 2026-27`);
  const startYear = Number(m[1]);
  if (Number(m[2]) !== (startYear + 1) % 100) {
    throw new DateError(`"${label}" is not a consecutive academic-year label`);
  }
  return { startYear, endYear: startYear + 1 };
}
