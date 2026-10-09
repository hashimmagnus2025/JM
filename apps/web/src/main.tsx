import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { router } from './app/router';
import { bootSession } from './features/auth/auth';
import { ApiError } from './lib/api';
import { applyTheme } from './layouts/AppShell';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // retry network blips and server errors, never client mistakes (4xx)
      retry: (count, e) =>
        count < 2 && !(e instanceof ApiError && e.status >= 400 && e.status < 500),
    },
  },
});

try {
  const t = localStorage.getItem('theme');
  if (t === 'light' || t === 'dark') applyTheme(t);
} catch {
  /* storage blocked */
}

void bootSession();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {/* styled with OUR tokens (not the library's "rich colours", which fail WCAG AA contrast) */}
      <Toaster
        position="bottom-right"
        closeButton
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              'flex w-[356px] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-lg border border-line border-l-4 bg-surface p-4 text-sm text-ink shadow-[var(--shadow-e2)]',
            title: 'font-medium text-ink',
            description: 'text-muted',
            success: 'border-l-success',
            error: 'border-l-danger',
            warning: 'border-l-warning',
            info: 'border-l-info',
            closeButton: 'rounded-md border border-line bg-surface text-ink',
          },
        }}
      />
    </QueryClientProvider>
  </StrictMode>,
);
