import * as RDialog from '@radix-ui/react-dialog';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/format';
import { Button } from './ui';

/** accessible modal: focus trap, Escape to close, focus restored, labelled by its title */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" />
        <RDialog.Content
          className={cn(
            'page-enter fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-surface shadow-[var(--shadow-e3)]',
            wide ? 'max-w-2xl' : 'max-w-lg',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <RDialog.Title className="text-base font-semibold text-ink">{title}</RDialog.Title>
              <RDialog.Description
                className={cn('mt-0.5 text-[13px] text-muted', !description && 'sr-only')}
              >
                {description ?? title}
              </RDialog.Description>
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="sm" aria-label="Close" className="-mr-2">
                <X className="size-4" />
              </Button>
            </RDialog.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
              {footer}
            </div>
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
  icon?: ReactNode;
}

/** row-actions menu: keyboard operable, hides items the user may not use */
export function ActionMenu({ items, label = 'Actions' }: { items: MenuItem[]; label?: string }) {
  const visible = items.filter((i) => !i.hidden);
  if (visible.length === 0) return null;
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>
        <Button variant="ghost" size="sm" aria-label={label}>
          <MoreHorizontal className="size-4" />
        </Button>
      </RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow-e2)]"
        >
          {visible.map((i) => (
            <RMenu.Item
              key={i.label}
              onSelect={i.onSelect}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2',
                i.danger ? 'text-danger' : 'text-ink',
              )}
            >
              {i.icon}
              {i.label}
            </RMenu.Item>
          ))}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

export { RMenu };
