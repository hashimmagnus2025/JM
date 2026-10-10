import {
  AlertTriangle,
  BadgeIndianRupee,
  CalendarClock,
  GraduationCap,
  LayoutGrid,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { QueryBoundary } from '../../components/QueryBoundary';
import {
  ColumnChart,
  DataTable,
  FeeStatusBadge,
  Money,
  Progress,
  Section,
  SplitBar,
  Stat,
  pctTone,
  rsShort,
  type Column,
} from '../../components/data';
import { formatDate } from '../../lib/format';
import { useDashboard, type ClassFeeRow, type DashboardData } from './api';

function Body({ d }: { d: DashboardData }) {
  const navigate = useNavigate();
  const agTotal = d.aging.reduce((t, a) => t + a.amount, 0) || 1;
  const methodTotal = d.methods.reduce((t, m) => t + m.amount, 0) || 1;
  const ranked = [...d.classes].sort((a, b) => a.pct - b.pct);

  const cols: Column<ClassFeeRow>[] = [
    {
      key: 'c',
      header: 'Class',
      cell: (r) => <span className="font-medium text-ink">{r.name}</span>,
    },
    { key: 'd', header: 'Divisions', cell: (r) => r.divisions, align: 'right' },
    {
      key: 's',
      header: 'Students',
      cell: (r) => r.students.toLocaleString('en-IN'),
      align: 'right',
    },
    {
      key: 'e',
      header: 'Expected',
      cell: (r) => <Money paise={r.expected} compact />,
      align: 'right',
    },
    {
      key: 'co',
      header: 'Collected',
      cell: (r) => <Money paise={r.collected} compact />,
      align: 'right',
    },
    {
      key: 'o',
      header: 'Outstanding',
      cell: (r) => <Money paise={r.outstanding} compact />,
      align: 'right',
    },
    {
      key: 'p',
      header: 'Collection',
      className: 'min-w-36',
      cell: (r) => (
        <div className="flex items-center gap-2">
          <Progress pct={r.pct} tone={pctTone(r.pct)} label={`${r.name} collection`} />
          <span className="w-12 text-right text-xs text-muted tabular-nums">{r.pct}%</span>
        </div>
      ),
    },
  ];
  const statusLinks = [
    ['PAID', 'Paid up to date'],
    ['PARTIAL', 'Partially paid'],
    ['UNPAID', 'Unpaid'],
    ['OVERDUE', 'Overdue'],
    ['DUE_SOON', 'Due soon'],
  ] as const;

  return (
    <>
      <p className="mb-4 text-sm text-muted">
        Academic year <strong className="text-ink">{d.yearLabel}</strong> · figures as on{' '}
        {formatDate(d.asOf)}
      </p>
      <section
        aria-label="Academic overview"
        className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Stat
          label="Classes"
          value={d.academic.classes}
          icon={<GraduationCap className="size-5" aria-hidden />}
        />
        <Stat
          label="Divisions"
          value={d.academic.divisions}
          hint={
            d.academic.unassignedDivisions
              ? `${d.academic.unassignedDivisions} without a class teacher`
              : 'all have a class teacher'
          }
          icon={<LayoutGrid className="size-5" aria-hidden />}
        />
        <Stat
          label="Active students"
          value={d.academic.students.toLocaleString('en-IN')}
          hint={`${d.academic.receipts.toLocaleString('en-IN')} receipts this year`}
          icon={<Users className="size-5" aria-hidden />}
        />
        <Stat
          label="Teachers"
          value={d.academic.teachers}
          icon={<GraduationCap className="size-5" aria-hidden />}
        />
      </section>

      <section
        aria-label="Fee collection"
        className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Stat
          label="Expected fees"
          value={rsShort(d.fees.expected)}
          hint="whole year, all students"
          icon={<BadgeIndianRupee className="size-5" aria-hidden />}
        />
        <Stat
          label="Collected"
          value={rsShort(d.fees.collected)}
          hint={`${d.fees.collectionPct}% of the amount due so far`}
          tone="success"
          icon={<Wallet className="size-5" aria-hidden />}
        />
        <Stat
          label="Outstanding"
          value={rsShort(d.fees.outstanding)}
          hint={`${rsShort(d.fees.upcoming30)} falls due in 30 days`}
          tone="warning"
          icon={<CalendarClock className="size-5" aria-hidden />}
        />
        <Stat
          label="Overdue"
          value={rsShort(d.fees.overdue)}
          hint={`${d.status.OVERDUE.toLocaleString('en-IN')} students`}
          tone="danger"
          icon={<AlertTriangle className="size-5" aria-hidden />}
        />
        <Stat
          label="Today’s collection"
          value={rsShort(d.fees.today)}
          icon={<TrendingUp className="size-5" aria-hidden />}
        />
        <Stat
          label="This month"
          value={rsShort(d.fees.month)}
          icon={<TrendingUp className="size-5" aria-hidden />}
        />
        <Stat
          label="Target achieved"
          value={`${d.fees.targetPct}%`}
          hint={`of ${rsShort(d.fees.target)} due to date`}
          tone="info"
        />
        <Stat
          label="Collection rate"
          value={`${d.fees.collectionPct}%`}
          hint="of the amount due so far"
          tone={pctTone(d.fees.collectionPct) === 'success' ? 'success' : 'warning'}
        />
      </section>

      <div className="mb-6 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Section
            title="Collection by month"
            description="Collected against the target that follows the instalment calendar"
          >
            <ColumnChart
              label="Collection by month"
              data={d.monthly.map((x) => ({
                name: x.month,
                value: x.actual,
                target: x.target,
                muted: x.future,
              }))}
            />
          </Section>
        </div>
        <Section title="Student payment status" description="Select a group to see its students">
          <SplitBar
            label="Students by payment status"
            parts={[
              { name: 'Paid up to date', value: d.status.PAID, cls: 'bg-success' },
              { name: 'Partially paid', value: d.status.PARTIAL, cls: 'bg-info' },
              { name: 'Unpaid', value: d.status.UNPAID, cls: 'bg-line-strong' },
              { name: 'Overdue', value: d.status.OVERDUE, cls: 'bg-danger' },
            ]}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {statusLinks.map(([k, l]) => (
              <Link
                key={k}
                to={`/students?fee=${k}`}
                className="rounded-full border border-line-strong px-3 py-1 text-xs font-medium text-ink hover:bg-primary-soft hover:text-primary"
              >
                {l} · {d.status[k].toLocaleString('en-IN')}
              </Link>
            ))}
          </div>
        </Section>
      </div>

      <div className="mb-6">
        <Section title="Class-wise summary" description="Select a class to see its students" flush>
          <DataTable
            caption="Class-wise fee summary"
            columns={cols}
            rows={d.classes}
            rowKey={(r) => r.id}
            pageSize={12}
            onRowClick={(r) => navigate(`/students?class=${r.id}`)}
          />
        </Section>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Section title="Class performance" description="Lowest collection first — needs follow-up">
          <ul className="space-y-3">
            {ranked.slice(0, 5).map((r) => (
              <li key={r.id}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="font-medium text-ink">{r.name}</span>
                  <span className="text-muted tabular-nums">
                    {r.pct}% · <Money paise={r.outstanding} compact /> pending
                  </span>
                </div>
                <Progress pct={r.pct} tone={pctTone(r.pct)} label={`${r.name} collection`} />
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Overdue by age" description="Each amount is aged from its own due date">
          <ul className="space-y-3">
            {d.aging.map((a, i) => (
              <li key={a.bucket}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="text-ink">{a.bucket}</span>
                  <span className="font-medium text-ink">
                    <Money paise={a.amount} compact />
                  </span>
                </div>
                <Progress
                  pct={(a.amount / agTotal) * 100}
                  tone={i === 3 ? 'danger' : i === 2 ? 'warning' : 'primary'}
                  label={a.bucket}
                />
              </li>
            ))}
          </ul>
          <Link
            to="/receivables/outstanding"
            className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
          >
            View outstanding fees →
          </Link>
        </Section>
        <Section title="How parents pay" description="Collected amount by method">
          <ul className="space-y-3">
            {d.methods.map((m) => (
              <li key={m.method}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="text-ink">{m.method}</span>
                  <span className="text-muted tabular-nums">
                    <Money paise={m.amount} compact /> ·{' '}
                    {Math.round((m.amount / methodTotal) * 100)}%
                  </span>
                </div>
                <Progress pct={(m.amount / methodTotal) * 100} label={m.method} />
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section
        title="Largest overdue balances"
        description="Where a reminder or a call helps most"
        flush
        action={
          <Link
            to="/receivables/reminders"
            className="text-sm font-medium text-primary hover:underline"
          >
            Send reminders →
          </Link>
        }
      >
        <DataTable
          caption="Largest overdue balances"
          rows={d.topOverdue}
          rowKey={(x) => x.id}
          pageSize={8}
          onRowClick={(x) => navigate(`/students/${x.id}`)}
          columns={[
            {
              key: 'n',
              header: 'Student',
              cell: (x) => <span className="font-medium text-ink">{x.name}</span>,
            },
            { key: 'c', header: 'Class', cell: (x) => x.classLabel },
            { key: 'g', header: 'Parent', cell: (x) => x.guardian },
            { key: 'st', header: 'Status', cell: (x) => <FeeStatusBadge status={x.status} /> },
            {
              key: 'o',
              header: 'Overdue',
              cell: (x) => <Money paise={x.overdue} />,
              align: 'right',
            },
          ]}
        />
      </Section>
    </>
  );
}

export function ManagementDashboard() {
  const q = useDashboard();
  return <QueryBoundary query={q}>{(d) => <Body d={d} />}</QueryBoundary>;
}
