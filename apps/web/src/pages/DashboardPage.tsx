import { ArrowRight, Check, Circle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Card, CardHeader, PageHeader, Skeleton } from '../components/ui';
import { useAuth, useCan } from '../features/auth/auth';
import { useCategories, useCurrentYear, useInstitution } from '../features/setup/api';
import { formatRange } from '../lib/format';

interface Step {
  id: string;
  title: string;
  hint: string;
  to: string;
  done: boolean | undefined;
  visible: boolean;
}

/** The real management dashboard (collections, outstanding, trends) arrives with the finance screens. Until then this is the guided setup checklist. */
export default function DashboardPage() {
  const principal = useAuth((s) => s.principal);
  const can = useCan();
  const institution = useInstitution();
  const year = useCurrentYear();
  const categories = useCategories();

  const profileDone = institution.data
    ? !!(
        institution.data.address.city &&
        (institution.data.contact.phone || institution.data.contact.email)
      )
    : undefined;
  const steps: Step[] = [
    {
      id: 'inst',
      title: 'Complete the institution profile',
      hint: 'Address and contact details appear on receipts.',
      to: '/administration/institution',
      done: profileDone,
      visible: can('institution.view'),
    },
    {
      id: 'year',
      title: 'Create the academic year and make it current',
      hint: 'Fees, classes and enrollments belong to a year.',
      to: '/academic/years',
      done: year.isPending ? undefined : !!year.data,
      visible: can('academicYear.view'),
    },
    {
      id: 'cat',
      title: 'Check student categories',
      hint: 'Categories choose the fee structure (General, RTE, Staff ward…).',
      to: '/academic/categories',
      done: categories.data ? categories.data.length > 0 : undefined,
      visible: can('studentCategory.view'),
    },
    {
      id: 'set',
      title: 'Review the school rules',
      hint: 'Late fees, payment methods, receipt numbers and more.',
      to: '/administration/settings',
      done: undefined,
      visible: can('settings.view'),
    },
  ].filter((s) => s.visible);

  const first = principal?.name.split(' ')[0] ?? '';

  return (
    <>
      <PageHeader
        title={`Welcome${first ? `, ${first}` : ''}`}
        description="Here is where to start. Classes, students, fees and collections appear in the menu as they are set up."
      />

      {year.data && (
        <p className="mb-6 text-sm text-muted">
          Current academic year: <strong className="text-ink">{year.data.label}</strong> ·{' '}
          {formatRange(year.data.startDate, year.data.endDate)}
        </p>
      )}

      <Card>
        <CardHeader
          title="Set up your school"
          description="Complete these steps once, in any order."
        />
        {institution.isPending && categories.isPending ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : (
          <ol className="divide-y divide-line">
            {steps.map((s, i) => (
              <li key={s.id}>
                <Link
                  to={s.to}
                  className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2"
                >
                  <span
                    className={
                      s.done
                        ? 'grid size-8 shrink-0 place-items-center rounded-full bg-success-bg text-success'
                        : 'grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted'
                    }
                    aria-hidden
                  >
                    {s.done ? <Check className="size-4" /> : <Circle className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">
                      {i + 1}. {s.title}
                    </span>
                    <span className="block text-[13px] text-muted">{s.hint}</span>
                  </span>
                  {s.done === true && <Badge tone="success">Done</Badge>}
                  <ArrowRight
                    className="size-4 text-muted transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
