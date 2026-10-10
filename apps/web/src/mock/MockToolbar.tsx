import { SYSTEM_ROLES } from '@sfm/shared';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { reloadPrincipal } from '../features/auth/auth';
import { useMockRole } from './role';

/** MOCK MODE only: switch the signed-in role to show how the menu and actions change, or reset the sample data */
export default function MockToolbar() {
  const role = useMockRole((s) => s.role);
  const setRole = useMockRole((s) => s.setRole);
  return (
    <div
      role="region"
      aria-label="Mock data controls"
      className="fixed top-3.5 left-14 z-40 flex items-center gap-2 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs text-muted shadow-[var(--shadow-e1)] lg:left-72"
    >
      <FlaskConical className="size-3.5 text-primary" aria-hidden />
      <span className="hidden font-medium text-ink md:inline">Sample data · nothing is saved</span>
      <label className="inline-flex items-center gap-1.5">
        View as
        <select
          aria-label="View as role"
          className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-ink"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            void reloadPrincipal();
          }}
        >
          {SYSTEM_ROLES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-primary hover:bg-primary-soft"
      >
        <RotateCcw className="size-3" aria-hidden /> Reset
      </button>
    </div>
  );
}
