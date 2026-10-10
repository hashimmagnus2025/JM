/** MOCK endpoints for every screen that has no backend yet. Shapes follow the API contract in each features folder (api.ts). */
import { SYSTEM_ROLES } from '@sfm/shared';
import {
  DEMO_TODAY,
  adjustments,
  assignments,
  audit,
  categories,
  classes,
  daysBetween,
  divisions,
  feeFast,
  feeStructure,
  instStatus,
  payments,
  reminders,
  roleLabels,
  structureTotal,
  students,
  teachers,
  users,
  CATEGORY_CONCESSION_BP,
  ADMISSION_FEE,
  type DPayment,
  type DStudent,
} from './data';
import {
  allocate,
  approve,
  audience,
  className,
  classLabel,
  createStudent,
  divisionName,
  feePreview,
  postPayment,
  promote,
  queueReminders,
  reverse,
  studentById,
  type NewStudentBody,
  type Segment,
} from './logic';
import { fail, ok, personFor, type Handler, type Out } from './setupRoutes';
import { useMockRole } from './role';
import {
  AGING_BUCKETS,
  activeStudents,
  aging,
  classRows,
  collectionBetween,
  divisionRows,
  methodSplit,
  monthly,
  statusCounts,
  sumOf,
  topOverdue,
  upcomingDue,
} from './stats';

const actor = (): string => personFor(useMockRole.getState().role).name;
const num = (v: string | null, d: number): number =>
  v && Number.isFinite(Number(v)) ? Number(v) : d;
function paged<T>(list: T[], q: URLSearchParams, extra: Record<string, unknown> = {}): Out {
  const page = Math.max(1, num(q.get('page'), 1));
  const size = Math.min(200, Math.max(1, num(q.get('pageSize'), 15)));
  return {
    data: list.slice((page - 1) * size, page * size),
    meta: { total: list.length, ...extra },
  };
}

const studentRow = (s: DStudent) => {
  const f = feeFast(s);
  return {
    id: s.id,
    studentId: s.studentId,
    admissionNo: s.admissionNo,
    name: s.name,
    classId: s.classId,
    divisionId: s.divisionId,
    classLabel: classLabel(s),
    guardian: s.guardian,
    mobile: s.mobile,
    categoryName: categories.find((c) => c.code === s.categoryCode)?.name ?? s.categoryCode,
    status: s.status,
    feeStatus: f.status,
    outstanding: f.outstanding,
    roll: s.roll,
  };
};

const paymentRow = (p: DPayment) => {
  const s = studentById(p.studentId)!;
  return {
    id: p.id,
    receiptNo: p.receiptNo,
    date: p.date,
    studentId: p.studentId,
    studentName: s.name,
    studentCode: s.studentId,
    classLabel: classLabel(s),
    amount: p.amount,
    method: p.method,
    ...(p.reference ? { reference: p.reference } : {}),
    collectedBy: p.collectedBy,
    status: p.status,
    ...(p.reversal ? { reversal: p.reversal } : {}),
  };
};

function receipt(p: DPayment) {
  const s = studentById(p.studentId)!;
  const later = payments
    .filter((x) => x.studentId === s.id && x.status === 'POSTED' && x.receiptNo > p.receiptNo)
    .reduce((t, x) => t + x.amount, 0);
  const after = feeFast(s).outstanding + later;
  return {
    ...paymentRow(p),
    academicYear: '2026-27',
    lines: p.allocations.map((a) => ({
      installmentNo: a.installmentNo,
      dueDate: s.installments[a.installmentNo - 1]?.dueDate ?? '',
      amount: a.amount,
    })),
    previousBalance: after + (p.status === 'POSTED' ? p.amount : 0),
    remainingBalance: after,
  };
}

function profile(s: DStudent) {
  const f = feeFast(s);
  const n = Number(s.classId.slice(1));
  const prev = s.previousDue;
  const history = [
    {
      year: '2026-27',
      classLabel: classLabel(s),
      outcome: 'Current' as const,
      payable: f.payable,
      paid: f.paid,
    },
    ...Array.from({ length: Math.min(n - 1, 3) }, (_, i) => {
      const pay = structureTotal(n - 1 - i);
      const carried = i === 0 && prev ? prev.amount - prev.paid : 0;
      return {
        year: `${2025 - i}-${String((26 - i) % 100).padStart(2, '0')}`,
        classLabel: `${n - 1 - i}-${divisionName(s.divisionId)}`,
        outcome: 'Promoted' as const,
        payable: pay,
        paid: pay - carried,
      };
    }),
  ];
  return {
    id: s.id,
    studentId: s.studentId,
    admissionNo: s.admissionNo,
    name: s.name,
    gender: s.gender,
    dob: s.dob,
    address: s.address,
    admissionDate: s.admissionDate,
    status: s.status,
    classId: s.classId,
    className: className(s.classId),
    divisionName: divisionName(s.divisionId),
    classLabel: classLabel(s),
    roll: s.roll,
    categoryName: categories.find((c) => c.code === s.categoryCode)?.name ?? s.categoryCode,
    concession: s.concession,
    guardian: { name: s.guardian, mobile: s.mobile, email: s.email },
    fee: {
      payable: f.payable,
      paid: f.paid,
      outstanding: f.outstanding,
      overdue: f.overdue,
      status: f.status,
      dueSoon: f.dueSoon,
    },
    installments: s.installments.map((i) => ({
      ...i,
      pending: i.payable - i.paid,
      status: instStatus(i),
    })),
    otherReceivables: [
      ...s.penalties.map((p) => ({
        label: p.label,
        dueDate: p.dueDate,
        amount: p.amount,
        paid: p.paid,
      })),
      ...(prev
        ? [
            {
              label: `Balance from ${prev.year}`,
              dueDate: '2026-03-31',
              amount: prev.amount,
              paid: prev.paid,
            },
          ]
        : []),
    ],
    history,
    payments: payments
      .filter((p) => p.studentId === s.id)
      .sort((a, b) => (a.receiptNo < b.receiptNo ? 1 : -1))
      .map(paymentRow),
    reminders: reminders.filter((r) => r.studentId === s.id).map(reminderRow),
    adjustments: adjustments.filter((a) => a.studentId === s.id).map(adjustmentRow),
  };
}

const reminderRow = (r: (typeof reminders)[number]) => {
  const s = studentById(r.studentId)!;
  return {
    id: r.id,
    date: r.date,
    studentId: r.studentId,
    studentName: s.name,
    classLabel: classLabel(s),
    type: r.type,
    channel: r.channel,
    message: r.message,
    sentBy: r.sentBy,
    status: r.status,
  };
};
const adjustmentRow = (a: (typeof adjustments)[number]) => {
  const s = studentById(a.studentId)!;
  return {
    id: a.id,
    studentId: a.studentId,
    studentName: s.name,
    classLabel: classLabel(s),
    type: a.type,
    amount: a.amount,
    reason: a.reason,
    approvedBy: a.approvedBy,
    date: a.date,
    status: a.status,
  };
};

/* rules the user can switch on/off; recipients follow the instalment that falls due on 10 Oct */
const rules = [
  {
    id: 'rule1',
    label: '7 days before the due date',
    when: '7 days before',
    type: 'Reminder',
    channel: 'WhatsApp',
    enabled: true,
  },
  {
    id: 'rule2',
    label: '1 day before the due date',
    when: '1 day before',
    type: 'Reminder',
    channel: 'WhatsApp',
    enabled: true,
  },
  {
    id: 'rule3',
    label: 'On the due date',
    when: 'On the day',
    type: 'Reminder',
    channel: 'SMS',
    enabled: true,
  },
  {
    id: 'rule4',
    label: '3 days after the due date',
    when: '3 days after',
    type: 'Overdue reminder',
    channel: 'WhatsApp',
    enabled: true,
  },
  {
    id: 'rule5',
    label: '7 days after the due date',
    when: '7 days after',
    type: 'Follow-up reminder',
    channel: 'E-mail',
    enabled: false,
  },
];

const bucketOf = (days: number): string =>
  days <= 0
    ? ''
    : days <= 30
      ? AGING_BUCKETS[0]
      : days <= 60
        ? AGING_BUCKETS[1]
        : days <= 90
          ? AGING_BUCKETS[2]
          : AGING_BUCKETS[3];

function oldestDue(s: DStudent): string | null {
  const dues = [
    ...s.installments
      .filter((i) => i.paid < i.payable && i.dueDate < DEMO_TODAY)
      .map((i) => i.dueDate),
    ...s.penalties.filter((p) => p.paid < p.amount && p.dueDate < DEMO_TODAY).map((p) => p.dueDate),
    ...(s.previousDue && s.previousDue.paid < s.previousDue.amount ? ['2026-03-31'] : []),
  ].sort();
  return dues[0] ?? null;
}

const agingArr = (list: DStudent[]) =>
  aging(list).map((amount, i) => ({ bucket: AGING_BUCKETS[i]!, amount }));

/* ------------------------------ reports ------------------------------ */

type Row = Record<string, string | number | null>;
interface Rep {
  key: string;
  group: string;
  title: string;
  description: string;
  build: (q: URLSearchParams) => {
    columns: { key: string; header: string; type: 'text' | 'money' | 'number' | 'date' }[];
    rows: Row[];
    totals?: Record<string, string | number>;
  };
}
const money = (key: string, header: string) => ({ key, header, type: 'money' as const });
const text = (key: string, header: string) => ({ key, header, type: 'text' as const });
const numc = (key: string, header: string) => ({ key, header, type: 'number' as const });
const datec = (key: string, header: string) => ({ key, header, type: 'date' as const });
const sumCols = (rows: Row[], keys: string[]): Record<string, number> =>
  Object.fromEntries(keys.map((k) => [k, rows.reduce((t, r) => t + Number(r[k] ?? 0), 0)]));

const REPORTS: Rep[] = [
  {
    key: 'student-wise',
    group: 'Fees',
    title: 'Student-wise fee report',
    description: 'Payable, paid and outstanding for every student.',
    build: (q) => {
      const rows = activeStudents()
        .filter((s) => !q.get('classId') || s.classId === q.get('classId'))
        .slice(0, 300)
        .map((s) => {
          const f = feeFast(s);
          return {
            student: s.name,
            id: s.studentId,
            class: classLabel(s),
            payable: f.payable,
            paid: f.paid,
            outstanding: f.outstanding,
          } as Row;
        });
      return {
        columns: [
          text('student', 'Student'),
          text('id', 'ID'),
          text('class', 'Class'),
          money('payable', 'Payable'),
          money('paid', 'Paid'),
          money('outstanding', 'Outstanding'),
        ],
        rows,
        totals: sumCols(rows, ['payable', 'paid', 'outstanding']),
      };
    },
  },
  {
    key: 'class-wise',
    group: 'Fees',
    title: 'Class-wise fee report',
    description: 'Expected, collected and outstanding per class.',
    build: () => {
      const rows = classRows().map(
        (r) =>
          ({
            class: r.name,
            divisions: r.divisions,
            students: r.students,
            expected: r.expected,
            collected: r.collected,
            outstanding: r.outstanding,
            pct: `${r.pct}%`,
          }) as Row,
      );
      return {
        columns: [
          text('class', 'Class'),
          numc('divisions', 'Divisions'),
          numc('students', 'Students'),
          money('expected', 'Expected'),
          money('collected', 'Collected'),
          money('outstanding', 'Outstanding'),
          text('pct', 'Collection'),
        ],
        rows,
        totals: sumCols(rows, ['students', 'expected', 'collected', 'outstanding']),
      };
    },
  },
  {
    key: 'division-wise',
    group: 'Fees',
    title: 'Division-wise fee report',
    description: 'Collection performance of each division.',
    build: (q) => {
      const cid = q.get('classId') || 'c10';
      const rows = divisionRows(cid).map(
        (r) =>
          ({
            class: className(cid),
            division: r.name,
            students: r.students,
            expected: r.expected,
            collected: r.collected,
            outstanding: r.outstanding,
            pct: `${r.pct}%`,
          }) as Row,
      );
      return {
        columns: [
          text('class', 'Class'),
          text('division', 'Division'),
          numc('students', 'Students'),
          money('expected', 'Expected'),
          money('collected', 'Collected'),
          money('outstanding', 'Outstanding'),
          text('pct', 'Collection'),
        ],
        rows,
        totals: sumCols(rows, ['students', 'expected', 'collected', 'outstanding']),
      };
    },
  },
  {
    key: 'academic-year',
    group: 'Fees',
    title: 'Academic-year report',
    description: 'Annual fee performance, year by year.',
    build: () => {
      const t = sumOf(activeStudents());
      const rows: Row[] = [
        {
          year: '2024-25',
          expected: Math.round(t.expected * 0.86),
          collected: Math.round(t.expected * 0.86 * 0.97),
          outstanding: Math.round(t.expected * 0.86 * 0.03),
        },
        {
          year: '2025-26',
          expected: Math.round(t.expected * 0.93),
          collected: Math.round(t.expected * 0.93 * 0.95),
          outstanding: Math.round(t.expected * 0.93 * 0.05),
        },
        {
          year: '2026-27 (running)',
          expected: t.expected,
          collected: t.collected,
          outstanding: t.outstanding,
        },
      ];
      return {
        columns: [
          text('year', 'Academic year'),
          money('expected', 'Expected'),
          money('collected', 'Collected'),
          money('outstanding', 'Outstanding'),
        ],
        rows,
      };
    },
  },
  {
    key: 'date-wise',
    group: 'Collection',
    title: 'Date-wise collection',
    description: 'What was collected on each day.',
    build: (q) => {
      const from = q.get('from') || '2026-09-06';
      const to = q.get('to') || DEMO_TODAY;
      const by = new Map<string, { n: number; amount: number }>();
      for (const p of payments)
        if (p.status === 'POSTED' && p.date >= from && p.date <= to) {
          const e = by.get(p.date) ?? { n: 0, amount: 0 };
          e.n++;
          e.amount += p.amount;
          by.set(p.date, e);
        }
      const rows = [...by.entries()]
        .sort()
        .map(([date, v]) => ({ date, receipts: v.n, amount: v.amount }) as Row);
      return {
        columns: [
          datec('date', 'Date'),
          numc('receipts', 'Receipts'),
          money('amount', 'Collected'),
        ],
        rows,
        totals: sumCols(rows, ['receipts', 'amount']),
      };
    },
  },
  {
    key: 'installment',
    group: 'Fees',
    title: 'Instalment report',
    description: 'Payment status of each instalment.',
    build: () => {
      const rows: Row[] = [1, 2, 3, 4].map((no) => {
        const l = activeStudents().map((s) => s.installments[no - 1]!);
        return {
          instalment: `Instalment ${no}`,
          due: l[0]!.dueDate,
          payable: l.reduce((t, i) => t + i.payable, 0),
          paid: l.reduce((t, i) => t + i.paid, 0),
          pending: l.reduce((t, i) => t + (i.payable - i.paid), 0),
          unpaid: l.filter((i) => i.paid < i.payable).length,
        };
      });
      return {
        columns: [
          text('instalment', 'Instalment'),
          datec('due', 'Due date'),
          money('payable', 'Payable'),
          money('paid', 'Paid'),
          money('pending', 'Pending'),
          numc('unpaid', 'Students not settled'),
        ],
        rows,
        totals: sumCols(rows, ['payable', 'paid', 'pending']),
      };
    },
  },
  {
    key: 'outstanding',
    group: 'Receivables',
    title: 'Outstanding report',
    description: 'All pending fees, largest first.',
    build: (q) => {
      const rows = activeStudents()
        .filter((s) => !q.get('classId') || s.classId === q.get('classId'))
        .map((s) => ({ s, f: feeFast(s) }))
        .filter((x) => x.f.outstanding > 0)
        .sort((a, b) => b.f.outstanding - a.f.outstanding)
        .slice(0, 300)
        .map(
          ({ s, f }) =>
            ({
              student: s.name,
              class: classLabel(s),
              parent: s.guardian,
              outstanding: f.outstanding,
              overdue: f.overdue,
            }) as Row,
        );
      return {
        columns: [
          text('student', 'Student'),
          text('class', 'Class'),
          text('parent', 'Parent'),
          money('outstanding', 'Outstanding'),
          money('overdue', 'Overdue'),
        ],
        rows,
        totals: sumCols(rows, ['outstanding', 'overdue']),
      };
    },
  },
  {
    key: 'overdue',
    group: 'Receivables',
    title: 'Overdue report',
    description: 'Students with fees past their due date.',
    build: (q) => {
      const rows = topOverdue(300)
        .filter(({ s }) => !q.get('classId') || s.classId === q.get('classId'))
        .map(
          ({ s, f }) =>
            ({
              student: s.name,
              class: classLabel(s),
              mobile: s.mobile,
              since: oldestDue(s),
              overdue: f.overdue,
            }) as Row,
        );
      return {
        columns: [
          text('student', 'Student'),
          text('class', 'Class'),
          text('mobile', 'Mobile'),
          datec('since', 'Overdue since'),
          money('overdue', 'Overdue'),
        ],
        rows,
        totals: sumCols(rows, ['overdue']),
      };
    },
  },
  {
    key: 'aging',
    group: 'Receivables',
    title: 'Aging report',
    description: 'Overdue amounts by how long they have been due.',
    build: () => {
      const rows = agingArr(activeStudents()).map(
        (a) => ({ bucket: a.bucket, amount: a.amount }) as Row,
      );
      return {
        columns: [text('bucket', 'Overdue for'), money('amount', 'Amount')],
        rows,
        totals: sumCols(rows, ['amount']),
      };
    },
  },
  {
    key: 'payment-method',
    group: 'Collection',
    title: 'Payment-method report',
    description: 'Collection by cash, UPI, bank, cheque and card.',
    build: () => {
      const rows = methodSplit().map(
        (m) =>
          ({
            method: m.method,
            receipts: payments.filter((p) => p.status === 'POSTED' && p.method === m.method).length,
            amount: m.amount,
          }) as Row,
      );
      return {
        columns: [
          text('method', 'Method'),
          numc('receipts', 'Receipts'),
          money('amount', 'Collected'),
        ],
        rows,
        totals: sumCols(rows, ['receipts', 'amount']),
      };
    },
  },
  {
    key: 'collection-staff',
    group: 'Collection',
    title: 'Collection by staff',
    description: 'Who collected how much.',
    build: () => {
      const by = new Map<string, { n: number; amount: number }>();
      for (const p of payments)
        if (p.status === 'POSTED') {
          const e = by.get(p.collectedBy) ?? { n: 0, amount: 0 };
          e.n++;
          e.amount += p.amount;
          by.set(p.collectedBy, e);
        }
      const rows = [...by.entries()].map(
        ([staff, v]) => ({ staff, receipts: v.n, amount: v.amount }) as Row,
      );
      return {
        columns: [
          text('staff', 'Staff member'),
          numc('receipts', 'Receipts'),
          money('amount', 'Collected'),
        ],
        rows,
        totals: sumCols(rows, ['receipts', 'amount']),
      };
    },
  },
  {
    key: 'reminders',
    group: 'Receivables',
    title: 'Reminder report',
    description: 'Reminder activity and delivery.',
    build: () => {
      const groups = new Map<string, number>();
      for (const r of reminders)
        groups.set(`${r.channel}|${r.status}`, (groups.get(`${r.channel}|${r.status}`) ?? 0) + 1);
      const rows = [...groups.entries()].map(([k, n]) => {
        const [channel, status] = k.split('|');
        return { channel: channel!, status: status!, count: n } as Row;
      });
      return {
        columns: [
          text('channel', 'Channel'),
          text('status', 'Delivery'),
          numc('count', 'Reminders'),
        ],
        rows,
        totals: sumCols(rows, ['count']),
      };
    },
  },
  {
    key: 'discounts',
    group: 'Fees',
    title: 'Discount & concession report',
    description: 'Fee reductions and who approved them.',
    build: () => {
      const rows = adjustments.map(
        (a) =>
          ({
            student: studentById(a.studentId)!.name,
            type: a.type,
            reason: a.reason,
            approvedBy: a.approvedBy ?? 'Waiting',
            amount: a.amount,
          }) as Row,
      );
      return {
        columns: [
          text('student', 'Student'),
          text('type', 'Type'),
          text('reason', 'Reason'),
          text('approvedBy', 'Approved by'),
          money('amount', 'Amount'),
        ],
        rows,
        totals: sumCols(rows, ['amount']),
      };
    },
  },
];

/* ------------------------------ route table ------------------------------ */

const need = (v: unknown, msg: string): Out | null =>
  v ? null : fail(400, 'VALIDATION_ERROR', msg);

export const feeRoutes: [string, RegExp, Handler][] = [
  /* dashboard */
  [
    'GET',
    /^\/dashboard$/,
    () => {
      const act = activeStudents();
      const total = sumOf(act);
      const counts = statusCounts(act);
      const m = monthly();
      const month = DEMO_TODAY.slice(0, 7);
      const target = m.filter((x) => !x.future).reduce((t, x) => t + x.target, 0);
      const done = m.reduce((t, x) => t + x.actual, 0);
      return ok({
        asOf: DEMO_TODAY,
        yearLabel: '2026-27',
        academic: {
          classes: classes.length,
          divisions: divisions.filter((d) => d.isActive).length,
          students: act.length,
          teachers: teachers.filter((t) => t.status === 'ACTIVE').length,
          receipts: payments.length,
          unassignedDivisions: divisions.filter(
            (d) => d.isActive && !assignments.some((a) => a.divisionId === d.id && a.isCurrent),
          ).length,
        },
        fees: {
          expected: total.expected,
          collected: total.collected,
          outstanding: total.outstanding,
          overdue: total.overdue,
          today: collectionBetween(DEMO_TODAY, DEMO_TODAY),
          month: collectionBetween(`${month}-01`, `${month}-31`),
          upcoming30: upcomingDue(30),
          targetPct: target ? Math.round((done / target) * 100) : 0,
          collectionPct: total.pct,
          target,
        },
        monthly: m,
        status: counts,
        classes: classRows(),
        aging: agingArr(act),
        methods: methodSplit(),
        topOverdue: topOverdue(8).map(({ s, f }) => ({
          id: s.id,
          name: s.name,
          classLabel: classLabel(s),
          guardian: s.guardian,
          status: f.status,
          overdue: f.overdue,
        })),
      });
    },
  ],

  /* students */
  [
    'GET',
    /^\/students\/fee-preview$/,
    ({ query }) =>
      ok(
        feePreview(
          query.get('classId') ?? 'c1',
          query.get('categoryCode') ?? 'GENERAL',
          num(query.get('openingBalance'), 0),
        ),
      ),
  ],
  [
    'GET',
    /^\/students\/(\w+)\/allocation-preview$/,
    ({ params, query }) => {
      const s = studentById(params[0]!);
      return s
        ? ok(allocate(s, num(query.get('amount'), 0)))
        : fail(404, 'STUDENT_NOT_FOUND', 'Student not found.');
    },
  ],
  [
    'GET',
    /^\/students$/,
    ({ query }) => {
      const n = (query.get('q') ?? '').trim().toLowerCase();
      const st = query.get('status') ?? 'ACTIVE';
      const fee = query.get('feeStatus');
      const list = students
        .filter((s) => st === 'ALL' || s.status === st)
        .filter((s) => !query.get('classId') || s.classId === query.get('classId'))
        .filter((s) => !query.get('divisionId') || s.divisionId === query.get('divisionId'))
        .filter((s) => !query.get('categoryCode') || s.categoryCode === query.get('categoryCode'))
        .filter(
          (s) =>
            !n ||
            [s.name, s.studentId, s.admissionNo, s.guardian, s.mobile].some((v) =>
              v.toLowerCase().includes(n),
            ),
        )
        .filter((s) => {
          if (!fee) return true;
          const f = feeFast(s);
          return fee === 'DUE_SOON' ? f.dueSoon && f.outstanding > 0 : f.status === fee;
        })
        .map(studentRow);
      return paged(list, query);
    },
  ],
  [
    'POST',
    /^\/students$/,
    ({ body }) => {
      const b = body as NewStudentBody;
      const d = divisions.find((x) => x.id === b.divisionId);
      if (!d || d.classId !== b.classId)
        return fail(400, 'VALIDATION_ERROR', 'Choose a division of that class.');
      if (
        d.capacity &&
        students.filter((s) => s.divisionId === d.id && s.status === 'ACTIVE').length >= d.capacity
      )
        return fail(
          409,
          'DIVISION_FULL',
          `${className(d.classId)} ${d.name} is full (${d.capacity} seats). Choose another division.`,
        );
      const s = createStudent(b, actor());
      return ok({ id: s.id, studentId: s.studentId, name: s.name }, 201);
    },
  ],
  [
    'GET',
    /^\/students\/(\w+)$/,
    ({ params }) => {
      const s = studentById(params[0]!);
      return s ? ok(profile(s)) : fail(404, 'STUDENT_NOT_FOUND', 'Student not found.');
    },
  ],
  [
    'POST',
    /^\/promotions$/,
    ({ body }) => {
      const b = body as { studentIds: string[]; toClassId: string; toDivisionId: string };
      const bad = need(
        b.studentIds?.length && b.toClassId && b.toDivisionId,
        'Choose the students and where they move to.',
      );
      return bad ?? ok({ promoted: promote(b.studentIds, b.toClassId, b.toDivisionId, actor()) });
    },
  ],

  /* fee structures */
  [
    'GET',
    /^\/fee-structures$/,
    ({ query }) => {
      const years = [
        { id: '2026-27', label: '2026-27' },
        { id: '2025-26', label: '2025-26' },
        { id: '2027-28', label: '2027-28' },
      ];
      const year = query.get('year') ?? '2026-27';
      const classId = query.get('classId') ?? 'c10';
      const factor = year === '2025-26' ? 0.92 : year === '2027-28' ? 1.06 : 1;
      const lines = feeStructure(Number(classId.slice(1))).map((l) => ({
        ...l,
        amount: Math.round((l.amount * factor) / 100) * 100,
      }));
      const total = lines.reduce((t, l) => t + l.amount, 0);
      const tuition = lines.find((l) => l.code === 'TUITION')!.amount;
      const yr = Number(year.slice(0, 4));
      return ok({
        years,
        year,
        classId,
        className: className(classId),
        status:
          year === '2026-27' ? 'Published' : year === '2027-28' ? 'Draft' : 'Locked (year closed)',
        version: year === '2026-27' ? 2 : 1,
        studentCount: students.filter((s) => s.classId === classId && s.status === 'ACTIVE').length,
        lines,
        total,
        admissionFee: ADMISSION_FEE,
        categoryRates: categories.map((c) => {
          const bp = CATEGORY_CONCESSION_BP[c.code] ?? 0;
          return {
            code: c.code,
            name: c.name,
            concessionPct: bp / 100,
            total: total - Math.round((tuition * bp) / 10_000),
          };
        }),
        instalments: [`${yr}-04-10`, `${yr}-07-10`, `${yr}-10-10`, `${yr + 1}-01-10`].map(
          (dueDate, i) => ({
            no: i + 1,
            dueDate,
            amount:
              i === 3 ? total - Math.floor(total / 400) * 100 * 3 : Math.floor(total / 400) * 100,
          }),
        ),
      });
    },
  ],

  /* payments */
  [
    'GET',
    /^\/payments$/,
    ({ query }) => {
      const n = (query.get('q') ?? '').trim().toLowerCase();
      const list = [...payments].reverse().filter((p) => {
        if (query.get('method') && p.method !== query.get('method')) return false;
        if (query.get('status') && p.status !== query.get('status')) return false;
        if (query.get('from') && p.date < query.get('from')!) return false;
        if (query.get('to') && p.date > query.get('to')!) return false;
        if (!n) return true;
        const s = studentById(p.studentId)!;
        return [p.receiptNo, p.reference ?? '', s.name, s.studentId].some((v) =>
          v.toLowerCase().includes(n),
        );
      });
      return paged(list.map(paymentRow), query, {
        collected: list.filter((p) => p.status === 'POSTED').reduce((t, p) => t + p.amount, 0),
      });
    },
  ],
  [
    'POST',
    /^\/payments\/(\w+)\/reverse$/,
    ({ params, body }) => {
      const p = payments.find((x) => x.id === params[0]);
      if (!p) return fail(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
      if (p.status === 'REVERSED')
        return fail(409, 'ALREADY_REVERSED', 'This payment is already reversed.');
      const reason = String((body as { reason?: string }).reason ?? '').trim();
      if (reason.length < 5)
        return fail(400, 'VALIDATION_ERROR', 'Give a reason of at least 5 characters.');
      reverse(p, reason, actor());
      return ok(paymentRow(p));
    },
  ],
  [
    'GET',
    /^\/payments\/(\w+)$/,
    ({ params }) => {
      const p = payments.find((x) => x.id === params[0]);
      return p ? ok(receipt(p)) : fail(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
    },
  ],
  [
    'POST',
    /^\/payments$/,
    ({ body, headers }) => {
      const b = body as {
        studentId: string;
        amount: number;
        method: DPayment['method'];
        reference?: string;
      };
      const s = studentById(b.studentId);
      if (!s) return fail(404, 'STUDENT_NOT_FOUND', 'Student not found.');
      if (!Number.isSafeInteger(b.amount) || b.amount <= 0)
        return fail(400, 'VALIDATION_ERROR', 'Enter the amount received.');
      const f = feeFast(s);
      if (b.amount > f.outstanding)
        return fail(
          422,
          'PAYMENT_EXCEEDS_OUTSTANDING',
          `The amount is more than the ₹${Math.round(f.outstanding / 100).toLocaleString('en-IN')} outstanding. Advance payments are switched off in Settings.`,
        );
      if (b.method !== 'Cash' && !b.reference?.trim())
        return fail(400, 'VALIDATION_ERROR', 'Enter the transaction reference.');
      if (
        b.reference &&
        payments.some(
          (p) =>
            p.status === 'POSTED' && p.method === b.method && p.reference === b.reference?.trim(),
        )
      )
        return fail(
          409,
          'DUPLICATE_REFERENCE',
          'This reference number was already used for another payment.',
        );
      const key = headers['idempotency-key'] ?? `${s.id}-${b.amount}-${Date.now()}`;
      return ok(
        receipt(postPayment(s, b.amount, b.method, b.reference?.trim() || undefined, actor(), key)),
        201,
      );
    },
  ],

  /* adjustments */
  ['GET', /^\/adjustments$/, () => ok(adjustments.map(adjustmentRow))],
  [
    'POST',
    /^\/adjustments\/(\w+)\/approve$/,
    ({ params }) => {
      const a = approve(params[0]!, actor());
      return a ? ok(adjustmentRow(a)) : fail(404, 'NOT_FOUND', 'Adjustment not found.');
    },
  ],

  /* outstanding */
  [
    'GET',
    /^\/outstanding$/,
    ({ query }) => {
      const n = (query.get('q') ?? '').trim().toLowerCase();
      const bucket = query.get('bucket');
      const base = activeStudents()
        .filter((s) => !query.get('classId') || s.classId === query.get('classId'))
        .filter((s) => !query.get('divisionId') || s.divisionId === query.get('divisionId'))
        .filter(
          (s) =>
            !n ||
            [s.name, s.studentId, s.guardian, s.mobile].some((v) => v.toLowerCase().includes(n)),
        );
      const rows = base
        .map((s) => ({ s, f: feeFast(s), due: oldestDue(s) }))
        .filter((x) => (query.get('scope') === 'all' ? x.f.outstanding > 0 : x.f.overdue > 0))
        .filter(
          (x) => !bucket || (x.due ? bucketOf(daysBetween(x.due, DEMO_TODAY)) === bucket : false),
        )
        .sort((a, b) => b.f.outstanding - a.f.outstanding);
      const list = rows.map(({ s, f, due }) => ({
        id: s.id,
        name: s.name,
        studentCode: s.studentId,
        classLabel: classLabel(s),
        guardian: s.guardian,
        mobile: s.mobile,
        oldestDueDate: due,
        daysOverdue: due ? daysBetween(due, DEMO_TODAY) : 0,
        outstanding: f.outstanding,
        overdue: f.overdue,
      }));
      return paged(list, query, {
        totals: {
          students: rows.length,
          outstanding: rows.reduce((t, x) => t + x.f.outstanding, 0),
          overdue: rows.reduce((t, x) => t + x.f.overdue, 0),
        },
        aging: agingArr(rows.map((x) => x.s)),
      });
    },
  ],

  /* reminders */
  ['GET', /^\/reminders\/rules$/, () => ok(rules)],
  [
    'PATCH',
    /^\/reminders\/rules\/(\w+)$/,
    ({ params, body }) => {
      const r = rules.find((x) => x.id === params[0]);
      if (!r) return fail(404, 'NOT_FOUND', 'Rule not found.');
      r.enabled = !!(body as { enabled: boolean }).enabled;
      return ok(r);
    },
  ],
  [
    'GET',
    /^\/reminders\/queue$/,
    () => {
      const pending = activeStudents().filter((s) => {
        const i = s.installments[2]!;
        return i.paid < i.payable;
      }).length;
      const items = [
        { id: 'q1', date: '2026-10-09', time: '10:00', rule: rules[1]!, n: pending },
        { id: 'q2', date: '2026-10-10', time: '09:00', rule: rules[2]!, n: pending },
        {
          id: 'q3',
          date: '2026-10-13',
          time: '10:00',
          rule: rules[3]!,
          n: Math.round(pending * 0.9),
        },
        {
          id: 'q4',
          date: '2026-10-17',
          time: '10:00',
          rule: rules[4]!,
          n: Math.round(pending * 0.8),
        },
      ];
      return ok(
        items
          .filter((x) => x.rule.enabled)
          .map((x) => ({
            id: x.id,
            date: x.date,
            time: x.time,
            rule: x.rule.label,
            channel: x.rule.channel,
            recipients: x.n,
          })),
      );
    },
  ],
  [
    'GET',
    /^\/reminders\/audience$/,
    ({ query }) => {
      const a = audience({
        segment: (query.get('segment') as Segment) ?? 'OVERDUE',
        classId: query.get('classId'),
        divisionId: query.get('divisionId'),
        studentId: query.get('studentId'),
      });
      return ok({ count: a.count, amount: a.amount });
    },
  ],
  [
    'POST',
    /^\/reminders\/send$/,
    ({ body }) => {
      const b = body as {
        audience: { segment: Segment; classId?: string; divisionId?: string; studentId?: string };
        channel: 'WhatsApp' | 'SMS' | 'E-mail' | 'In-app';
        message: string;
      };
      if (!b.message?.trim()) return fail(400, 'VALIDATION_ERROR', 'Write the message.');
      const a = audience(b.audience);
      if (a.count === 0) return fail(422, 'NO_RECIPIENTS', 'No student matches. Nothing was sent.');
      return ok({ queued: queueReminders(a.list, b.channel, b.message, actor()) });
    },
  ],
  ['GET', /^\/reminders$/, ({ query }) => paged(reminders.map(reminderRow), query)],

  /* targets & reports */
  [
    'GET',
    /^\/targets$/,
    () => {
      const m = monthly();
      const t = sumOf(activeStudents());
      const done = m.reduce((a, x) => a + x.actual, 0);
      const dueToDate = m.filter((x) => !x.future).reduce((a, x) => a + x.target, 0);
      const rate = dueToDate ? done / dueToDate : 0;
      const remaining = m.filter((x) => x.future).reduce((a, x) => a + x.target, 0);
      const projected = done + Math.round(remaining * Math.min(1, rate));
      return ok({
        yearLabel: '2026-27',
        months: m,
        forecast: {
          expectedAnnual: t.expected,
          collectedToDate: done,
          outstanding: t.expected - done,
          currentRate: Math.round(rate * 1000) / 10,
          projected,
          projectedPct: t.expected ? Math.round((projected / t.expected) * 1000) / 10 : 0,
        },
        classes: classRows().map((c) => ({
          id: c.id,
          name: c.name,
          target: c.expected,
          actual: c.collected,
          pct: c.pct,
        })),
      });
    },
  ],
  [
    'GET',
    /^\/reports$/,
    () =>
      ok(REPORTS.map(({ key, group, title, description }) => ({ key, group, title, description }))),
  ],
  [
    'GET',
    /^\/reports\/([\w-]+)$/,
    ({ params, query }) => {
      const r = REPORTS.find((x) => x.key === params[0]);
      return r
        ? ok({ title: r.title, ...r.build(query) })
        : fail(404, 'NOT_FOUND', 'Report not found.');
    },
  ],

  /* administration */
  [
    'GET',
    /^\/users$/,
    () => ok(users.map((u) => ({ ...u, roleName: roleLabels[u.roleKey] ?? u.roleKey }))),
  ],
  [
    'GET',
    /^\/roles$/,
    () =>
      ok(
        SYSTEM_ROLES.map((r) => ({
          key: r.key,
          name: r.name,
          description: r.description,
          permissions: [...r.permissions],
          userCount: users.filter((u) => u.roleKey === r.key && u.active).length,
        })),
      ),
  ],
  [
    'GET',
    /^\/audit-logs$/,
    ({ query }) => {
      const n = (query.get('q') ?? '').trim().toLowerCase();
      return paged(
        audit.filter(
          (a) =>
            !n || [a.user, a.action, a.entity, a.detail].some((v) => v.toLowerCase().includes(n)),
        ),
        query,
      );
    },
  ],
];
