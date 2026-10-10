import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDown, ArrowUp, GraduationCap, Plus } from 'lucide-react';
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
  Switch,
} from '../components/ui';
import { useCan } from '../features/auth/auth';
import { useCurrentYear } from '../features/setup/api';
import {
  useDivisions,
  useClasses,
  useCreateClass,
  useReorderClasses,
  useUpdateClass,
  type ClassRow,
} from '../features/academic/api';
import { friendlyMessage } from '../lib/messages';

const schema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,11}$/, 'Use letters, digits, - or _ (up to 12)'),
  name: z.string().trim().min(1, 'Enter a name').max(40, 'Keep it under 40 characters'),
  isFinal: z.boolean(),
});
type Form = z.infer<typeof schema>;

function ClassModal({ cls, onClose }: { cls: ClassRow | 'new'; onClose: () => void }) {
  const isNew = cls === 'new';
  const create = useCreateClass();
  const update = useUpdateClass();
  const [error, setError] = useState<string>();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: isNew
      ? { code: '', name: '', isFinal: false }
      : { code: cls.code, name: cls.name, isFinal: cls.isFinal },
  });
  const onSubmit = handleSubmit(async (v) => {
    setError(undefined);
    try {
      if (isNew) await create.mutateAsync(v);
      else await update.mutateAsync({ id: cls.id, name: v.name, isFinal: v.isFinal });
      toast.success(isNew ? 'Class added' : 'Class saved');
      onClose();
    } catch (e) {
      setError(friendlyMessage(e));
    }
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New class' : `Edit ${cls.name}`}
      description="Classes are the same every year. Divisions (A, B, C…) are set up per academic year."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="class-form" loading={isSubmitting}>
            {isNew ? 'Add class' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="class-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={errors.name?.message} required>
            {(p) => <Input {...p} autoFocus placeholder="Class 5" {...register('name')} />}
          </Field>
          <Field
            label="Code"
            hint={isNew ? 'Short and permanent.' : 'The code cannot be changed.'}
            error={errors.code?.message}
            required
          >
            {(p) => (
              <Input
                {...p}
                disabled={!isNew}
                placeholder="5"
                className="uppercase"
                {...register('code')}
              />
            )}
          </Field>
        </div>
        <Switch
          checked={watch('isFinal')}
          onChange={(v) => setValue('isFinal', v, { shouldDirty: true })}
          label="This is the last class of a stage (students graduate after it)"
        />
      </form>
    </Modal>
  );
}

export default function ClassesPage() {
  const query = useClasses();
  const update = useUpdateClass();
  const reorder = useReorderClasses();
  const can = useCan();
  const currentYear = useCurrentYear();
  const yearId = currentYear.data?.id;
  const divisions = useDivisions(can('division.view') ? yearId : undefined);
  const divisionCount = (classId: string): number =>
    (divisions.data ?? []).filter((d) => d.classId === classId && d.isActive).length;
  const manage = can('class.manage');
  const [editing, setEditing] = useState<ClassRow | 'new' | null>(null);

  const toggle = async (c: ClassRow) => {
    try {
      await update.mutateAsync({ id: c.id, isActive: !c.isActive });
      toast.success(c.isActive ? `${c.name} switched off` : `${c.name} switched on`);
    } catch (e) {
      toast.error(friendlyMessage(e));
    }
  };
  const move = async (list: ClassRow[], from: number, to: number) => {
    const ids = list.map((c) => c.id);
    const [picked] = ids.splice(from, 1);
    ids.splice(to, 0, picked!);
    try {
      await reorder.mutateAsync(ids);
    } catch (e) {
      toast.error(friendlyMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Classes"
        description="The classes your institution runs, in teaching order. A class is never deleted — switch it off to stop using it."
        actions={
          <PermissionGate permission="class.manage">
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> New class
            </Button>
          </PermissionGate>
        }
      />
      <Card>
        <QueryBoundary query={query}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState
                icon={<GraduationCap className="size-6" aria-hidden />}
                title="No classes yet"
                description="Add your classes (for example Nursery to Class 12), then create their divisions for each academic year."
                action={
                  manage ? <Button onClick={() => setEditing('new')}>Add first class</Button> : null
                }
              />
            ) : (
              <ol className="divide-y divide-line">
                {list.map((c, i) => (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-3.5">
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary"
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{c.name}</p>
                      <p className="text-xs text-muted">
                        Code {c.code}
                        {divisions.data && currentYear.data
                          ? ` · ${divisionCount(c.id)} division${divisionCount(c.id) === 1 ? '' : 's'} in ${currentYear.data.label}`
                          : ''}
                      </p>
                    </div>
                    <div className="hidden items-center gap-2 sm:flex">
                      {c.isFinal && <Badge tone="info">Last class</Badge>}
                      <Badge tone={c.isActive ? 'success' : 'neutral'}>
                        {c.isActive ? 'In use' : 'Switched off'}
                      </Badge>
                    </div>
                    {manage && (
                      <div className="flex items-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Move ${c.name} up`}
                          disabled={i === 0 || reorder.isPending}
                          onClick={() => void move(list, i, i - 1)}
                        >
                          <ArrowUp className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Move ${c.name} down`}
                          disabled={i === list.length - 1 || reorder.isPending}
                          onClick={() => void move(list, i, i + 1)}
                        >
                          <ArrowDown className="size-4" aria-hidden />
                        </Button>
                        <ActionMenu
                          label={`Actions for ${c.name}`}
                          items={[
                            { label: 'Edit', onSelect: () => setEditing(c) },
                            {
                              label: c.isActive ? 'Switch off' : 'Switch on',
                              onSelect: () => void toggle(c),
                            },
                          ]}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )
          }
        </QueryBoundary>
      </Card>
      {editing && <ClassModal cls={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
