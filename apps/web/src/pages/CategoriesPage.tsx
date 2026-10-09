import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Tags } from 'lucide-react';
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
} from '../components/ui';
import { useCan } from '../features/auth/auth';
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  type Category,
} from '../features/setup/api';
import { friendlyMessage } from '../lib/messages';

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'Use letters, digits and underscores (e.g. STAFF_WARD)'),
  name: z.string().trim().min(2, 'Enter a name'),
});
const renameSchema = z.object({ name: z.string().trim().min(2, 'Enter a name') });

function CategoryModal({ category, onClose }: { category: Category | 'new'; onClose: () => void }) {
  const isNew = category === 'new';
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const [error, setError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ code: string; name: string }>({
    resolver: zodResolver(isNew ? createSchema : (renameSchema as unknown as typeof createSchema)),
    defaultValues: isNew ? { code: '', name: '' } : { code: category.code, name: category.name },
  });
  const onSubmit = handleSubmit(async (v) => {
    setError(undefined);
    try {
      if (isNew) await create.mutateAsync({ code: v.code, name: v.name });
      else await update.mutateAsync({ id: category.id, name: v.name });
      toast.success(isNew ? 'Category added' : 'Category renamed');
      onClose();
    } catch (e) {
      setError(friendlyMessage(e));
    }
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New student category' : `Rename ${category.name}`}
      description="Categories decide which fee structure a student gets (for example General, RTE or Staff ward)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" loading={isSubmitting}>
            {isNew ? 'Add category' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <Field label="Name" error={errors.name?.message} required>
          {(p) => <Input {...p} autoFocus {...register('name')} />}
        </Field>
        <Field
          label="Code"
          hint={
            isNew
              ? 'Short and permanent — it cannot be changed later.'
              : 'The code cannot be changed.'
          }
          error={errors.code?.message}
          required
        >
          {(p) => <Input {...p} disabled={!isNew} className="uppercase" {...register('code')} />}
        </Field>
      </form>
    </Modal>
  );
}

export default function CategoriesPage() {
  const query = useCategories();
  const update = useUpdateCategory();
  const can = useCan();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);

  const toggle = async (c: Category) => {
    try {
      await update.mutateAsync({ id: c.id, isActive: !c.isActive });
      toast.success(c.isActive ? `${c.name} switched off` : `${c.name} switched on`);
    } catch (e) {
      toast.error(friendlyMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Student categories"
        description="Group students for fee purposes. A category is never deleted — switch it off to stop using it."
        actions={
          <PermissionGate permission="studentCategory.manage">
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> New category
            </Button>
          </PermissionGate>
        }
      />
      <Card>
        <QueryBoundary query={query}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState
                icon={<Tags className="size-6" aria-hidden />}
                title="No categories yet"
                description="Add at least one category (for example General) before admitting students."
              />
            ) : (
              <ul className="divide-y divide-line">
                {list.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{c.name}</p>
                      <p className="text-xs text-muted">{c.code}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge tone={c.isActive ? 'success' : 'neutral'}>
                        {c.isActive ? 'In use' : 'Switched off'}
                      </Badge>
                      <ActionMenu
                        label={`Actions for ${c.name}`}
                        items={[
                          {
                            label: 'Rename',
                            onSelect: () => setEditing(c),
                            hidden: !can('studentCategory.manage'),
                          },
                          {
                            label: c.isActive ? 'Switch off' : 'Switch on',
                            onSelect: () => void toggle(c),
                            hidden: !can('studentCategory.manage'),
                          },
                        ]}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryBoundary>
      </Card>
      {editing && <CategoryModal category={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
