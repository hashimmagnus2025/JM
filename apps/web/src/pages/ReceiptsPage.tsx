import { Download, Receipt as ReceiptIcon, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable, Money, downloadCsv } from '../components/data';
import { Modal } from '../components/overlay';
import { QueryBoundary } from '../components/QueryBoundary';
import {
  Badge,
  Button,
  Card,
  Field,
  FormError,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '../components/ui';
import { useCan } from '../features/auth/auth';
import { usePayments, useReversePayment } from '../features/fees/api';
import type { PaymentRow } from '../features/fees/types';
import { ReceiptModal } from '../features/payments/ReceiptModal';
import { formatDate } from '../lib/format';
import { friendlyMessage } from '../lib/messages';

export default function ReceiptsPage() {
  const can = useCan();
  const [f, setF] = useState({ q: '', method: '', status: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [view, setView] = useState<string | null>(null);
  const [reversing, setReversing] = useState<PaymentRow | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const reverse = useReversePayment();
  const query = usePayments(f, page);
  const set = (k: keyof typeof f, v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    setPage(1);
  };

  const confirm = async () => {
    if (!reversing) return;
    if (reason.trim().length < 5) return setError('Give a reason of at least 5 characters.');
    try {
      await reverse.mutateAsync({ id: reversing.id, reason: reason.trim() });
      toast.success(`${reversing.receiptNo} reversed`);
      setReversing(null);
      setReason('');
      setError(undefined);
    } catch (e) {
      setError(friendlyMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Receipts & payments"
        description="Every payment ever taken. Nothing is deleted: a wrong payment is reversed with a reason and stays visible."
        actions={
          <Button
            variant="secondary"
            disabled={!query.data}
            onClick={() =>
              downloadCsv(
                'payments.csv',
                [
                  'Receipt',
                  'Date',
                  'Student',
                  'Class',
                  'Method',
                  'Reference',
                  'Amount (₹)',
                  'Status',
                  'Collected by',
                ],
                (query.data?.rows ?? []).map((p) => [
                  p.receiptNo,
                  p.date,
                  p.studentName,
                  p.classLabel,
                  p.method,
                  p.reference ?? '',
                  p.amount / 100,
                  p.status,
                  p.collectedBy,
                ]),
              )
            }
          >
            <Download className="size-4" aria-hidden /> Export this page
          </Button>
        }
      />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            aria-label="Search receipts"
            placeholder="Receipt no., student, reference"
            className="lg:col-span-2"
            value={f.q}
            onChange={(e) => set('q', e.target.value)}
          />
          <Select
            aria-label="Payment method"
            value={f.method}
            onChange={(e) => set('method', e.target.value)}
          >
            <option value="">All methods</option>
            {['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
          <Input
            aria-label="From date"
            type="date"
            value={f.from}
            onChange={(e) => set('from', e.target.value)}
          />
          <Input
            aria-label="To date"
            type="date"
            value={f.to}
            onChange={(e) => set('to', e.target.value)}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
          <span>
            <strong className="text-ink">{(query.data?.total ?? 0).toLocaleString('en-IN')}</strong>{' '}
            payments ·{' '}
            <strong className="text-ink">
              <Money paise={query.data?.collected ?? 0} />
            </strong>{' '}
            collected
          </span>
          <Select
            aria-label="Payment status"
            className="h-8 w-44"
            value={f.status}
            onChange={(e) => set('status', e.target.value)}
          >
            <option value="">Posted and reversed</option>
            <option value="POSTED">Posted only</option>
            <option value="REVERSED">Reversed only</option>
          </Select>
        </div>
      </Card>
      <Card>
        <QueryBoundary query={query}>
          {(d) => (
            <DataTable
              caption="Payments"
              rows={d.rows}
              rowKey={(p) => p.id}
              pageSize={15}
              paging={{ page: page - 1, total: d.total, onPage: (p) => setPage(p + 1) }}
              columns={[
                {
                  key: 'r',
                  header: 'Receipt',
                  cell: (p) => <span className="font-medium text-ink">{p.receiptNo}</span>,
                },
                { key: 'd', header: 'Date', cell: (p) => formatDate(p.date) },
                {
                  key: 's',
                  header: 'Student',
                  cell: (p) => (
                    <div>
                      <p className="text-ink">{p.studentName}</p>
                      <p className="text-xs text-muted">{p.classLabel}</p>
                    </div>
                  ),
                },
                {
                  key: 'm',
                  header: 'Method',
                  cell: (p) => (
                    <div>
                      <p>{p.method}</p>
                      {p.reference && <p className="text-xs text-muted">{p.reference}</p>}
                    </div>
                  ),
                },
                {
                  key: 'a',
                  header: 'Amount',
                  cell: (p) => <Money paise={p.amount} />,
                  align: 'right',
                },
                {
                  key: 'st',
                  header: 'Status',
                  cell: (p) =>
                    p.status === 'POSTED' ? (
                      <Badge tone="success">Posted</Badge>
                    ) : (
                      <Badge tone="danger">Reversed</Badge>
                    ),
                },
                {
                  key: 'x',
                  header: '',
                  align: 'right',
                  cell: (p) => (
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`View receipt ${p.receiptNo}`}
                        onClick={() => setView(p.id)}
                      >
                        <ReceiptIcon className="size-4" aria-hidden />
                      </Button>
                      {p.status === 'POSTED' && can('payment.reverse') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Reverse ${p.receiptNo}`}
                          onClick={() => {
                            setReversing(p);
                            setError(undefined);
                          }}
                        >
                          <Undo2 className="size-4" aria-hidden />
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </QueryBoundary>
      </Card>
      {view && <ReceiptModal paymentId={view} onClose={() => setView(null)} />}
      {reversing && (
        <Modal
          open
          onClose={() => setReversing(null)}
          title={`Reverse ${reversing.receiptNo}`}
          description="The payment stays on record, marked as reversed, and the student’s balance goes back up. This cannot be undone."
          footer={
            <>
              <Button variant="secondary" onClick={() => setReversing(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={reverse.isPending} onClick={() => void confirm()}>
                Reverse payment
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <FormError message={error} />
            <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">
              <Money paise={reversing.amount} /> from {reversing.studentName}
            </p>
            <Field label="Reason" required hint="Shown in the audit log.">
              {(p) => (
                <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />
              )}
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
