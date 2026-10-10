import { Bell, Download } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DataTable, Money, Progress, Section, Stat, downloadCsv } from '../components/data';
import { QueryBoundary } from '../components/QueryBoundary';
import { Badge, Button, Card, Input, PageHeader, Select } from '../components/ui';
import { useCan } from '../features/auth/auth';
import { useClasses, useDivisions } from '../features/academic/api';
import { useOutstanding } from '../features/receivables/api';
import { useCurrentYear } from '../features/setup/api';
import { formatDate } from '../lib/format';

export default function OutstandingPage() {
  const navigate = useNavigate();
  const can = useCan();
  const classes = useClasses();
  const year = useCurrentYear();
  const [f, setF] = useState({
    q: '',
    classId: '',
    divisionId: '',
    bucket: '',
    scope: 'overdue' as 'overdue' | 'all',
  });
  const [page, setPage] = useState(1);
  const divisions = useDivisions(f.classId ? year.data?.id : undefined);
  const set = (k: keyof typeof f, v: string) => {
    setF((p) => ({ ...p, [k]: v, ...(k === 'classId' ? { divisionId: '' } : {}) }));
    setPage(1);
  };
  const query = useOutstanding(f, page);
  const meta = query.data?.meta;
  const agTotal = (meta?.aging ?? []).reduce((t, a) => t + a.amount, 0) || 1;

  return (
    <>
      <PageHeader
        title="Outstanding fees"
        description="Everything still to be collected, who owes it and for how long. Overdue amounts are aged from their own original due date."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!query.data}
              onClick={() =>
                downloadCsv(
                  'outstanding.csv',
                  [
                    'Student',
                    'ID',
                    'Class',
                    'Parent',
                    'Mobile',
                    'Overdue since',
                    'Overdue (₹)',
                    'Outstanding (₹)',
                  ],
                  (query.data?.rows ?? []).map((r) => [
                    r.name,
                    r.studentCode,
                    r.classLabel,
                    r.guardian,
                    r.mobile,
                    r.oldestDueDate ?? '',
                    r.overdue / 100,
                    r.outstanding / 100,
                  ]),
                )
              }
            >
              <Download className="size-4" aria-hidden /> Export this page
            </Button>
            {can('reminder.send') && (
              <Link to={`/receivables/reminders${f.classId ? `?class=${f.classId}` : ''}`}>
                <Button>
                  <Bell className="size-4" aria-hidden /> Send reminders
                </Button>
              </Link>
            )}
          </>
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Students" value={(meta?.totals.students ?? 0).toLocaleString('en-IN')} />
        <Stat
          label="Outstanding"
          value={<Money paise={meta?.totals.outstanding ?? 0} compact />}
          tone="warning"
        />
        <Stat
          label="Overdue"
          value={<Money paise={meta?.totals.overdue ?? 0} compact />}
          tone="danger"
        />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card className="h-fit p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              aria-label="Search"
              placeholder="Name, ID, parent, mobile"
              value={f.q}
              onChange={(e) => set('q', e.target.value)}
            />
            <Select
              aria-label="Class"
              value={f.classId}
              onChange={(e) => set('classId', e.target.value)}
            >
              <option value="">All classes</option>
              {(classes.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Division"
              value={f.divisionId}
              disabled={!f.classId}
              onChange={(e) => set('divisionId', e.target.value)}
            >
              <option value="">All divisions</option>
              {(divisions.data ?? [])
                .filter((d) => d.classId === f.classId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </Select>
            <Select
              aria-label="Show"
              value={f.scope}
              onChange={(e) => set('scope', e.target.value)}
            >
              <option value="overdue">Overdue only</option>
              <option value="all">Everything still pending</option>
            </Select>
            <Select
              aria-label="Overdue for"
              value={f.bucket}
              onChange={(e) => set('bucket', e.target.value)}
            >
              <option value="">Any age</option>
              {(meta?.aging ?? []).map((a) => (
                <option key={a.bucket}>{a.bucket}</option>
              ))}
            </Select>
          </div>
        </Card>
        <Section title="Overdue by age">
          <ul className="space-y-2.5">
            {(meta?.aging ?? []).map((a) => (
              <li key={a.bucket}>
                <button
                  type="button"
                  onClick={() => set('bucket', f.bucket === a.bucket ? '' : a.bucket)}
                  className="block w-full text-left"
                  aria-pressed={f.bucket === a.bucket}
                >
                  <span className="mb-1 flex justify-between text-sm">
                    <span
                      className={f.bucket === a.bucket ? 'font-semibold text-primary' : 'text-ink'}
                    >
                      {a.bucket}
                    </span>
                    <Money paise={a.amount} compact />
                  </span>
                  <Progress pct={(a.amount / agTotal) * 100} label={a.bucket} />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <Card>
        <QueryBoundary query={query}>
          {(d) => (
            <DataTable
              caption="Students with outstanding fees"
              rows={d.rows}
              rowKey={(r) => r.id}
              pageSize={15}
              paging={{ page: page - 1, total: d.meta.total, onPage: (p) => setPage(p + 1) }}
              onRowClick={(r) => navigate(`/students/${r.id}`)}
              empty="Nobody owes anything for this selection."
              columns={[
                {
                  key: 'n',
                  header: 'Student',
                  cell: (r) => (
                    <div>
                      <p className="font-medium text-ink">{r.name}</p>
                      <p className="text-xs text-muted">{r.studentCode}</p>
                    </div>
                  ),
                },
                { key: 'c', header: 'Class', cell: (r) => r.classLabel },
                {
                  key: 'g',
                  header: 'Parent',
                  cell: (r) => (
                    <div>
                      <p>{r.guardian}</p>
                      {can('student.viewContact') && (
                        <p className="text-xs text-muted">{r.mobile}</p>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'since',
                  header: 'Overdue since',
                  cell: (r) =>
                    r.oldestDueDate ? (
                      <span>
                        {formatDate(r.oldestDueDate)}{' '}
                        <Badge
                          tone={
                            r.daysOverdue > 90
                              ? 'danger'
                              : r.daysOverdue > 30
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {r.daysOverdue} days
                        </Badge>
                      </span>
                    ) : (
                      <span className="text-muted">Not yet due</span>
                    ),
                },
                {
                  key: 'ov',
                  header: 'Overdue',
                  cell: (r) => <Money paise={r.overdue} />,
                  align: 'right',
                },
                {
                  key: 'o',
                  header: 'Outstanding',
                  cell: (r) => <Money paise={r.outstanding} />,
                  align: 'right',
                },
              ]}
            />
          )}
        </QueryBoundary>
      </Card>
    </>
  );
}
