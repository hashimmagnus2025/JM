import { toast } from 'sonner';
import { DataTable, Money, Stat } from '../components/data';
import { QueryBoundary } from '../components/QueryBoundary';
import { Badge, Button, Card, PageHeader } from '../components/ui';
import { useCan } from '../features/auth/auth';
import { useAdjustments, useApproveAdjustment, type AdjustmentRow } from '../features/fees/api';
import { formatDate } from '../lib/format';
import { friendlyMessage } from '../lib/messages';

function Body({ all }: { all: AdjustmentRow[] }) {
  const can = useCan();
  const approve = useApproveAdjustment();
  const rows = [...all].sort((a, b) =>
    a.status === b.status ? (a.date < b.date ? 1 : -1) : a.status === 'PENDING' ? -1 : 1,
  );
  const pending = rows.filter((a) => a.status === 'PENDING');
  const approved = rows.filter((a) => a.status === 'APPROVED');
  const doApprove = async (id: string) => {
    try {
      await approve.mutateAsync(id);
      toast.success('Approved');
    } catch (e) {
      toast.error(friendlyMessage(e));
    }
  };
  return (
    <>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Waiting for approval"
          value={pending.length}
          tone="warning"
          hint={<Money paise={pending.reduce((t, a) => t + a.amount, 0)} compact />}
        />
        <Stat
          label="Approved this year"
          value={approved.length}
          tone="success"
          hint={<Money paise={approved.reduce((t, a) => t + a.amount, 0)} compact />}
        />
        <Stat
          label="Largest single item"
          value={<Money paise={rows.reduce((m, a) => Math.max(m, a.amount), 0)} compact />}
        />
      </div>
      <Card>
        <DataTable
          caption="Adjustments"
          rows={rows}
          rowKey={(a) => a.id}
          pageSize={12}
          columns={[
            { key: 'd', header: 'Date', cell: (a) => formatDate(a.date) },
            {
              key: 's',
              header: 'Student',
              cell: (a) => (
                <div>
                  <p className="font-medium text-ink">{a.studentName}</p>
                  <p className="text-xs text-muted">{a.classLabel}</p>
                </div>
              ),
            },
            { key: 't', header: 'Type', cell: (a) => a.type },
            {
              key: 'r',
              header: 'Reason',
              cell: (a) => <span className="text-muted">{a.reason}</span>,
            },
            { key: 'a', header: 'Amount', cell: (a) => <Money paise={a.amount} />, align: 'right' },
            {
              key: 'st',
              header: 'Status',
              cell: (a) =>
                a.status === 'APPROVED' ? (
                  <Badge tone="success">Approved{a.approvedBy ? ` · ${a.approvedBy}` : ''}</Badge>
                ) : (
                  <Badge tone="warning">Waiting</Badge>
                ),
            },
            {
              key: 'x',
              header: '',
              align: 'right',
              cell: (a) =>
                a.status === 'PENDING' && can('adjustment.approve') ? (
                  <Button
                    size="sm"
                    loading={approve.isPending}
                    onClick={() => void doApprove(a.id)}
                  >
                    Approve
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>
    </>
  );
}

export default function AdjustmentsPage() {
  const q = useAdjustments();
  return (
    <>
      <PageHeader
        title="Discounts & concessions"
        description="Scholarships, discounts, concessions and waivers. Each one records who approved it and why, and the original fee stays visible."
      />
      <QueryBoundary query={q}>{(d) => <Body all={d} />}</QueryBoundary>
    </>
  );
}
