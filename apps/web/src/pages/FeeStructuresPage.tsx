import { CheckCircle2, History } from 'lucide-react';
import { useState } from 'react';
import { DataTable, Money, Section } from '../components/data';
import { QueryBoundary } from '../components/QueryBoundary';
import { Badge, Card, Field, PageHeader, Select } from '../components/ui';
import { useClasses } from '../features/academic/api';
import { useFeeStructure, type FeeStructureData } from '../features/fees/api';
import { formatDate } from '../lib/format';

function Body({ d }: { d: FeeStructureData }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Section
          title={`${d.className} · ${d.year}`}
          description={`Applies to ${d.studentCount} active students (General category rate)`}
          flush
        >
          <DataTable
            caption="Fee components"
            rows={d.lines}
            rowKey={(l) => l.code}
            columns={[
              {
                key: 'l',
                header: 'Fee component',
                cell: (l) => <span className="font-medium text-ink">{l.label}</span>,
              },
              { key: 'w', header: 'Charged', cell: () => 'In 4 instalments' },
              {
                key: 'a',
                header: 'Amount',
                cell: (l) => <Money paise={l.amount} />,
                align: 'right',
              },
            ]}
          />
          <div className="flex justify-between border-t border-line px-4 py-3 font-semibold text-ink">
            <span>Total for the year</span>
            <Money paise={d.total} />
          </div>
          <div className="flex justify-between border-t border-line px-4 py-3 text-sm text-muted">
            <span>Admission fee (new students only)</span>
            <Money paise={d.admissionFee} />
          </div>
        </Section>
      </div>
      <div className="space-y-4">
        <Section title="Category rates" description="Concession on the tuition fee">
          <ul className="space-y-2.5 text-sm">
            {d.categoryRates.map((c) => (
              <li key={c.code} className="flex items-center justify-between gap-2">
                <span className="text-ink">{c.name}</span>
                <span className="text-muted tabular-nums">
                  {c.concessionPct === 0 ? 'Full fee' : `${c.concessionPct}% off`} ·{' '}
                  <Money paise={c.total} />
                </span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Instalment plan">
          <ol className="space-y-2 text-sm">
            {d.instalments.map((i) => (
              <li key={i.no} className="flex justify-between">
                <span className="text-muted">
                  Instalment {i.no} · {formatDate(i.dueDate)}
                </span>
                <Money paise={i.amount} />
              </li>
            ))}
          </ol>
          <p className="mt-3 flex items-start gap-2 text-xs text-muted">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> The plan
            can be changed per class, or per student with a reason.
          </p>
        </Section>
      </div>
    </div>
  );
}

export default function FeeStructuresPage() {
  const classes = useClasses();
  const [year, setYear] = useState('2026-27');
  const [classId, setClassId] = useState('');
  const first = (classes.data ?? [])[0]?.id ?? '';
  const q = useFeeStructure(year, classId || first);
  const d = q.data;
  return (
    <>
      <PageHeader
        title="Fee structures"
        description="The fee for each class, year by year. A published structure is never edited in place — a change makes a new version, and past years stay as they were."
      />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Academic year">
            {(p) => (
              <Select {...p} value={year} onChange={(e) => setYear(e.target.value)}>
                {(d?.years ?? [{ id: year, label: year }]).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Class">
            {(p) => (
              <Select {...p} value={classId || first} onChange={(e) => setClassId(e.target.value)}>
                {(classes.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {d && (
            <div className="flex items-end gap-2 pb-1">
              <Badge
                tone={
                  d.status === 'Published'
                    ? 'success'
                    : d.status === 'Draft'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {d.status}
              </Badge>
              <span className="inline-flex items-center gap-1 text-sm text-muted">
                <History className="size-4" aria-hidden /> Version {d.version}
              </span>
            </div>
          )}
        </div>
      </Card>
      <QueryBoundary query={q}>{(data) => <Body d={data} />}</QueryBoundary>
    </>
  );
}
