import { z } from 'zod';

/**
 * System settings registry. Every configurable business rule is a typed, validated, documented setting with a
 * default that equals the client's decision (docs/architecture/11). Changing a setting never needs a code change;
 * every change is audited with before/after.
 */

const paiseInt = z.number().int().safe();

export const PAYMENT_METHOD_SCHEMA = z.strictObject({
  code: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'Use upper-case letters, digits and underscores'),
  label: z.string().trim().min(2).max(40),
  /** a reference / transaction number must be entered */
  requiresReference: z.boolean(),
  /** that reference may be used only once (UPI, bank transfer, card …) */
  uniqueReference: z.boolean(),
  isActive: z.boolean().default(true),
});
export type PaymentMethodSetting = z.infer<typeof PAYMENT_METHOD_SCHEMA>;

export const BILLING_POINT_SCHEMA = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ACADEMIC_YEAR_START') }),
  z.strictObject({ kind: z.literal('FIXED_DATE'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.strictObject({ kind: z.literal('ON_DEMAND') }),
]);

export interface SettingDef<S extends z.ZodType = z.ZodType> {
  key: string;
  group: string;
  label: string;
  description: string;
  /** BRC reference when the default comes from a client decision */
  rule?: string;
  schema: S;
  default: z.infer<S>;
}

const setting = <S extends z.ZodType>(d: SettingDef<S>): SettingDef<S> => d;

export const SETTING_DEFS = [
  setting({
    key: 'status.dueSoonDays',
    group: 'Fees & status',
    label: 'Due-soon window (days)',
    description: 'An installment shows "Due soon" this many days before its due date.',
    rule: 'BRC-I1',
    schema: z.number().int().min(0).max(60),
    default: 7,
  }),
  setting({
    key: 'aging.boundaries',
    group: 'Fees & status',
    label: 'Aging buckets (days overdue)',
    description:
      'Upper limits of the first three buckets, e.g. 30, 60, 90 → 0–30, 31–60, 61–90, 90+.',
    rule: 'BRC-I2',
    schema: z
      .tuple([z.number().int().min(1), z.number().int().min(2), z.number().int().min(3)])
      .refine(([a, b, c]) => a < b && b < c, 'Each limit must be larger than the one before'),
    default: [30, 60, 90] as [number, number, number],
  }),
  setting({
    key: 'aging.basis',
    group: 'Fees & status',
    label: 'Aging is counted from',
    description: 'Original due date (default) or the current due date after any extension.',
    rule: 'BRC-I2',
    schema: z.enum(['ORIGINAL_DUE_DATE', 'CURRENT_DUE_DATE']),
    default: 'ORIGINAL_DUE_DATE' as const,
  }),
  setting({
    key: 'metrics.expectedIncludesPenalties',
    group: 'Fees & status',
    label: 'Include late fees in Expected Fees',
    description:
      'Off by default: Expected Fees means the applicable fee obligation; late fees are reported separately.',
    rule: 'BRC-I2',
    schema: z.boolean(),
    default: false,
  }),
  setting({
    key: 'allocation.strategy',
    group: 'Payments',
    label: 'Payment allocation order',
    description:
      'Oldest due first: overdue items by age, then opening balance, late fees, installments.',
    rule: 'BRC-E1',
    schema: z.enum(['OLDEST_DUE_FIRST']),
    default: 'OLDEST_DUE_FIRST' as const,
  }),
  setting({
    key: 'allocation.componentPriority',
    group: 'Payments',
    label: 'Fee-component priority inside one installment',
    description:
      'Fee component codes in the order they should be paid, e.g. ADMISSION, TUITION. Empty = the fee structure order.',
    rule: 'BRC-E1',
    schema: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/)).max(30),
    default: [] as string[],
  }),
  setting({
    key: 'advance.enabled',
    group: 'Payments',
    label: 'Allow advance payments',
    description: 'Off: a payment larger than the outstanding amount is rejected.',
    rule: 'BRC-E2',
    schema: z.boolean(),
    default: false,
  }),
  setting({
    key: 'installments.remainderPlacement',
    group: 'Fees & status',
    label: 'Leftover paise go to',
    description:
      'When an amount does not divide evenly, the extra paise land on the last (default) or first installment.',
    rule: 'BRC-C4',
    schema: z.enum(['LAST', 'FIRST']),
    default: 'LAST' as const,
  }),
  setting({
    key: 'payment.methods',
    group: 'Payments',
    label: 'Payment methods',
    description: 'Methods staff can choose when collecting a fee.',
    rule: 'SOW §14',
    schema: z
      .array(PAYMENT_METHOD_SCHEMA)
      .min(1)
      .max(20)
      .refine(
        (m) => new Set(m.map((x) => x.code)).size === m.length,
        'Method codes must be unique',
      ),
    default: [
      {
        code: 'CASH',
        label: 'Cash',
        requiresReference: false,
        uniqueReference: false,
        isActive: true,
      },
      { code: 'UPI', label: 'UPI', requiresReference: true, uniqueReference: true, isActive: true },
      {
        code: 'BANK_TRANSFER',
        label: 'Bank transfer',
        requiresReference: true,
        uniqueReference: true,
        isActive: true,
      },
      {
        code: 'CHEQUE',
        label: 'Cheque',
        requiresReference: true,
        uniqueReference: false,
        isActive: true,
      },
      {
        code: 'CARD',
        label: 'Card',
        requiresReference: true,
        uniqueReference: true,
        isActive: true,
      },
    ] as PaymentMethodSetting[],
  }),
  setting({
    key: 'payment.backdateMaxDays',
    group: 'Payments',
    label: 'Back-dating limit (days)',
    description: 'How far back a payment may be dated (needs the back-date permission).',
    rule: 'BRC-E5',
    schema: z.number().int().min(0).max(365),
    default: 7,
  }),
  setting({
    key: 'reversal.approval.thresholdPaise',
    group: 'Payments',
    label: 'Second approval for large reversals (from amount)',
    description:
      'Reversals of payments at or above this amount need a second person to approve. Empty = never required.',
    rule: 'BRC-E6',
    schema: paiseInt.positive().nullable(),
    default: null as number | null,
  }),
  setting({
    key: 'receipt.numbering',
    group: 'Receipts',
    label: 'Receipt numbering',
    description: 'Format PREFIX-YEAR-000001. Numbers are never reused; gaps are allowed.',
    rule: 'BRC-G1',
    schema: z.strictObject({
      prefix: z.string().regex(/^[A-Z0-9]{1,10}$/, 'Use 1–10 upper-case letters or digits'),
      scope: z.enum(['ACADEMIC_YEAR', 'CALENDAR_YEAR', 'FINANCIAL_YEAR', 'NONE']),
      pad: z.number().int().min(4).max(10),
    }),
    default: { prefix: 'REC', scope: 'ACADEMIC_YEAR' as const, pad: 6 },
  }),
  setting({
    key: 'teacher.allowMultipleDivisions',
    group: 'Academic',
    label: 'A teacher may be class teacher of several divisions',
    description: 'One class teacher per division is always enforced.',
    rule: 'BRC-B6',
    schema: z.boolean(),
    default: true,
  }),
  setting({
    key: 'billing.ratePerStudentPaise',
    group: 'Commercial',
    label: 'Annual charge per active student',
    description: 'Commercial rule, kept separate from the fee engine.',
    rule: 'BRC-K1',
    schema: paiseInt.min(0),
    default: 12_000,
  }),
  setting({
    key: 'billing.point',
    group: 'Commercial',
    label: 'Active students are counted on',
    description: 'Start of the academic year (default), a fixed date, or on demand.',
    rule: 'BRC-K1',
    schema: BILLING_POINT_SCHEMA,
    default: { kind: 'ACADEMIC_YEAR_START' } as z.infer<typeof BILLING_POINT_SCHEMA>,
  }),
] as const;

export type SettingKey = (typeof SETTING_DEFS)[number]['key'];

const BY_KEY = new Map<string, SettingDef>(SETTING_DEFS.map((d) => [d.key, d as SettingDef]));

export const isSettingKey = (k: unknown): k is SettingKey => typeof k === 'string' && BY_KEY.has(k);
export const settingDef = (k: SettingKey): SettingDef => BY_KEY.get(k) as SettingDef;

/** typed value of one setting; every default is a valid value for its own schema */
export type SettingValue<K extends SettingKey> = Extract<
  (typeof SETTING_DEFS)[number],
  { key: K }
>['default'];

export type Settings = { [K in SettingKey]: SettingValue<K> };

export const DEFAULT_SETTINGS: Settings = Object.fromEntries(
  SETTING_DEFS.map((d) => [d.key, d.default]),
) as Settings;

/** merge stored values over the defaults; stored values that no longer validate fall back to the default */
export function resolveSettings(stored: Record<string, unknown>): {
  settings: Settings;
  invalid: string[];
} {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  const invalid: string[] = [];
  for (const [key, value] of Object.entries(stored)) {
    const def = BY_KEY.get(key);
    if (!def) continue; // unknown / retired key
    const parsed = def.schema.safeParse(value);
    if (parsed.success) out[key] = parsed.data;
    else invalid.push(key);
  }
  return { settings: out as Settings, invalid };
}
