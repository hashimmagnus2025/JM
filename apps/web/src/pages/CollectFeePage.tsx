import { Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { FeeStatusBadge, InstBadge, Money, Section, Stat } from '../components/data';
import { QueryBoundary } from '../components/QueryBoundary';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormError,
  Input,
  PageHeader,
  Select,
} from '../components/ui';
import { useCollectPayment } from '../features/fees/api';
import type { PaymentMethod } from '../features/fees/types';
import { ReceiptModal } from '../features/payments/ReceiptModal';
import {
  useAllocationPreview,
  useStudent,
  useStudentSearch,
  type StudentProfile,
} from '../features/students/api';
import { formatDate } from '../lib/format';
import { friendlyMessage } from '../lib/messages';
import { parseRupees, rs } from '../lib/money';

const METHODS: PaymentMethod[] = ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card'];

function Counter({ s, onReceipt }: { s: StudentProfile; onReceipt: (id: string) => void }) {
  const collect = useCollectPayment();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [ref, setRef] = useState('');
  const [error, setError] = useState<string>();
  // one key per payment attempt: pressing the button twice can never create two receipts
  const key = useRef(crypto.randomUUID());
  const f = s.fee;
  const paise = amount === '' ? null : parseRupees(amount);
  const preview = useAllocationPreview(s.id, paise ?? 0);
  const needsRef = method !== 'Cash';

  const pay = async () => {
    setError(undefined);
    if (paise === null || paise <= 0) return setError('Enter the amount received, in rupees.');
    if (paise > f.outstanding)
      return setError(
        `The amount is more than the ${rs(f.outstanding)} outstanding. Advance payments are switched off in Settings.`,
      );
    if (needsRef && !ref.trim())
      return setError(`Enter the ${method === 'Cheque' ? 'cheque' : 'transaction'} reference.`);
    try {
      const r = await collect.mutateAsync({
        studentId: s.id,
        amount: paise,
        method,
        ...(ref.trim() ? { reference: ref.trim() } : {}),
        idempotencyKey: key.current,
      });
      key.current = crypto.randomUUID();
      toast.success(`Receipt ${r.data.receiptNo} created`);
      setAmount('');
      setRef('');
      onReceipt(r.data.id);
    } catch (e) {
      setError(friendlyMessage(e));
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
      <div className="space-y-4">
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <Link
              to={`/students/${s.id}`}
              className="text-lg font-semibold text-ink hover:text-primary"
            >
              {s.name}
            </Link>
            <p className="text-sm text-muted">
              {s.studentId} · {s.classLabel} · Parent {s.guardian.name}
            </p>
          </div>
          <FeeStatusBadge status={f.status} />
        </Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Total payable" value={<Money paise={f.payable} />} />
          <Stat label="Already paid" value={<Money paise={f.paid} />} tone="success" />
          <Stat
            label="Outstanding"
            value={<Money paise={f.outstanding} />}
            tone={f.overdue ? 'danger' : 'warning'}
            hint={
              f.overdue ? (
                <>
                  <Money paise={f.overdue} /> overdue
                </>
              ) : (
                'nothing overdue'
              )
            }
          />
        </div>
        <Section title="Instalments" flush>
          <ul className="divide-y divide-line">
            {s.installments.map((i) => {
              const a = preview.data?.lines.find((x) => x.installmentNo === i.no);
              return (
                <li
                  key={i.no}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-ink">Instalment {i.no}</p>
                    <p className="text-xs text-muted">Due {formatDate(i.dueDate)}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    {a && (
                      <Badge tone="brand">
                        + <Money paise={a.amount} /> from this payment
                      </Badge>
                    )}
                    <span className="text-muted tabular-nums">
                      Pending <Money paise={i.pending} />
                    </span>
                    <InstBadge status={i.status} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      </div>

      <Card className="h-fit space-y-4 p-5 xl:sticky xl:top-20">
        <h2 className="text-base font-semibold text-ink">Payment</h2>
        <FormError message={error} />
        <Field
          label="Amount received (₹)"
          required
          hint="Applied to the oldest due instalment first."
        >
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          {f.overdue > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAmount(String(f.overdue / 100))}
            >
              Overdue {rs(f.overdue)}
            </Button>
          )}
          {f.outstanding > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAmount(String(f.outstanding / 100))}
            >
              Full {rs(f.outstanding)}
            </Button>
          )}
        </div>
        <Field label="Payment method" required>
          {(p) => (
            <Select
              {...p}
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          )}
        </Field>
        {needsRef && (
          <Field label={method === 'Cheque' ? 'Cheque number' : 'Transaction reference'} required>
            {(p) => <Input {...p} value={ref} onChange={(e) => setRef(e.target.value)} />}
          </Field>
        )}
        {paise && preview.data && preview.data.lines.length > 0 && (
          <div className="rounded-lg bg-primary-soft px-4 py-3 text-sm text-primary" role="status">
            <p className="font-medium">This payment will go to</p>
            <ul className="mt-1">
              {preview.data.lines.map((a) => (
                <li key={a.installmentNo} className="flex justify-between">
                  <span>{a.label}</span>
                  <Money paise={a.amount} />
                </li>
              ))}
            </ul>
            <p className="mt-2 flex justify-between border-t border-primary/20 pt-2 font-semibold">
              <span>Balance after</span>
              <Money paise={preview.data.balanceAfter} />
            </p>
          </div>
        )}
        <Button
          className="w-full"
          onClick={() => void pay()}
          loading={collect.isPending}
          disabled={f.outstanding === 0}
        >
          {f.outstanding === 0 ? 'Nothing is due' : 'Confirm payment & create receipt'}
        </Button>
      </Card>
    </div>
  );
}

export default function CollectFeePage() {
  const [sp, setSp] = useSearchParams();
  const sid = sp.get('student') ?? '';
  const [q, setQ] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);
  const matches = useStudentSearch(q);
  const student = useStudent(sid || undefined);

  return (
    <>
      <PageHeader
        title="Collect fee"
        description="Find the student, check what is due, enter the payment and print the receipt."
      />
      <Card className="mb-4 p-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-3 left-3 size-4 text-subtle"
            aria-hidden
          />
          <Input
            aria-label="Find a student"
            placeholder="Search by name, student ID, admission no., parent or mobile"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {(matches.data ?? []).length > 0 && q.trim().length >= 2 && (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
            {(matches.data ?? []).map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-primary-soft"
                  onClick={() => {
                    setSp({ student: m.id });
                    setQ('');
                  }}
                >
                  <span>
                    <span className="font-medium text-ink">{m.name}</span>{' '}
                    <span className="text-xs text-muted">
                      {m.studentId} · {m.classLabel} · {m.guardian}
                    </span>
                  </span>
                  <FeeStatusBadge status={m.feeStatus} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!sid ? (
        <Card>
          <EmptyState
            title="Search for a student to begin"
            description="Type at least two letters. You can also open a student and choose ‘Collect fee’."
          />
        </Card>
      ) : (
        <QueryBoundary query={student}>
          {(s) => <Counter key={s.id} s={s} onReceipt={setReceipt} />}
        </QueryBoundary>
      )}
      {receipt && <ReceiptModal paymentId={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}
