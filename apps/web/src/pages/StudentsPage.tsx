import { Download, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { QueryBoundary } from '../components/QueryBoundary';
import { PermissionGate } from '../components/PermissionGate';
import { DataTable, FeeStatusBadge, Money, downloadCsv, type Column } from '../components/data';
import { Badge, Button, Card, Input, PageHeader, Select } from '../components/ui';
import { useCan } from '../features/auth/auth';
import { useClasses, useDivisions } from '../features/academic/api';
import { useStudents, type StudentRow } from '../features/students/api';
import { useCategories, useCurrentYear } from '../features/setup/api';
import { initials } from '../lib/format';

const FEE_FILTERS = [
  ['', 'Any fee status'],
  ['PAID', 'Paid up to date'],
  ['PARTIAL', 'Partially paid'],
  ['UNPAID', 'Unpaid'],
  ['OVERDUE', 'Overdue'],
  ['DUE_SOON', 'Due soon'],
] as const;

export default function StudentsPage() {
  const navigate = useNavigate();
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  const [page, setPage] = useState(1);
  const f = {
    q: sp.get('q') ?? '',
    classId: sp.get('class') ?? '',
    divisionId: sp.get('division') ?? '',
    feeStatus: sp.get('fee') ?? '',
    categoryCode: sp.get('category') ?? '',
    status: sp.get('status') ?? 'ACTIVE',
  };
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'class') next.delete('division');
    setSp(next, { replace: true });
    setPage(1);
  };

  const classes = useClasses();
  const year = useCurrentYear();
  const divisions = useDivisions(f.classId ? year.data?.id : undefined);
  const categories = useCategories();
  const query = useStudents(f, page);
  const total = query.data?.total ?? 0;

  const cols: Column<StudentRow>[] = [
    {
      key: 'n',
      header: 'Student',
      cell: (s) => (
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary"
          >
            {initials(s.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{s.name}</p>
            <p className="text-xs text-muted">
              {s.studentId} · {s.admissionNo}
            </p>
          </div>
        </div>
      ),
    },
    { key: 'c', header: 'Class', cell: (s) => s.classLabel },
    {
      key: 'g',
      header: 'Parent',
      cell: (s) => (
        <div>
          <p>{s.guardian}</p>
          {can('student.viewContact') && s.mobile && (
            <p className="text-xs text-muted">{s.mobile}</p>
          )}
        </div>
      ),
    },
    { key: 'cat', header: 'Category', cell: (s) => s.categoryName },
    {
      key: 'st',
      header: 'Fee status',
      cell: (s) =>
        s.status === 'ACTIVE' ? (
          <FeeStatusBadge status={s.feeStatus} />
        ) : (
          <Badge>{s.status === 'INACTIVE' ? 'Inactive' : 'Passed out'}</Badge>
        ),
    },
    {
      key: 'o',
      header: 'Outstanding',
      cell: (s) => <Money paise={s.outstanding} />,
      align: 'right',
    },
  ];

  const exportCsv = () =>
    downloadCsv(
      'students.csv',
      ['Student ID', 'Name', 'Class', 'Parent', 'Category', 'Fee status', 'Outstanding (₹)'],
      (query.data?.rows ?? []).map((s) => [
        s.studentId,
        s.name,
        s.classLabel,
        s.guardian,
        s.categoryName,
        s.feeStatus,
        s.outstanding / 100,
      ]),
    );
  const filtered = !!(f.q || f.classId || f.divisionId || f.feeStatus || f.categoryCode);

  return (
    <>
      <PageHeader
        title="Students"
        description="Everyone enrolled, with their class and fee position. Select a student for the complete 360° profile."
        actions={
          <>
            {can('student.export') && (
              <Button variant="secondary" onClick={exportCsv}>
                <Download className="size-4" aria-hidden /> Export this page
              </Button>
            )}
            <PermissionGate permission="student.create">
              <Link to="/students/new">
                <Button>
                  <Plus className="size-4" aria-hidden /> New student
                </Button>
              </Link>
            </PermissionGate>
          </>
        }
      />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative sm:col-span-2">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <Input
              aria-label="Search students"
              placeholder="Name, student ID, admission no., parent, mobile"
              className="pl-9"
              value={f.q}
              onChange={(e) => set('q', e.target.value)}
            />
          </div>
          <Select
            aria-label="Class"
            value={f.classId}
            onChange={(e) => set('class', e.target.value)}
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
            onChange={(e) => set('division', e.target.value)}
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
            aria-label="Fee status"
            value={f.feeStatus}
            onChange={(e) => set('fee', e.target.value)}
          >
            {FEE_FILTERS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Category"
            value={f.categoryCode}
            onChange={(e) => set('category', e.target.value)}
          >
            <option value="">All categories</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>
            <strong className="text-ink">{total.toLocaleString('en-IN')}</strong> students
          </span>
          <span aria-hidden>·</span>
          <label className="inline-flex items-center gap-2">
            Showing
            <select
              aria-label="Student status"
              className="rounded-md border border-line-strong bg-surface px-2 py-1 text-ink"
              value={f.status}
              onChange={(e) => set('status', e.target.value === 'ACTIVE' ? '' : e.target.value)}
            >
              <option value="ACTIVE">active students</option>
              <option value="INACTIVE">inactive students</option>
              <option value="ALL">all students</option>
            </select>
          </label>
          {filtered && (
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => {
                setSp(new URLSearchParams(), { replace: true });
                setPage(1);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </Card>
      <Card>
        <QueryBoundary query={query}>
          {(d) => (
            <DataTable
              caption="Students"
              columns={cols}
              rows={d.rows}
              rowKey={(s) => s.id}
              pageSize={15}
              paging={{ page: page - 1, total: d.total, onPage: (p) => setPage(p + 1) }}
              onRowClick={(s) => navigate(`/students/${s.id}`)}
              empty="No student matches these filters."
            />
          )}
        </QueryBoundary>
      </Card>
    </>
  );
}
