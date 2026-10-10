import { Loader2 } from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom';
import { useAuth, usePermission } from '../features/auth/auth';
import { AppShell } from '../layouts/AppShell';
import { ErrorState } from '../components/ui';
import { FINANCE_UI } from '../lib/features';

// route-level code splitting: each screen is downloaded only when it is opened
const LoginPage = lazy(() => import('../pages/LoginPage'));
const ChangePasswordPage = lazy(() => import('../pages/ChangePasswordPage'));
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const AcademicYearsPage = lazy(() => import('../pages/AcademicYearsPage'));
const ClassesPage = lazy(() => import('../pages/ClassesPage'));
const DivisionsPage = lazy(() => import('../pages/DivisionsPage'));
const TeachersPage = lazy(() => import('../pages/TeachersPage'));
const CategoriesPage = lazy(() => import('../pages/CategoriesPage'));
const InstitutionPage = lazy(() => import('../pages/InstitutionPage'));
const SettingsPage = lazy(() => import('../pages/SettingsPage'));
const StudentsPage = lazy(() => import('../pages/StudentsPage'));
const StudentProfilePage = lazy(() => import('../pages/StudentProfilePage'));
const AddStudentPage = lazy(() => import('../pages/AddStudentPage'));
const PromotionPage = lazy(() => import('../pages/PromotionPage'));
const FeeStructuresPage = lazy(() => import('../pages/FeeStructuresPage'));
const CollectFeePage = lazy(() => import('../pages/CollectFeePage'));
const ReceiptsPage = lazy(() => import('../pages/ReceiptsPage'));
const AdjustmentsPage = lazy(() => import('../pages/AdjustmentsPage'));
const OutstandingPage = lazy(() => import('../pages/OutstandingPage'));
const RemindersPage = lazy(() => import('../pages/RemindersPage'));
const TargetsPage = lazy(() => import('../pages/TargetsPage'));
const ReportsPage = lazy(() => import('../pages/ReportsPage'));
const UsersPage = lazy(() => import('../pages/UsersPage'));
const AuditPage = lazy(() => import('../pages/AuditPage'));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'));

const Busy = () => (
  <div
    className="grid h-full min-h-40 place-items-center text-muted"
    role="status"
    aria-label="Loading"
  >
    <Loader2 className="size-6 animate-spin" aria-hidden />
  </div>
);
const Lazy = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<Busy />}>{children}</Suspense>
);

/** signed-in users only; a user with a temporary password can reach nothing but the change-password page */
export function RequireAuth() {
  const status = useAuth((s) => s.status);
  const mustChange = useAuth((s) => s.principal?.mustChangePassword);
  const location = useLocation();
  if (status === 'booting') return <Busy />;
  if (status === 'anon')
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (mustChange && location.pathname !== '/change-password')
    return <Navigate to="/change-password" replace />;
  if (mustChange)
    return (
      <Lazy>
        <ChangePasswordPage />
      </Lazy>
    );
  return <AppShell />;
}

/** a direct link to a page the user may not open shows a clear message instead of an empty screen */
function Guard({ permission, children }: { permission: string; children: ReactNode }) {
  const ok = usePermission(permission);
  if (!ok)
    return (
      <ErrorState message="You do not have permission to open this page. Ask your administrator if you need access." />
    );
  return <Lazy>{children}</Lazy>;
}

/** screens of the finance modules (students, fees, receivables, insight): on when their backend is ready, or in mock mode */
const guarded = (path: string, permission: string, page: ReactNode) => ({
  path,
  element: <Guard permission={permission}>{page}</Guard>,
});
const financeRoutes = FINANCE_UI
  ? [
      guarded('/students', 'student.view', <StudentsPage />),
      guarded('/students/new', 'student.create', <AddStudentPage />),
      guarded('/students/promotion', 'promotion.run', <PromotionPage />),
      guarded('/students/:id', 'student.view', <StudentProfilePage />),
      guarded('/fees/structures', 'feeStructure.view', <FeeStructuresPage />),
      guarded('/fees/collect', 'payment.collect', <CollectFeePage />),
      guarded('/fees/receipts', 'receipt.view', <ReceiptsPage />),
      guarded('/fees/adjustments', 'adjustment.view', <AdjustmentsPage />),
      guarded('/receivables/outstanding', 'outstanding.view', <OutstandingPage />),
      guarded('/receivables/reminders', 'reminder.view', <RemindersPage />),
      guarded('/insights/targets', 'dashboard.view', <TargetsPage />),
      guarded('/insights/reports', 'report.view', <ReportsPage />),
      guarded('/administration/users', 'user.view', <UsersPage />),
      guarded('/administration/audit', 'audit.view', <AuditPage />),
    ]
  : [];

export const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <Lazy>
        <LoginPage />
      </Lazy>
    ),
  },
  {
    element: <RequireAuth />,
    errorElement: (
      <ErrorState
        message="Something went wrong on this page. Please reload."
        onRetry={() => window.location.reload()}
      />
    ),
    children: [
      {
        path: '/',
        element: (
          <Lazy>
            <DashboardPage />
          </Lazy>
        ),
      },
      {
        path: '/academic/years',
        element: (
          <Guard permission="academicYear.view">
            <AcademicYearsPage />
          </Guard>
        ),
      },
      {
        path: '/academic/classes',
        element: (
          <Guard permission="class.view">
            <ClassesPage />
          </Guard>
        ),
      },
      {
        path: '/academic/divisions',
        element: (
          <Guard permission="division.view">
            <DivisionsPage />
          </Guard>
        ),
      },
      {
        path: '/academic/teachers',
        element: (
          <Guard permission="teacher.view">
            <TeachersPage />
          </Guard>
        ),
      },
      {
        path: '/academic/categories',
        element: (
          <Guard permission="studentCategory.view">
            <CategoriesPage />
          </Guard>
        ),
      },
      {
        path: '/administration/institution',
        element: (
          <Guard permission="institution.view">
            <InstitutionPage />
          </Guard>
        ),
      },
      {
        path: '/administration/settings',
        element: (
          <Guard permission="settings.view">
            <SettingsPage />
          </Guard>
        ),
      },
      ...financeRoutes,
      {
        path: '/change-password',
        element: (
          <Lazy>
            <ChangePasswordPage />
          </Lazy>
        ),
      },
      {
        path: '*',
        element: (
          <Lazy>
            <NotFoundPage />
          </Lazy>
        ),
      },
    ],
  },
]);
