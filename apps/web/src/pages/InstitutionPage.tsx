import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { QueryBoundary } from '../components/QueryBoundary';
import {
  Button,
  Card,
  CardHeader,
  Field,
  FormError,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '../components/ui';
import { usePermission } from '../features/auth/auth';
import { useInstitution, useUpdateInstitution, type Institution } from '../features/setup/api';
import { friendlyMessage } from '../lib/messages';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const opt = z.string().trim().max(200).optional();

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the institution name').max(150),
  shortName: z.string().trim().max(40).optional(),
  registrationNo: z.string().trim().max(60).optional(),
  line1: opt,
  line2: opt,
  city: opt,
  state: opt,
  pincode: z.string().trim().max(10).optional(),
  phone: z.string().trim().max(20).optional(),
  altPhone: z.string().trim().max(20).optional(),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid e-mail')]).optional(),
  website: z
    .union([
      z.literal(''),
      z.string().trim().url('Enter a full web address, e.g. https://school.in'),
    ])
    .optional(),
  academicStartMonth: z.coerce.number().int().min(1).max(12),
  receiptFooter: z.string().trim().max(300).optional(),
  extra: z.array(z.object({ key: z.string().trim().max(40), value: z.string().trim().max(200) })),
});
type Values = z.infer<typeof schema>;

const toForm = (i: Institution): Values => ({
  name: i.name,
  shortName: i.shortName ?? '',
  registrationNo: i.registrationNo ?? '',
  line1: i.address.line1 ?? '',
  line2: i.address.line2 ?? '',
  city: i.address.city ?? '',
  state: i.address.state ?? '',
  pincode: i.address.pincode ?? '',
  phone: i.contact.phone ?? '',
  altPhone: i.contact.altPhone ?? '',
  email: i.contact.email ?? '',
  website: i.contact.website ?? '',
  academicStartMonth: i.academicStartMonth,
  receiptFooter: i.receiptFooter ?? '',
  extra: Object.entries(i.extra).map(([key, value]) => ({ key, value })),
});

/** empty text boxes are left out rather than saved as empty strings */
const clean = <T extends Record<string, string | undefined>>(o: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<T>;

function InstitutionForm({ institution }: { institution: Institution }) {
  const canEdit = usePermission('institution.manage');
  const update = useUpdateInstitution();
  const [error, setError] = useState<string>();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(schema) as never,
    defaultValues: toForm(institution),
  });
  const extra = useFieldArray({ control, name: 'extra' });
  useEffect(() => reset(toForm(institution)), [institution, reset]);

  const onSubmit = handleSubmit(async (v) => {
    setError(undefined);
    try {
      await update.mutateAsync({
        name: v.name,
        ...(v.shortName ? { shortName: v.shortName } : {}),
        ...(v.registrationNo ? { registrationNo: v.registrationNo } : {}),
        address: clean({
          line1: v.line1,
          line2: v.line2,
          city: v.city,
          state: v.state,
          pincode: v.pincode,
        }),
        contact: clean({
          phone: v.phone,
          altPhone: v.altPhone,
          email: v.email,
          website: v.website,
        }),
        academicStartMonth: v.academicStartMonth,
        ...(v.receiptFooter ? { receiptFooter: v.receiptFooter } : {}),
        extra: Object.fromEntries(
          v.extra.filter((e) => e.key && e.value).map((e) => [e.key, e.value]),
        ),
      });
      toast.success('Institution details saved');
    } catch (e) {
      setError(friendlyMessage(e));
    }
  });

  const ro = !canEdit;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <FormError message={error} />
      <Card>
        <CardHeader title="Basic details" description="Shown on receipts and reports." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field
            label="Institution name"
            error={errors.name?.message}
            required
            className="sm:col-span-2"
          >
            {(p) => <Input {...p} readOnly={ro} {...register('name')} />}
          </Field>
          <Field label="Short name" hint="Used where space is limited">
            {(p) => <Input {...p} readOnly={ro} {...register('shortName')} />}
          </Field>
          <Field label="Registration number">
            {(p) => <Input {...p} readOnly={ro} {...register('registrationNo')} />}
          </Field>
          <Field label="Institution code" hint="Permanent. Set when the system was installed.">
            {(p) => <Input {...p} value={institution.code} disabled readOnly />}
          </Field>
          <Field label="Academic year starts in">
            {(p) => (
              <Select {...p} disabled={ro} {...register('academicStartMonth')}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Address" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Address line 1" className="sm:col-span-2">
            {(p) => <Input {...p} readOnly={ro} {...register('line1')} />}
          </Field>
          <Field label="Address line 2" className="sm:col-span-2">
            {(p) => <Input {...p} readOnly={ro} {...register('line2')} />}
          </Field>
          <Field label="City">{(p) => <Input {...p} readOnly={ro} {...register('city')} />}</Field>
          <Field label="State">
            {(p) => <Input {...p} readOnly={ro} {...register('state')} />}
          </Field>
          <Field label="PIN code">
            {(p) => <Input {...p} inputMode="numeric" readOnly={ro} {...register('pincode')} />}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Contact" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Phone">
            {(p) => <Input {...p} type="tel" readOnly={ro} {...register('phone')} />}
          </Field>
          <Field label="Alternate phone">
            {(p) => <Input {...p} type="tel" readOnly={ro} {...register('altPhone')} />}
          </Field>
          <Field label="E-mail" error={errors.email?.message}>
            {(p) => <Input {...p} type="email" readOnly={ro} {...register('email')} />}
          </Field>
          <Field label="Website" error={errors.website?.message}>
            {(p) => (
              <Input
                {...p}
                type="url"
                placeholder="https://"
                readOnly={ro}
                {...register('website')}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Receipts" description="Printed at the bottom of every receipt." />
        <div className="p-5">
          <Field label="Receipt footer note">
            {(p) => (
              <Textarea
                {...p}
                readOnly={ro}
                placeholder="e.g. Fees once paid are not refundable."
                {...register('receiptFooter')}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Other details"
          description="Anything else you want to keep, such as UDISE code or affiliation number."
          action={
            !ro && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => extra.append({ key: '', value: '' })}
              >
                <Plus className="size-4" aria-hidden /> Add detail
              </Button>
            )
          }
        />
        <div className="space-y-3 p-5">
          {extra.fields.length === 0 && <p className="text-sm text-muted">No other details.</p>}
          {extra.fields.map((f, i) => (
            <div key={f.id} className="flex items-end gap-3">
              <Field label="Name" className="flex-1">
                {(p) => <Input {...p} readOnly={ro} {...register(`extra.${i}.key`)} />}
              </Field>
              <Field label="Value" className="flex-[2]">
                {(p) => <Input {...p} readOnly={ro} {...register(`extra.${i}.value`)} />}
              </Field>
              {!ro && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Remove this detail"
                  className="mb-1"
                  onClick={() => extra.remove(i)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      {canEdit ? (
        <div className="sticky bottom-0 -mx-4 flex justify-end gap-3 border-t border-line bg-bg/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <Button
            variant="secondary"
            disabled={!isDirty}
            onClick={() => reset(toForm(institution))}
          >
            Discard changes
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            Save changes
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">You can view these details but not change them.</p>
      )}
    </form>
  );
}

export default function InstitutionPage() {
  const query = useInstitution();
  return (
    <>
      <PageHeader
        title="Institution"
        description="Your school's profile. It appears on receipts, reminders and reports."
      />
      <QueryBoundary query={query}>{(i) => <InstitutionForm institution={i} />}</QueryBoundary>
    </>
  );
}
