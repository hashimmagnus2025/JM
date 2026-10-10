import { Printer } from 'lucide-react';
import { Money } from '../../components/data';
import { Modal } from '../../components/overlay';
import { Badge, Button, FormError, Skeleton } from '../../components/ui';
import { formatDate } from '../../lib/format';
import { friendlyMessage } from '../../lib/messages';
import { useInstitution } from '../setup/api';
import { useReceipt } from '../fees/api';

/** a printable receipt; everything on it (balances included) comes from the server */
export function ReceiptModal({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const q = useReceipt(paymentId);
  const inst = useInstitution();
  const r = q.data;
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={r ? `Receipt ${r.receiptNo}` : 'Receipt'}
      description={
        r?.status === 'REVERSED'
          ? 'This payment was reversed. The receipt number stays on record.'
          : 'Printable receipt'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => window.print()} disabled={!r}>
            <Printer className="size-4" aria-hidden /> Print
          </Button>
        </>
      }
    >
      {q.isPending && <Skeleton className="h-64" />}
      {q.isError && <FormError message={friendlyMessage(q.error)} />}
      {r && (
        <div className="print-area rounded-lg border border-line bg-surface p-6 text-sm">
          <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
            <div>
              <p className="text-lg font-semibold text-ink">{inst.data?.name ?? 'School'}</p>
              {inst.data && (
                <p className="text-xs text-muted">
                  {[inst.data.address.line1, inst.data.address.city, inst.data.address.pincode]
                    .filter(Boolean)
                    .join(', ')}
                  {inst.data.contact.phone ? ` · ${inst.data.contact.phone}` : ''}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs text-muted">Receipt no.</p>
              <p className="font-semibold text-ink">{r.receiptNo}</p>
              <p className="text-xs text-muted">{formatDate(r.date)}</p>
              {r.status === 'REVERSED' && <Badge tone="danger">Reversed</Badge>}
            </div>
          </div>
          <dl className="grid gap-x-6 gap-y-3 py-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">Student</dt>
              <dd className="font-medium text-ink">{r.studentName}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Student ID</dt>
              <dd className="font-medium text-ink">{r.studentCode}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Class &amp; division</dt>
              <dd className="font-medium text-ink">{r.classLabel}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Academic year</dt>
              <dd className="font-medium text-ink">{r.academicYear}</dd>
            </div>
          </dl>
          <table className="w-full border-y border-line text-left">
            <thead>
              <tr className="text-xs text-muted">
                <th scope="col" className="py-2 font-medium">
                  Fee details
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.lines.map((l) => (
                <tr key={l.installmentNo}>
                  <td className="py-2">
                    Instalment {l.installmentNo} · due {formatDate(l.dueDate)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    <Money paise={l.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-ink">
                <td className="py-2">Amount paid</td>
                <td className="py-2 text-right tabular-nums">
                  <Money paise={r.amount} />
                </td>
              </tr>
            </tfoot>
          </table>
          <dl className="grid gap-x-6 gap-y-3 pt-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">Payment method</dt>
              <dd className="font-medium text-ink">{r.method}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Reference</dt>
              <dd className="font-medium text-ink">{r.reference ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Previous balance</dt>
              <dd className="font-medium text-ink">
                <Money paise={r.previousBalance} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Remaining balance</dt>
              <dd className="font-medium text-ink">
                <Money paise={r.remainingBalance} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Collected by</dt>
              <dd className="font-medium text-ink">{r.collectedBy}</dd>
            </div>
          </dl>
          {r.reversal && (
            <p className="mt-4 rounded-md bg-danger-bg px-3 py-2 text-danger">
              Reversed on {formatDate(r.reversal.date)} by {r.reversal.by}: {r.reversal.reason}
            </p>
          )}
          {inst.data?.receiptFooter && (
            <p className="mt-5 text-xs text-muted">{inst.data.receiptFooter}</p>
          )}
        </div>
      )}
    </Modal>
  );
}
