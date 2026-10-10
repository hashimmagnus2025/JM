import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable, FeeStatusBadge, Money, Section } from '../components/data';
import { QueryBoundary } from '../components/QueryBoundary';
import { Badge, Button, Card, Field, FormError, PageHeader, Select } from '../components/ui';
import { useClasses, useDivisions } from '../features/academic/api';
import { useCurrentYear } from '../features/setup/api';
import { usePromote, useStudents } from '../features/students/api';
import { friendlyMessage } from '../lib/messages';

export default function PromotionPage() {
  const classes = useClasses();
  const year = useCurrentYear();
  const divisions = useDivisions(year.data?.id);
  const promote = usePromote();
  const [fromDiv, setFromDiv] = useState('');
  const [toClass, setToClass] = useState('');
  const [toDiv, setToDiv] = useState('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();

  const divList = divisions.data ?? [];
  const classList = (classes.data ?? []).slice().sort((a, b) => a.sequence - b.sequence);
  const from = divList.find((d) => d.id === fromDiv);
  const cls = (id: string) => classList.find((c) => c.id === id);
  const nextClass = from
    ? classList.find((c) => c.sequence === (cls(from.classId)?.sequence ?? 0) + 1)
    : undefined;
  const targetClass = toClass || nextClass?.id || '';
  const list = useStudents({ divisionId: fromDiv, status: 'ACTIVE' }, page, 50);
  const rows = fromDiv ? (list.data?.rows ?? []) : [];

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const withDues = rows.filter((s) => picked.has(s.id) && s.outstanding > 0).length;
  const reset = (div: string) => {
    setFromDiv(div);
    setPicked(new Set());
    setDone(undefined);
    setToClass('');
    setToDiv('');
    setPage(1);
  };

  const run = async () => {
    setError(undefined);
    if (picked.size === 0) return setError('Select at least one student.');
    if (!targetClass || !toDiv) return setError('Choose the class and division they move to.');
    try {
      await promote.mutateAsync({
        studentIds: [...picked],
        toClassId: targetClass,
        toDivisionId: toDiv,
      });
      setDone(
        `${picked.size} student${picked.size === 1 ? '' : 's'} promoted to ${cls(targetClass)?.name}.`,
      );
      toast.success('Promotion saved');
      setPicked(new Set());
    } catch (e) {
      setError(friendlyMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Promotion"
        description="Move students to the next class for the next academic year. Each promotion adds a new record — the old year stays exactly as it was."
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Section
          title="Choose students"
          description="Start from a division, then tick the students who move up."
          flush
        >
          <div className="border-b border-line p-4">
            <Field label="From division">
              {(p) => (
                <Select {...p} value={fromDiv} onChange={(e) => reset(e.target.value)}>
                  <option value="">Choose a division…</option>
                  {divList.map((d) => (
                    <option key={d.id} value={d.id}>
                      {cls(d.classId)?.name} · {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {fromDiv && (
            <QueryBoundary query={list}>
              {(d) => (
                <>
                  <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-sm">
                    <label className="inline-flex items-center gap-2 text-ink">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={picked.size === d.rows.length && d.rows.length > 0}
                        onChange={(e) =>
                          setPicked(e.target.checked ? new Set(d.rows.map((s) => s.id)) : new Set())
                        }
                      />
                      Select all ({d.rows.length})
                    </label>
                    <span className="text-muted">{picked.size} selected</span>
                  </div>
                  <DataTable
                    caption="Students in the division"
                    rows={d.rows}
                    rowKey={(s) => s.id}
                    pageSize={50}
                    paging={{ page: page - 1, total: d.total, onPage: (p) => setPage(p + 1) }}
                    columns={[
                      {
                        key: 'c',
                        header: '',
                        cell: (s) => (
                          <input
                            type="checkbox"
                            aria-label={`Select ${s.name}`}
                            className="size-4 accent-[var(--primary)]"
                            checked={picked.has(s.id)}
                            onChange={() => toggle(s.id)}
                          />
                        ),
                      },
                      {
                        key: 'n',
                        header: 'Student',
                        cell: (s) => <span className="font-medium text-ink">{s.name}</span>,
                      },
                      { key: 'r', header: 'Roll', cell: (s) => s.roll },
                      {
                        key: 'f',
                        header: 'Fee status',
                        cell: (s) => <FeeStatusBadge status={s.feeStatus} />,
                      },
                      {
                        key: 'o',
                        header: 'Outstanding',
                        cell: (s) => <Money paise={s.outstanding} />,
                        align: 'right',
                      },
                    ]}
                  />
                </>
              )}
            </QueryBoundary>
          )}
        </Section>
        <div className="space-y-4">
          <Card className="space-y-4 p-5">
            <h2 className="text-base font-semibold text-ink">Move to</h2>
            <p className="flex items-center gap-2 text-sm text-muted">
              {from ? `${cls(from.classId)?.name} · ${from.name}` : 'Choose a division'}{' '}
              <ArrowRight className="size-4" aria-hidden /> <Badge tone="brand">next year</Badge>
            </p>
            <Field label="Class">
              {(p) => (
                <Select
                  {...p}
                  value={targetClass}
                  disabled={!fromDiv}
                  onChange={(e) => {
                    setToClass(e.target.value);
                    setToDiv('');
                  }}
                >
                  {classList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Division" required>
              {(p) => (
                <Select
                  {...p}
                  value={toDiv}
                  disabled={!fromDiv}
                  onChange={(e) => setToDiv(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {divList
                    .filter((d) => d.classId === targetClass)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            {withDues > 0 && (
              <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning" role="status">
                {withDues} of the selected students still owe fees. Their dues stay with this year —
                they do not move with the student.
              </p>
            )}
            <FormError message={error} />
            {done && (
              <p
                className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-sm text-success"
                role="status"
              >
                <CheckCircle2 className="size-4" aria-hidden /> {done}
              </p>
            )}
            <Button className="w-full" onClick={() => void run()} loading={promote.isPending}>
              Promote selected
            </Button>
          </Card>
          <Card className="p-5 text-sm text-muted">
            <p className="mb-1 font-medium text-ink">What happens</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>A new enrollment is created for the new year.</li>
              <li>The fee structure of the new class is attached.</li>
              <li>Last year’s class, fees and receipts are never changed.</li>
              <li>Students in the last class graduate instead.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
