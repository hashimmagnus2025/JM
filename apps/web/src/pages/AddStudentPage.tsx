import { Info } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Money, Section } from '../components/data';
import { Button, Card, Field, FormError, Input, PageHeader, Select } from '../components/ui';
import { useClasses, useDivisions } from '../features/academic/api';
import { useCreateStudent, useFeePreview, useStudents } from '../features/students/api';
import { useCategories, useCurrentYear } from '../features/setup/api';
import { formatDate } from '../lib/format';
import { friendlyMessage } from '../lib/messages';
import { parseRupees } from '../lib/money';

interface Form {
  name: string;
  gender: '' | 'MALE' | 'FEMALE';
  dob: string;
  guardian: string;
  mobile: string;
  email: string;
  classId: string;
  divisionId: string;
  categoryCode: string;
  opening: string;
}
const EMPTY: Form = {
  name: '',
  gender: '',
  dob: '',
  guardian: '',
  mobile: '',
  email: '',
  classId: '',
  divisionId: '',
  categoryCode: 'GENERAL',
  opening: '',
};

/** the fee preview on the right comes from the server: it is exactly what will be saved */
export default function AddStudentPage() {
  const navigate = useNavigate();
  const create = useCreateStudent();
  const classes = useClasses();
  const year = useCurrentYear();
  const divisions = useDivisions(year.data?.id);
  const categories = useCategories();
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [formError, setFormError] = useState<string>();
  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setF((p) => ({ ...p, [k]: v, ...(k === 'classId' ? { divisionId: '' } : {}) }));

  const openingPaise = f.opening === '' ? 0 : parseRupees(f.opening);
  const preview = useFeePreview({
    classId: f.classId,
    categoryCode: f.categoryCode,
    openingBalance: openingPaise ?? 0,
  });
  const divs = (divisions.data ?? []).filter((d) => d.classId === f.classId && d.isActive);
  const seats = useStudents({ divisionId: f.divisionId, status: 'ACTIVE' }, 1, 1);
  const chosen = divs.find((d) => d.id === f.divisionId);
  const p = f.classId ? preview.data : undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const er: typeof errors = {};
    if (f.name.trim().length < 2) er.name = 'Enter the student’s full name';
    if (!f.gender) er.gender = 'Choose a gender';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dob)) er.dob = 'Enter the date of birth';
    if (f.guardian.trim().length < 2) er.guardian = 'Enter the parent or guardian’s name';
    if (!/^[6-9]\d{9}$/.test(f.mobile.replace(/\s/g, '')))
      er.mobile = 'Enter a 10-digit mobile number';
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) er.email = 'Enter a valid e-mail';
    if (!f.classId) er.classId = 'Choose a class';
    if (f.classId && !f.divisionId) er.divisionId = 'Choose a division';
    if (openingPaise === null) er.opening = 'Enter an amount in rupees';
    setErrors(er);
    setFormError(undefined);
    if (Object.keys(er).length) return;
    try {
      const r = await create.mutateAsync({
        name: f.name.trim(),
        gender: f.gender as 'MALE' | 'FEMALE',
        dob: f.dob,
        guardianName: f.guardian.trim(),
        mobile: f.mobile.replace(/\s/g, ''),
        ...(f.email ? { email: f.email } : {}),
        classId: f.classId,
        divisionId: f.divisionId,
        categoryCode: f.categoryCode,
        openingBalance: openingPaise ?? 0,
      });
      toast.success(`${r.data.name} added as ${r.data.studentId}`);
      navigate(`/students/${r.data.id}`);
    } catch (err) {
      setFormError(friendlyMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="New student"
        description="Fill in the details on the left. The fee on the right is worked out as you choose the class and category — it is exactly what will be saved."
      />
      <form onSubmit={submit} noValidate className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          <FormError message={formError} />
          <Section title="Student">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" required error={errors.name} className="sm:col-span-2">
                {(a) => (
                  <Input {...a} value={f.name} onChange={(e) => set('name', e.target.value)} />
                )}
              </Field>
              <Field label="Gender" required error={errors.gender}>
                {(a) => (
                  <Select
                    {...a}
                    value={f.gender}
                    onChange={(e) => set('gender', e.target.value as Form['gender'])}
                  >
                    <option value="">Choose…</option>
                    <option value="FEMALE">Female</option>
                    <option value="MALE">Male</option>
                  </Select>
                )}
              </Field>
              <Field label="Date of birth" required error={errors.dob}>
                {(a) => (
                  <Input
                    {...a}
                    type="date"
                    value={f.dob}
                    onChange={(e) => set('dob', e.target.value)}
                  />
                )}
              </Field>
            </div>
          </Section>
          <Section title="Parent / guardian">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required error={errors.guardian} className="sm:col-span-2">
                {(a) => (
                  <Input
                    {...a}
                    value={f.guardian}
                    onChange={(e) => set('guardian', e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Mobile"
                required
                error={errors.mobile}
                hint="Reminders and receipts are sent here."
              >
                {(a) => (
                  <Input
                    {...a}
                    inputMode="tel"
                    value={f.mobile}
                    onChange={(e) => set('mobile', e.target.value)}
                  />
                )}
              </Field>
              <Field label="E-mail" error={errors.email}>
                {(a) => (
                  <Input
                    {...a}
                    type="email"
                    value={f.email}
                    onChange={(e) => set('email', e.target.value)}
                  />
                )}
              </Field>
            </div>
          </Section>
          <Section
            title="Class and fee category"
            description="These decide which fee structure the student gets."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Class" required error={errors.classId}>
                {(a) => (
                  <Select {...a} value={f.classId} onChange={(e) => set('classId', e.target.value)}>
                    <option value="">Choose…</option>
                    {(classes.data ?? [])
                      .filter((c) => c.isActive)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
              <Field
                label="Division"
                required
                error={errors.divisionId}
                hint={
                  chosen?.capacity && seats.data
                    ? `${seats.data.total} of ${chosen.capacity} seats taken`
                    : undefined
                }
              >
                {(a) => (
                  <Select
                    {...a}
                    value={f.divisionId}
                    disabled={!f.classId}
                    onChange={(e) => set('divisionId', e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {divs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Category" required>
                {(a) => (
                  <Select
                    {...a}
                    value={f.categoryCode}
                    onChange={(e) => set('categoryCode', e.target.value)}
                  >
                    {(categories.data ?? [])
                      .filter((c) => c.isActive)
                      .map((c) => (
                        <option key={c.id} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            </div>
          </Section>
          <Section
            title="Opening balance"
            description="Only if the student already owes money from before this system was used. It is recorded as a separate, dated item and never mixed into the year’s fee."
          >
            <div className="max-w-xs">
              <Field
                label="Amount owed (₹)"
                error={errors.opening}
                hint="Leave empty if nothing is owed."
              >
                {(a) => (
                  <Input
                    {...a}
                    inputMode="decimal"
                    placeholder="0"
                    value={f.opening}
                    onChange={(e) => set('opening', e.target.value)}
                  />
                )}
              </Field>
            </div>
          </Section>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => navigate('/students')}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Add student
            </Button>
          </div>
        </div>

        <aside aria-label="Fee preview" className="xl:sticky xl:top-20 xl:self-start">
          <Card>
            <div className="border-b border-line px-5 py-4">
              <h2 className="text-base font-semibold text-ink">Fee preview</h2>
              <p className="mt-0.5 text-[13px] text-muted">
                Academic year {year.data?.label ?? ''}
              </p>
            </div>
            {!p ? (
              <p className="flex items-start gap-2 px-5 py-8 text-sm text-muted">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> Choose a class to see the
                fee, the concession and the instalments.
              </p>
            ) : (
              <div className="space-y-4 p-5 text-sm">
                <ul className="space-y-1.5">
                  {p.lines.map((l) => (
                    <li key={l.code} className="flex justify-between">
                      <span className="text-muted">{l.label}</span>
                      <Money paise={l.amount} />
                    </li>
                  ))}
                  <li className="flex justify-between">
                    <span className="text-muted">Admission fee (new student)</span>
                    <Money paise={p.admission} />
                  </li>
                </ul>
                <div className="space-y-1.5 border-t border-line pt-3">
                  <div className="flex justify-between">
                    <span className="text-muted">Fee before concession</span>
                    <Money paise={p.gross} />
                  </div>
                  {p.concession > 0 && (
                    <div className="flex justify-between text-success">
                      <span>Category concession</span>
                      <span className="tabular-nums">
                        − <Money paise={p.concession} />
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold text-ink">
                    <span>Fee for the year</span>
                    <Money paise={p.payable} />
                  </div>
                </div>
                <div className="border-t border-line pt-3">
                  <p className="mb-2 font-medium text-ink">Instalments</p>
                  <ul className="space-y-1.5">
                    {p.instalments.map((i) => (
                      <li key={i.no} className="flex justify-between">
                        <span className="text-muted">
                          {i.no} · due {formatDate(i.dueDate)}
                        </span>
                        <Money paise={i.amount} />
                      </li>
                    ))}
                  </ul>
                </div>
                {p.openingBalance > 0 && (
                  <div className="flex justify-between border-t border-line pt-3">
                    <span className="text-muted">Opening balance (separate)</span>
                    <Money paise={p.openingBalance} />
                  </div>
                )}
                <div className="flex items-center justify-between rounded-lg bg-primary-soft px-4 py-3 font-semibold text-primary">
                  <span>Total to collect</span>
                  <Money paise={p.total} />
                </div>
              </div>
            )}
          </Card>
        </aside>
      </form>
    </>
  );
}
