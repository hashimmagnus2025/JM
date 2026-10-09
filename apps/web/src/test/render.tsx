import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { useAuth, type Principal } from '../features/auth/auth';

export const principal = (permissions: string[], over: Partial<Principal> = {}): Principal => ({
  id: 'u1',
  name: 'Asha Mehta',
  email: 'asha@school.test',
  roleKeys: ['REGISTRAR'],
  permissions,
  dataScope: 'ALL',
  mustChangePassword: false,
  ...over,
});

export const signInAs = (p: Principal): void => useAuth.getState().set('authed', p);

export function renderPage(ui: ReactElement, route = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** route-aware fetch stub: `routes['GET /academic-years'] = () => ({ data: [...] })` */
export function stubApi(
  routes: Record<string, (body: unknown) => { status?: number; body?: unknown }>,
) {
  const calls: { key: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('/api/v1', '').split('?')[0];
      const key = `${init?.method ?? 'GET'} ${path}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ key, body });
      const h = routes[key];
      if (!h)
        return new Response(
          JSON.stringify({ error: { code: 'NOT_FOUND', message: `no stub for ${key}` } }),
          { status: 404 },
        );
      const out = h(body);
      return new Response(out.body === undefined ? null : JSON.stringify(out.body), {
        status: out.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}
