import { Search } from 'lucide-react';
import { useState } from 'react';
import { DataTable } from '../components/data';
import { QueryBoundary } from '../components/QueryBoundary';
import { Badge, Card, Input, PageHeader } from '../components/ui';
import { useAudit } from '../features/admin/api';

const tone = (a: string) =>
  a.includes('REVERSED')
    ? 'danger'
    : a.includes('POSTED') || a.includes('CREATED') || a.includes('APPROVED')
      ? 'success'
      : a.includes('CHANGED') || a.includes('UPDATED')
        ? 'info'
        : 'neutral';

export default function AuditPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const query = useAudit(q, page);
  return (
    <>
      <PageHeader
        title="Audit log"
        description="A permanent record of every important action: who did what, when, and to which record. It can be read but never edited."
      />
      <Card className="mb-4 p-4">
        <div className="relative max-w-md">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <Input
            aria-label="Search the audit log"
            placeholder="Person, action, receipt or student"
            className="pl-9"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </Card>
      <Card>
        <QueryBoundary query={query}>
          {(d) => (
            <DataTable
              caption="Audit log"
              rows={d.rows}
              rowKey={(a) => a.id}
              pageSize={15}
              paging={{ page: page - 1, total: d.total, onPage: (p) => setPage(p + 1) }}
              columns={[
                {
                  key: 'at',
                  header: 'When',
                  cell: (a) => <span className="whitespace-nowrap">{a.at}</span>,
                },
                { key: 'u', header: 'Who', cell: (a) => a.user },
                {
                  key: 'a',
                  header: 'Action',
                  cell: (a) => (
                    <Badge tone={tone(a.action)}>
                      {a.action.replaceAll('_', ' ').toLowerCase()}
                    </Badge>
                  ),
                },
                {
                  key: 'e',
                  header: 'Record',
                  cell: (a) => <span className="font-medium text-ink">{a.entity}</span>,
                },
                {
                  key: 'd',
                  header: 'Details',
                  cell: (a) => <span className="text-muted">{a.detail}</span>,
                },
              ]}
            />
          )}
        </QueryBoundary>
      </Card>
    </>
  );
}
