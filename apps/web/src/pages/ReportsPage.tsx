import { ArrowLeft, Download, FileText } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataTable, Money, Section, downloadCsv, type Column } from '../components/data';
import { QueryBoundary } from '../components/QueryBoundary';
import { Button, Card, Field, Input, PageHeader, Select } from '../components/ui';
import { useCan } from '../features/auth/auth';
import { useClasses } from '../features/academic/api';
import {
  useReport,
  useReportCatalog,
  type ReportInfo,
  type ReportResult,
} from '../features/insights/api';
import { formatDate } from '../lib/format';

function ReportView({ info, onBack }: { info: ReportInfo; onBack: () => void }) {
  const can = useCan();
  const classes = useClasses();
  const [f, setF] = useState({ classId: '', from: '', to: '' });
  const q = useReport(info.key, {
    ...(f.classId ? { classId: f.classId } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
  });
  const showClass = ['student-wise', 'division-wise', 'outstanding', 'overdue'].includes(info.key);
  const showDates = info.key === 'date-wise';

  const cell = (c: ReportResult['columns'][number], v: string | number | null) =>
    v === null || v === '' ? (
      '—'
    ) : c.type === 'money' ? (
      <Money paise={Number(v)} />
    ) : c.type === 'date' ? (
      formatDate(String(v))
    ) : c.type === 'number' ? (
      Number(v).toLocaleString('en-IN')
    ) : (
      String(v)
    );

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden /> All reports
      </button>
      <PageHeader
        title={info.title}
        description={info.description}
        actions={
          can('report.export') && q.data ? (
            <Button
              variant="secondary"
              onClick={() =>
                downloadCsv(
                  `${info.key}.csv`,
                  q.data.columns.map((c) => c.header),
                  q.data.rows.map((r) =>
                    q.data.columns.map((c) =>
                      c.type === 'money' ? Number(r[c.key] ?? 0) / 100 : (r[c.key] ?? ''),
                    ),
                  ),
                )
              }
            >
              <Download className="size-4" aria-hidden /> Export CSV
            </Button>
          ) : undefined
        }
      />
      {(showClass || showDates) && (
        <Card className="mb-4 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {showClass && (
              <Field label="Class">
                {(p) => (
                  <Select
                    {...p}
                    value={f.classId}
                    onChange={(e) => setF({ ...f, classId: e.target.value })}
                  >
                    <option value="">
                      {info.key === 'division-wise' ? 'Class 10' : 'All classes'}
                    </option>
                    {(classes.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {showDates && (
              <>
                <Field label="From">
                  {(p) => (
                    <Input
                      {...p}
                      type="date"
                      value={f.from}
                      onChange={(e) => setF({ ...f, from: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="To">
                  {(p) => (
                    <Input
                      {...p}
                      type="date"
                      value={f.to}
                      onChange={(e) => setF({ ...f, to: e.target.value })}
                    />
                  )}
                </Field>
              </>
            )}
          </div>
        </Card>
      )}
      <Card>
        <QueryBoundary query={q}>
          {(d) => {
            const cols: Column<Record<string, string | number | null>>[] = d.columns.map((c) => ({
              key: c.key,
              header: c.header,
              align: c.type === 'money' || c.type === 'number' ? ('right' as const) : undefined,
              cell: (r) => cell(c, r[c.key] ?? null),
            }));
            return (
              <>
                <DataTable
                  caption={d.title}
                  columns={cols}
                  rows={d.rows}
                  rowKey={(r) => JSON.stringify(r)}
                  pageSize={15}
                  empty="No data for this selection."
                />
                {d.totals && (
                  <div className="flex flex-wrap justify-end gap-x-8 gap-y-1 border-t border-line bg-surface-2/60 px-4 py-3 text-sm font-semibold text-ink">
                    {d.columns
                      .filter((c) => d.totals && c.key in d.totals)
                      .map((c) => (
                        <span key={c.key}>
                          {c.header}:{' '}
                          {c.type === 'money' ? (
                            <Money paise={Number(d.totals![c.key])} />
                          ) : (
                            Number(d.totals![c.key]).toLocaleString('en-IN')
                          )}
                        </span>
                      ))}
                  </div>
                )}
              </>
            );
          }}
        </QueryBoundary>
      </Card>
    </>
  );
}

export default function ReportsPage() {
  const [sp, setSp] = useSearchParams();
  const catalog = useReportCatalog();
  const open = sp.get('report');
  return (
    <QueryBoundary query={catalog}>
      {(list) => {
        const info = list.find((r) => r.key === open);
        if (info) return <ReportView info={info} onBack={() => setSp({})} />;
        const groups = [...new Set(list.map((r) => r.group))];
        return (
          <>
            <PageHeader
              title="Reports"
              description="Ready-made reports. Open one, filter it, and export what you see."
            />
            <div className="space-y-6">
              {groups.map((g) => (
                <Section key={g} title={g}>
                  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {list
                      .filter((r) => r.group === g)
                      .map((r) => (
                        <li key={r.key}>
                          <button
                            type="button"
                            onClick={() => setSp({ report: r.key })}
                            className="flex h-full w-full items-start gap-3 rounded-xl border border-line p-4 text-left transition-colors hover:border-primary hover:bg-primary-soft"
                          >
                            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                              <FileText className="size-4" aria-hidden />
                            </span>
                            <span>
                              <span className="block font-medium text-ink">{r.title}</span>
                              <span className="block text-[13px] text-muted">{r.description}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                  </ul>
                </Section>
              ))}
            </div>
          </>
        );
      }}
    </QueryBoundary>
  );
}
