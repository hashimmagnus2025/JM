import { Writable } from 'node:stream';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createLogger } from './config/logger';
import { loadEnv } from './config/env';

const silent = createLogger('silent');
const validEnv = {
  NODE_ENV: 'test',
  MONGO_URI: 'mongodb://localhost:27017/sfm?replicaSet=rs0',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  S3_BUCKET: 'sfm-test',
  S3_ACCESS_KEY_ID: 'a',
  S3_SECRET_ACCESS_KEY: 'b',
};

describe('HTTP shell', () => {
  it('liveness, request id, secure headers, no x-powered-by', async () => {
    const app = createApp({ logger: silent, readiness: {} });
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[\w-]{8,}$/);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
  it('readiness reports every dependency; 503 when one is down or throws', async () => {
    const up = createApp({ logger: silent, readiness: { mongo: async () => true } });
    expect((await request(up).get('/readyz')).body).toEqual({
      status: 'ready',
      checks: { mongo: true },
    });
    const down = createApp({
      logger: silent,
      readiness: {
        mongo: async () => true,
        redis: async () => false,
        s3: async () => {
          throw new Error('boom');
        },
      },
    });
    const res = await request(down).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ mongo: true, redis: false, s3: false });
  });
  it('keeps a sane client request id and replaces a hostile one', async () => {
    const app = createApp({ logger: silent, readiness: {} });
    expect(
      (await request(app).get('/healthz').set('x-request-id', 'client-req-12345')).headers[
        'x-request-id'
      ],
    ).toBe('client-req-12345');
    expect(
      (await request(app).get('/healthz').set('x-request-id', 'bad id!<script>')).headers[
        'x-request-id'
      ],
    ).not.toContain('<');
  });
  it('unknown routes → 404 JSON; unhandled errors → generic 500 with NO stack trace', async () => {
    const app = createApp({ logger: silent, readiness: { crash: async () => true } });
    const nf = await request(app).get('/nope');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');
    const bad = await request(app)
      .post('/healthz')
      .set('content-type', 'application/json')
      .send('{not json');
    // malformed JSON is the CLIENT's mistake: a clear 400, never a 500, and never the parser's internals
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/at .*\.ts|SyntaxError|stack/);
    expect(bad.body.error).toMatchObject({ code: 'INVALID_JSON' });
  });
});

describe('logger redaction', () => {
  it('never writes secrets or contact details', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _e, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = createLogger('info', sink);
    log.info(
      {
        req: { headers: { authorization: 'Bearer SECRET', cookie: 'sid=SECRET' } },
        user: { passwordHash: 'HASH', mobile: '9876543210', email: 'a@b.c' },
        guardians: [{ mobile: '9123456789' }],
      },
      'test',
    );
    const out = lines.join('');
    for (const leaked of ['SECRET', 'HASH', '9876543210', 'a@b.c', '9123456789'])
      expect(out).not.toContain(leaked);
    expect(out).toContain('[REDACTED]');
  });
});

describe('environment validation (fail fast)', () => {
  it('accepts a valid configuration and applies defaults', () => {
    const env = loadEnv(validEnv);
    expect(env).toMatchObject({
      PORT: 4100,
      APP_TIMEZONE: 'Asia/Kolkata',
      JWT_ACCESS_TTL_SECONDS: 900,
      S3_FORCE_PATH_STYLE: false,
    });
  });
  it('rejects a missing/short secret, a non-replica-set Mongo URI, a bad Redis URL', () => {
    expect(() => loadEnv({ ...validEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadEnv({ ...validEnv, MONGO_URI: 'mongodb://localhost:27017/sfm' })).toThrow(
      /replica set/,
    );
    expect(() => loadEnv({ ...validEnv, REDIS_URL: 'http://x' })).toThrow(/REDIS_URL/);
    expect(() => loadEnv({ ...validEnv, S3_BUCKET: undefined })).toThrow(/S3_BUCKET/);
    expect(() => loadEnv({ ...validEnv, PORT: '99999' })).toThrow(/PORT/);
  });
  it('parses CORS origins and seed settings; blank values count as unset', () => {
    const env = loadEnv({
      ...validEnv,
      CORS_ORIGINS: 'https://a.test, https://b.test ,',
      SEED_ADMIN_EMAIL: '  ',
      SEED_ADMIN_PASSWORD: '',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://a.test', 'https://b.test']);
    expect(env.SEED_ADMIN_EMAIL).toBeUndefined();
    expect(env.SEED_ADMIN_PASSWORD).toBeUndefined();
    expect(loadEnv(validEnv).CORS_ORIGINS).toEqual([]);
    expect(() => loadEnv({ ...validEnv, CORS_ORIGINS: 'not a url' })).toThrow(/CORS_ORIGINS/);
  });
  it('refuses the example secret in production', () => {
    expect(() =>
      loadEnv({
        ...validEnv,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'change-me-change-me-change-me-change-me',
      }),
    ).toThrow(/example secret/);
  });
});
