/**
 * Permission registry — the single list of things a user can be allowed to do.
 * Permissions live in CODE (a permission nobody enforces is meaningless); ROLES are data that
 * bundle permissions. The backend checks these on every request; the frontend only hides buttons.
 */

export interface PermissionDef {
  key: string;
  label: string;
  group: string;
}

const def = (group: string, key: string, label: string): PermissionDef => ({ key, label, group });

export const PERMISSION_DEFS = [
  def('Institution', 'institution.view', 'View institution profile'),
  def('Institution', 'institution.manage', 'Edit institution profile'),
  def('Institution', 'settings.view', 'View settings'),
  def('Institution', 'settings.manage', 'Change settings'),
  def('Administration', 'user.view', 'View users'),
  def('Administration', 'user.manage', 'Create and edit users'),
  def('Administration', 'role.view', 'View roles'),
  def('Administration', 'role.manage', 'Create and edit roles'),
  def('Administration', 'audit.view', 'View audit log'),
  def('Administration', 'audit.export', 'Export audit log'),
  def('Academic', 'academicYear.view', 'View academic years'),
  def('Academic', 'academicYear.manage', 'Manage academic years'),
  def('Academic', 'academicYear.close', 'Close an academic year'),
  def('Academic', 'academicYear.override', 'Post into a closed academic year'),
  def('Academic', 'studentCategory.view', 'View student categories'),
  def('Academic', 'studentCategory.manage', 'Manage student categories'),
  def('Academic', 'class.view', 'View classes'),
  def('Academic', 'class.manage', 'Manage classes'),
  def('Academic', 'division.view', 'View divisions'),
  def('Academic', 'division.manage', 'Manage divisions'),
  def('Academic', 'teacher.view', 'View teachers'),
  def('Academic', 'teacher.create', 'Add teachers'),
  def('Academic', 'teacher.update', 'Edit teachers'),
  def('Academic', 'teacher.deactivate', 'Activate / deactivate teachers'),
  def('Academic', 'teacherAssignment.view', 'View teacher assignments'),
  def('Academic', 'teacherAssignment.assign', 'Assign a class teacher'),
  def('Academic', 'teacherAssignment.change', 'Change a class teacher'),
  def('Students', 'student.view', 'View students'),
  def('Students', 'student.viewContact', 'See parent contact details'),
  def('Students', 'student.create', 'Admit students'),
  def('Students', 'student.update', 'Edit students'),
  def('Students', 'student.archive', 'Archive students'),
  def('Students', 'student.export', 'Export student lists'),
  def('Students', 'parent.view', 'View parents'),
  def('Students', 'parent.manage', 'Create and edit parents'),
  def('Students', 'enrollment.manage', 'Manage enrollments'),
  def('Students', 'promotion.run', 'Run student promotion'),
  def('Fees', 'feeStructure.view', 'View fee structures'),
  def('Fees', 'feeStructure.manage', 'Edit fee structure drafts'),
  def('Fees', 'feeStructure.publish', 'Publish fee structures'),
  def('Fees', 'feeAssignment.view', 'View fee assignments'),
  def('Fees', 'feeAssignment.manage', 'Assign or change a student fee plan'),
  def('Fees', 'installment.view', 'View installments'),
  def('Fees', 'installment.modify', 'Change installments'),
  def('Fees', 'openingBalance.view', 'View opening balances'),
  def('Fees', 'openingBalance.create', 'Create opening balances'),
  def('Fees', 'openingBalance.reverse', 'Reverse opening balances'),
  def('Fees', 'openingBalance.carryForward', 'Carry dues forward to a later year'),
  def('Fees', 'adjustment.view', 'View discounts and concessions'),
  def('Fees', 'adjustment.create', 'Request a discount or concession'),
  def('Fees', 'adjustment.approve', 'Approve a discount or concession'),
  def('Fees', 'adjustment.reverse', 'Reverse a discount or concession'),
  def('Fees', 'lateFee.manage', 'Manage late-fee rules'),
  def('Fees', 'lateFee.waive', 'Waive late fees'),
  def('Payments', 'payment.view', 'View payments'),
  def('Payments', 'payment.collect', 'Collect fees'),
  def('Payments', 'payment.allocateManual', 'Allocate a payment manually'),
  def('Payments', 'payment.backdate', 'Record back-dated payments'),
  def('Payments', 'payment.editMeta', 'Edit non-financial payment notes'),
  def('Payments', 'payment.reverse', 'Reverse a payment'),
  def('Payments', 'payment.reverseApprove', 'Approve a payment reversal'),
  def('Payments', 'receipt.view', 'View receipts'),
  def('Payments', 'receipt.reprint', 'Reprint receipts'),
  def('Receivables', 'outstanding.view', 'View outstanding, overdue and aging'),
  def('Receivables', 'dashboard.view', 'View the dashboard'),
  def('Receivables', 'target.manage', 'Manage collection targets'),
  def('Communication', 'reminder.view', 'View reminders'),
  def('Communication', 'reminder.send', 'Send reminders'),
  def('Communication', 'reminder.manage', 'Manage reminder rules and templates'),
  def('Reports', 'report.view', 'View reports'),
  def('Reports', 'report.export', 'Export reports'),
  def('Data', 'import.run', 'Upload and validate imports'),
  def('Data', 'import.commit', 'Commit imports'),
] as const;

export type PermissionKey = (typeof PERMISSION_DEFS)[number]['key'];

export const ALL_PERMISSIONS: readonly PermissionKey[] = PERMISSION_DEFS.map((p) => p.key);

const KEY_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

export const isPermissionKey = (value: unknown): value is PermissionKey =>
  typeof value === 'string' && KEY_SET.has(value);

/**
 * Administration-grade permissions. Whoever builds or assigns a role may only include these if they hold
 * them personally (no privilege escalation). Operational permissions such as `payment.collect` are exempt on
 * purpose: an Admin is not allowed to collect fees themselves (separation of duties) but must be able to
 * create Fee Collectors.
 */
export const PRIVILEGED_PERMISSIONS: readonly PermissionKey[] = [
  'user.manage',
  'role.manage',
  'settings.manage',
  'institution.manage',
  'academicYear.override',
  'audit.export',
];

/* ------------------------------ system roles (seed) ------------------------------ */

export type DataScope = 'ALL' | 'OWN_DIVISIONS';

export interface SystemRoleDef {
  key: string;
  name: string;
  description: string;
  dataScope: DataScope;
  permissions: readonly PermissionKey[];
}

const pick = (...keys: PermissionKey[]): readonly PermissionKey[] => keys;
const viewOnly = (...groups: string[]): PermissionKey[] =>
  PERMISSION_DEFS.filter((p) => groups.includes(p.group) && p.key.endsWith('.view')).map(
    (p) => p.key,
  );

const ACADEMIC_VIEW = viewOnly('Academic');
const FEE_VIEW = viewOnly('Fees');

/**
 * Starting roles (the final matrix is a client decision, BRC-J1 — roles are editable data).
 * BRC-E6: ONLY finance/admin roles hold `payment.reverse`; the Fee Collector does not.
 * Class Teacher is not a release-1 role (teachers do not log in, BRC-B6).
 */
export const SYSTEM_ROLES: readonly SystemRoleDef[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Full access to everything, including users and settings.',
    dataScope: 'ALL',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'ADMIN',
    name: 'Admin / Principal',
    description:
      'Runs the institution: academics, approvals, reversals, reports. Cannot collect fees.',
    dataScope: 'ALL',
    permissions: ALL_PERMISSIONS.filter(
      (k) =>
        !['payment.collect', 'payment.allocateManual', 'payment.backdate'].includes(k) &&
        k !== 'academicYear.override',
    ),
  },
  {
    key: 'ACCOUNTANT',
    name: 'Accountant',
    description: 'Fees, collection, opening balances and finance reports. Can request reversals.',
    dataScope: 'ALL',
    permissions: [
      ...ACADEMIC_VIEW,
      'institution.view',
      'settings.view',
      'student.view',
      'student.viewContact',
      'student.export',
      'parent.view',
      'feeStructure.view',
      'feeStructure.manage',
      'feeAssignment.view',
      'feeAssignment.manage',
      'installment.view',
      'installment.modify',
      'openingBalance.view',
      'openingBalance.create',
      'openingBalance.reverse',
      'adjustment.view',
      'adjustment.create',
      'lateFee.manage',
      'payment.view',
      'payment.collect',
      'payment.allocateManual',
      'payment.backdate',
      'payment.editMeta',
      'payment.reverse',
      'receipt.view',
      'receipt.reprint',
      'outstanding.view',
      'dashboard.view',
      'target.manage',
      'reminder.view',
      'reminder.send',
      'report.view',
      'report.export',
      'import.run',
    ],
  },
  {
    key: 'FEE_COLLECTOR',
    name: 'Fee Collector',
    description: 'Collects fees at the counter and prints receipts. Cannot reverse payments.',
    dataScope: 'ALL',
    permissions: pick(
      'student.view',
      'student.viewContact',
      'parent.view',
      'feeAssignment.view',
      'installment.view',
      'openingBalance.view',
      'adjustment.view',
      'payment.view',
      'payment.collect',
      'receipt.view',
      'receipt.reprint',
      'outstanding.view',
      'academicYear.view',
      'class.view',
      'division.view',
    ),
  },
  {
    key: 'REGISTRAR',
    name: 'Registrar',
    description: 'Admissions, students, parents, enrollment and promotion.',
    dataScope: 'ALL',
    permissions: [
      ...ACADEMIC_VIEW,
      'academicYear.manage',
      'studentCategory.manage',
      'class.manage',
      'division.manage',
      'teacher.create',
      'teacher.update',
      'teacher.deactivate',
      'teacherAssignment.assign',
      'teacherAssignment.change',
      'student.view',
      'student.viewContact',
      'student.create',
      'student.update',
      'student.archive',
      'student.export',
      'parent.view',
      'parent.manage',
      'enrollment.manage',
      'promotion.run',
      'feeAssignment.view',
      'openingBalance.view',
      'openingBalance.create',
      'dashboard.view',
      'report.view',
      'import.run',
    ],
  },
  {
    key: 'COMMS_OFFICER',
    name: 'Communication Officer',
    description: 'Sends and manages fee reminders.',
    dataScope: 'ALL',
    permissions: pick(
      'student.view',
      'student.viewContact',
      'parent.view',
      'outstanding.view',
      'reminder.view',
      'reminder.send',
      'reminder.manage',
      'dashboard.view',
      'report.view',
      'academicYear.view',
      'class.view',
      'division.view',
    ),
  },
  {
    key: 'AUDITOR',
    name: 'Auditor',
    description: 'Read-only access to finance, reports and the audit log.',
    dataScope: 'ALL',
    permissions: [
      ...ACADEMIC_VIEW,
      ...FEE_VIEW,
      'institution.view',
      'settings.view',
      'user.view',
      'role.view',
      'student.view',
      'student.viewContact',
      'student.export',
      'parent.view',
      'payment.view',
      'receipt.view',
      'outstanding.view',
      'dashboard.view',
      'reminder.view',
      'report.view',
      'report.export',
      'audit.view',
      'audit.export',
    ],
  },
];
