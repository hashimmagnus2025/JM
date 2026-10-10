import {
  ColumnChart,
  DataTable,
  Money,
  Progress,
  Section,
  Stat,
  pctTone,
} from '../components/data';
import { QueryBoundary } from '../components/QueryBoundary';
import { PageHeader } from '../components/ui';
import { useTargets, type TargetsData } from '../features/insights/api';

function Body({ d }: { d: TargetsData }) {
  const f = d.forecast;
  return (
    <>
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Expected this year" value={<Money paise={f.expectedAnnual} compact />} />
        <Stat
          label="Collected till date"
          value={<Money paise={f.collectedToDate} compact />}
          tone="success"
          hint={`${f.currentRate}% of the target to date`}
        />
        <Stat
          label="Still to collect"
          value={<Money paise={f.outstanding} compact />}
          tone="warning"
        />
        <Stat
          label="Projected by March"
          value={<Money paise={f.projected} compact />}
          tone="info"
          hint={`${f.projectedPct}% of the year’s fee — an estimate from the current trend`}
        />
      </div>
      <div className="mb-4">
        <Section
          title="Monthly target and collection"
          description="The dashed bar is the target; the solid bar is what was collected"
        >
          <ColumnChart
            label="Monthly target and collection"
            data={d.months.map((x) => ({
              name: x.month,
              value: x.actual,
              target: x.target,
              muted: x.future,
            }))}
          />
        </Section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Month by month" flush>
          <DataTable
            caption="Monthly targets"
            rows={d.months}
            rowKey={(m) => m.month}
            pageSize={12}
            columns={[
              {
                key: 'm',
                header: 'Month',
                cell: (m) => <span className="font-medium text-ink">{m.month}</span>,
              },
              {
                key: 't',
                header: 'Target',
                cell: (m) => <Money paise={m.target} compact />,
                align: 'right',
              },
              {
                key: 'a',
                header: 'Collected',
                cell: (m) => (m.future ? '—' : <Money paise={m.actual} compact />),
                align: 'right',
              },
              {
                key: 'p',
                header: 'Achieved',
                cell: (m) =>
                  m.future ? '—' : `${m.target ? Math.round((m.actual / m.target) * 100) : 0}%`,
                align: 'right',
              },
            ]}
          />
        </Section>
        <Section
          title="Class-wise achievement"
          description="Collected so far against the year’s expected fee"
        >
          <ul className="space-y-3">
            {d.classes.map((c) => (
              <li key={c.id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium text-ink">{c.name}</span>
                  <span className="text-muted tabular-nums">{c.pct}%</span>
                </div>
                <Progress pct={c.pct} tone={pctTone(c.pct)} label={`${c.name} achievement`} />
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}

export default function TargetsPage() {
  const q = useTargets();
  return (
    <>
      <PageHeader
        title="Targets & forecast"
        description="How collection is tracking against the plan, and where the year is likely to end."
      />
      <QueryBoundary query={q}>{(d) => <Body d={d} />}</QueryBoundary>
    </>
  );
}
