/**
 * API client.
 *  - The access token lives in memory only (never localStorage); the refresh token is an httpOnly cookie the
 *    browser sends by itself.
 *  - An expired token is renewed silently, ONCE for all requests that fail at the same time (single flight), and the
 *    failed request is retried.
 *  - Every error becomes an ApiError with a stable `code`; screens show a friendly message, never raw text.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let onSessionLost: () => void = () => undefined;
let refreshing: Promise<boolean> | null = null;

export const setAccessToken = (t: string | null): void => {
  accessToken = t;
};
export const getAccessToken = (): string | null => accessToken;
/** called when the session cannot be renewed → the app sends the user to the sign-in page */
export const setSessionLostHandler = (fn: () => void): void => {
  onSessionLost = fn;
};

const BASE = '/api/v1';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  roleKeys: string[];
  mustChangePassword: boolean;
}

export interface SessionData {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
}

async function parse(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toError(res: Response, body: unknown): ApiError {
  const e = (
    body as
      | { error?: { code?: string; message?: string; details?: unknown; requestId?: string } }
      | undefined
  )?.error;
  return new ApiError(
    res.status,
    e?.code ?? `HTTP_${res.status}`,
    e?.message ?? 'Something went wrong. Please try again.',
    e?.details,
    e?.requestId,
  );
}

/** renew the access token with the refresh cookie; concurrent callers share ONE request */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Requested-With': 'fetch' },
      });
      if (res.status === 409) {
        // another tab renewed at the same moment; its cookie is already in the browser → one retry
        await new Promise((r) => setTimeout(r, 250));
        refreshing = null;
        return refreshSession();
      }
      if (!res.ok) return false;
      const body = (await parse(res)) as { data: SessionData };
      accessToken = body.data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** false for login style calls that must not trigger a silent renewal */
  auth?: boolean;
  signal?: AbortSignal;
  /** extra headers, e.g. Idempotency-Key on money-moving requests */
  headers?: Record<string, string>;
}

const RENEWABLE = new Set(['TOKEN_EXPIRED', 'TOKEN_INVALID', 'UNAUTHENTICATED', 'SESSION_ENDED']);

export async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true, signal, headers = {} } = opts;
  const qs = query
    ? new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : '';
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;

  const sentWith = accessToken;
  const doFetch = (): Promise<Response> =>
    fetch(url, {
      method,
      credentials: 'include',
      ...(signal ? { signal } : {}),
      headers: {
        ...headers,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  let res: Response;
  try {
    res = await doFetch();
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Cannot reach the server. Check your connection and try again.',
    );
  }

  if (res.status === 401 && auth) {
    const first = (await parse(res.clone())) as { error?: { code?: string } } | undefined;
    if (RENEWABLE.has(first?.error?.code ?? '')) {
      // someone else already renewed the token while this request was in flight → just retry with the new one
      if (accessToken !== sentWith && accessToken !== null) {
        res = await doFetch();
      } else if (await refreshSession()) {
        res = await doFetch();
      } else {
        onSessionLost();
      }
    }
  }

  const data = await parse(res);
  if (!res.ok) throw toError(res, data);
  return data as T;
}

export interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export async function get<T>(path: string, query?: RequestOptions['query']): Promise<T> {
  const r = await request<Envelope<T>>(path, { ...(query ? { query } : {}) });
  return r.data;
}

/** a list with its paging information (meta.total) */
export function getPage<T>(path: string, query?: RequestOptions['query']): Promise<Envelope<T[]>> {
  return request<Envelope<T[]>>(path, { ...(query ? { query } : {}) });
}

export function send<T>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<Envelope<T>> {
  return request<Envelope<T>>(path, {
    method,
    ...(body !== undefined ? { body } : {}),
    ...(headers ? { headers } : {}),
  });
}

export async function login(email: string, password: string): Promise<SessionData> {
  const r = await request<Envelope<SessionData>>('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  accessToken = r.data.accessToken;
  return r.data;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'fetch' },
    });
  } finally {
    accessToken = null;
  }
}
