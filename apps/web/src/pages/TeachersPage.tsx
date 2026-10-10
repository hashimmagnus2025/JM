import { zodResolver } from '@hookform/resolvers/zod';
import { Phone, Plus, Search, UserRound } from 'lucide-react';
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
  EmptyState,
  Field,
  FormError,
  Input,
  PageHeader,
  Select,
  Textarea,
  type Tone,
} from '../components/ui';
import { useCan } from '../features/auth/auth';
import {
  useCreateTeacher,
  useTeachers,
  useTeacherStatus,
  useUpdateTeacher,
  type Teacher,
  type TeacherStatus,
} from '../features/teachers/api';
import { formatDate, initials } from '../lib/format';
import { friendlyMessage } from '../lib/messages';

const STATUS: Record<TeacherStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  INACTIVE: { label: 'Inactive', tone: 'neutral' },
  LEFT: { label: 'Left', tone: 'warning' },
};

const schema = z.object({
  fullName: z.string().trim().min(2, 'Enter the full name').max(100),
  staffId: z.string().trim().min(1, 'Enter the staff ID').max(30),
  mobile: z
    .string()
    .trim()
    .refine(
      (v) => /^[6-9]\d{9}$/.test(v.replace(/[\s()-]/g, '').replace(/^(\+?91|0)(?=\d{10}$)/, '')),
      'Enter a 10-digit mobile number',
    ),
  email: z.string().trim().email('Enter a valid e-mail').or(z.literal('')),
  gender: z.enum(['', 'MALE', 'FEMALE', 'OTHER']),
  qualification: z.string().trim().max(100),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the joining date'),
  remarks: z.string().trim().max(300),
});
type Form = z.infer<typeof schema>;

function TeacherModal({ teacher, onClose }: { teacher: Teacher | 'new'; onClose: () => void }) {
  const isNew = teacher === 'new';
  const create = useCreateTeacher();
  const update = useUpdateTeacher();
  const [error, setError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: isNew
      ? {
          fullName: '',
          staffId: '',
          mobile: '',
          email: '',
          gender: '',
          qualification: '',
          joiningDate: '',
          remarks: '',
        }
      : {
          fullName: teacher.fullName,
          staffId: teacher.staffId,
          mobile: teacher.mobile,
          email: teacher.email ?? '',
          gender: teacher.gender ?? '',
          qualification: teacher.qualification ?? '',
          joiningDate: teacher.joiningDate,
          remarks: teacher.remarks ?? '',
        },
  });
  const onSubmit = handleSubmit(async (v) => {
    setError(undefined);
    try {
      if (isNew) {
        await create.mutateAsync({
          fullName: v.fullName,
          staffId: v.staffId,
          mobile: v.mobile,
          joiningDate: v.joiningDate,
          ...(v.email ? { email: v.email } : {}),
          ...(v.gender ? { gender: v.gender } : {}),
          ...(v.qualification ? { qualification: v.qualification } : {}),
          ...(v.remarks ? { remarks: v.remarks } : {}),
        });
      } else {
        // an empty box clears the stored value
        await update.mutateAsync({
          id: teacher.id,
          patch: {
            fullName: v.fullName,
            staffId: v.staffId,
            mobile: v.mobile,
            joiningDate: v.joiningDate,
            email: v.email || null,
            gender: v.gender || null,
            qualification: v.qualification || null,
            remarks: v.remarks || null,
          },
        });
      }
      toast.success(isNew ? 'Teacher added' : 'Teacher saved');
      onClose();
    } catch (e) {
      setError(friendlyMessage(e));
    }
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={isNew ? 'New teacher' : `Edit ${teacher.fullName}`}
      description={isNew ? 'A teacher ID (TCH-…) is created automatically.' : teacher.teacherCode}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="teacher-form" loading={isSubmitting}>
            {isNew ? 'Add teacher' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="teacher-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Full name"
            error={errors.fullName?.message}
            required
            className="sm:col-span-2"
          >
            {(p) => <Input {...p} autoFocus {...register('fullName')} />}
          </Field>
          <Field
            label="Staff ID"
            hint="The school's own employee number."
            error={errors.staffId?.message}
            required
          >
            {(p) => <Input {...p} {...register('staffId')} />}
          </Field>
          <Field label="Mobile" error={errors.mobile?.message} required>
            {(p) => (
              <Input {...p} inputMode="tel" placeholder="98765 43210" {...register('mobile')} />
            )}
          </Field>
          <Field label="E-mail" error={errors.email?.message}>
            {(p) => <Input {...p} type="email" {...register('email')} />}
          </Field>
          <Field label="Gender">
            {(p) => (
              <Select {...p} {...register('gender')}>
                <option value="">Not specified</option>
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
                <option value="OTHER">Other</option>
              </Select>
            )}
          </Field>
          <Field label="Joining date" error={errors.joiningDate?.message} required>
            {(p) => <Input {...p} type="date" {...register('joiningDate')} />}
          </Field>
          <Field label="Qualification" error={errors.qualification?.message}>
            {(p) => <Input {...p} placeholder="B.Ed, M.Sc" {...register('qualification')} />}
          </Field>
          <Field label="Remarks" error={errors.remarks?.message} className="sm:col-span-2">
            {(p) => <Textarea {...p} {...register('remarks')} />}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

function LeftModal({ teacher, onClose }: { teacher: Teacher; onClose: () => void }) {
  const status = useTeacherStatus();
  const [date, setDate] = useState('');
  const [error, setError] = useState<string>();
  const submit = async () => {
    setError(undefined);
    try {
      await status.mutateAsync({ id: teacher.id, status: 'LEFT', leavingDate: date });
      toast.success(`${teacher.fullName} marked as left`);
      onClose();
    } catch (e) {
      setError(friendlyMessage(e));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${teacher.fullName} has left`}
      description="They stay in the records and in every past year. They cannot be assigned any more."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={status.isPending} disabled={!date}>
            Mark as left
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        <Field label="Last working day" required>
          {(p) => (
            <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          )}
        </Field>
      </div>
    </Modal>
  );
}

export default function TeachersPage() {
  const can = useCan();
  const manage = can('teacher.create') || can('teacher.update');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const query = useTeachers({
    ...(status ? { status } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  });
  const setTeacherStatus = useTeacherStatus();
  const [editing, setEditing] = useState<Teacher | 'new' | null>(null);
  const [leaving, setLeaving] = useState<Teacher | null>(null);

  const change = async (t: Teacher, next: TeacherStatus) => {
    try {
      await setTeacherStatus.mutateAsync({ id: t.id, status: next });
      toast.success(
        next === 'ACTIVE' ? `${t.fullName} is active again` : `${t.fullName} switched off`,
      );
    } catch (e) {
      toast.error(friendlyMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Teachers"
        description="Your teaching staff. Class teachers are assigned to divisions on the Divisions page. A teacher is never deleted."
        actions={
          <PermissionGate permission="teacher.create">
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> New teacher
            </Button>
          </PermissionGate>
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-60 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <Input
            aria-label="Search teachers"
            placeholder="Search name, staff ID, teacher ID or mobile"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="w-44">
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="LEFT">Left</option>
          </Select>
        </div>
      </div>
      <Card>
        <QueryBoundary query={query}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState
                icon={<UserRound className="size-6" aria-hidden />}
                title={q || status ? 'No teacher matches' : 'No teachers yet'}
                description={
                  q || status
                    ? 'Try a different search or status.'
                    : 'Add your teachers, then make them class teachers of divisions.'
                }
                action={
                  !q && !status && can('teacher.create') ? (
                    <Button onClick={() => setEditing('new')}>Add first teacher</Button>
                  ) : null
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {list.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-3.5">
                    <span
                      aria-hidden
                      className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary"
                    >
                      {initials(t.fullName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{t.fullName}</p>
                      <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
                        <span>{t.teacherCode}</span>
                        <span>Staff ID {t.staffId}</span>
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-3" aria-hidden /> {t.mobile}
                        </span>
                        <span>Joined {formatDate(t.joiningDate)}</span>
                        {t.status === 'LEFT' && t.leavingDate && (
                          <span>Left {formatDate(t.leavingDate)}</span>
                        )}
                      </p>
                    </div>
                    <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                    {(manage || can('teacher.deactivate')) && (
                      <ActionMenu
                        label={`Actions for ${t.fullName}`}
                        items={[
                          {
                            label: 'Edit',
                            onSelect: () => setEditing(t),
                            hidden: !can('teacher.update'),
                          },
                          {
                            label: 'Switch off',
                            onSelect: () => void change(t, 'INACTIVE'),
                            hidden: !can('teacher.deactivate') || t.status !== 'ACTIVE',
                          },
                          {
                            label: 'Mark as left',
                            onSelect: () => setLeaving(t),
                            hidden: !can('teacher.deactivate') || t.status === 'LEFT',
                          },
                          {
                            label: 'Make active',
                            onSelect: () => void change(t, 'ACTIVE'),
                            hidden: !can('teacher.deactivate') || t.status === 'ACTIVE',
                          },
                        ]}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )
          }
        </QueryBoundary>
      </Card>
      {editing && <TeacherModal teacher={editing} onClose={() => setEditing(null)} />}
      {leaving && <LeftModal teacher={leaving} onClose={() => setLeaving(null)} />}
    </>
  );
}
