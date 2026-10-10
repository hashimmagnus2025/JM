/**
 * Business rules for the MOCK backend. In production the same rules live in the real API
 * (the finance engine is the only place money is calculated) — the screens never calculate money.
 */
import {
  ADMISSION_FEE,
  CATEGORY_CONCESSION_BP,
  DEMO_TODAY,
  adjustments,
  applyPayments,
  audit,
  classes,
  clearFeeCache,
  divisions,
  feeFast,
  feeStructure,
  payments,
  reminders,
  structureTotal,
  students,
  type DPayment,
  type DStudent,
} from './data';

const pad = (n: number, w: number): string => String(n).padStart(w, '0');
const DUES = ['2026-04-10', '2026-07-10', '2026-10-10', '2027-01-10'];

export const classNo = (s: Pick<DStudent, 'classId'>): number => Number(s.classId.slice(1));
export const className = (id: string): string => classes.find((c) => c.id === id)?.name ?? '—';
export const divisionName = (id: string): string => divisions.find((d) => d.id === id)?.name ?? '—';
export const classLabel = (s: Pick<DStudent, 'classId' | 'divisionId'>): string =>
  `${className(s.classId).replace('Class ', '')}-${divisionName(s.divisionId)}`;
export const studentById = (id: string): DStudent | undefined => students.find((s) => s.id === id);

export function log(user: string, action: string, entity: string, detail: string): void {
  audit.unshift({
    id: `au${audit.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
    at: `${DEMO_TODAY} ${new Date().toTimeString().slice(0, 5)}`,
    user,
    action,
    entity,
    detail,
  });
}

/** oldest due first (BRC-E1) */
export function allocate(s: DStudent, amount: number) {
  let left = amount;
  const lines: { installmentNo: number; label: string; amount: number }[] = [];
  for (const i of s.installments) {
    const pending = i.payable - i.paid;
    if (left <= 0) break;
    if (pending <= 0) continue;
    const take = Math.min(left, pending);
    lines.push({ installmentNo: i.no, label: `Instalment ${i.no}`, amount: take });
    left -= take;
  }
  const allocated = lines.reduce((t, l) => t + l.amount, 0);
  return { lines, allocated, balanceAfter: feeFast(s).outstanding - allocated };
}

export function feePreview(classId: string, categoryCode: string, openingBalance: number) {
  const n = Number(classId.slice(1));
  const lines = feeStructure(n);
  const tuition = lines.find((l) => l.code === 'TUITION')?.amount ?? 0;
  const concession = Math.round((tuition * (CATEGORY_CONCESSION_BP[categoryCode] ?? 0)) / 10_000);
  const gross = structureTotal(n) + ADMISSION_FEE;
  const payable = gross - concession;
  const base = Math.floor(payable / 400) * 100;
  const parts = [base, base, base, payable - base * 3];
  return {
    lines,
    admission: ADMISSION_FEE,
    gross,
    concession,
    payable,
    openingBalance,
    total: payable + openingBalance,
    instalments: parts.map((amount, i) => ({ no: i + 1, dueDate: DUES[i]!, amount })),
  };
}

export interface NewStudentBody {
  name: string;
  gender: 'MALE' | 'FEMALE';
  dob: string;
  guardianName: string;
  mobile: string;
  email?: string;
  classId: string;
  divisionId: string;
  categoryCode: string;
  openingBalance: number;
}
export function createStudent(b: NewStudentBody, by: string): DStudent {
  const p = feePreview(b.classId, b.categoryCode, b.openingBalance);
  const serial = students.length + 1;
  const n = Number(b.classId.slice(1));
  const s: DStudent = {
    id: `s${serial}`,
    studentId: `STU-${pad(serial, 5)}`,
    admissionNo: `ADM/26/${pad(2400 + serial, 4)}`,
    name: b.name.trim(),
    gender: b.gender,
    dob: b.dob,
    classId: b.classId,
    divisionId: b.divisionId,
    roll: students.filter((x) => x.divisionId === b.divisionId).length + 1,
    categoryCode: b.categoryCode,
    guardian: b.guardianName.trim(),
    mobile: b.mobile,
    email: b.email ?? '',
    address: '—',
    admissionDate: DEMO_TODAY,
    status: 'ACTIVE',
    isNew: true,
    grossPayable: p.gross,
    concession: p.concession,
    installments: p.instalments.map((i) => ({
      no: i.no,
      dueDate: i.dueDate,
      payable: i.amount,
      paid: 0,
      components: [
        ...feeStructure(n).map((l) => ({ label: l.label, amount: Math.round(l.amount / 4) })),
        ...(i.no === 1 ? [{ label: 'Admission fee', amount: p.admission }] : []),
      ],
    })),
    penalties: [],
    previousDue:
      b.openingBalance > 0 ? { year: 'Opening balance', amount: b.openingBalance, paid: 0 } : null,
  };
  students.push(s);
  clearFeeCache();
  log(by, 'STUDENT_CREATED', s.studentId, `${s.name}, ${classLabel(s)}`);
  return s;
}

const idem = new Map<string, DPayment>();
export function postPayment(
  s: DStudent,
  amount: number,
  method: DPayment['method'],
  reference: string | undefined,
  by: string,
  key: string,
): DPayment {
  const seen = idem.get(key);
  if (seen) return seen; // same Idempotency-Key = same payment, never two
  const { lines } = allocate(s, amount);
  const rec: DPayment = {
    id: `p${payments.length + 1}`,
    receiptNo: `REC-2026-${pad(payments.length + 1, 6)}`,
    date: DEMO_TODAY,
    studentId: s.id,
    amount: lines.reduce((t, l) => t + l.amount, 0),
    method,
    ...(reference ? { reference } : {}),
    collectedBy: by,
    status: 'POSTED',
    allocations: lines.map((l) => ({ installmentNo: l.installmentNo, amount: l.amount })),
  };
  payments.push(rec);
  idem.set(key, rec);
  applyPayments();
  clearFeeCache();
  log(
    by,
    'PAYMENT_POSTED',
    rec.receiptNo,
    `${s.name} · ₹${Math.round(rec.amount / 100).toLocaleString('en-IN')} · ${method}`,
  );
  return rec;
}

export function reverse(p: DPayment, reason: string, by: string): void {
  p.status = 'REVERSED';
  p.reversal = { reason, by, date: DEMO_TODAY };
  applyPayments();
  clearFeeCache();
  log(by, 'PAYMENT_REVERSED', p.receiptNo, reason);
}

export function promote(
  ids: string[],
  toClassId: string,
  toDivisionId: string,
  by: string,
): number {
  const set = new Set(ids);
  let n = 0;
  for (const s of students) {
    if (!set.has(s.id)) continue;
    // the real system adds a NEW enrollment for the new year; the old one stays as history
    s.classId = toClassId;
    s.divisionId = toDivisionId;
    n++;
  }
  clearFeeCache();
  log(
    by,
    'STUDENTS_PROMOTED',
    `${n} students`,
    `to ${className(toClassId)} (new academic-year record)`,
  );
  return n;
}

export function approve(id: string, by: string) {
  const a = adjustments.find((x) => x.id === id);
  if (!a) return null;
  a.status = 'APPROVED';
  a.approvedBy = by;
  log(by, 'ADJUSTMENT_APPROVED', a.type, a.reason);
  return a;
}

export type Segment = 'OVERDUE' | 'UNPAID' | 'PARTIAL' | 'ANY_DUE';
export function audience(q: {
  segment: Segment;
  classId?: string | null;
  divisionId?: string | null;
  studentId?: string | null;
}) {
  const list = students.filter((s) => {
    if (s.status !== 'ACTIVE') return false;
    if (q.studentId) return s.id === q.studentId;
    if (q.classId && s.classId !== q.classId) return false;
    if (q.divisionId && s.divisionId !== q.divisionId) return false;
    const f = feeFast(s);
    if (q.segment === 'OVERDUE') return f.status === 'OVERDUE';
    if (q.segment === 'UNPAID') return f.status === 'UNPAID';
    if (q.segment === 'PARTIAL') return f.status === 'PARTIAL';
    return f.outstanding > 0;
  });
  return { list, count: list.length, amount: list.reduce((t, s) => t + feeFast(s).outstanding, 0) };
}

export function queueReminders(
  list: DStudent[],
  channel: DReminderChannel,
  template: string,
  by: string,
): number {
  for (const s of list) {
    const f = feeFast(s);
    reminders.unshift({
      id: `r${reminders.length + 1}`,
      studentId: s.id,
      date: DEMO_TODAY,
      type: 'Manual reminder',
      channel,
      message: template
        .replaceAll('{student}', s.name)
        .replaceAll('{parent}', s.guardian)
        .replaceAll('{class}', classLabel(s))
        .replaceAll('{amount}', `₹${Math.round(f.outstanding / 100).toLocaleString('en-IN')}`),
      sentBy: by,
      status: 'Queued',
    });
  }
  log(by, 'REMINDER_SENT', `${list.length} students`, `${channel} · manual`);
  return list.length;
}
type DReminderChannel = 'WhatsApp' | 'SMS' | 'E-mail' | 'In-app';
