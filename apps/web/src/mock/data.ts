/**
 * DEMO DATA — a believable school generated in the browser (seeded, so it looks the same every time).
 * Nothing here is real and nothing is saved. All money is integer paise, like the real system.
 */
import { SYSTEM_ROLES } from '@sfm/shared';

export const DEMO_TODAY = '2026-10-06';
export const YEAR_ID = 'y2026';

export interface DClass {
  id: string;
  code: string;
  name: string;
  sequence: number;
  isActive: boolean;
  isFinal: boolean;
}
export interface DDivision {
  id: string;
  academicYearId: string;
  classId: string;
  name: string;
  capacity?: number;
  isActive: boolean;
}
export interface DYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: 'PLANNED' | 'ACTIVE' | 'CLOSED';
  isCurrent: boolean;
}
export interface DCategory {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sequence: number;
}
export interface DTeacher {
  id: string;
  teacherCode: string;
  staffId: string;
  fullName: string;
  mobile: string;
  email?: string;
  gender?: string;
  qualification?: string;
  joiningDate: string;
  status: 'ACTIVE' | 'INACTIVE' | 'LEFT';
  leavingDate?: string;
  remarks?: string;
}
export interface DAssignment {
  id: string;
  academicYearId: string;
  classId: string;
  divisionId: string;
  teacherId: string;
  role: 'CLASS_TEACHER';
  effectiveFrom: string;
  effectiveTo: string | null;
  isCurrent: boolean;
  endReason?: string;
  reason?: string;
}

export type InstStatus = 'PAID' | 'PARTIAL' | 'PENDING' | 'DUE_SOON' | 'OVERDUE';
export interface DInstallment {
  no: number;
  dueDate: string;
  payable: number;
  paid: number;
  components: { label: string; amount: number }[];
}
export interface DPenalty {
  label: string;
  dueDate: string;
  amount: number;
  paid: number;
}
export type FeeStatus = 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE';
export interface DStudent {
  id: string;
  studentId: string;
  admissionNo: string;
  name: string;
  gender: 'MALE' | 'FEMALE';
  dob: string;
  classId: string;
  divisionId: string;
  roll: number;
  categoryCode: string;
  guardian: string;
  mobile: string;
  email: string;
  address: string;
  admissionDate: string;
  status: 'ACTIVE' | 'INACTIVE' | 'PASSED_OUT';
  isNew: boolean;
  grossPayable: number;
  concession: number;
  installments: DInstallment[];
  penalties: DPenalty[];
  /** unpaid balance from an earlier year; it stays attached to that year (BRC-D1) */
  previousDue: { year: string; amount: number; paid: number } | null;
}
export interface DPayment {
  id: string;
  receiptNo: string;
  date: string;
  studentId: string;
  amount: number;
  method: 'Cash' | 'UPI' | 'Bank transfer' | 'Cheque' | 'Card';
  reference?: string;
  collectedBy: string;
  status: 'POSTED' | 'REVERSED';
  allocations: { installmentNo: number; amount: number }[];
  reversal?: { reason: string; by: string; date: string };
}
export interface DReminder {
  id: string;
  studentId: string;
  date: string;
  type: string;
  channel: 'WhatsApp' | 'SMS' | 'E-mail' | 'In-app';
  message: string;
  sentBy: string;
  status: 'Delivered' | 'Failed' | 'Queued';
}
export interface DAdjustment {
  id: string;
  studentId: string;
  type: 'Scholarship' | 'Discount' | 'Concession' | 'Waiver';
  amount: number;
  reason: string;
  approvedBy: string | null;
  date: string;
  status: 'APPROVED' | 'PENDING';
}
export interface DUser {
  id: string;
  name: string;
  email: string;
  roleKey: string;
  active: boolean;
  lastLogin: string;
}
export interface DAudit {
  id: string;
  at: string;
  user: string;
  action: string;
  entity: string;
  detail: string;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260406);
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
const between = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
const rupees = (n: number): number => n * 100;
const pad = (n: number, w: number): string => String(n).padStart(w, '0');

export function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => Date.parse(`${s}T00:00:00Z`);
  return Math.round((t(b) - t(a)) / 86_400_000);
}

const MALE = [
  'Aarav',
  'Vivaan',
  'Aditya',
  'Arjun',
  'Rohan',
  'Kabir',
  'Ishaan',
  'Reyansh',
  'Yash',
  'Dev',
  'Krish',
  'Om',
  'Rahul',
  'Nikhil',
  'Siddharth',
  'Karan',
  'Harsh',
  'Tanmay',
  'Atharv',
  'Pranav',
];
const FEMALE = [
  'Ananya',
  'Diya',
  'Saanvi',
  'Myra',
  'Isha',
  'Kavya',
  'Riya',
  'Aadhya',
  'Pooja',
  'Neha',
  'Tara',
  'Meera',
  'Sneha',
  'Anika',
  'Prisha',
  'Kiara',
  'Nisha',
  'Shreya',
  'Avni',
  'Trisha',
];
const SURNAME = [
  'Sharma',
  'Verma',
  'Patil',
  'Deshmukh',
  'Iyer',
  'Nair',
  'Gupta',
  'Khan',
  'Singh',
  'Joshi',
  'Kulkarni',
  'Mehta',
  'Reddy',
  'Pillai',
  'Banerjee',
  'Chopra',
  'Jadhav',
  'Shinde',
  'Bhatt',
  'Kapoor',
  'More',
  'Pawar',
  'Thakur',
  'Mishra',
];
const PARENT_M = [
  'Rajesh',
  'Suresh',
  'Anil',
  'Vikram',
  'Sanjay',
  'Manoj',
  'Prakash',
  'Deepak',
  'Ramesh',
  'Amit',
  'Sunil',
  'Ashok',
];
const AREAS = [
  'Civil Lines',
  'Sadar',
  'Dharampeth',
  'Ramdaspeth',
  'Manish Nagar',
  'Sitabuldi',
  'Pratap Nagar',
  'Itwari',
  'Wardha Road',
  'Trimurti Nagar',
];
const COLLECTORS = ['Meena Joshi', 'Sandeep Rao', 'Pooja Nair'];
const METHODS: DPayment['method'][] = [
  'Cash',
  'Cash',
  'Cash',
  'UPI',
  'UPI',
  'UPI',
  'UPI',
  'Bank transfer',
  'Cheque',
  'Card',
];

const INST_DUES = ['2026-04-10', '2026-07-10', '2026-10-10', '2027-01-10'];

export const institution = {
  id: 'inst1',
  name: 'Jawahar Memorial School',
  shortName: 'JMS',
  code: 'JMS',
  address: {
    line1: '12 Station Road',
    city: 'Nagpur',
    state: 'Maharashtra',
    pincode: '440001',
    country: 'India',
  },
  contact: { phone: '0712 2345678', email: 'office@jms.example', website: 'https://jms.example' },
  registrationNo: 'MH/EDU/1984/0412',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  academicStartMonth: 4,
  receiptFooter: 'Fees once paid are not refundable. This is a computer generated receipt.',
  extra: { 'UDISE code': '27011234567' } as Record<string, string>,
};

export const years: DYear[] = [
  {
    id: 'y2024',
    label: '2024-25',
    startDate: '2024-04-01',
    endDate: '2025-03-31',
    status: 'CLOSED',
    isCurrent: false,
  },
  {
    id: 'y2025',
    label: '2025-26',
    startDate: '2025-04-01',
    endDate: '2026-03-31',
    status: 'CLOSED',
    isCurrent: false,
  },
  {
    id: YEAR_ID,
    label: '2026-27',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'ACTIVE',
    isCurrent: true,
  },
  {
    id: 'y2027',
    label: '2027-28',
    startDate: '2027-04-01',
    endDate: '2028-03-31',
    status: 'PLANNED',
    isCurrent: false,
  },
];

export const categories: DCategory[] = [
  { id: 'cat1', code: 'GENERAL', name: 'General', isActive: true, sequence: 1 },
  { id: 'cat2', code: 'RTE', name: 'RTE (free seat)', isActive: true, sequence: 2 },
  { id: 'cat3', code: 'STAFF_WARD', name: 'Staff ward', isActive: true, sequence: 3 },
  { id: 'cat4', code: 'SIBLING', name: 'Sibling concession', isActive: true, sequence: 4 },
];

export const classes: DClass[] = Array.from({ length: 12 }, (_, i) => ({
  id: `c${i + 1}`,
  code: String(i + 1),
  name: `Class ${i + 1}`,
  sequence: i + 1,
  isActive: true,
  isFinal: i === 11,
}));

const DIV_NAMES = ['A', 'B', 'C', 'D'];
export const divisions: DDivision[] = classes.flatMap((c) => {
  const n = Number(c.code);
  const count = n === 9 || n === 10 ? 4 : 3;
  return DIV_NAMES.slice(0, count).map((name) => ({
    id: `d${c.code}${name}`,
    academicYearId: YEAR_ID,
    classId: c.id,
    name,
    capacity: 55,
    isActive: true,
  }));
});

/** per-class fee structure, 2026-27 */
export interface FeeLine {
  code: string;
  label: string;
  amount: number;
}
export function feeStructure(classNo: number): FeeLine[] {
  const lines: FeeLine[] = [
    { code: 'TUITION', label: 'Tuition fee', amount: rupees(24_000 + classNo * 2_000) },
    { code: 'EXAM', label: 'Examination fee', amount: rupees(2_400) },
    { code: 'ACTIVITY', label: 'Activity fee', amount: rupees(1_600) },
    { code: 'LIBRARY', label: 'Library fee', amount: rupees(1_200) },
  ];
  if (classNo >= 3) lines.push({ code: 'COMPUTER', label: 'Computer fee', amount: rupees(2_000) });
  if (classNo >= 6) lines.push({ code: 'LAB', label: 'Laboratory fee', amount: rupees(2_800) });
  return lines;
}
export const ADMISSION_FEE = rupees(5_000);
export const structureTotal = (classNo: number): number =>
  feeStructure(classNo).reduce((s, l) => s + l.amount, 0);

/** the part of a category's concession on the tuition fee (basis points) */
export const CATEGORY_CONCESSION_BP: Record<string, number> = {
  GENERAL: 0,
  RTE: 10_000,
  STAFF_WARD: 5_000,
  SIBLING: 1_000,
};

const split = (total: number, n: number): number[] => {
  // whole rupees per instalment, the remainder goes to the last one
  const base = Math.floor(total / n / 100) * 100;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - base * (n - 1) : base));
};

const teacherNames = [
  'Asha Mehta',
  'Ravi Kumar',
  'Sunita Deshpande',
  'Imran Shaikh',
  'Lata Kulkarni',
  'Vinod Pawar',
  'Rekha Nair',
  'Prakash Joshi',
  'Farida Khan',
  'Gopal Iyer',
  'Meghna Bhatt',
  'Suresh Reddy',
  'Anita Patil',
  'Dinesh Thakur',
  'Kavita Singh',
  'Rahul Verma',
  'Seema Gupta',
  'Ajay Mishra',
  'Neelam Chopra',
  'Tushar More',
  'Pallavi Jadhav',
  'Manish Shinde',
  'Radhika Pillai',
  'Sachin Banerjee',
  'Usha Kapoor',
  'Nitin Sharma',
  'Jyoti Rao',
  'Harish Bhosale',
  'Smita Gaikwad',
  'Mukesh Tiwari',
  'Divya Menon',
  'Sanjay Lokhande',
  'Archana Sathe',
  'Bhavesh Parikh',
  'Leena Dixit',
  'Kunal Wagh',
  'Payal Saxena',
  'Girish Kale',
  'Madhuri Apte',
  'Yogesh Raut',
];
export const teachers: DTeacher[] = teacherNames.map((fullName, i) => ({
  id: `t${i + 1}`,
  teacherCode: `TCH-${pad(i + 1, 6)}`,
  staffId: `EMP-${100 + i}`,
  fullName,
  mobile: `9${between(100000000, 899999999)}`,
  email: `${fullName.split(' ')[0]!.toLowerCase()}@jms.example`,
  gender: i % 3 === 1 ? 'MALE' : 'FEMALE',
  qualification: pick(['B.Ed', 'M.Sc, B.Ed', 'M.A, B.Ed', 'B.Sc, B.Ed', 'M.Com, B.Ed']),
  joiningDate: `${between(2008, 2024)}-06-${pad(between(1, 28), 2)}`,
  status: 'ACTIVE' as const,
}));
teachers[39]!.status = 'INACTIVE';

// 38 divisions, 38 class teachers (a teacher can hold several divisions; here one each, two share)
export const assignments: DAssignment[] = divisions
  .filter((_, i) => i !== 7 && i !== 19)
  .map((d, i) => ({
    id: `as${i + 1}`,
    academicYearId: YEAR_ID,
    classId: d.classId,
    divisionId: d.id,
    teacherId: `t${(i % 38) + 1}`,
    role: 'CLASS_TEACHER' as const,
    effectiveFrom: '2026-04-01',
    effectiveTo: null,
    isCurrent: true,
  }));

/* ------------------------------ students ------------------------------ */

export const students: DStudent[] = [];
const divisionCounts = new Map<string, number>();
let serial = 0;
for (const d of divisions) {
  const classNo = Number(d.classId.slice(1));
  const count = between(44, 53);
  divisionCounts.set(d.id, count);
  for (let k = 0; k < count; k++) {
    serial++;
    const male = rnd() < 0.52;
    const first = pick(male ? MALE : FEMALE);
    const last = pick(SURNAME);
    const r = rnd();
    const categoryCode =
      r < 0.72 ? 'GENERAL' : r < 0.82 ? 'RTE' : r < 0.9 ? 'STAFF_WARD' : 'SIBLING';
    const isNew = rnd() < (classNo === 1 ? 0.8 : 0.07);
    const lines = feeStructure(classNo);
    const tuition = lines.find((l) => l.code === 'TUITION')!.amount;
    const concession = Math.round((tuition * (CATEGORY_CONCESSION_BP[categoryCode] ?? 0)) / 10_000);
    const gross = structureTotal(classNo) + (isNew ? ADMISSION_FEE : 0);
    const payable = gross - concession;
    const parts = split(payable, 4);
    const componentTotals = [
      ...lines,
      ...(isNew ? [{ code: 'ADM', label: 'Admission fee', amount: ADMISSION_FEE }] : []),
    ];
    const installments: DInstallment[] = parts.map((amt, i) => ({
      no: i + 1,
      dueDate: INST_DUES[i]!,
      payable: amt,
      paid: 0,
      components: componentTotals
        .map((c) => ({
          label: c.label,
          share: c.code === 'TUITION' ? c.amount - (i === 0 ? concession : 0) : c.amount,
        }))
        .map((c) => ({ label: c.label, amount: Math.round(c.share / 4) }))
        .filter((c) => c.amount > 0),
    }));
    const dobYear = 2026 - (5 + classNo) - (rnd() < 0.5 ? 0 : 1);
    students.push({
      id: `s${serial}`,
      studentId: `STU-${pad(serial, 5)}`,
      admissionNo: `ADM/${isNew ? 26 : between(14, 25)}/${pad(between(1, 2400), 4)}`,
      name: `${first} ${last}`,
      gender: male ? 'MALE' : 'FEMALE',
      dob: `${dobYear}-${pad(between(1, 12), 2)}-${pad(between(1, 28), 2)}`,
      classId: d.classId,
      divisionId: d.id,
      roll: k + 1,
      categoryCode,
      guardian: `${pick(PARENT_M)} ${last}`,
      mobile: `9${between(100000000, 899999999)}`,
      email: `${last.toLowerCase()}${between(1, 99)}@mail.example`,
      address: `${between(1, 240)}, ${pick(AREAS)}, Nagpur`,
      admissionDate: isNew
        ? `2026-0${between(3, 6)}-${pad(between(1, 28), 2)}`
        : `${between(2014, 2025)}-06-${pad(between(1, 28), 2)}`,
      status: 'ACTIVE',
      isNew,
      grossPayable: gross,
      concession,
      installments,
      penalties: [],
      previousDue:
        rnd() < 0.06 ? { year: '2025-26', amount: rupees(between(15, 120) * 100), paid: 0 } : null,
    });
  }
}
// a few students who left, to show inactive / passed-out states
for (const s of students.filter((_, i) => i % 331 === 0)) s.status = 'INACTIVE';

/* ------------------------------ payments ------------------------------ */

export const payments: DPayment[] = [];
const draft: Omit<DPayment, 'receiptNo' | 'id'>[] = [];

function addPayment(
  s: DStudent,
  date: string,
  allocations: { installmentNo: number; amount: number }[],
): void {
  if (date > DEMO_TODAY) date = DEMO_TODAY;
  const method = pick(METHODS);
  draft.push({
    date,
    studentId: s.id,
    amount: allocations.reduce((t, a) => t + a.amount, 0),
    method,
    ...(method === 'Cash'
      ? {}
      : {
          reference:
            method === 'UPI'
              ? `UPI${between(100000000000, 999999999999)}`
              : method === 'Cheque'
                ? `CHQ ${between(100000, 999999)}`
                : `TXN${between(10000000, 99999999)}`,
        }),
    collectedBy: pick(COLLECTORS),
    status: 'POSTED',
    allocations,
  });
}

for (const s of students) {
  const profile = rnd();
  const [i1, i2, i3, i4] = s.installments as [
    DInstallment,
    DInstallment,
    DInstallment,
    DInstallment,
  ];
  const early = (due: string, lo: number, hi: number) => addDaysISO(due, between(lo, hi));
  if (i1.payable === 0) continue;
  if (profile < 0.76) {
    // pays on time; about half already paid the instalment that falls due this week
    if (rnd() < 0.18) {
      addPayment(s, early(i1.dueDate, -8, 6), [
        { installmentNo: 1, amount: i1.payable },
        { installmentNo: 2, amount: i2.payable },
      ]);
    } else {
      addPayment(s, early(i1.dueDate, -8, 12), [{ installmentNo: 1, amount: i1.payable }]);
      addPayment(s, early(i2.dueDate, -10, 14), [{ installmentNo: 2, amount: i2.payable }]);
    }
    const r3 = rnd();
    if (r3 < 0.5)
      addPayment(s, early(i3.dueDate, -12, -1), [{ installmentNo: 3, amount: i3.payable }]);
    else if (r3 < 0.58)
      addPayment(s, early(i3.dueDate, -9, -1), [
        { installmentNo: 3, amount: Math.round((i3.payable * between(30, 70)) / 100) },
      ]);
  } else if (profile < 0.82) {
    addPayment(s, early(i1.dueDate, -5, 15), [{ installmentNo: 1, amount: i1.payable }]);
    addPayment(s, early(i2.dueDate, 2, 30), [
      { installmentNo: 2, amount: Math.round((i2.payable * between(35, 80)) / 100) },
    ]);
  } else if (profile < 0.88) {
    addPayment(s, early(i1.dueDate, 0, 25), [{ installmentNo: 1, amount: i1.payable }]);
  } else if (profile < 0.94) {
    if (rnd() < 0.4)
      addPayment(s, early(i1.dueDate, 10, 50), [
        { installmentNo: 1, amount: Math.round((i1.payable * between(30, 70)) / 100) },
      ]);
  } else {
    addPayment(s, early(i1.dueDate, -10, -2), [
      { installmentNo: 1, amount: i1.payable },
      { installmentNo: 2, amount: i2.payable },
      { installmentNo: 3, amount: i3.payable },
      { installmentNo: 4, amount: i4.payable },
    ]);
  }
}
draft.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
draft.forEach((p, i) => {
  const rec: DPayment = { ...p, id: `p${i + 1}`, receiptNo: `REC-2026-${pad(i + 1, 6)}` };
  payments.push(rec);
});
// a handful of reversals, with the reason that was recorded (the receipt number is never reused)
for (const p of payments.filter((_, i) => i % 211 === 100)) {
  p.status = 'REVERSED';
  p.reversal = {
    reason: pick(['Cheque bounced', 'Entered against the wrong student', 'Duplicate entry']),
    by: 'Anil Kulkarni',
    date: addDaysISO(p.date, between(1, 6)),
  };
}

/** apply the (posted) payments to the instalments, oldest instalment first */
export function applyPayments(): void {
  for (const s of students) for (const i of s.installments) i.paid = 0;
  const byId = new Map(students.map((s) => [s.id, s]));
  for (const p of payments) {
    if (p.status !== 'POSTED') continue;
    const s = byId.get(p.studentId);
    if (!s) continue;
    for (const a of p.allocations) {
      const inst = s.installments[a.installmentNo - 1];
      if (inst) inst.paid += a.amount;
    }
  }
}
applyPayments();

// late fees (separate receivables, BRC-F1) for students with an unpaid second instalment
for (const s of students) {
  const i2 = s.installments[1]!;
  if (i2.paid < i2.payable && s.status === 'ACTIVE' && rnd() < 0.55) {
    s.penalties.push({
      label: 'Late fee — instalment 2',
      dueDate: '2026-08-10',
      amount: rupees(between(2, 6) * 100),
      paid: 0,
    });
    if (rnd() < 0.6)
      s.penalties.push({
        label: 'Late fee — instalment 2 (Sept)',
        dueDate: '2026-09-10',
        amount: rupees(between(2, 6) * 100),
        paid: 0,
      });
  }
}

/* ------------------------------ reminders, adjustments, users, audit ------------------------------ */

export const reminders: DReminder[] = [];
export const adjustments: DAdjustment[] = [];
export const users: DUser[] = [
  {
    id: 'u1',
    name: 'Anil Kulkarni',
    email: 'principal@jms.example',
    roleKey: 'SUPER_ADMIN',
    active: true,
    lastLogin: '2026-10-06 09:12',
  },
  {
    id: 'u2',
    name: 'Rekha Deshmukh',
    email: 'admin@jms.example',
    roleKey: 'ADMIN',
    active: true,
    lastLogin: '2026-10-06 08:40',
  },
  {
    id: 'u3',
    name: 'Sandeep Rao',
    email: 'sandeep@jms.example',
    roleKey: 'FEE_COLLECTOR',
    active: true,
    lastLogin: '2026-10-06 09:05',
  },
  {
    id: 'u4',
    name: 'Meena Joshi',
    email: 'meena@jms.example',
    roleKey: 'FEE_COLLECTOR',
    active: true,
    lastLogin: '2026-10-05 16:22',
  },
  {
    id: 'u5',
    name: 'Pooja Nair',
    email: 'pooja@jms.example',
    roleKey: 'FEE_COLLECTOR',
    active: true,
    lastLogin: '2026-10-06 09:20',
  },
  {
    id: 'u6',
    name: 'Vikas Pande',
    email: 'accounts@jms.example',
    roleKey: 'ACCOUNTANT',
    active: true,
    lastLogin: '2026-10-04 11:02',
  },
  {
    id: 'u7',
    name: 'Shobha Gaikwad',
    email: 'registrar@jms.example',
    roleKey: 'REGISTRAR',
    active: true,
    lastLogin: '2026-10-03 10:31',
  },
  {
    id: 'u8',
    name: 'CA Mohan Lal',
    email: 'audit@jms.example',
    roleKey: 'AUDITOR',
    active: true,
    lastLogin: '2026-09-28 15:00',
  },
  {
    id: 'u9',
    name: 'Former Clerk',
    email: 'clerk@jms.example',
    roleKey: 'FEE_COLLECTOR',
    active: false,
    lastLogin: '2026-06-02 12:10',
  },
];
export const audit: DAudit[] = [];

export const monthKey = (d: string): string => d.slice(0, 7);

export function instStatus(i: DInstallment, today = DEMO_TODAY): InstStatus {
  if (i.paid >= i.payable) return 'PAID';
  if (i.dueDate < today) return 'OVERDUE';
  if (i.paid > 0) return 'PARTIAL';
  if (daysBetween(today, i.dueDate) <= 7) return 'DUE_SOON';
  return 'PENDING';
}

export interface StudentFee {
  payable: number;
  paid: number;
  outstanding: number;
  overdue: number;
  status: FeeStatus;
  /** what had fallen due by today (instalments, late fees, earlier dues) */
  dueToDate: number;
  dueSoon: boolean;
}
export function feeOf(s: DStudent, today = DEMO_TODAY): StudentFee {
  const inst = s.installments;
  const prev = s.previousDue;
  const payable =
    inst.reduce((t, i) => t + i.payable, 0) +
    s.penalties.reduce((t, p) => t + p.amount, 0) +
    (prev?.amount ?? 0);
  const paid =
    inst.reduce((t, i) => t + i.paid, 0) +
    s.penalties.reduce((t, p) => t + p.paid, 0) +
    (prev?.paid ?? 0);
  const overdue =
    inst.filter((i) => i.dueDate < today).reduce((t, i) => t + Math.max(0, i.payable - i.paid), 0) +
    s.penalties.filter((p) => p.dueDate < today).reduce((t, p) => t + (p.amount - p.paid), 0) +
    (prev ? prev.amount - prev.paid : 0);
  const outstanding = payable - paid;
  const dueToDate =
    inst.filter((i) => i.dueDate <= today).reduce((t, i) => t + i.payable, 0) +
    s.penalties.filter((p) => p.dueDate <= today).reduce((t, p) => t + p.amount, 0) +
    (prev?.amount ?? 0);
  // Unpaid = nothing paid at all; Overdue = paid something but a due amount is still open;
  // Partially paid = part of a not-yet-overdue instalment is paid; otherwise paid up to date
  const partialOpen = inst.some((i) => i.paid > 0 && i.paid < i.payable && i.dueDate >= today);
  const status: FeeStatus =
    paid === 0 && outstanding > 0
      ? 'UNPAID'
      : overdue > 0
        ? 'OVERDUE'
        : partialOpen
          ? 'PARTIAL'
          : 'PAID';
  return {
    payable,
    paid,
    outstanding,
    overdue,
    dueToDate,
    status,
    dueSoon: inst.some((i) => instStatus(i, today) === 'DUE_SOON'),
  };
}

const feeCache = new Map<string, StudentFee>();
export function feeFast(s: DStudent): StudentFee {
  let f = feeCache.get(s.id);
  if (!f) {
    f = feeOf(s);
    feeCache.set(s.id, f);
  }
  return f;
}
export const clearFeeCache = (): void => feeCache.clear();

for (const s of students) {
  const f = feeOf(s);
  if (f.overdue > 0 && rnd() < 0.7) {
    const dates = ['2026-07-17', '2026-07-31', '2026-08-14', '2026-10-01'];
    const n = between(1, 3);
    for (let k = 0; k < n; k++) {
      reminders.push({
        id: `r${reminders.length + 1}`,
        studentId: s.id,
        date: dates[k]!,
        type: k === 0 ? 'Overdue reminder' : 'Follow-up reminder',
        channel: pick(['WhatsApp', 'WhatsApp', 'SMS', 'E-mail'] as const),
        message: `Dear Parent, ₹${Math.round(f.overdue / 100).toLocaleString('en-IN')} fee is pending for ${s.name}. Please complete the payment at the earliest.`,
        sentBy: k === 0 ? 'Rekha Deshmukh' : 'System (automatic)',
        status: rnd() < 0.07 ? 'Failed' : 'Delivered',
      });
    }
  }
}
reminders.sort((a, b) => (a.date < b.date ? 1 : -1));

students
  .filter((s) => s.concession > 0)
  .slice(0, 80)
  .forEach((s, i) => {
    adjustments.push({
      id: `adj${i + 1}`,
      studentId: s.id,
      type:
        s.categoryCode === 'RTE'
          ? 'Waiver'
          : s.categoryCode === 'SIBLING'
            ? 'Discount'
            : 'Concession',
      amount: s.concession,
      reason:
        s.categoryCode === 'RTE'
          ? 'RTE free seat — tuition waived'
          : s.categoryCode === 'STAFF_WARD'
            ? 'Staff ward — 50% tuition concession'
            : 'Sibling concession — 10% on tuition',
      approvedBy: 'Anil Kulkarni',
      date: s.admissionDate > '2026-04-01' ? s.admissionDate : '2026-04-02',
      status: 'APPROVED',
    });
  });
students
  .slice(5, 600)
  .filter((_, i) => i % 61 === 0)
  .forEach((s, i) => {
    adjustments.push({
      id: `adjm${i + 1}`,
      studentId: s.id,
      type: pick(['Scholarship', 'Discount', 'Waiver'] as const),
      amount: rupees(between(5, 30) * 100),
      reason: pick([
        'Merit scholarship',
        'Financial hardship — principal approval',
        'Sports quota',
      ]),
      approvedBy: i % 3 === 0 ? null : 'Anil Kulkarni',
      date: `2026-0${between(6, 9)}-${pad(between(1, 28), 2)}`,
      status: i % 3 === 0 ? 'PENDING' : 'APPROVED',
    });
  });

const by = new Map(students.map((s) => [s.id, s]));
payments
  .slice(-40)
  .reverse()
  .forEach((p, i) => {
    const s = by.get(p.studentId)!;
    audit.push({
      id: `au${i + 1}`,
      at: `${p.date} ${pad(between(9, 16), 2)}:${pad(between(0, 59), 2)}`,
      user: p.collectedBy,
      action: p.status === 'REVERSED' ? 'PAYMENT_REVERSED' : 'PAYMENT_POSTED',
      entity: p.receiptNo,
      detail: `${s.name} · ₹${Math.round(p.amount / 100).toLocaleString('en-IN')} · ${p.method}`,
    });
  });
[
  [
    '2026-10-05 17:02',
    'Rekha Deshmukh',
    'REMINDER_SENT',
    'Class 8',
    '212 reminders queued (WhatsApp)',
  ],
  [
    '2026-10-04 12:10',
    'Anil Kulkarni',
    'ADJUSTMENT_APPROVED',
    'Scholarship',
    'Merit scholarship approved',
  ],
  [
    '2026-10-03 10:45',
    'Shobha Gaikwad',
    'STUDENT_CREATED',
    'STU-01851',
    'New admission, Class 4-B',
  ],
  [
    '2026-09-30 16:20',
    'Rekha Deshmukh',
    'SETTING_CHANGED',
    'late fee rule',
    'Fixed late fee ₹200 → ₹300 (reason: board decision)',
  ],
  [
    '2026-09-28 11:00',
    'Anil Kulkarni',
    'FEE_STRUCTURE_PUBLISHED',
    'Class 10 · 2026-27',
    'Version 2 published',
  ],
  [
    '2026-09-20 09:30',
    'Rekha Deshmukh',
    'TEACHER_CHANGED',
    'Class 6-B',
    'Class teacher changed (reason: transferred)',
  ],
].forEach(([at, user, action, entity, detail], i) =>
  audit.unshift({
    id: `aum${i}`,
    at: at!,
    user: user!,
    action: action!,
    entity: entity!,
    detail: detail!,
  }),
);
audit.sort((a, b) => (a.at < b.at ? 1 : -1));

export const roleLabels = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.key, r.name])) as Record<
  string,
  string
>;
