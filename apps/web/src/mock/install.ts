/**
 * MOCK MODE (`npm run dev:mock`): answers /api/v1 requests in the browser so every screen can be built, reviewed
 * and shown to the client before the real backend exists. Data lives in memory and resets on reload.
 * This code is loaded only in mock mode and is not part of a production build.
 */
import { feeRoutes } from './routes';
import { setupRoutes, type Handler, type Out } from './setupRoutes';

const table = [...setupRoutes, ...feeRoutes];

async function handle(
  method: string,
  path: string,
  query: URLSearchParams,
  body: unknown,
  headers: Record<string, string>,
): Promise<Response> {
  await new Promise((r) => setTimeout(r, 70)); // a little latency, so loading states are visible
  for (const [m, re, fn] of table as [string, RegExp, Handler][]) {
    if (m !== method) continue;
    const match = re.exec(path);
    if (!match) continue;
    let out: Out;
    try {
      out = fn({ params: match.slice(1), query, body: body ?? {}, headers });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('mock handler failed', path, e);
      out = {
        status: 500,
        error: { code: 'INTERNAL', message: 'Something went wrong in the mock server.' },
      };
    }
    const status = out.error ? (out.status ?? 400) : (out.status ?? 200);
    const payload = out.error
      ? { error: { ...out.error, requestId: 'mock' } }
      : { data: out.data, ...(out.meta ? { meta: out.meta } : {}) };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(
    JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not available yet.' } }),
    { status: 404 },
  );
}

export function installMockApi(): void {
  const real = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('/api/v1')) return real(input, init);
    const u = new URL(url, window.location.origin);
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      body = undefined;
    }
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    return handle(
      (init?.method ?? 'GET').toUpperCase(),
      u.pathname.replace('/api/v1', ''),
      u.searchParams,
      body,
      headers,
    );
  }) as typeof window.fetch;
}
