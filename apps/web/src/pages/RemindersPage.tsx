import { Send } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DataTable, Money, Section, Tabs } from '../components/data';
import { QueryBoundary } from '../components/QueryBoundary';
import {
  Badge,
  Button,
  Card,
  Field,
  FormError,
  PageHeader,
  Select,
  Switch,
  Textarea,
} from '../components/ui';
import { useCan } from '../features/auth/auth';
import { useClasses, useDivisions } from '../features/academic/api';
import {
  useAudience,
  useReminderHistory,
  useReminderQueue,
  useReminderRules,
  useSendReminders,
  useToggleRule,
  type Segment,
} from '../features/receivables/api';
import { useCurrentYear } from '../features/setup/api';
import { formatDate } from '../lib/format';
import { friendlyMessage } from '../lib/messages';

type Tab = 'send' | 'auto' | 'history';

const TEMPLATES = [
  {
    id: 'due',
    label: 'Fee pending',
    text: 'Dear {parent}, {amount} fee is pending for {student}, Class {class}. Please complete the payment by the due date.',
  },
  {
    id: 'overdue',
    label: 'Overdue',
    text: 'Dear {parent}, the fee of {amount} for {student} (Class {class}) is overdue. Please pay at the earliest or contact the school office.',
  },
  {
    id: 'thanks',
    label: 'Final notice',
    text: 'Dear {parent}, this is a final reminder: {amount} is still pending for {student}, Class {class}.',
  },
];
const SEGMENTS: [Segment, string][] = [
  ['OVERDUE', 'Overdue students'],
  ['PARTIAL', 'Partially paid students'],
  ['UNPAID', 'Unpaid students'],
  ['ANY_DUE', 'Everyone with a pending amount'],
];

function SendPanel() {
  const [sp] = useSearchParams();
  const studentId = sp.get('student') ?? '';
  const classes = useClasses();
  const year = useCurrentYear();
  const send = useSendReminders();
  const [segment, setSegment] = useState<Segment>(studentId ? 'ANY_DUE' : 'OVERDUE');
  const [classId, setClassId] = useState(sp.get('class') ?? '');
  const [divisionId, setDivisionId] = useState('');
  const [channel, setChannel] = useState('WhatsApp');
  const [text, setText] = useState(TEMPLATES[1]!.text);
  const [error, setError] = useState<string>();
  const divisions = useDivisions(classId ? year.data?.id : undefined);
  const audience = {
    segment,
    ...(classId ? { classId } : {}),
    ...(divisionId ? { divisionId } : {}),
    ...(studentId ? { studentId } : {}),
  };
  const count = useAudience(audience);
  const sample = text
    .replaceAll('{parent}', 'Mr. Sharma')
    .replaceAll('{student}', 'Rahul Sharma')
    .replaceAll('{class}', '10-A')
    .replaceAll('{amount}', '₹10,000');

  const submit = async () => {
    setError(undefined);
    try {
      const r = await send.mutateAsync({ audience, channel, message: text });
      toast.success(`${r.data.queued} reminders queued`);
    } catch (e) {
      setError(friendlyMessage(e));
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <Card className="space-y-4 p-5">
        <h2 className="text-base font-semibold text-ink">Who should get it?</h2>
        {studentId && (
          <p className="rounded-md bg-primary-soft px-3 py-2 text-sm text-primary">
            Sending to one student only.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Students">
            {(p) => (
              <Select
                {...p}
                value={segment}
                disabled={!!studentId}
                onChange={(e) => setSegment(e.target.value as Segment)}
              >
                {SEGMENTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Class">
            {(p) => (
              <Select
                {...p}
                value={classId}
                disabled={!!studentId}
                onChange={(e) => {
                  setClassId(e.target.value);
                  setDivisionId('');
                }}
              >
                <option value="">All classes</option>
                {(classes.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Division">
            {(p) => (
              <Select
                {...p}
                value={divisionId}
                disabled={!classId || !!studentId}
                onChange={(e) => setDivisionId(e.target.value)}
              >
                <option value="">All divisions</option>
                {(divisions.data ?? [])
                  .filter((d) => d.classId === classId)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>
        <h2 className="pt-2 text-base font-semibold text-ink">What should it say?</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Template">
            {(p) => (
              <Select
                {...p}
                value=""
                onChange={(e) => {
                  const t = TEMPLATES.find((x) => x.id === e.target.value);
                  if (t) setText(t.text);
                }}
              >
                <option value="">Choose a template…</option>
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Channel">
            {(p) => (
              <Select {...p} value={channel} onChange={(e) => setChannel(e.target.value)}>
                {['WhatsApp', 'SMS', 'E-mail', 'In-app'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field
          label="Message"
          required
          hint="You can use {parent}, {student}, {class} and {amount}."
        >
          {(p) => (
            <Textarea {...p} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          )}
        </Field>
      </Card>
      <div className="space-y-4">
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold text-ink">Ready to send</h2>
          <p className="text-3xl font-semibold text-ink tabular-nums">
            {(count.data?.count ?? 0).toLocaleString('en-IN')}{' '}
            <span className="text-base font-normal text-muted">parents</span>
          </p>
          <p className="text-sm text-muted">
            together owing{' '}
            <strong className="text-ink">
              <Money paise={count.data?.amount ?? 0} />
            </strong>
          </p>
          <div className="rounded-lg bg-surface-2 p-3 text-sm text-ink">
            <p className="mb-1 text-xs font-medium text-muted">Preview</p>
            {sample}
          </div>
          <FormError message={error} />
          <Button
            className="w-full"
            onClick={() => void submit()}
            loading={send.isPending}
            disabled={(count.data?.count ?? 0) === 0 || !text.trim()}
          >
            <Send className="size-4" aria-hidden /> Send to{' '}
            {(count.data?.count ?? 0).toLocaleString('en-IN')} parents
          </Button>
          <p className="text-xs text-muted">
            Messages stop automatically for anyone who pays before they are delivered.
          </p>
        </Card>
      </div>
    </div>
  );
}

function AutoPanel() {
  const can = useCan();
  const rules = useReminderRules();
  const queue = useReminderQueue();
  const toggle = useToggleRule();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section
        title="Automatic reminders"
        description="Sent without anyone pressing a button. They stop once the balance is cleared."
      >
        <QueryBoundary query={rules}>
          {(list) => (
            <ul className="divide-y divide-line">
              {list.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium text-ink">{r.label}</p>
                    <p className="text-xs text-muted">
                      {r.type} · {r.channel}
                    </p>
                  </div>
                  <Switch
                    checked={r.enabled}
                    label={r.enabled ? 'On' : 'Off'}
                    disabled={!can('reminder.manage') || toggle.isPending}
                    onChange={(v) => toggle.mutate({ id: r.id, enabled: v })}
                  />
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </Section>
      <Section title="Coming up" description="What the system will send next" flush>
        <QueryBoundary query={queue}>
          {(list) => (
            <DataTable
              caption="Scheduled reminders"
              rows={list}
              rowKey={(q) => q.id}
              empty="Nothing is scheduled. Switch on a reminder rule."
              columns={[
                { key: 'd', header: 'When', cell: (q) => `${formatDate(q.date)}, ${q.time}` },
                { key: 'r', header: 'Rule', cell: (q) => q.rule },
                { key: 'c', header: 'Channel', cell: (q) => q.channel },
                {
                  key: 'n',
                  header: 'Parents',
                  cell: (q) => q.recipients.toLocaleString('en-IN'),
                  align: 'right',
                },
              ]}
            />
          )}
        </QueryBoundary>
      </Section>
    </div>
  );
}

function HistoryPanel() {
  const [page, setPage] = useState(1);
  const q = useReminderHistory(page);
  return (
    <Section
      title="Everything that was sent"
      description="Who got what, when, and whether it arrived"
      flush
    >
      <QueryBoundary query={q}>
        {(d) => (
          <DataTable
            caption="Reminder history"
            rows={d.rows}
            rowKey={(r) => r.id}
            pageSize={12}
            paging={{ page: page - 1, total: d.total, onPage: (p) => setPage(p + 1) }}
            columns={[
              { key: 'd', header: 'Date', cell: (r) => formatDate(r.date) },
              {
                key: 's',
                header: 'Student',
                cell: (r) => (
                  <div>
                    <p className="text-ink">{r.studentName}</p>
                    <p className="text-xs text-muted">{r.classLabel}</p>
                  </div>
                ),
              },
              { key: 't', header: 'Type', cell: (r) => r.type },
              { key: 'c', header: 'Channel', cell: (r) => r.channel },
              {
                key: 'm',
                header: 'Message',
                cell: (r) => <span className="line-clamp-2 max-w-sm text-muted">{r.message}</span>,
              },
              { key: 'b', header: 'Sent by', cell: (r) => r.sentBy },
              {
                key: 'st',
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
        )}
      </QueryBoundary>
    </Section>
  );
}

export default function RemindersPage() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>(can('reminder.send') ? 'send' : 'history');
  return (
    <>
      <PageHeader
        title="Reminders"
        description="Remind parents about pending fees — by hand, to exactly the group you choose, or automatically on a schedule."
      />
      <Tabs
        label="Reminder sections"
        value={tab}
        onChange={setTab}
        tabs={[
          ...(can('reminder.send') ? [{ id: 'send' as const, label: 'Send now' }] : []),
          { id: 'auto', label: 'Automatic' },
          { id: 'history', label: 'History' },
        ]}
      />
      {tab === 'send' && <SendPanel />}
      {tab === 'auto' && <AutoPanel />}
      {tab === 'history' && <HistoryPanel />}
    </>
  );
}
