import { formatINR, parseRupeesToPaise, type PaymentMethodSetting } from '@sfm/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, Input, Select, Switch } from '../../components/ui';
import { formatDate } from '../../lib/format';

/**
 * One friendly editor + one plain-language summary per setting. Values are validated by the server with the
 * setting's own schema; the editors only make sure the user can express a valid value.
 */

const ENUMS: Record<string, { value: string; label: string }[]> = {
  'aging.basis': [
    { value: 'ORIGINAL_DUE_DATE', label: 'Original due date (recommended)' },
    { value: 'CURRENT_DUE_DATE', label: 'Current due date after any extension' },
  ],
  'allocation.strategy': [{ value: 'OLDEST_DUE_FIRST', label: 'Oldest due first' }],
  'installments.remainderPlacement': [
    { value: 'LAST', label: 'The last installment' },
    { value: 'FIRST', label: 'The first installment' },
  ],
};
const SCOPES = [
  { value: 'ACADEMIC_YEAR', label: 'Academic year (REC-2026-000001)' },
  { value: 'CALENDAR_YEAR', label: 'Calendar year' },
  { value: 'FINANCIAL_YEAR', label: 'Financial year (April–March)' },
  { value: 'NONE', label: 'One continuous series (REC-000001)' },
];
const NUMBER_RANGES: Record<string, { min: number; max: number; unit: string }> = {
  'status.dueSoonDays': { min: 0, max: 60, unit: 'days' },
  'payment.backdateMaxDays': { min: 0, max: 365, unit: 'days' },
};
const BOOLEANS = new Set([
  'metrics.expectedIncludesPenalties',
  'advance.enabled',
  'teacher.allowMultipleDivisions',
]);

export function summarize(key: string, v: unknown): string {
  switch (key) {
    case 'aging.boundaries': {
      const [a, b, c] = v as [number, number, number];
      return `0–${a}, ${a + 1}–${b}, ${b + 1}–${c} and ${c}+ days`;
    }
    case 'receipt.numbering': {
      const n = v as { prefix: string; scope: string; pad: number };
      const year = n.scope === 'NONE' ? '' : '-2026';
      return `${n.prefix}${year}-${'1'.padStart(n.pad, '0')}`;
    }
    case 'payment.methods':
      return (
        (v as PaymentMethodSetting[])
          .filter((m) => m.isActive)
          .map((m) => m.label)
          .join(', ') || 'None'
      );
    case 'allocation.componentPriority':
      return (v as string[]).length
        ? (v as string[]).join(' → ')
        : 'Same order as the fee structure';
    case 'billing.ratePerStudentPaise':
      return `${formatINR(v as number)} per student per year`;
    case 'reversal.approval.thresholdPaise':
      return v === null ? 'Never required' : `From ${formatINR(v as number)}`;
    case 'billing.point': {
      const p = v as { kind: string; date?: string };
      return p.kind === 'ACADEMIC_YEAR_START'
        ? 'Start of the academic year'
        : p.kind === 'ON_DEMAND'
          ? 'When the bill is generated'
          : `On ${formatDate(p.date)}`;
    }
    default:
      if (BOOLEANS.has(key)) return v ? 'Yes' : 'No';
      if (key in ENUMS) return ENUMS[key]?.find((o) => o.value === v)?.label ?? String(v);
      if (key in NUMBER_RANGES) return `${String(v)} ${NUMBER_RANGES[key]?.unit}`;
      return String(v);
  }
}

export interface EditorProps {
  settingKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
  /** set by the editor when the typed text cannot become a valid value yet */
  onValidity: (message: string | null) => void;
}

const rupees = (paise: number): string =>
  paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);

function RupeeEditor({ settingKey, value, onChange, onValidity }: EditorProps) {
  const nullable = settingKey === 'reversal.approval.thresholdPaise';
  const [text, setText] = useState(value === null ? '' : rupees(value as number));
  const update = (t: string) => {
    setText(t);
    if (t.trim() === '') {
      if (nullable) {
        onChange(null);
        onValidity(null);
      } else onValidity('Enter an amount');
      return;
    }
    try {
      const p = parseRupeesToPaise(t);
      if (p === 0 && nullable) onValidity('Enter an amount above zero, or leave empty for "never"');
      else {
        onChange(p);
        onValidity(null);
      }
    } catch {
      onValidity('Enter an amount like 50000 or 1250.50');
    }
  };
  return (
    <Field label={nullable ? 'Amount (₹) — leave empty for "never"' : 'Amount (₹)'}>
      {(p) => (
        <Input
          {...p}
          inputMode="decimal"
          value={text}
          onChange={(e) => update(e.target.value)}
          placeholder={nullable ? 'No second approval' : '120'}
        />
      )}
    </Field>
  );
}

function MethodsEditor({ value, onChange, onValidity }: EditorProps) {
  const initial = value as PaymentMethodSetting[];
  const existing = new Set(initial.map((m) => m.code));
  const [rows, setRows] = useState<PaymentMethodSetting[]>(initial);
  const push = (next: PaymentMethodSetting[]) => {
    setRows(next);
    onChange(next);
    const codes = next.map((r) => r.code);
    if (next.some((r) => !/^[A-Z][A-Z0-9_]{1,19}$/.test(r.code) || r.label.trim().length < 2))
      onValidity('Every method needs a name and a code (letters, digits, underscores)');
    else if (new Set(codes).size !== codes.length) onValidity('Codes must be different');
    else if (!next.some((r) => r.isActive)) onValidity('Keep at least one method switched on');
    else onValidity(null);
  };
  const patch = (i: number, p: Partial<PaymentMethodSetting>) =>
    push(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div
          key={i}
          className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-[1fr_1fr_auto]"
        >
          <Field label="Name">
            {(p) => (
              <Input {...p} value={r.label} onChange={(e) => patch(i, { label: e.target.value })} />
            )}
          </Field>
          <Field label="Code" hint={existing.has(r.code) ? 'Fixed' : 'Fixed after saving'}>
            {(p) => (
              <Input
                {...p}
                value={r.code}
                disabled={existing.has(r.code)}
                className="uppercase"
                onChange={(e) => patch(i, { code: e.target.value.toUpperCase() })}
              />
            )}
          </Field>
          {!existing.has(r.code) && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Remove method"
              className="self-end"
              onClick={() => push(rows.filter((_, k) => k !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-3">
            <Switch
              label="In use"
              checked={r.isActive}
              onChange={(v) => patch(i, { isActive: v })}
            />
            <Switch
              label="Ask for a reference number"
              checked={r.requiresReference}
              onChange={(v) =>
                patch(i, { requiresReference: v, ...(v ? {} : { uniqueReference: false }) })
              }
            />
            <Switch
              label="Reference can be used only once"
              checked={r.uniqueReference}
              disabled={!r.requiresReference}
              onChange={(v) => patch(i, { uniqueReference: v })}
            />
          </div>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          push([
            ...rows,
            {
              code: '',
              label: '',
              requiresReference: false,
              uniqueReference: false,
              isActive: true,
            },
          ])
        }
      >
        <Plus className="size-4" aria-hidden /> Add method
      </Button>
    </div>
  );
}

export function SettingEditor(props: EditorProps) {
  const { settingKey: key, value, onChange, onValidity } = props;

  if (BOOLEANS.has(key))
    return (
      <Switch
        label={summarize(key, value) === 'Yes' ? 'Yes' : 'No'}
        checked={value as boolean}
        onChange={onChange}
      />
    );

  if (key in NUMBER_RANGES) {
    const r = NUMBER_RANGES[key] as { min: number; max: number; unit: string };
    return (
      <Field label={`Number of ${r.unit}`} hint={`Between ${r.min} and ${r.max}`}>
        {(p) => (
          <Input
            {...p}
            type="number"
            min={r.min}
            max={r.max}
            defaultValue={value as number}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (e.target.value === '' || !Number.isInteger(n) || n < r.min || n > r.max)
                onValidity(`Enter a whole number from ${r.min} to ${r.max}`);
              else {
                onChange(n);
                onValidity(null);
              }
            }}
          />
        )}
      </Field>
    );
  }

  if (key in ENUMS) {
    return (
      <Field label="Choose one">
        {(p) => (
          <Select {...p} defaultValue={value as string} onChange={(e) => onChange(e.target.value)}>
            {ENUMS[key]?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
    );
  }

  if (key === 'billing.ratePerStudentPaise' || key === 'reversal.approval.thresholdPaise')
    return <RupeeEditor {...props} />;

  if (key === 'allocation.componentPriority') {
    return (
      <Field
        label="Fee component codes, in the order they are paid"
        hint="Separate with commas, e.g. ADMISSION, TUITION, TRANSPORT. Leave empty to follow the fee structure order."
      >
        {(p) => (
          <Input
            {...p}
            defaultValue={(value as string[]).join(', ')}
            onChange={(e) => {
              const codes = e.target.value
                .split(',')
                .map((s) => s.trim().toUpperCase())
                .filter(Boolean);
              if (codes.some((c) => !/^[A-Z][A-Z0-9_]{1,29}$/.test(c)))
                onValidity('Use codes like TUITION or LAB_FEE');
              else {
                onChange(codes);
                onValidity(null);
              }
            }}
          />
        )}
      </Field>
    );
  }

  if (key === 'aging.boundaries') {
    const [a, b, c] = value as [number, number, number];
    return <BoundariesEditor initial={[a, b, c]} onChange={onChange} onValidity={onValidity} />;
  }

  if (key === 'receipt.numbering') {
    const v = value as { prefix: string; scope: string; pad: number };
    return <NumberingEditor initial={v} onChange={onChange} onValidity={onValidity} />;
  }

  if (key === 'billing.point')
    return (
      <BillingPointEditor
        initial={value as { kind: string; date?: string }}
        onChange={onChange}
        onValidity={onValidity}
      />
    );

  if (key === 'payment.methods') return <MethodsEditor {...props} />;

  return <p className="text-sm text-muted">This setting cannot be edited here yet.</p>;
}

function BoundariesEditor({
  initial,
  onChange,
  onValidity,
}: {
  initial: [number, number, number];
  onChange: (v: unknown) => void;
  onValidity: (m: string | null) => void;
}) {
  const [v, setV] = useState(initial);
  const set = (i: number, n: number) => {
    const next = v.map((x, k) => (k === i ? n : x)) as [number, number, number];
    setV(next);
    if (next.some((x) => !Number.isInteger(x) || x < 1)) onValidity('Use whole numbers above zero');
    else if (!(next[0] < next[1] && next[1] < next[2]))
      onValidity('Each limit must be larger than the one before');
    else {
      onChange(next);
      onValidity(null);
    }
  };
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {['First bucket ends at', 'Second bucket ends at', 'Third bucket ends at'].map((l, i) => (
        <Field key={l} label={`${l} (days)`}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min={1}
              value={v[i]}
              onChange={(e) => set(i, Number(e.target.value))}
            />
          )}
        </Field>
      ))}
      <p className="text-xs text-muted sm:col-span-3">
        Preview: {summarize('aging.boundaries', v)}
      </p>
    </div>
  );
}

function NumberingEditor({
  initial,
  onChange,
  onValidity,
}: {
  initial: { prefix: string; scope: string; pad: number };
  onChange: (v: unknown) => void;
  onValidity: (m: string | null) => void;
}) {
  const [v, setV] = useState(initial);
  const set = (p: Partial<typeof initial>) => {
    const next = { ...v, ...p };
    setV(next);
    if (!/^[A-Z0-9]{1,10}$/.test(next.prefix)) onValidity('Prefix: 1–10 capital letters or digits');
    else if (!Number.isInteger(next.pad) || next.pad < 4 || next.pad > 10)
      onValidity('Number length must be between 4 and 10');
    else {
      onChange(next);
      onValidity(null);
    }
  };
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Prefix">
        {(p) => (
          <Input
            {...p}
            value={v.prefix}
            className="uppercase"
            onChange={(e) => set({ prefix: e.target.value.toUpperCase() })}
          />
        )}
      </Field>
      <Field label="Year part" className="sm:col-span-2">
        {(p) => (
          <Select {...p} value={v.scope} onChange={(e) => set({ scope: e.target.value })}>
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Number length (digits)">
        {(p) => (
          <Input
            {...p}
            type="number"
            min={4}
            max={10}
            value={v.pad}
            onChange={(e) => set({ pad: Number(e.target.value) })}
          />
        )}
      </Field>
      <p className="self-end text-sm text-muted sm:col-span-2">
        Preview: <strong className="text-ink">{summarize('receipt.numbering', v)}</strong>. Numbers
        are never reused; gaps are allowed.
      </p>
    </div>
  );
}

function BillingPointEditor({
  initial,
  onChange,
  onValidity,
}: {
  initial: { kind: string; date?: string };
  onChange: (v: unknown) => void;
  onValidity: (m: string | null) => void;
}) {
  const [kind, setKind] = useState(initial.kind);
  const [date, setDate] = useState(initial.date ?? '');
  const emit = (k: string, d: string) => {
    if (k === 'FIXED_DATE') {
      if (!d) onValidity('Choose the date');
      else {
        onChange({ kind: k, date: d });
        onValidity(null);
      }
    } else {
      onChange({ kind: k });
      onValidity(null);
    }
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Count active students on">
        {(p) => (
          <Select
            {...p}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              emit(e.target.value, date);
            }}
          >
            <option value="ACADEMIC_YEAR_START">Start of the academic year</option>
            <option value="FIXED_DATE">A fixed date</option>
            <option value="ON_DEMAND">When the bill is generated</option>
          </Select>
        )}
      </Field>
      {kind === 'FIXED_DATE' && (
        <Field label="Date">
          {(p) => (
            <Input
              {...p}
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                emit('FIXED_DATE', e.target.value);
              }}
            />
          )}
        </Field>
      )}
    </div>
  );
}
