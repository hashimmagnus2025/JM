import { useState } from 'react';
import { toast } from 'sonner';
import { Modal } from '../../components/overlay';
import {
  Badge,
  Button,
  Field,
  FormError,
  Input,
  Select,
  Skeleton,
  Textarea,
} from '../../components/ui';
import { formatDate } from '../../lib/format';
import { friendlyMessage } from '../../lib/messages';
import type { AcademicYear } from '../setup/api';
import type { Division } from '../academic/api';
import {
  useAssignTeacher,
  useChangeTeacher,
  useDivisionHistory,
  useEndAssignment,
  type Assignment,
  type Teacher,
} from './api';

export type TeacherDialogKind = 'assign' | 'change' | 'end' | 'history';

export interface TeacherDialogProps {
  kind: TeacherDialogKind;
  division: Division;
  className: string;
  year: AcademicYear;
  current: Assignment | undefined;
  teachers: Teacher[];
  onClose: () => void;
}

/** today as a business date, kept inside the academic year */
export function defaultDate(year: AcademicYear, today = new Date()): string {
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (t < year.startDate) return year.startDate;
  if (t > year.endDate) return year.endDate;
  return t;
}

/** the day after a YYYY-MM-DD date, without any time-zone conversion */
export function dayAfter(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

const title = (d: Division, cls: string) => `${cls} · Division ${d.name}`;

function TeacherSelect({
  teachers,
  value,
  onChange,
  exclude,
}: {
  teachers: Teacher[];
  value: string;
  onChange: (v: string) => void;
  exclude?: string | undefined;
}) {
  const active = teachers.filter((t) => t.status === 'ACTIVE' && t.id !== exclude);
  return (
    <Field
      label="Teacher"
      required
      hint={
        active.length === 0
          ? 'There is no active teacher to choose. Add one under Teachers.'
          : undefined
      }
    >
      {(p) => (
        <Select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose a teacher…</option>
          {active.map((t) => (
            <option key={t.id} value={t.id}>
              {t.fullName} · {t.teacherCode}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function DateField({
  label,
  value,
  onChange,
  year,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  year: AcademicYear;
}) {
  return (
    <Field
      label={label}
      required
      hint={`Between ${formatDate(year.startDate)} and ${formatDate(year.endDate)}.`}
    >
      {(p) => (
        <Input
          {...p}
          type="date"
          min={year.startDate}
          max={year.endDate}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

function Actions({
  onClose,
  label,
  onSubmit,
  loading,
  disabled,
}: {
  onClose: () => void;
  label: string;
  onSubmit: () => void;
  loading: boolean;
  disabled: boolean;
}) {
  return (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button onClick={onSubmit} loading={loading} disabled={disabled}>
        {label}
      </Button>
    </>
  );
}

function AssignDialog(p: TeacherDialogProps) {
  const assign = useAssignTeacher();
  const [teacherId, setTeacherId] = useState('');
  const [date, setDate] = useState(defaultDate(p.year));
  const [error, setError] = useState<string>();
  const submit = async () => {
    setError(undefined);
    try {
      await assign.mutateAsync({ divisionId: p.division.id, teacherId, effectiveFrom: date });
      toast.success('Class teacher assigned');
      p.onClose();
    } catch (e) {
      setError(friendlyMessage(e));
    }
  };
  return (
    <Modal
      open
      onClose={p.onClose}
      title={`Assign class teacher · ${title(p.division, p.className)}`}
      description={`Academic year ${p.year.label}`}
      footer={
        <Actions
          onClose={p.onClose}
          label="Assign"
          onSubmit={() => void submit()}
          loading={assign.isPending}
          disabled={!teacherId || !date}
        />
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        <TeacherSelect teachers={p.teachers} value={teacherId} onChange={setTeacherId} />
        <DateField label="Class teacher from" value={date} onChange={setDate} year={p.year} />
      </div>
    </Modal>
  );
}

function ChangeDialog(p: TeacherDialogProps) {
  const change = useChangeTeacher();
  const [teacherId, setTeacherId] = useState('');
  // a change must start after the current teacher started, so the default is never earlier than the next day
  const earliest = p.current ? dayAfter(p.current.effectiveFrom) : p.year.startDate;
  const today = defaultDate(p.year);
  const [date, setDate] = useState(today < earliest ? earliest : today);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const submit = async () => {
    if (!p.current) return;
    setError(undefined);
    try {
      await change.mutateAsync({
        id: p.current.id,
        newTeacherId: teacherId,
        effectiveFrom: date,
        reason,
      });
      toast.success('Class teacher changed');
      p.onClose();
    } catch (e) {
      setError(friendlyMessage(e));
    }
  };
  return (
    <Modal
      open
      onClose={p.onClose}
      title={`Change class teacher · ${title(p.division, p.className)}`}
      description="The previous teacher stays in the history with their dates."
      footer={
        <Actions
          onClose={p.onClose}
          label="Change teacher"
          onSubmit={() => void submit()}
          loading={change.isPending}
          disabled={!teacherId || !date || reason.trim().length < 3}
        />
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        <TeacherSelect
          teachers={p.teachers}
          value={teacherId}
          onChange={setTeacherId}
          exclude={p.current?.teacherId}
        />
        <DateField label="New teacher from" value={date} onChange={setDate} year={p.year} />
        <Field label="Reason" required>
          {(f) => (
            <Textarea
              {...f}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is the class teacher changing?"
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

function EndDialog(p: TeacherDialogProps) {
  const end = useEndAssignment();
  const [date, setDate] = useState(defaultDate(p.year));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const submit = async () => {
    if (!p.current) return;
    setError(undefined);
    try {
      await end.mutateAsync({ id: p.current.id, effectiveTo: date, reason });
      toast.success('Class teacher assignment ended');
      p.onClose();
    } catch (e) {
      setError(friendlyMessage(e));
    }
  };
  return (
    <Modal
      open
      onClose={p.onClose}
      title={`End class teacher · ${title(p.division, p.className)}`}
      description="The division will have no class teacher until you assign one."
      footer={
        <Actions
          onClose={p.onClose}
          label="End assignment"
          onSubmit={() => void submit()}
          loading={end.isPending}
          disabled={!date || reason.trim().length < 3}
        />
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        <DateField
          label="Last day as class teacher"
          value={date}
          onChange={setDate}
          year={p.year}
        />
        <Field label="Reason" required>
          {(f) => <Textarea {...f} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

const END_REASON: Record<string, string> = {
  CHANGED: 'Changed',
  LEFT_INSTITUTION: 'Ended',
  CORRECTION: 'Corrected',
  YEAR_END: 'Year ended',
};

function HistoryDialog(p: TeacherDialogProps) {
  const history = useDivisionHistory(p.division.id, true);
  const names = new Map(p.teachers.map((t) => [t.id, t.fullName]));
  return (
    <Modal
      open
      onClose={p.onClose}
      title={`Class teacher history · ${title(p.division, p.className)}`}
      description="Every class teacher this division has had, newest first."
      footer={
        <Button variant="secondary" onClick={p.onClose}>
          Close
        </Button>
      }
    >
      {history.isPending ? (
        <Skeleton className="h-20" />
      ) : history.isError ? (
        <FormError message={friendlyMessage(history.error)} />
      ) : history.data.length === 0 ? (
        <p className="text-sm text-muted">No class teacher has been assigned yet.</p>
      ) : (
        <ol className="space-y-3">
          {history.data.map((a) => (
            <li key={a.id} className="rounded-lg border border-line px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-ink">{names.get(a.teacherId) ?? 'Teacher'}</p>
                {a.isCurrent ? (
                  <Badge tone="success">Current</Badge>
                ) : (
                  <Badge>{END_REASON[a.endReason ?? ''] ?? 'Ended'}</Badge>
                )}
              </div>
              <p className="text-xs text-muted">
                {formatDate(a.effectiveFrom)} – {a.effectiveTo ? formatDate(a.effectiveTo) : 'now'}
              </p>
              {a.reason && <p className="mt-1 text-sm text-ink">{a.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

export function ClassTeacherDialog(p: TeacherDialogProps) {
  if (p.kind === 'assign') return <AssignDialog {...p} />;
  if (p.kind === 'change') return <ChangeDialog {...p} />;
  if (p.kind === 'end') return <EndDialog {...p} />;
  return <HistoryDialog {...p} />;
}
