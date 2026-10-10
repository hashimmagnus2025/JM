import {
  DEMO_TODAY,
  addDaysISO,
  classes,
  daysBetween,
  divisions,
  feeFast,
  payments,
  students,
  type DStudent,
  type FeeStatus,
} from './data';

export const activeStudents = (): DStudent[] => students.filter((s) => s.status === 'ACTIVE');

export interface Sum {
  students: number;
  expected: number;
  collected: number;
  outstanding: number;
  overdue: number;
  pct: number;
}
export function sumOf(list: DStudent[]): Sum {
  let expected = 0;
  let collected = 0;
  let outstanding = 0;
  let overdue = 0;
  let due = 0;
  let covered = 0;
  for (const s of list) {
    const f = feeFast(s);
    expected += f.payable;
    collected += f.paid;
    outstanding += f.outstanding;
    overdue += f.overdue;
    due += f.dueToDate;
    covered += Math.min(f.paid, f.dueToDate);
  }
  return {
    students: list.length,
    expected,
    collected,
    outstanding,
    overdue,
    // collection rate = how much of what has FALLEN DUE so far has been collected
    pct: due ? Math.round((covered / due) * 1000) / 10 : 0,
  };
}

export function classRows() {
  const act = activeStudents();
  return classes.map((c) => {
    const list = act.filter((s) => s.classId === c.id);
    return {
      id: c.id,
      name: c.name,
      divisions: divisions.filter((d) => d.classId === c.id && d.isActive).length,
      ...sumOf(list),
    };
  });
}

export function divisionRows(classId: string) {
  const act = activeStudents();
  return divisions
    .filter((d) => d.classId === classId)
    .map((d) => ({
      id: d.id,
      name: d.name,
      capacity: d.capacity ?? 0,
      ...sumOf(act.filter((s) => s.divisionId === d.id)),
    }));
}

export function statusCounts(
  list: DStudent[] = activeStudents(),
): Record<FeeStatus | 'DUE_SOON', number> {
  const out = { PAID: 0, PARTIAL: 0, UNPAID: 0, OVERDUE: 0, DUE_SOON: 0 };
  for (const s of list) {
    const f = feeFast(s);
    out[f.status]++;
    if (f.dueSoon && f.outstanding > 0) out.DUE_SOON++;
  }
  return out;
}

export const AGING_BUCKETS = ['0–30 days', '31–60 days', '61–90 days', '90+ days'] as const;
/** every unpaid, past-due amount is aged from ITS OWN original due date (BRC-I2) */
export function aging(list: DStudent[] = activeStudents()): number[] {
  const out = [0, 0, 0, 0];
  const put = (due: string, amount: number) => {
    if (amount <= 0 || due >= DEMO_TODAY) return;
    const d = daysBetween(due, DEMO_TODAY);
    out[d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3]! += amount;
  };
  for (const s of list) {
    for (const i of s.installments) put(i.dueDate, i.payable - i.paid);
    for (const p of s.penalties) put(p.dueDate, p.amount - p.paid);
    if (s.previousDue) put('2026-03-31', s.previousDue.amount - s.previousDue.paid);
  }
  return out;
}

export const MONTHS = [
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
  'Jan',
  'Feb',
  'Mar',
];
const monthIndex = (date: string): number => (Number(date.slice(5, 7)) + 8) % 12;

/** collections per month of the academic year, with a target that follows the instalment calendar */
export function monthly() {
  const act = activeStudents();
  const total = sumOf(act).expected;
  const weights = [28, 4, 4, 24, 3, 3, 24, 3, 3, 4, 2, 2];
  const wsum = weights.reduce((a, b) => a + b, 0);
  const actual = new Array<number>(12).fill(0);
  for (const p of payments) if (p.status === 'POSTED') actual[monthIndex(p.date)]! += p.amount;
  const now = monthIndex(DEMO_TODAY);
  return MONTHS.map((m, i) => ({
    month: m,
    target: Math.round((total * weights[i]!) / wsum),
    actual: i <= now ? actual[i]! : 0,
    future: i > now,
  }));
}

export function methodSplit() {
  const m = new Map<string, number>();
  for (const p of payments)
    if (p.status === 'POSTED') m.set(p.method, (m.get(p.method) ?? 0) + p.amount);
  return [...m.entries()]
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function collectionBetween(from: string, to: string): number {
  return payments
    .filter((p) => p.status === 'POSTED' && p.date >= from && p.date <= to)
    .reduce((t, p) => t + p.amount, 0);
}

export function upcomingDue(days = 30): number {
  const end = addDaysISO(DEMO_TODAY, days);
  let total = 0;
  for (const s of activeStudents())
    for (const i of s.installments)
      if (i.dueDate >= DEMO_TODAY && i.dueDate <= end) total += Math.max(0, i.payable - i.paid);
  return total;
}

export function topOverdue(n = 8) {
  return activeStudents()
    .map((s) => ({ s, f: feeFast(s) }))
    .filter((x) => x.f.overdue > 0)
    .sort((a, b) => b.f.overdue - a.f.overdue)
    .slice(0, n);
}
