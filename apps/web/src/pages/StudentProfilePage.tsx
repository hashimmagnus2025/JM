import { ArrowLeft, Bell, Receipt as ReceiptIcon, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  DataTable,
  FeeStatusBadge,
  InstBadge,
  KV,
  Money,
  Section,
  Stat,
  Tabs,
} from '../components/data';
import { PermissionGate } from '../components/PermissionGate';
import { QueryBoundary } from '../components/QueryBoundary';
import { Badge, Button, Card, EmptyState, PageHeader } from '../components/ui';
import { ReceiptModal } from '../features/payments/ReceiptModal';
import { useStudent, type StudentProfile } from '../features/students/api';
import { formatDate, initials } from '../lib/format';

type Tab = 'overview' | 'history' | 'fees' | 'payments' | 'reminders' | 'adjustments';

function Profile({ s }: { s: StudentProfile }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [receipt, setReceipt] = useState<string | null>(null);
  const f = s.fee;
  return (
    <>
      <Link
        to="/students"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden /> All students
      </Link>
      <PageHeader
        title={s.name}
        description={`${s.studentId} · ${s.classLabel} · ${s.categoryName}`}
        actions={
          <>
            <PermissionGate permission="payment.collect">
              <Link to={`/fees/collect?student=${s.id}`}>
                <Button>
                  <Wallet className="size-4" aria-hidden /> Collect fee
                </Button>
              </Link>
            </PermissionGate>
            <PermissionGate permission="reminder.send">
              <Link to={`/receivables/reminders?student=${s.id}`}>
                <Button variant="secondary">
                  <Bell className="size-4" aria-hidden /> Send reminder
                </Button>
              </Link>
            </PermissionGate>
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Total payable"
          value={<Money paise={f.payable} />}
          hint="2026-27 incl. late fee and earlier dues"
        />
        <Stat
          label="Paid"
          value={<Money paise={f.paid} />}
          tone="success"
          hint={`${s.payments.filter((p) => p.status === 'POSTED').length} receipts`}
        />
        <Stat
          label="Outstanding"
          value={<Money paise={f.outstanding} />}
          tone="warning"
          hint={<FeeStatusBadge status={f.status} />}
        />
        <Stat
          label="Overdue"
          value={<Money paise={f.overdue} />}
          tone="danger"
          hint={f.overdue ? 'past its due date' : 'nothing overdue'}
        />
      </div>

      <Tabs
        label="Student profile sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'history', label: 'Academic history', count: s.history.length },
          { id: 'fees', label: 'Fees & instalments' },
          { id: 'payments', label: 'Payments & receipts', count: s.payments.length },
          { id: 'reminders', label: 'Reminders', count: s.reminders.length },
          { id: 'adjustments', label: 'Concessions', count: s.adjustments.length },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Section title="Basic information">
            <dl className="grid grid-cols-2 gap-4">
              <KV k="Date of birth" v={formatDate(s.dob)} />
              <KV k="Gender" v={s.gender === 'MALE' ? 'Male' : 'Female'} />
              <KV k="Admission no." v={s.admissionNo} />
              <KV k="Admission date" v={formatDate(s.admissionDate)} />
              <KV k="Address" v={s.address} />
              <KV
                k="Status"
                v={
                  s.status === 'ACTIVE'
                    ? 'Active'
                    : s.status === 'INACTIVE'
                      ? 'Inactive'
                      : 'Passed out'
                }
              />
            </dl>
          </Section>
          <Section title="Parent / guardian">
            <div className="mb-3 flex items-center gap-3">
              <span
                aria-hidden
                className="grid size-10 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary"
              >
                {initials(s.guardian.name)}
              </span>
              <p className="font-medium text-ink">{s.guardian.name}</p>
            </div>
            <dl className="grid grid-cols-2 gap-4">
              <KV k="Mobile" v={s.guardian.mobile} />
              <KV k="E-mail" v={s.guardian.email || '—'} />
            </dl>
          </Section>
          <Section title="Current academic information">
            <dl className="grid grid-cols-2 gap-4">
              <KV k="Academic year" v="2026-27" />
              <KV k="Class" v={s.className} />
              <KV k="Division" v={s.divisionName} />
              <KV k="Roll no." v={s.roll} />
              <KV k="Category" v={s.categoryName} />
              <KV k="Concession" v={s.concession ? <Money paise={s.concession} /> : 'None'} />
            </dl>
          </Section>
        </div>
      )}

      {tab === 'history' && (
        <Section
          title="Class by class"
          description="Each year is its own permanent record. Promotion adds a new row; nothing is overwritten."
          flush
        >
          <DataTable
            caption="Academic and fee history"
            rows={s.history}
            rowKey={(h) => h.year}
            columns={[
              {
                key: 'y',
                header: 'Academic year',
                cell: (h) => <span className="font-medium text-ink">{h.year}</span>,
              },
              { key: 'c', header: 'Class', cell: (h) => h.classLabel },
              {
                key: 's',
                header: 'Outcome',
                cell: (h) => (
                  <Badge tone={h.outcome === 'Current' ? 'brand' : 'neutral'}>{h.outcome}</Badge>
                ),
              },
              {
                key: 'p',
                header: 'Payable',
                cell: (h) => <Money paise={h.payable} />,
                align: 'right',
              },
              { key: 'pa', header: 'Paid', cell: (h) => <Money paise={h.paid} />, align: 'right' },
              {
                key: 'b',
                header: 'Balance',
                cell: (h) => <Money paise={h.payable - h.paid} />,
                align: 'right',
              },
            ]}
          />
        </Section>
      )}

      {tab === 'fees' && (
        <div className="space-y-4">
          <Section title="Instalments 2026-27" flush>
            <DataTable
              caption="Instalments"
              rows={s.installments}
              rowKey={(i) => String(i.no)}
              columns={[
                {
                  key: 'n',
                  header: 'Instalment',
                  cell: (i) => <span className="font-medium text-ink">{i.no}</span>,
                },
                { key: 'd', header: 'Due date', cell: (i) => formatDate(i.dueDate) },
                {
                  key: 'p',
                  header: 'Payable',
                  cell: (i) => <Money paise={i.payable} />,
                  align: 'right',
                },
                {
                  key: 'pa',
                  header: 'Paid',
                  cell: (i) => <Money paise={i.paid} />,
                  align: 'right',
                },
                {
                  key: 'pe',
                  header: 'Pending',
                  cell: (i) => <Money paise={i.pending} />,
                  align: 'right',
                },
                { key: 's', header: 'Status', cell: (i) => <InstBadge status={i.status} /> },
              ]}
            />
          </Section>
          <Section
            title="What each instalment contains"
            description="Fee components in instalment 1"
          >
            <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {(s.installments[0]?.components ?? []).map((c) => (
                <li
                  key={c.label}
                  className="flex justify-between border-b border-line py-1.5 text-sm"
                >
                  <span className="text-muted">{c.label}</span>
                  <Money paise={c.amount} />
                </li>
              ))}
            </ul>
          </Section>
          {s.otherReceivables.length > 0 && (
            <Section title="Other amounts" description="Kept separate from the year’s fee" flush>
              <DataTable
                caption="Other receivables"
                rows={s.otherReceivables}
                rowKey={(r) => r.label}
                columns={[
                  { key: 'l', header: 'Item', cell: (r) => r.label },
                  { key: 'd', header: 'Due', cell: (r) => formatDate(r.dueDate) },
                  {
                    key: 'a',
                    header: 'Amount',
                    cell: (r) => <Money paise={r.amount} />,
                    align: 'right',
                  },
                  {
                    key: 'p',
                    header: 'Pending',
                    cell: (r) => <Money paise={r.amount - r.paid} />,
                    align: 'right',
                  },
                ]}
              />
            </Section>
          )}
        </div>
      )}

      {tab === 'payments' && (
        <Section
          title="Payments"
          description="A payment is never deleted — a mistake is reversed with a reason and stays visible."
          flush
        >
          <DataTable
            caption="Payments and receipts"
            rows={s.payments}
            rowKey={(p) => p.id}
            empty="No payment has been made yet."
            columns={[
              {
                key: 'r',
                header: 'Receipt',
                cell: (p) => <span className="font-medium text-ink">{p.receiptNo}</span>,
              },
              { key: 'd', header: 'Date', cell: (p) => formatDate(p.date) },
              {
                key: 'm',
                header: 'Method',
                cell: (p) => `${p.method}${p.reference ? ` · ${p.reference}` : ''}`,
              },
              {
                key: 'a',
                header: 'Amount',
                cell: (p) => <Money paise={p.amount} />,
                align: 'right',
              },
              {
                key: 's',
                header: 'Status',
                cell: (p) =>
                  p.status === 'POSTED' ? (
                    <Badge tone="success">Posted</Badge>
                  ) : (
                    <Badge tone="danger">Reversed</Badge>
                  ),
              },
              {
                key: 'v',
                header: '',
                align: 'right',
                cell: (p) => (
                  <Button size="sm" variant="ghost" onClick={() => setReceipt(p.id)}>
                    <ReceiptIcon className="size-4" aria-hidden /> View
                  </Button>
                ),
              },
            ]}
          />
        </Section>
      )}

      {tab === 'reminders' && (
        <Section title="Reminder history" flush>
          <DataTable
            caption="Reminders sent"
            rows={s.reminders}
            rowKey={(r) => r.id}
            empty="No reminder has been sent to this parent."
            columns={[
              { key: 'd', header: 'Date', cell: (r) => formatDate(r.date) },
              { key: 't', header: 'Type', cell: (r) => r.type },
              { key: 'c', header: 'Channel', cell: (r) => r.channel },
              {
                key: 'm',
                header: 'Message',
                cell: (r) => <span className="line-clamp-2 max-w-md text-muted">{r.message}</span>,
              },
              { key: 'b', header: 'Sent by', cell: (r) => r.sentBy },
              {
                key: 's',
                header: 'Delivery',
                cell: (r) => (
                  <Badge
                    tone={
                      r.status === 'Delivered'
                        ? 'success'
                        : r.status === 'Failed'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {r.status}
                  </Badge>
                ),
              },
            ]}
          />
        </Section>
      )}

      {tab === 'adjustments' && (
        <Section
          title="Discounts, scholarships and concessions"
          description="The original fee stays visible next to every reduction."
          flush
        >
          <DataTable
            caption="Concessions"
            rows={s.adjustments}
            rowKey={(a) => a.id}
            empty="No concession applies to this student."
            columns={[
              { key: 't', header: 'Type', cell: (a) => a.type },
              { key: 'r', header: 'Reason', cell: (a) => a.reason },
              {
                key: 'a',
                header: 'Amount',
                cell: (a) => <Money paise={a.amount} />,
                align: 'right',
              },
              { key: 'ap', header: 'Approved by', cell: (a) => a.approvedBy ?? '—' },
              { key: 'd', header: 'Date', cell: (a) => formatDate(a.date) },
            ]}
          />
        </Section>
      )}
      {receipt && <ReceiptModal paymentId={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

export default function StudentProfilePage() {
  const { id } = useParams();
  const q = useStudent(id);
  return (
    <QueryBoundary query={q}>
      {(s) =>
        s ? (
          <Profile s={s} />
        ) : (
          <Card>
            <EmptyState title="Student not found" />
          </Card>
        )
      }
    </QueryBoundary>
  );
}
