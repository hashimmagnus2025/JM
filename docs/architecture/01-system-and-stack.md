# 1 · System Architecture  &  2 · Technology Stack

## 1. Complete System Architecture

### 1.1 Context & runtime topology

```
                         ┌─────────────────────────────────────┐
 Staff / Management /    │  Nginx                              │
 Class teachers  ──TLS──►│  TLS · gzip/brotli · static SPA     │
 (desktop, tablet,       │  security headers · edge rate limit │
  mobile browser)        └───────┬───────────────────┬─────────┘
                                 │ /                 │ /api/v1/*
                         React SPA (static)          ▼
                                            ┌──────────────────┐        ┌──────────────────────┐
                                            │ API  (Express 5) │───────►│ MongoDB (replica set)│
                                            │ N stateless      │        │ txns · aggregation   │
                                            │ instances        │        └──────────────────────┘
                                            └────────┬─────────┘        ┌──────────────────────┐
                                                     │ enqueue ────────►│ Redis                │
                                                     │                  │ BullMQ · cache ·     │
                                                     │                  │ rate-limit · locks   │
                                                     ▼                  └──────────┬───────────┘
                                      ┌────────────────────────────┐               │ consume
                                      │ S3-compatible object store │               ▼
                                      │ logo · receipts PDF ·      │◄──── ┌──────────────────┐
                                      │ exports · import files     │      │ Worker(s)        │
                                      └────────────────────────────┘      │ same codebase,   │──► WhatsApp / SMS /
                                                                          │ different entry  │    Email providers
                                                                          └──────────────────┘    (adapters)
              Sentry (errors)  ·  pino JSON logs → stdout → host log shipper  ·  Uptime monitor on /readyz
```

**Processes (all from one Docker image, different commands):**
`api` (HTTP) · `worker` (BullMQ consumers + schedulers) · `migrate` (one-shot: indexes/seed/migrations).

### 1.2 Why a modular monolith

| Need | Consequence |
|---|---|
| A payment touches *payment + allocations + receivables + balance projection + receipt + audit* atomically | Must be one MongoDB transaction → one process boundary / one data owner. Microservices would force sagas for money. |
| SOW commercial page: one VPS | Fewer moving parts; scale-out by running more `api`/`worker` containers. |
| Future: parent portal, gateway, multi-branch (SOW §52) | Each module exposes a service interface; adapters for providers. Extraction later is possible because modules do not reach into each other's collections. |

### 1.3 Request lifecycle (API)

```
Nginx → requestId (AsyncLocalStorage) → pino-http → helmet/CORS → body limit
  → rate-limit (Redis) → authenticate (verify JWT, load Principal from cache — NOT from token claims)
  → authorize(permission) → scope resolver (data scope)  → validate (Zod: params, query, body)
  → idempotency guard (flagged routes) → controller (thin: map DTO ↔ command)
  → service (business rules, UnitOfWork transaction, audit, afterCommit hooks)
  → repository (Mongoose; tenant + scope filter injected here)
  → response mapper (DTO — never raw documents) → error handler (stable error codes, no stack traces)
```

### 1.4 Layer rules (enforced by lint, not by convention)

| Layer | May depend on | Must not |
|---|---|---|
| **routes** | controllers, middleware, shared schemas | contain logic |
| **controllers** | services (own module), DTO mappers | touch models, start transactions |
| **services** | own repositories, **other modules' public service interfaces**, `domain/finance`, `domain/academic`, providers via ports | import another module's models/repositories |
| **repositories** | Mongoose models of the *own* module | business rules |
| **domain/finance** | only pure utilities from `@sfm/shared` (money, business dates, canonical JSON) and itself | import mongoose, express, redis, fs, `node:crypto`, `Date.now()` (use injected `Clock`); `domain/billing` and `domain/finance` may not import each other |
| **jobs/workers** | services | duplicate service logic |

Implemented with `eslint-plugin-boundaries` + `no-restricted-imports`; CI fails on violation.

### 1.5 Cross-cutting mechanisms

**Unit of Work (transactions).** `uow.run(ctx, async (tx) => …)` wraps `session.withTransaction` with: automatic retry on `TransientTransactionError` / `UnknownTransactionCommitResult`, `readConcern: snapshot`, `writeConcern: majority`, a hard time limit, and an **`afterCommit(fn)` queue** (cache-version bump, BullMQ enqueue, notification). Repositories receive `tx` explicitly (no hidden global session).

*Commands that must be transactional:* student admission, payment collection, payment reversal, opening balance create/reverse, adjustment approve/reverse, installment restructure, teacher change, enrollment/promotion (per student), fee-assignment, late-fee posting, import-commit chunk, receipt cancellation.

**Idempotency.** `Idempotency-Key` header (UUID generated when the form is opened) on payment, reversal, admission, promotion-commit, import-commit. Stored with a unique index and the response hash; replay returns the original response (HTTP 200 + `Idempotent-Replay: true`).

**Optimistic concurrency.** Mutable masters carry `version`; `PATCH` requires `If-Match: <version>` → `409 VERSION_CONFLICT` instead of lost updates. Financial counters use **guarded atomic updates** (`{_id, pending: {$gte: x}}` + `$inc`) — see §11.

**Domain events — deliberately simple.** Synchronous in-process calls inside the transaction for *consistency-critical* effects (audit, balance projection, receipt). Post-commit hooks for *best-effort* effects (enqueue reminder cancellation, cache invalidation, notifications). **No outbox pattern in v1**: every post-commit effect is either idempotent and re-derivable (nightly reconciliation, send-time re-check of balance) or non-critical. This avoids a moving part that does not solve a real problem here.

**Clock & time.** `Clock.today(): BusinessDate` (IST) and `Clock.now(): Date`; tests freeze time. `BusinessDate` is a branded string; arithmetic through a tiny util (`addDays`, `diffDays`) — never `new Date()` in domain code.

**Error model.** Typed `AppError(code, httpStatus, details)`; domain rule violations are `422` with stable codes (`PAYMENT_EXCEEDS_OUTSTANDING`, `DUPLICATE_TRANSACTION_REF`, `RECEIVABLE_VERSION_CONFLICT`, …). Frontend maps `code → friendly message`; stack traces never leave the server.

**Multi-institution readiness.** Every business document has `institutionId`. The repository base class injects it from the principal; there is no way to query without it. v1 runs one institution per deployment (matches the VPS commercial model) but a second institution does not require a schema change. Campus/branch (`campusId`) is a *future additive field* — not built (SOW §52).

### 1.6 Deployment topology (sized for the SOW's single VPS)

```
VPS (≈4 vCPU / 8 GB) — docker compose
 ├─ nginx            (80/443, certbot/ACME, serves /dist, proxies /api)
 ├─ api      ×2      (512 MB each, stateless)
 ├─ worker   ×1      (512 MB; BullMQ concurrency per queue)
 ├─ mongo            (single-node REPLICA SET + keyfile auth — required for transactions;
 │                    WiredTiger cache ≈ 2 GB; volume on dedicated disk)
 ├─ redis            (AOF on; maxmemory 256 MB; noeviction for BullMQ DB)
 ├─ backup           (cron: encrypted mongodump → off-site S3 bucket; weekly restore test)
 └─ minio  (optional — or use external S3-compatible: Cloudflare R2 / Backblaze B2 / AWS S3)
External: Sentry (SaaS), uptime monitor, WhatsApp/SMS/Email providers.
```

*Honest limits:* a single-node replica set is **not** high availability. RPO is bounded by backup cadence (§18 proposes hourly oplog-based dumps + daily full). Growth path with **no code change**: managed MongoDB (3-node RS), managed Redis, S3, CDN for the SPA, more `api` replicas.

### 1.7 Environments & configuration

`local` (docker compose with mongo-RS, redis, minio, mailpit) · `ci` (service containers) · `staging` · `production`. All config via env, **validated at boot with Zod** (process exits on invalid/missing); `.env.example` committed; secrets never in images; production secrets in a root-only env file or Docker secrets. `autoIndex` is **off** outside local; indexes are created by versioned migrations (`migrate` job) — never `syncIndexes()` in production.

---

## 2. Technology Stack and Reason for Each

### 2.1 Core (as specified)

| Layer | Technology | Why it earns its place | Guardrail |
|---|---|---|---|
| Runtime | **Node.js 22 LTS** (≥ 22; runs unchanged on 24) + TypeScript `strict` | One language across web/api/shared schemas. | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` on. |
| API | **Express 5** | Native async error propagation; mature middleware ecosystem. | Thin controllers; no logic in routes. |
| DB | **MongoDB 8 + Mongoose** | Requested. Transactions, aggregation, partial/compound indexes cover every need. | Replica set always (even local). DTO ≠ persistence schema. |
| Validation | **Zod** (shared package) | One schema → backend validation, frontend forms (RHF resolver), OpenAPI. | Strict objects (reject unknown keys → no mass-assignment). |
| Auth | **JWT access (15 min) + rotating refresh token**, **Argon2id** | Stateless API scaling + revocable sessions. | See §18; use `@node-rs/argon2` (prebuilt binaries, no native toolchain in Alpine). |
| Jobs | **Redis + BullMQ** | Reminders, exports, imports, nightly jobs must not block requests; needs retries/backoff/scheduling. | Jobs are idempotent; job IDs derived from business keys. |
| Logging | **Pino** (+ `pino-http`) | Fast structured JSON; `redact` for secrets/PII. | Business-event logger separate from request logger. |
| Security | **Helmet, CORS allow-list, express-rate-limit (Redis store)** | Baseline hardening. | CSP tuned for SPA; no wildcard CORS. |
| Files | **S3-compatible** via AWS SDK v3 | Receipts/exports/imports/logo out of Mongo. | Private buckets; presigned GET, short TTL; lifecycle rules. |
| Reports | **ExcelJS** (streaming xlsx), **`csv-stringify`** (streaming csv), **pdfmake** (PDF) | See 2.3. | CSV/Excel formula-injection sanitizer on every cell. |
| API docs | **OpenAPI 3.1 generated from the same Zod schemas** (`@asteasolutions/zod-to-openapi`) + Swagger UI | Spec can't drift from validation. | Swagger UI disabled/protected in production. |
| Tests | **Vitest, Supertest, Playwright** | Requested. | + `fast-check`, `mongodb-memory-server` (replica-set mode), `axe-playwright`. |
| DevOps | **Docker, Compose, Nginx, GitHub Actions** | Reproducible builds and deploys. | Multi-stage, non-root, read-only FS where possible. |
| Monitoring | **Sentry** (+ `/healthz`, `/readyz`, uptime check) | Error visibility with PII scrubbing. | Prometheus/Grafana only if/when ops needs it — *not added now*. |

### 2.2 Frontend

| Concern | Choice | Reason / rule |
|---|---|---|
| Build | **React 19 + Vite + TypeScript** | Fast DX, route-level code splitting. |
| Styling | **Tailwind CSS + shadcn/ui + Radix + lucide-react** | Accessible primitives we *own* and restyle into an original design system (tokens in §14) — not a template look. |
| Routing | **React Router** (data-router mode) | Route loaders for auth guard, `lazy()` per route. |
| Server state | **TanStack Query** | Cache, dedupe, optimistic UI where safe (never for money), retry policy per error class. |
| Client state | **Zustand — only** for: auth principal, selected academic year context, sidebar/UI prefs, admission-wizard draft | Everything else is server state or URL state. |
| Forms | **React Hook Form + Zod** (shared schemas) | Same validation both sides; server remains authority. |
| Tables | **TanStack Table** (server-side pagination/sort/filter) + `@tanstack/react-virtual` only for long-lived large lists | Column visibility, sticky headers, row selection. |
| Charts | **Recharts** | Requested; wrapped in our own `ChartCard` to enforce palette/tooltips/a11y summaries. |
| Command palette / global search | `cmdk` (shadcn `Command`) | Keyboard-first search. |
| Toasts | `sonner` | Accessible, minimal. |
| URL state | `useSearchParams` + Zod parser helper | Filters are shareable/bookmarkable and drive drill-down — no extra library. |

### 2.3 Why these report libraries

- **pdfmake** for receipts and tabular PDFs: pure JS (no Chromium in the runtime image), declarative tables, headers/footers/page numbers. **Fonts are embedded (Noto Sans)** — the standard PDF fonts have **no ₹ glyph**. Caveat: complex scripts (Devanagari shaping) are limited → if regional-language receipts are required (**BRC-J4**) the receipt renderer switches to a pooled headless-Chromium worker behind the same `ReceiptRenderer` port.
- **ExcelJS streaming writer**: constant memory for large exports; supports number formats (`[$₹-4009]#,##0.00`), frozen headers, filters.
- **csv-stringify / csv-parse**: streaming, battle-tested. SheetJS is deliberately avoided (licensing/distribution concerns).

### 2.4 Additions beyond your list (each justified)

| Addition | Problem it solves |
|---|---|
| **pnpm workspaces** (Turborepo deferred until the build graph needs caching) | `packages/shared` (money, business dates, canonical JSON, enums; later Zod DTOs/permission keys) consumed by api (and web later). |
| **fast-check** | Property tests: Σ(installments)=total, allocation conservation, reversal restores state. |
| **mongodb-memory-server (replica set)** | Real transactions in unit/integration tests without Docker. |
| **eslint-plugin-boundaries** | Enforces §1.4 automatically. |
| **migrate-mongo** (or equivalent) | Versioned index/data migrations; `autoIndex` off in prod. |
| **cmdk, sonner** | Palette/toasts. |
| **ioredis** | BullMQ + cache + rate-limit store. |
| **axe-playwright** | Automated accessibility regression. |

### 2.5 Deliberately **not** added

GraphQL (REST + OpenAPI fits; reports are report-shaped), microservices/Kafka, Elasticsearch/Atlas Search (prefix/token search on indexed normalized fields is sufficient to ~100k students — revisit on evidence), Redux, CQRS/event-sourcing frameworks (append-only ledger gives the benefit without the machinery), Prometheus/Grafana (until ops requests), a CSS-in-JS lib, i18next (UI strings are centralized in a message catalog, i18n-ready; adopt a library when a second language is confirmed — **BRC-J4**).

### 2.6 Deviations from the brief (all small, all explained)

1. **API prefix `/api/v1/...`** instead of `/api/...` — versioning from day one; paths below otherwise match your list.
2. **"Permissions" are a code-defined registry, not a Mongo collection.** Permissions are meaningless without enforcing code; a DB-editable permission *definition* can drift from what the code checks. `/api/v1/permissions` exposes the catalog read-only; **roles** (the editable part) are in Mongo.
3. **Installments + Opening balances + Penalties share one `receivables` collection** (with `kind`) instead of three unrelated collections — see D2. The API still exposes `/installments` and `/opening-balances` as friendly views.
4. **`Discount/Concession` collection is named `adjustments`** (type: scholarship/discount/concession/waiver/other) — SOW §39 treats them as one record shape.
