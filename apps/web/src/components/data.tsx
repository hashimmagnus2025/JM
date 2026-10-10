import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import type { FeeStatus, InstStatus } from '../features/fees/types';
import { cn } from '../lib/format';
import { rs, rsShort } from '../lib/money';
import { Badge, Card, type Tone } from './ui';

export { rs, rsShort };

/* ------------------------------ money & status ------------------------------ */

export function Money({
  paise,
  compact,
  className,
}: {
  paise: number;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('tabular-nums', className)}>{compact ? rsShort(paise) : rs(paise)}</span>
  );
}

const FEE_STATUS: Record<FeeStatus, { label: string; tone: Tone }> = {
  PAID: { label: 'Paid up to date', tone: 'success' },
  PARTIAL: { label: 'Partially paid', tone: 'info' },
  UNPAID: { label: 'Unpaid', tone: 'neutral' },
  OVERDUE: { label: 'Overdue', tone: 'danger' },
};
export const FeeStatusBadge = ({ status }: { status: FeeStatus }) => (
  <Badge tone={FEE_STATUS[status].tone}>{FEE_STATUS[status].label}</Badge>
);
const INST_STATUS: Record<InstStatus, { label: string; tone: Tone }> = {
  PAID: { label: 'Paid', tone: 'success' },
  PARTIAL: { label: 'Partial', tone: 'info' },
  PENDING: { label: 'Pending', tone: 'neutral' },
  DUE_SOON: { label: 'Due soon', tone: 'warning' },
  OVERDUE: { label: 'Overdue', tone: 'danger' },
};
export const InstBadge = ({ status }: { status: InstStatus }) => (
  <Badge tone={INST_STATUS[status].tone}>{INST_STATUS[status].label}</Badge>
);

/* ------------------------------ stat card & progress ------------------------------ */

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  icon?: ReactNode;
}) {
  const toneCls = {
    default: 'bg-primary-soft text-primary',
    success: 'bg-success-bg text-success',
    warning: 'bg-warning-bg text-warning',
    danger: 'bg-danger-bg text-danger',
    info: 'bg-info-bg text-info',
  }[tone];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted">{label}</p>
          <p className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-ink tabular-nums">
            {value}
          </p>
          {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
        </div>
        {icon && (
          <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', toneCls)}>
            {icon}
          </span>
        )}
      </div>
    </Card>
  );
}

export function Progress({
  pct,
  label,
  tone = 'primary',
}: {
  pct: number;
  label?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
}) {
  const bar = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  }[tone];
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div
        className={cn('h-full rounded-full transition-[width]', bar)}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
export const pctTone = (pct: number): 'success' | 'warning' | 'danger' =>
  pct >= 85 ? 'success' : pct >= 70 ? 'warning' : 'danger';

/* ------------------------------ tabs ------------------------------ */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="mb-4 flex gap-1 overflow-x-auto border-b border-line"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
            value === t.id
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ table ------------------------------ */

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'right';
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  pageSize = 12,
  onRowClick,
  empty = 'Nothing to show.',
  caption,
  paging,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  empty?: string;
  caption: string;
  /** when the server pages the list: rows are already one page */
  paging?: { page: number; total: number; onPage: (p: number) => void };
}) {
  const [localPage, setLocalPage] = useState(0);
  const total = paging?.total ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safe = Math.min(paging ? paging.page : localPage, pages - 1);
  const setPage = paging ? paging.onPage : setLocalPage;
  const slice = paging ? rows : rows.slice(safe * pageSize, safe * pageSize + pageSize);
  return (
    <div>
      {/* a scrollable area must be reachable by keyboard (and named) so people without a mouse can scroll a wide table */}
      <div className="overflow-x-auto" role="region" aria-label={caption} tabIndex={0}>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-surface-2/60 text-[12px] font-semibold tracking-wide text-muted uppercase">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    'px-4 py-3 whitespace-nowrap',
                    c.align === 'right' && 'text-right',
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {slice.map((r) => (
              <tr
                key={rowKey(r)}
                className={cn(
                  'transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-primary-soft/60',
                )}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                {...(onRowClick
                  ? {
                      tabIndex: 0,
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === 'Enter') onRowClick(r);
                      },
                    }
                  : {})}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-4 py-3 align-middle',
                      c.align === 'right' && 'text-right tabular-nums',
                      c.className,
                    )}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total === 0 && <p className="px-5 py-10 text-center text-sm text-muted">{empty}</p>}
      {total > pageSize && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
          <span>
            {safe * pageSize + 1}–{Math.min(total, safe * pageSize + pageSize)} of{' '}
            {total.toLocaleString('en-IN')}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={safe === 0}
              onClick={() => setPage(safe - 1)}
              className="grid size-8 place-items-center rounded-md border border-line-strong text-ink hover:bg-primary-soft disabled:opacity-40"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <span className="px-2 tabular-nums">
              {safe + 1} / {pages}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={safe >= pages - 1}
              onClick={() => setPage(safe + 1)}
              className="grid size-8 place-items-center rounded-md border border-line-strong text-ink hover:bg-primary-soft disabled:opacity-40"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ charts (plain CSS, no library) ------------------------------ */

export function ColumnChart({
  data,
  label,
}: {
  data: { name: string; value: number; target?: number; muted?: boolean }[];
  label: string;
}) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.target ?? 0)));
  const summary = data
    .map(
      (d) => `${d.name}: ${rsShort(d.value)}${d.target ? ` of ${rsShort(d.target)} target` : ''}`,
    )
    .join('; ');
  return (
    <figure className="m-0">
      <div
        role="img"
        aria-label={`${label}. ${summary}`}
        className="flex h-52 items-end gap-2 sm:gap-3"
      >
        {data.map((d) => (
          <div
            key={d.name}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
          >
            <div className="relative flex w-full flex-1 items-end justify-center">
              {d.target !== undefined && (
                <div
                  aria-hidden
                  className="absolute bottom-0 w-full max-w-9 rounded-t-md border border-dashed border-line-strong bg-surface-2/50"
                  style={{ height: `${(d.target / max) * 100}%` }}
                />
              )}
              <div
                aria-hidden
                className={cn(
                  'relative w-full max-w-9 rounded-t-md',
                  d.muted ? 'bg-line' : 'bg-primary',
                )}
                style={{ height: `${(d.value / max) * 100}%` }}
              />
            </div>
            <span className="text-[11px] text-muted">{d.name}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-primary" /> Collected
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-sm border border-dashed border-line-strong bg-surface-2"
          />{' '}
          Target
        </span>
      </figcaption>
    </figure>
  );
}

export function SplitBar({
  parts,
  label,
}: {
  parts: { name: string; value: number; cls: string }[];
  label: string;
}) {
  const total = parts.reduce((t, p) => t + p.value, 0) || 1;
  return (
    <div>
      <div
        role="img"
        aria-label={`${label}: ${parts.map((p) => `${p.name} ${p.value.toLocaleString('en-IN')}`).join(', ')}`}
        className="flex h-3 overflow-hidden rounded-full bg-surface-2"
      >
        {parts.map((p) => (
          <div key={p.name} className={p.cls} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.name} className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-muted">
              <span aria-hidden className={cn('size-2.5 rounded-sm', p.cls)} />
              {p.name}
            </span>
            <span className="font-medium text-ink tabular-nums">
              {p.value.toLocaleString('en-IN')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------ small layout helpers ------------------------------ */

export function Section({
  title,
  description,
  action,
  children,
  flush,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  const id = useId();
  return (
    <Card>
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 id={id} className="text-base font-semibold text-ink">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
        {action}
      </div>
      <div className={flush ? '' : 'p-5'} aria-labelledby={id}>
        {children}
      </div>
    </Card>
  );
}

export const KV = ({ k, v }: { k: string; v: ReactNode }) => (
  <div>
    <dt className="text-xs text-muted">{k}</dt>
    <dd className="mt-0.5 text-sm font-medium text-ink">{v}</dd>
  </div>
);

/** downloads the rows as a real CSV file (the demo's export buttons work) */
export function downloadCsv(name: string, header: string[], rows: (string | number)[][]): void {
  const esc = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
