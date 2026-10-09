import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarRange, CheckCircle2, Lock, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ActionMenu, Modal } from '../components/overlay';
import { PermissionGate } from '../components/PermissionGate';
import { QueryBoundary } from '../components/QueryBoundary';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormError,
  Input,
  PageHeader,
  Textarea,
} from '../components/ui';
import { useCan } from '../features/auth/auth';
import {
  useCreateYear,
  useSuggestedYear,
  useUpdateYear,
  useYearAction,
  useYears,
  type AcademicYear,
  type YearAction,
} from '../features/setup/api';
import { formatRange, yearLabelFor } from '../lib/format';
import { fieldErrors, friendlyMessage } from '../lib/messages';

const schema = z
  .object({
    label: z.string().regex(/^\d{4}-\d{2}$/, 'Use a name like 2026-27'),
    startDate: z.string().min(1, 'Choose the start date'),
    endDate: z.string().min(1, 'Choose the end date'),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate > v.startDate, {
    path: ['endDate'],
    message: 'The end date must be after the start date',
  });
type Values = z.infer<typeof schema>;

function YearFormModal({ year, onClose }: { year: AcademicYear | 'new'; onClose: () => void }) {
  const isNew = year === 'new';
  const suggestion = useSuggestedYear(isNew);
  const create = useCreateYear();
  const update = useUpdateYear();
  const [error, setError] = useState<string>();
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError: setFieldError,
    watch,
    formState: { errors, dirtyFields, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: isNew
      ? { label: '', startDate: '', endDate: '' }
      : { label: year.label, startDate: year.startDate, endDate: year.endDate },
  });

  // pre-fill a new year with the one that follows the latest year
  useEffect(() => {
    if (isNew && suggestion.data) reset(suggestion.data);
  }, [isNew, suggestion.data, reset]);

  // keep the name in step with the start date until the user types their own
  const start = watch('startDate');
  useEffect(() => {
    const suggested = yearLabelFor(start);
    if (suggested && !dirtyFields.label && isNew && !suggestion.data) setValue('label', suggested);
  }, [start, dirtyFields.label, isNew, suggestion.data, setValue]);

  const onSubmit = handleSubmit(async (v) => {
    setError(undefined);
    try {
      if (isNew) await create.mutateAsync(v);
      else await update.mutateAsync({ id: year.id, ...v });
      toast.success(
        isNew ? `Academic year ${v.label} created` : `Academic year ${v.label} updated`,
      );
      onClose();
    } catch (e) {
      const fe = fieldErrors(e);
      for (const [k, m] of Object.entries(fe))
        if (k in v) setFieldError(k as keyof Values, { message: m });
      setError(friendlyMessage(e));
    }
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New academic year' : `Edit ${year.label}`}
      description="An academic year runs for about 12 months. Years cannot overlap."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="year-form" loading={isSubmitting}>
            {isNew ? 'Create year' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="year-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts on" error={errors.startDate?.message} required>
            {(p) => <Input {...p} type="date" {...register('startDate')} />}
          </Field>
          <Field label="Ends on" error={errors.endDate?.message} required>
            {(p) => <Input {...p} type="date" {...register('endDate')} />}
          </Field>
        </div>
        <Field label="Name" hint="For example 2026-27" error={errors.label?.message} required>
          {(p) => <Input {...p} inputMode="numeric" placeholder="2026-27" {...register('label')} />}
        </Field>
      </form>
    </Modal>
  );
}

function ReasonModal({
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= 3;
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={!ok}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await onConfirm(reason.trim());
                onClose();
              } catch (e) {
                setError(friendlyMessage(e));
                const d = (e as { details?: unknown }).details;
                if (Array.isArray(d) && d.every((x) => typeof x === 'string'))
                  setError(`${friendlyMessage(e)} ${d.join(' ')}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label="Reason" hint="Kept in the audit history." required>
          {(p) => (
            <Textarea
              {...p}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Year ended and all dues reconciled"
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

const STATUS = {
  PLANNED: { tone: 'info', label: 'Planned' },
  ACTIVE: { tone: 'success', label: 'Active' },
  CLOSED: { tone: 'neutral', label: 'Closed' },
} as const;

export default function AcademicYearsPage() {
  const years = useYears();
  const can = useCan();
  const action = useYearAction();
  const [editing, setEditing] = useState<AcademicYear | 'new' | null>(null);
  const [reasonFor, setReasonFor] = useState<{
    year: AcademicYear;
    kind: 'close' | 'reopen';
  } | null>(null);
  const [confirmCurrent, setConfirmCurrent] = useState<AcademicYear | null>(null);

  const run = async (id: string, a: YearAction, ok: string) => {
    try {
      await action.mutateAsync({ id, action: a });
      toast.success(ok);
    } catch (e) {
      toast.error(friendlyMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Academic years"
        description="Every fee, enrollment and receipt belongs to an academic year. Only one year is current at a time; closed years stay unchanged."
        actions={
          <PermissionGate permission="academicYear.manage">
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> New academic year
            </Button>
          </PermissionGate>
        }
      />
      <Card>
        <QueryBoundary query={years}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState
                icon={<CalendarRange className="size-6" aria-hidden />}
                title="No academic years yet"
                description="Create your first academic year to start setting up classes, divisions and fees."
                action={
                  <PermissionGate permission="academicYear.manage">
                    <Button onClick={() => setEditing('new')}>
                      <Plus className="size-4" aria-hidden /> Create academic year
                    </Button>
                  </PermissionGate>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Academic years</caption>
                  <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                    <tr>
                      <th scope="col" className="px-5 py-3 font-medium">
                        Year
                      </th>
                      <th scope="col" className="px-5 py-3 font-medium">
                        Dates
                      </th>
                      <th scope="col" className="px-5 py-3 font-medium">
                        Status
                      </th>
                      <th scope="col" className="w-12 px-5 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {list.map((y) => (
                      <tr key={y.id} className="hover:bg-surface-2/60">
                        <th scope="row" className="px-5 py-3.5 font-semibold text-ink">
                          <span className="flex items-center gap-2">
                            {y.label}
                            {y.isCurrent && (
                              <Badge
                                tone="brand"
                                icon={<CheckCircle2 className="size-3" aria-hidden />}
                              >
                                Current
                              </Badge>
                            )}
                          </span>
                        </th>
                        <td className="px-5 py-3.5 text-muted">
                          {formatRange(y.startDate, y.endDate)}
                        </td>
                        <td className="px-5 py-3.5">
                          <Badge
                            tone={STATUS[y.status].tone}
                            icon={
                              y.status === 'CLOSED' ? (
                                <Lock className="size-3" aria-hidden />
                              ) : undefined
                            }
                          >
                            {STATUS[y.status].label}
                          </Badge>
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <ActionMenu
                            label={`Actions for ${y.label}`}
                            items={[
                              {
                                label: 'Edit dates and name',
                                onSelect: () => setEditing(y),
                                hidden: y.status !== 'PLANNED' || !can('academicYear.manage'),
                              },
                              {
                                label: 'Activate',
                                onSelect: () =>
                                  void run(y.id, 'activate', `${y.label} is now active`),
                                hidden: y.status !== 'PLANNED' || !can('academicYear.manage'),
                              },
                              {
                                label: 'Make this the current year',
                                onSelect: () => setConfirmCurrent(y),
                                hidden:
                                  y.isCurrent ||
                                  y.status === 'CLOSED' ||
                                  !can('academicYear.manage'),
                              },
                              {
                                label: 'Move back to planned',
                                onSelect: () =>
                                  void run(y.id, 'deactivate', `${y.label} is planned again`),
                                hidden:
                                  y.status !== 'ACTIVE' ||
                                  y.isCurrent ||
                                  !can('academicYear.manage'),
                              },
                              {
                                label: 'Close year',
                                danger: true,
                                onSelect: () => setReasonFor({ year: y, kind: 'close' }),
                                hidden:
                                  y.status !== 'ACTIVE' ||
                                  y.isCurrent ||
                                  !can('academicYear.close'),
                              },
                              {
                                label: 'Reopen year',
                                icon: <RotateCcw className="size-4" aria-hidden />,
                                onSelect: () => setReasonFor({ year: y, kind: 'reopen' }),
                                hidden: y.status !== 'CLOSED' || !can('academicYear.close'),
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </QueryBoundary>
      </Card>

      {editing && <YearFormModal year={editing} onClose={() => setEditing(null)} />}

      {confirmCurrent && (
        <Modal
          open
          onClose={() => setConfirmCurrent(null)}
          title={`Make ${confirmCurrent.label} the current year?`}
          description="New admissions, fee collection and reports will default to this year. The previous current year stays active."
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmCurrent(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const y = confirmCurrent;
                  setConfirmCurrent(null);
                  void run(y.id, 'set-current', `${y.label} is now the current year`);
                }}
              >
                Make current
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            {confirmCurrent.status === 'PLANNED'
              ? 'This planned year will also be activated.'
              : 'You can change this again at any time.'}
          </p>
        </Modal>
      )}

      {reasonFor && (
        <ReasonModal
          title={
            reasonFor.kind === 'close'
              ? `Close ${reasonFor.year.label}?`
              : `Reopen ${reasonFor.year.label}?`
          }
          description={
            reasonFor.kind === 'close'
              ? 'A closed year is locked: it cannot be edited and no new payments can be recorded in it without special permission.'
              : 'Reopening is a correction. It is recorded in the audit history with your reason.'
          }
          confirmLabel={reasonFor.kind === 'close' ? 'Close year' : 'Reopen year'}
          danger={reasonFor.kind === 'close'}
          onConfirm={async (reason) => {
            await action.mutateAsync({ id: reasonFor.year.id, action: reasonFor.kind, reason });
            toast.success(
              reasonFor.kind === 'close'
                ? `${reasonFor.year.label} is closed`
                : `${reasonFor.year.label} is open again`,
            );
          }}
          onClose={() => setReasonFor(null)}
        />
      )}
    </>
  );
}
