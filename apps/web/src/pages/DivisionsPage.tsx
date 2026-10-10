import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarRange, Copy, LayoutGrid, Plus } from 'lucide-react';
import { useState } from 'react';
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
  CardHeader,
  EmptyState,
  Field,
  FormError,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from '../components/ui';
import { useCan } from '../features/auth/auth';
import {
  useClasses,
  useCloneDivisions,
  useCreateDivision,
  useDivisions,
  useUpdateDivision,
  type ClassRow,
  type Division,
} from '../features/academic/api';
import { useYears, type AcademicYear } from '../features/setup/api';
import { useTeachers, useYearAssignments, type Assignment } from '../features/teachers/api';
import {
  ClassTeacherDialog,
  type TeacherDialogKind,
} from '../features/teachers/ClassTeacherDialogs';
import { friendlyMessage } from '../lib/messages';

const capacityField = z
  .string()
  .trim()
  .refine(
    (v) => v === '' || (/^\d+$/.test(v) && +v >= 1 && +v <= 500),
    'Enter 1 to 500, or leave empty',
  );
const schema = z.object({
  classId: z.string().min(1, 'Choose a class'),
  name: z.string().trim().min(1, 'Enter a name').max(20, 'Keep it under 20 characters'),
  capacity: capacityField,
});
type Form = z.infer<typeof schema>;

function DivisionModal({
  year,
  classes,
  division,
  presetClassId,
  onClose,
}: {
  year: AcademicYear;
  classes: ClassRow[];
  division: Division | 'new';
  presetClassId?: string;
  onClose: () => void;
}) {
  const isNew = division === 'new';
  const create = useCreateDivision();
  const update = useUpdateDivision();
  const [error, setError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: isNew
      ? { classId: presetClassId ?? '', name: '', capacity: '' }
      : {
          classId: division.classId,
          name: division.name,
          capacity: division.capacity ? String(division.capacity) : '',
        },
  });
  const onSubmit = handleSubmit(async (v) => {
    setError(undefined);
    const capacity = v.capacity === '' ? undefined : Number(v.capacity);
    try {
      if (isNew)
        await create.mutateAsync({
          academicYearId: year.id,
          classId: v.classId,
          name: v.name,
          ...(capacity !== undefined ? { capacity } : {}),
        });
      else await update.mutateAsync({ id: division.id, name: v.name, capacity: capacity ?? null });
      toast.success(isNew ? 'Division added' : 'Division saved');
      onClose();
    } catch (e) {
      setError(friendlyMessage(e));
    }
  });
  const choices = classes.filter((c) => c.isActive || (!isNew && c.id === division.classId));
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? `New division · ${year.label}` : `Edit division · ${year.label}`}
      description="A division belongs to one class in one academic year."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="division-form" loading={isSubmitting}>
            {isNew ? 'Add division' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="division-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <Field label="Class" error={errors.classId?.message} required>
          {(p) => (
            <Select {...p} disabled={!isNew} {...register('classId')}>
              <option value="">Choose a class…</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Division name" error={errors.name?.message} required>
            {(p) => <Input {...p} autoFocus placeholder="A" {...register('name')} />}
          </Field>
          <Field
            label="Capacity"
            hint="Optional — most students allowed."
            error={errors.capacity?.message}
          >
            {(p) => <Input {...p} inputMode="numeric" placeholder="40" {...register('capacity')} />}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

function CloneModal({
  years,
  target,
  onClose,
}: {
  years: AcademicYear[];
  target: AcademicYear;
  onClose: () => void;
}) {
  const clone = useCloneDivisions();
  const sources = years.filter((y) => y.id !== target.id);
  const [from, setFrom] = useState(sources[0]?.id ?? '');
  const [error, setError] = useState<string>();
  const submit = async () => {
    setError(undefined);
    try {
      const { data: r } = await clone.mutateAsync({ fromYearId: from, toYearId: target.id });
      toast.success(
        r.created === 0
          ? 'Nothing new to copy — every division already exists.'
          : `${r.created} division${r.created === 1 ? '' : 's'} copied${r.skipped ? `, ${r.skipped} already existed` : ''}`,
      );
      onClose();
    } catch (e) {
      setError(friendlyMessage(e));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Copy divisions into ${target.label}`}
      description="Copies the active divisions and their capacity. Students are not copied, and divisions that already exist are left alone."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={clone.isPending} disabled={!from}>
            Copy divisions
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        <Field label="Copy from">
          {(p) => (
            <Select {...p} value={from} onChange={(e) => setFrom(e.target.value)}>
              {sources.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}

function ClassCard({
  cls,
  divisions,
  editable,
  onAdd,
  onEdit,
  onToggle,
  teachers,
}: {
  cls: ClassRow;
  divisions: Division[];
  editable: boolean;
  onAdd: () => void;
  onEdit: (d: Division) => void;
  onToggle: (d: Division) => void;
  /** class-teacher column; omitted when the user cannot see assignments */
  teachers?: {
    nameOf: (d: Division) => { assignment: Assignment; name: string } | null;
    canAssign: boolean;
    canChange: boolean;
    onAction: (d: Division, kind: TeacherDialogKind) => void;
  };
}) {
  return (
    <Card>
      <CardHeader
        title={cls.name}
        description={
          divisions.length === 0
            ? 'No divisions yet'
            : `${divisions.filter((d) => d.isActive).length} active of ${divisions.length}`
        }
        action={
          editable && cls.isActive ? (
            <Button variant="secondary" size="sm" onClick={onAdd}>
              <Plus className="size-4" aria-hidden /> Add
            </Button>
          ) : undefined
        }
      />
      {divisions.length > 0 && (
        <ul className="divide-y divide-line">
          {divisions.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">Division {d.name}</p>
                <p className="text-xs text-muted">
                  {d.capacity ? `Capacity ${d.capacity}` : 'No capacity limit'}
                </p>
                {teachers && d.isActive && (
                  <p className="mt-0.5 text-xs">
                    {teachers.nameOf(d) ? (
                      <span className="text-muted">
                        Class teacher:{' '}
                        <span className="font-medium text-ink">{teachers.nameOf(d)?.name}</span>
                      </span>
                    ) : (
                      <span className="font-medium text-warning">No class teacher yet</span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!d.isActive && <Badge>Switched off</Badge>}
                {(editable || teachers) && (
                  <ActionMenu
                    label={`Actions for ${cls.name} ${d.name}`}
                    items={[
                      { label: 'Edit', onSelect: () => onEdit(d), hidden: !editable },
                      {
                        label: 'Assign class teacher',
                        onSelect: () => teachers?.onAction(d, 'assign'),
                        hidden:
                          !teachers ||
                          !editable ||
                          !d.isActive ||
                          !!teachers.nameOf(d) ||
                          !teachers.canAssign,
                      },
                      {
                        label: 'Change class teacher',
                        onSelect: () => teachers?.onAction(d, 'change'),
                        hidden:
                          !teachers || !editable || !teachers.nameOf(d) || !teachers.canChange,
                      },
                      {
                        label: 'End class teacher',
                        onSelect: () => teachers?.onAction(d, 'end'),
                        hidden:
                          !teachers || !editable || !teachers.nameOf(d) || !teachers.canChange,
                      },
                      {
                        label: 'Class teacher history',
                        onSelect: () => teachers?.onAction(d, 'history'),
                        hidden: !teachers,
                      },
                      {
                        label: d.isActive ? 'Switch off' : 'Switch on',
                        onSelect: () => onToggle(d),
                        hidden: !editable,
                      },
                    ]}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function DivisionsPage() {
  const years = useYears();
  const classes = useClasses();
  const can = useCan();
  const update = useUpdateDivision();
  const [chosen, setChosen] = useState<string>();
  const [editing, setEditing] = useState<{ division: Division | 'new'; classId?: string } | null>(
    null,
  );
  const [cloning, setCloning] = useState(false);

  const yearList = years.data ?? [];
  const year =
    yearList.find((y) => y.id === chosen) ??
    yearList.find((y) => y.isCurrent) ??
    yearList.find((y) => y.status !== 'CLOSED') ??
    yearList[0];
  const divisions = useDivisions(year?.id);
  const showTeachers = can('teacherAssignment.view') && can('teacher.view');
  const teacherList = useTeachers({}, showTeachers);
  const yearAssignments = useYearAssignments(showTeachers ? year?.id : undefined);
  const [teacherDialog, setTeacherDialog] = useState<{
    kind: TeacherDialogKind;
    division: Division;
  } | null>(null);
  const teacherName = new Map((teacherList.data ?? []).map((t) => [t.id, t.fullName]));
  const currentOf = new Map(
    (yearAssignments.data ?? []).filter((a) => a.isCurrent).map((a) => [a.divisionId, a]),
  );
  const editable = !!year && year.status !== 'CLOSED' && can('division.manage');

  const toggle = async (d: Division) => {
    try {
      await update.mutateAsync({ id: d.id, isActive: !d.isActive });
      toast.success(
        d.isActive ? `Division ${d.name} switched off` : `Division ${d.name} switched on`,
      );
    } catch (e) {
      toast.error(friendlyMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Divisions"
        description="The sections of each class (A, B, C…) for one academic year. Past years keep their own divisions."
        actions={
          <>
            {year && (
              <div className="w-44">
                <Select
                  aria-label="Academic year"
                  value={year.id}
                  onChange={(e) => setChosen(e.target.value)}
                >
                  {yearList.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.label}
                      {y.isCurrent ? ' (current)' : ''}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {editable && yearList.length > 1 && (
              <Button variant="secondary" onClick={() => setCloning(true)}>
                <Copy className="size-4" aria-hidden /> Copy from year
              </Button>
            )}
            <PermissionGate permission="division.manage">
              {editable && (
                <Button onClick={() => setEditing({ division: 'new' })}>
                  <Plus className="size-4" aria-hidden /> New division
                </Button>
              )}
            </PermissionGate>
          </>
        }
      />

      <QueryBoundary query={years}>
        {(list) =>
          list.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CalendarRange className="size-6" aria-hidden />}
                title="Create an academic year first"
                description="Divisions belong to an academic year. Add one under Academic years."
              />
            </Card>
          ) : (
            <QueryBoundary query={classes}>
              {(cls) =>
                cls.length === 0 ? (
                  <Card>
                    <EmptyState
                      icon={<LayoutGrid className="size-6" aria-hidden />}
                      title="Add your classes first"
                      description="Create the classes under Classes, then add their divisions here."
                    />
                  </Card>
                ) : (
                  <>
                    {year?.status === 'CLOSED' && (
                      <p
                        className="mb-4 rounded-lg bg-info-bg px-4 py-3 text-sm text-info"
                        role="status"
                      >
                        {year.label} is closed, so its divisions are read-only.
                      </p>
                    )}
                    {divisions.isPending ? (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {[0, 1, 2].map((i) => (
                          <Skeleton key={i} className="h-40" />
                        ))}
                      </div>
                    ) : (
                      <QueryBoundary query={divisions}>
                        {(rows) => (
                          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {cls
                              .filter((c) => c.isActive || rows.some((d) => d.classId === c.id))
                              .map((c) => (
                                <ClassCard
                                  key={c.id}
                                  cls={c}
                                  divisions={rows.filter((d) => d.classId === c.id)}
                                  editable={editable}
                                  onAdd={() => setEditing({ division: 'new', classId: c.id })}
                                  onEdit={(d) => setEditing({ division: d })}
                                  onToggle={(d) => void toggle(d)}
                                  {...(showTeachers && teacherList.data && yearAssignments.data
                                    ? {
                                        teachers: {
                                          nameOf: (d: Division) => {
                                            const a = currentOf.get(d.id);
                                            return a
                                              ? {
                                                  assignment: a,
                                                  name: teacherName.get(a.teacherId) ?? 'Teacher',
                                                }
                                              : null;
                                          },
                                          canAssign: can('teacherAssignment.assign'),
                                          canChange: can('teacherAssignment.change'),
                                          onAction: (division: Division, kind: TeacherDialogKind) =>
                                            setTeacherDialog({ kind, division }),
                                        },
                                      }
                                    : {})}
                                />
                              ))}
                          </div>
                        )}
                      </QueryBoundary>
                    )}
                  </>
                )
              }
            </QueryBoundary>
          )
        }
      </QueryBoundary>

      {editing && year && (
        <DivisionModal
          year={year}
          classes={classes.data ?? []}
          division={editing.division}
          {...(editing.classId ? { presetClassId: editing.classId } : {})}
          onClose={() => setEditing(null)}
        />
      )}
      {teacherDialog && year && teacherList.data && (
        <ClassTeacherDialog
          kind={teacherDialog.kind}
          division={teacherDialog.division}
          className={
            (classes.data ?? []).find((c) => c.id === teacherDialog.division.classId)?.name ??
            'Class'
          }
          year={year}
          current={currentOf.get(teacherDialog.division.id)}
          teachers={teacherList.data}
          onClose={() => setTeacherDialog(null)}
        />
      )}
      {cloning && year && (
        <CloneModal years={yearList} target={year} onClose={() => setCloning(false)} />
      )}
    </>
  );
}
