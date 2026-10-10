import * as RMenu from '@radix-ui/react-dropdown-menu';
import {
  Building2,
  CalendarRange,
  ChevronDown,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  UserRound,
  LayoutGrid,
  Tags,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut, useAuth, useCan } from '../features/auth/auth';
import { Button } from '../components/ui';
import { cn, initials } from '../lib/format';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  end?: boolean;
}
interface NavGroup {
  title?: string;
  items: NavItem[];
}

/** navigation follows the permissions the user holds (a convenience; the backend enforces access) */
export const NAV: NavGroup[] = [
  { items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    title: 'Academic',
    items: [
      {
        to: '/academic/years',
        label: 'Academic years',
        icon: CalendarRange,
        permission: 'academicYear.view',
      },
      {
        to: '/academic/classes',
        label: 'Classes',
        icon: GraduationCap,
        permission: 'class.view',
      },
      {
        to: '/academic/divisions',
        label: 'Divisions',
        icon: LayoutGrid,
        permission: 'division.view',
      },
      {
        to: '/academic/teachers',
        label: 'Teachers',
        icon: UserRound,
        permission: 'teacher.view',
      },
      {
        to: '/academic/categories',
        label: 'Student categories',
        icon: Tags,
        permission: 'studentCategory.view',
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        to: '/administration/institution',
        label: 'Institution',
        icon: Building2,
        permission: 'institution.view',
      },
      {
        to: '/administration/settings',
        label: 'Settings',
        icon: Settings,
        permission: 'settings.view',
      },
    ],
  },
];

type Theme = 'light' | 'dark' | 'system';
const readTheme = (): Theme => {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
};
export function applyTheme(t: Theme): void {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try {
    if (t === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', t);
  } catch {
    /* storage blocked: the theme simply is not remembered */
  }
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const can = useCan();
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {NAV.map((g, gi) => {
        const items = g.items.filter((i) => !i.permission || can(i.permission));
        if (items.length === 0) return null;
        return (
          <div key={gi}>
            {g.title && (
              <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wide text-subtle uppercase">
                {g.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={i.to}>
                  <NavLink
                    to={i.to}
                    end={i.end ?? false}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary text-on-primary'
                          : 'text-muted hover:bg-surface-2 hover:text-ink',
                      )
                    }
                  >
                    <i.icon className="size-4 shrink-0" aria-hidden />
                    {i.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell() {
  const principal = useAuth((s) => s.principal);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => applyTheme(theme), [theme]);

  return (
    <div className="flex h-full bg-bg text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      {/* desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-line px-5">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-on-primary">
            <GraduationCap className="size-5" aria-hidden />
          </span>
          <span className="text-[15px] font-semibold">School Fees</span>
        </div>
        <Sidebar />
      </aside>

      {/* mobile drawer */}
      {open && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <aside className="page-enter relative flex h-full w-72 flex-col bg-surface shadow-[var(--shadow-e3)]">
            <div className="flex h-16 items-center justify-between border-b border-line px-5">
              <span className="text-[15px] font-semibold">School Fees</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <Menu className="size-5" />
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <RMenu.Root>
            <RMenu.Trigger asChild>
              <button
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2"
                aria-label="Account menu"
              >
                <span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-semibold text-on-primary">
                  {initials(principal?.name ?? '')}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block text-[13px] leading-tight font-medium">
                    {principal?.name}
                  </span>
                  <span className="block text-[11px] leading-tight text-muted">
                    {principal?.roleKeys.join(', ').replaceAll('_', ' ').toLowerCase()}
                  </span>
                </span>
                <ChevronDown className="size-4 text-muted" aria-hidden />
              </button>
            </RMenu.Trigger>
            <RMenu.Portal>
              <RMenu.Content
                align="end"
                sideOffset={6}
                className="z-50 min-w-52 rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow-e2)]"
              >
                <div className="px-3 py-2 text-xs text-muted">{principal?.email}</div>
                <RMenu.Separator className="my-1 h-px bg-line" />
                <RMenu.Item
                  onSelect={() => navigate('/change-password')}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
                >
                  <KeyRound className="size-4" aria-hidden /> Change password
                </RMenu.Item>
                <RMenu.Item
                  onSelect={() => void signOut().then(() => navigate('/login'))}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-danger outline-none data-[highlighted]:bg-surface-2"
                >
                  <LogOut className="size-4" aria-hidden /> Sign out
                </RMenu.Item>
              </RMenu.Content>
            </RMenu.Portal>
          </RMenu.Root>
        </header>
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <div
            key={location.pathname}
            className="page-enter mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8"
          >
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
