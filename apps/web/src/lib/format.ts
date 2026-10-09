import { isBusinessDate, parseAcademicYearLabel } from '@sfm/shared';
import clsx, { type ClassValue } from 'clsx';

export const cn = (...v: ClassValue[]): string => clsx(v);

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** '2026-10-10' → '10 Oct 2026' (business dates are never passed through a time zone) */
export function formatDate(d: string | null | undefined): string {
  if (!d || !isBusinessDate(d)) return '—';
  return `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}

export const formatRange = (a: string, b: string): string => `${formatDate(a)} – ${formatDate(b)}`;

/** date + time of an ISO instant in the school's time zone */
export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (
      (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
    ).toUpperCase() || '?'
  );
}

/** '2026-27' label from a start date (April–March by default) */
export function yearLabelFor(startDate: string): string | null {
  if (!isBusinessDate(startDate)) return null;
  const y = Number(startDate.slice(0, 4));
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export const isValidYearLabel = (l: string): boolean => {
  try {
    parseAcademicYearLabel(l);
    return true;
  } catch {
    return false;
  }
};
