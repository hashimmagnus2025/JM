import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  getAccessToken,
  login,
  request,
  setAccessToken,
  setSessionLostHandler,
} from './api';
import { fieldErrors, friendlyMessage } from './messages';

const json = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

let calls: { url: string; init?: RequestInit }[];
const mockFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return handler(url, init);
    }),
  );
};
const header = (c: { init?: RequestInit } | undefined, name: string): string | undefined =>
  (c?.init?.headers as Record<string, string> | undefined)?.[name];

beforeEach(() => {
  setAccessToken(null);
  setSessionLostHandler(() => undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('sends the Bearer token, JSON body and credentials; builds the query string', async () => {
    mockFetch(() => json(200, { data: { ok: 1 } }));
    setAccessToken('tok');
    const r = await request<{ data: { ok: number } }>('/x', {
      method: 'POST',
      body: { a: 1 },
      query: { q: 'hi', skip: undefined, empty: '' },
    });
    expect(r.data.ok).toBe(1);
    expect(calls[0]?.url).toBe('/api/v1/x?q=hi');
    expect(calls[0]?.init?.credentials).toBe('include');
    expect(header(calls[0], 'Authorization')).toBe('Bearer tok');
    expect(calls[0]?.init?.body).toBe('{"a":1}');
  });

  it('login keeps the token in memory only', async () => {
    mockFetch(() =>
      json(200, {
        data: {
          accessToken: 'abc',
          expiresIn: 900,
          user: { id: '1', name: 'A', email: 'a@a', roleKeys: [], mustChangePassword: false },
        },
      }),
    );
    await login('a@a', 'pw');
    expect(getAccessToken()).toBe('abc');
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain('abc');
    expect(header(calls[0], 'Authorization')).toBeUndefined(); // login is unauthenticated
  });

  it('turns API errors into ApiError with the stable code and request id', async () => {
    mockFetch(() =>
      json(422, {
        error: { code: 'YEAR_OVERLAP', message: 'These dates overlap.', requestId: 'r1' },
      }),
    );
    const err = await request('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'YEAR_OVERLAP', requestId: 'r1' });
    expect(friendlyMessage(err)).toBe('These dates overlap with another academic year.');
  });

  it('network failures become a friendly NETWORK_ERROR (never a raw TypeError)', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const err = await request('/x').catch((e) => e);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(friendlyMessage(err)).toMatch(/Cannot reach the server/);
  });

  it('non-JSON error bodies still produce a safe message', async () => {
    mockFetch(() => new Response('<html>boom</html>', { status: 502 }));
    const err = (await request('/x').catch((e) => e)) as ApiError;
    expect(err).toMatchObject({ status: 502, code: 'HTTP_502' });
    expect(err.message).not.toContain('<html>');
  });

  it('an expired token is renewed silently and the request retried with the new token', async () => {
    let n = 0;
    mockFetch((url) => {
      if (url.endsWith('/auth/refresh'))
        return json(200, { data: { accessToken: 'fresh', expiresIn: 900, user: {} } });
      n++;
      return n === 1
        ? json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } })
        : json(200, { data: 'ok' });
    });
    setAccessToken('old');
    const r = await request<{ data: string }>('/x');
    expect(r.data).toBe('ok');
    expect(getAccessToken()).toBe('fresh');
    expect(header(calls.filter((c) => c.url.endsWith('/x')).pop(), 'Authorization')).toBe(
      'Bearer fresh',
    );
    expect(
      header(
        calls.find((c) => c.url.endsWith('/auth/refresh')),
        'X-Requested-With',
      ),
    ).toBe('fetch');
  });

  it('several requests failing together trigger ONE refresh (single flight)', async () => {
    let first = 0;
    mockFetch(async (url) => {
      if (url.endsWith('/auth/refresh')) {
        await new Promise((r) => setTimeout(r, 20));
        return json(200, { data: { accessToken: 'fresh', expiresIn: 900, user: {} } });
      }
      first++;
      return first <= 3
        ? json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } })
        : json(200, { data: 'ok' });
    });
    setAccessToken('old');
    const all = await Promise.all([request('/a'), request('/b'), request('/c')]);
    expect(all).toHaveLength(3);
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('when the session cannot be renewed the app is told, and the 401 is surfaced', async () => {
    const lost = vi.fn();
    setSessionLostHandler(lost);
    mockFetch((url) =>
      url.endsWith('/auth/refresh')
        ? json(401, { error: { code: 'REFRESH_INVALID', message: 'x' } })
        : json(401, { error: { code: 'SESSION_ENDED', message: 'x' } }),
    );
    setAccessToken('old');
    await expect(request('/x')).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('a wrong password (401 INVALID_CREDENTIALS) never triggers a refresh', async () => {
    mockFetch(() => json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'x' } }));
    await expect(login('a@a', 'bad')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(0);
  });

  it('a 403 (missing permission) is not treated as an expired session', async () => {
    mockFetch(() => json(403, { error: { code: 'FORBIDDEN', message: 'no' } }));
    setAccessToken('t');
    await expect(request('/x')).rejects.toMatchObject({ status: 403 });
    expect(calls).toHaveLength(1);
  });

  it('204 responses resolve to undefined', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(request('/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

describe('messages', () => {
  it('maps field errors from a validation response', () => {
    const e = new ApiError(400, 'VALIDATION_ERROR', 'x', [
      { field: 'email', message: 'Invalid e-mail' },
      { field: 'email', message: 'second' },
      { field: 'name', message: 'Too short' },
    ]);
    expect(fieldErrors(e)).toEqual({ email: 'Invalid e-mail', name: 'Too short' });
    expect(fieldErrors(new Error('x'))).toEqual({});
  });
  it('unknown codes fall back to the server message; non-API errors get a generic one', () => {
    expect(friendlyMessage(new ApiError(409, 'SOMETHING_NEW', 'Server says no'))).toBe(
      'Server says no',
    );
    expect(friendlyMessage(new Error('raw'))).toBe('Something went wrong. Please try again.');
  });
});
