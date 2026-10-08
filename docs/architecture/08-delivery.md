# 15 · Module Structure · 16 · Development Phases · 17 · Testing · 18 · Security · 19 · Performance
(+ DevOps, observability, backup)

---

## 15. Complete Module Structure

### 15.1 Monorepo

```
/
├─ apps/
│  ├─ api/                         Express 5 + Mongoose (modular monolith)
│  └─ web/                         React 19 + Vite SPA
├─ packages/
│  ├─ shared/                      Zod schemas (DTOs), enums, permission registry, error codes, labels, money/date formatters
│  ├─ ui/                          design tokens, Tailwind preset, shadcn-based components, Storybook
│  └─ config/                      tsconfig, eslint (incl. boundaries), prettier
├─ e2e/                            Playwright suites (+ axe)
├─ ops/                            Dockerfiles, compose (dev/prod), nginx conf, backup scripts, CI templates
├─ docs/                           architecture (this set), ADRs, runbooks, API guide
├─ .github/workflows/              ci.yml · e2e.yml · release.yml
└─ pnpm-workspace.yaml · turbo.json
```

### 15.2 Backend (`apps/api/src`)

```
config/            env.ts (Zod-validated), logger.ts, sentry.ts, openapi.ts
db/                connection.ts, uow.ts (transactions), migrations/, seed/ (dev + demo + roles)
middleware/        requestContext, authenticate, authorize, scope, validate, idempotency, rateLimit, errorHandler, notFound
lib/               errors.ts, pagination.ts, ids.ts (counters), crypto.ts, redact.ts, clock.ts, csv-safe.ts
domain/
  finance/         PURE engine (7.1)               ← no I/O, 95%+ coverage gate
  academic/        pure rules (promotion mapping, capacity, year ranges)
  billing/         PURE, isolated: active-student count & annual student charge (decision BRC-K1) — never imports domain/finance
modules/           (each: routes.ts · controller.ts · service.ts · repository.ts · model.ts · mapper.ts · events.ts · *.test.ts · index.ts = public API)
  auth/  users/  roles/  permissions/(registry)  institution/  settings/
  academic-years/  classes/  divisions/  teachers/  teacher-assignments/
  students/  enrollments/  promotions/  student-categories/
  fee-components/  fee-structures/  fee-assignments/  installments/(receivables)  opening-balances/  adjustments/  late-fees/
  payments/  receipts/  outstanding/                 ← finance write/read modules
  reminders/(templates, rules, campaigns, delivery)  notifications/
  dashboard/  targets/  reports/(registry + definitions)  exports/  imports/  search/  audit/  files/  health/
providers/         storage/(s3), mail/(smtp|ses), sms/(…), whatsapp/(…), console/, inapp/    ← ports + adapters
jobs/              queues.ts, scheduler.ts, processors/{reminder.*, penalty.accrue, finance.reconcile, snapshot.daily, export, import.*, promotion.commit, cleanup}
app.ts  server.ts  worker.ts
```

### 15.3 Frontend (`apps/web/src`)

```
app/               router.tsx (lazy routes + guards), providers.tsx (Query, Theme, Auth), error-boundaries
layouts/           AppShell (sidebar/topbar/bottom-nav), AuthLayout, PrintLayout
pages/             thin route components → compose features
features/          one folder per domain; each has: api/ (typed client + query keys + hooks), components/, forms/, tables/, charts/, schemas.ts (re-exports shared), utils/
  auth/ dashboard/ academic-years/ classes/ divisions/ teachers/ teacher-assignments/ students/ student-360/ admission/ enrollment/ promotion/
  fee-structures/ opening-balances/ adjustments/ collection/ payments/ receipts/ outstanding/ reminders/ reports/ imports/ audit/ users-roles/ settings/ search/
components/        app-level shared (QueryBoundary, PermissionGate, MoneyText, StatusBadge…) – primitives live in packages/ui
hooks/             useDebounce, usePermissions, useAcademicYear, useUrlFilters, useIdempotencyKey, useConfirm
stores/            auth.ts, yearContext.ts, wizardDraft.ts, uiPrefs.ts            (Zustand — only these)
lib/               http client (refresh single-flight, error normalisation), format, labels, constants
styles/            tokens.css, globals.css
```
Rules: features don't import each other's internals (only each other's `index.ts`); no business calculation in the web app (lint-banned arithmetic helpers on money except formatting); every list uses the shared DataTable + `useUrlFilters`.

---

## 16. Development Phases

### 16.0 Scope & timeline risk (read first)
The SOW commercial page states **45–60 working days**; the SOW + this brief (41 collections, reminders with providers, imports, reports in three formats, award-level UI, full test suite, hardening) is substantially larger. Recommended cut — agree before Phase 1:

| Release | Phases | Outcome |
|---|---|---|
| **R1 — Core receivables (go-live candidate)** | 0–13 (+ essential parts of 15–16, 17-students/opening-balance, 18-audit/security) | Academic structure, teachers, students, fees, opening balances, installments, collection, receipts, reversal, outstanding/aging, essential dashboard + 6 key reports, student/opening-balance import, RBAC, audit. |
| **R2 — Recovery & insight** | 14, 15, 16 (rest) | Reminder engine (with first provider), full dashboard/forecast/targets, all reports + PDF/Excel. |
| **R3 — Hardening & scale** | 17 (rest), 18, 19, 20 | Full migration tooling, MFA, load tests, DR drills, production runbooks. |

*(Calendar estimates are intentionally not given here; they depend on team size and on closing the §21 questions.)*

### 16.1 Phase plan with exit criteria

| Phase | Scope | Key deliverables | Exit criteria |
|---|---|---|---|
| **0 — Foundations** *(prerequisite to 1)* | Monorepo, CI, Docker/compose (Mongo RS, Redis, MinIO), config, logger, error model, **design tokens + UI kit skeleton**, `packages/shared` | Walking skeleton deployed to staging (`/healthz`, login page) | CI green (lint, types, unit, build); staging deploy works |
| **1 — Architecture + Database** | Finalise this design after §21 answers; Mongoose models + indexes + migrations; counters; seed; **finance-core engine v0 (money, dates, status) with tests**; OpenAPI skeleton | Schema/migration set; ER doc frozen; engine unit tests | Indexes created by migration; `explain` tests scaffolded; engine property tests pass |
| **2 — Auth + RBAC** | Login, refresh rotation, sessions, users, roles, permission registry, scope resolver, audit core (hash chain) | Auth flows, role matrix UI, audit writer | Pen-test checklist for auth passes; permission tests per route (generated from route table) |
| **3 — Institution + Academic Year** | Institution profile/logo, settings registry, academic years (+current/close), student categories | CRUD + audit | Overlap/current rules tested |
| **4 — Classes + Divisions** | Class master/sequence, year-scoped divisions, capacity, clone-structure | CRUD + summaries | Unique/capacity rules tested |
| **5 — Teachers + Assignments** | Teacher master, assignments (assign/change/end), history, board UI | §9 complete | Concurrency + history tests; teacher-wise students query |
| **6 — Students + Enrollment** | Student master, duplicate check, enrollment, global search, Student 360 shell (non-financial tabs) | Students list/profile, search | Search p95 targets; scope tests |
| **7 — Promotion + Academic history** | Promotion batches, academic timeline | §10A | Chunked/idempotent commit tested; history immutability tests |
| **8 — Fee structure + versioning** | Components, structures, versions, plans, publish/diff, clone-year | §7.4–7.5 | Version immutability; 2025-26 unaffected regression test |
| **9 — Opening balance + Fee engine** | Fee preview, assignment, receivables generation, opening balance, adjustments (approval), **admission wizard**, balance projection | §7, §8, §10 | **Golden tests** (§7.11, SOW fixtures) green; wizard e2e |
| **10 — Installments** | Restructure, reschedule, custom plans, statuses, late-fee engine + nightly job | §7.5–7.9 | Property tests; penalty idempotency |
| **11 — Payments + Allocation** | Collect, allocation (auto/manual), idempotency, duplicate guards, reversal (+approval) | §11 | Concurrency tests (parallel payments, replay), reversal restores state |
| **12 — Receipts** | Numbering `REC-2026-000001`, snapshot, PDF/print, reprint, cancel | §11.5 | Unique, never-reused numbering test; PDF golden text test |
| **13 — Outstanding + Overdue + Aging** | Outstanding views/grouping, aging, overdue, drill-downs, reconciliation job | §7.2 | Dashboard = report totals test |
| **14 — Reminder engine** | Templates, rules, campaigns, queue, providers (console/in-app + first real), webhooks, history | §12 | Stop-when-cleared tests; dedupe tests |
| **15 — Dashboard + Analytics** | All widgets, targets, forecast, snapshots, caching | §13 | p95 dashboard < 1.5 s on 25k-student seed |
| **16 — Reports + Export** | Registry, all reports, CSV/XLSX/PDF, async exports | §13A | Filter fidelity + injection-safety tests |
| **17 — Import/Migration** | Two-phase importers (all types), templates, error reports | §13B | Re-commit idempotency; preview math = commit math |
| **18 — Audit + Security hardening** | Audit explorer/export, MFA, insert-only DB roles, CSP tuning, dependency/secret scanning, DPDP checklist | §18 | External-style security review; ZAP baseline clean |
| **19 — Testing** | Fill gaps: full Playwright journeys, a11y sweep, load tests (k6), chaos (kill worker mid-commit), restore drill | §17 | Coverage gates; all critical journeys green in CI |
| **20 — Production deployment** | Prod compose/Nginx/TLS, backups + restore test, monitoring/alerts, runbooks, UAT, go-live checklist, training material | §1.6, §18.8 | UAT sign-off; backup restore verified; rollback rehearsed |

**Reordering note:** finance-core (pure engine + golden tests) starts in Phase 1 and runs *ahead of* UI work — it is the highest-risk, most reusable asset; every later phase integrates against it.

---

## 17. Testing Strategy

### 17.1 Pyramid & tooling

| Layer | Tool | Scope | Gate |
|---|---|---|---|
| **Unit — pure domain** | Vitest + **fast-check** | `domain/finance`, `domain/academic`, mappers, validators | **≥ 95 % lines & branches** on `domain/finance` (CI-enforced) |
| **Service integration** | Vitest + `mongodb-memory-server` (replica set) + Redis test container | transactions, guarded updates, unique indexes, audit-in-txn | ≥ 85 % on services |
| **API / contract** | **Supertest** | every route: authz matrix (generated from route table), validation, status/error codes, envelope, pagination; OpenAPI response validation | every route has ≥ 1 allow + 1 deny test |
| **Query-plan** | Vitest + Mongo `explain` | key list/aggregation queries must not COLLSCAN | CI fails on regression |
| **Concurrency** | Vitest (parallel `Promise.all`) | 10 simultaneous payments on one installment; same idempotency key ×5; same UPI ref ×2; parallel teacher assign | invariants hold |
| **Frontend unit/component** | Vitest + Testing Library | MoneyInput, forms, StatusBadge mapping, QueryBoundary states | — |
| **E2E** | **Playwright** (+ axe) | critical journeys (17.3) in Chromium (+WebKit smoke) on desktop & mobile viewports | all green on main |
| **Load** | k6 | seeded 25k students / 150k receivables | p95 budgets (§19) |
| **Security** | ZAP baseline, `pnpm audit`/OSV, gitleaks | CI nightly | no high/critical |

### 17.2 Business-logic test catalogue (non-exhaustive; each is a named test)

| Area | Cases |
|---|---|
| **Fee calculation** | structure precedence (4 specificity levels); no structure → error; optional component on/off; version pin (assignment keeps v2 after v3 publish); **2026-27 change leaves 2025-26 untouched** |
| **Installments** | equal split with remainder → Σ exact; component-specific installments; custom plan Σ validation; full payment; mid-year admission overdue handling; regenerate = idempotent |
| **Opening balance** | creates exactly one receivable; gross fee unchanged; duplicate blocked; import twice → one; reversal blocked if paid; ages from effective date; appears in summary/outstanding/audit |
| **Partial payment** | SOW §15 (15,000 − 10,000 → Partial, 5,000 pending) |
| **Allocation** | SOW §17 (5,000 + 15,000 ← 20,000 / 12,000); oldest-due-first tiers; component-priority split; manual allocation validation; unallocated advance (only when enabled) |
| **Outstanding** | §7.11 golden case = ₹35,000; formula equals SOW §19 & brief; per student/class/division/teacher/year/fee-type/installment all reconcile |
| **Discount / concession** | fixed/percent; distribution strategies exact; cannot exceed payable; approval gate (pending doesn't reduce); original payable preserved |
| **Late fee** | fixed/daily/percent; grace; cap; waived; **accrual job twice → no duplicates**; penalty after partial payment uses reduced base |
| **Reversal** | restores every receivable/component; receipt cancelled, number retained; double reversal blocked; approval flow (same-user denied); UPI ref reusable after reversal; cascade with advance-adjust; audit complete |
| **Duplicate prevention** | idempotency replay; duplicate transaction ref; possible-duplicate heuristic; duplicate receipt impossible; duplicate fee assignment/enrollment/opening balance (DB-level); duplicate admission no |
| **Promotion** | 1-A → 2-B → 3-A history intact; repeat; pass-out; partial-failure resume; blocked when target enrollment exists; fees auto-assigned per setting |
| **Historical integrity** | past enrollment/teacher/fee version/receipt unchanged after later changes; receipt reprint byte-identical; audit hash chain verifies |
| **Teacher assignment** | assign; concurrent assign; change keeps old row; as-of queries; deactivate-with-assignment blocked; teacher moves class next year |
| **Reminders** | rule offsets; dedupe; stop-when-cleared (send-time guard); quiet hours; template rendering; webhook status update |
| **RBAC/scope** | route × role matrix; class teacher cannot read other division (404); contact masking; sensitive-op controls |
| **Reconciliation** | dashboard vs report vs export totals; nightly reconcile detects an injected drift |
| **SOW fixtures** | §5/§6 Class 10 table; §12 installment table; §31, §35 aggregates reproduced from seeded data |

### 17.3 E2E journeys (Playwright)
1. Login → refresh → logout; lockout; permission-denied page.
2. **Admission wizard** with fee preview, opening balance, concession, historical payment → Student 360 shows identical numbers.
3. **Collect fee** (cash; UPI with duplicate ref rejection; partial; multi-installment allocation) → receipt PDF content check → balance updated.
4. **Reverse payment** with approval (two users) → receipt cancelled, balance restored, audit visible.
5. Teacher assign → change → history; teacher-wise students.
6. Fee structure new version → publish → new admission uses it, old student unchanged.
7. Promotion batch preview → commit → academic history.
8. Reminder: manual campaign → queue → history; pay → pending reminders skipped.
9. Report filter → export CSV/XLSX/PDF → content matches table.
10. Import: upload → preview counts → confirm → committed totals reconcile.
11. Mobile viewport: search → Student 360 → collect.
12. a11y sweep (axe) on each screen in light/dark.

### 17.4 Test data
Deterministic generator (`pnpm seed:demo --students 25000 --seed 42`) + hand-built **golden fixtures** from the SOW; frozen `Clock` (default `2026-10-08`).

---

## 18. Security Strategy

### 18.1 Threat model highlights (financial SaaS handling minors' data)

| Threat | Controls |
|---|---|
| **Insider fraud** (pocketed cash, back-dating, discount abuse, reversal abuse) | Separation of duties (collect ≠ approve reversal/discount), mandatory reasons, reversal/discount approval, back-date limits, immutable hash-chained audit, **reversal & back-date registers**, per-collector daily totals/day-book, alerts on unusual reversal rates (Phase 18) |
| **Broken access control / IDOR** | Authorization per request from server state; repository-level tenant+scope injection; 404 for out-of-scope; automated route×role tests |
| **Credential attacks** | Argon2id; rate limit + lockout; breached-password check; MFA for finance/admin roles; uniform login errors |
| **Session theft / CSRF** | Access token in memory; refresh cookie httpOnly+Secure+SameSite=Strict, path-scoped, rotation + reuse detection, custom-header + Origin check |
| **Injection** | Zod strict schemas; Mongoose `sanitizeFilter`; never spread request bodies into queries; reject `$`/`.` keys; escaped, anchored search regex; length caps |
| **Mass assignment** | Strict DTOs; explicit mappers; server-set fields (`institutionId`, `createdBy`, amounts computed by engine) |
| **XSS** | React escaping; no `dangerouslySetInnerHTML` (lint-banned); CSP (no inline scripts), sanitised template previews |
| **File upload abuse** | size/type caps, magic-byte sniff, private bucket, random keys, logo re-encode, optional ClamAV, presigned download with short TTL |
| **CSV/Excel formula injection** | cell sanitiser on every export |
| **Data leakage** | Pino `redact` (tokens, passwords, Authorization, cookies, mobile/email), Sentry `beforeSend` scrubbing, DTO mappers, masked contact for roles without `student.viewContact`, generic 5xx messages |
| **Supply chain** | pinned lockfile, `pnpm audit`/OSV in CI, Dependabot/Renovate, minimal base image, non-root, SBOM |
| **Webhook spoofing** | HMAC verification + timestamp window + idempotency |
| **Denial of service** | Nginx + Redis rate limits, body-size limits, pagination caps, export concurrency limits, query timeouts (`maxTimeMS`) |
| **Tampering with history** | Insert-only DB role on ledger/audit collections; hash chain verified nightly; append-only repositories |

### 18.2 HTTP & transport
TLS 1.2+ only, HSTS, Helmet (CSP, `frame-ancestors 'none'`, referrer-policy, nosniff, permissions-policy), CORS allow-list from env, cookies `Secure; HttpOnly; SameSite=Strict`, compression after auth, trust-proxy configured for Nginx, request body limit 1 MB (uploads via dedicated route).

### 18.3 Secrets & config
Zod-validated env; no secrets in repo/images/logs; rotate JWT keys (`kid`), DB/Redis/S3 credentials; separate least-privilege Mongo users (`api`: readWrite minus update on ledger collections; `migrate`: dbAdmin; `backup`: read).

### 18.4 Audit
Written **inside the business transaction** via `AuditService.record(tx, …)` — a change cannot commit without its audit entry. Fields: user, role keys, entity type/id, `studentId`, action, timestamp, **previous/new value (field-level diff, sensitive fields redacted)**, reason, IP, UA, requestId. **Hash chain:** `hash = SHA-256(prevHash ‖ canonical(entry))` per institution; nightly verifier; tampering alerts. Actions covered: Student created/updated/promoted · Teacher assigned/changed · Fee structure changed/published · Opening balance created/reversed · Payment created/modified(meta)/reversed · Receipt generated/cancelled · Discount requested/approved/rejected/reversed · Installment modified/restructured/rescheduled · Reminder sent · Permission/role changed · Login/logout/failed login · Export · Import commit · Settings changed.

### 18.5 Privacy & compliance (India)
Student data includes **children's personal data** → align with the **DPDP Act 2023** (purpose limitation, security safeguards, breach notification, parental consent handling, data-principal requests, retention). Provide: data inventory, retention settings, export/erasure workflow for *non-financial* PII (financial records retained per statutory requirements — **BRC-J2**), consent/opt-out capture for communications, data-processing agreements with SMS/WhatsApp/email vendors. Hosting region India unless client states otherwise.

### 18.6 Application-level protections for money
Integer paise · guarded atomic updates · unique indexes for every duplicate rule · idempotency keys · no generic update/delete paths for ledger collections · nightly reconcile + hash-chain verification · closed-year locks.

### 18.7 Monitoring & incident response
Sentry (api, worker, web; PII scrubbed; release tags), structured logs with requestId, `/readyz` (Mongo, Redis, S3), uptime alerts, BullMQ failure alerts, reconcile-drift alerts, auth anomaly logs. Runbooks: suspected fraud, data correction (authorised correction flow), restore, provider outage.

### 18.8 Backup & disaster recovery (SOW §48)
Proposed baseline for the single-VPS deployment (**BRC-J2** to confirm): MongoDB **hourly** compressed dumps with oplog + **daily full**, encrypted (age/GPG), shipped off-site to a versioned/object-lock bucket; Redis AOF (jobs are re-derivable); object storage versioning; **monthly automated restore test** into a scratch instance with reconcile + hash-chain verification; targets **RPO ≤ 1 h, RTO ≤ 4 h**; documented restore runbook.

### 18.9 Session & access controls (SOW §48)
Idle timeout, absolute lifetime, concurrent-session list/revoke, forced logout on password/role change, optional IP allow-list for admin roles, failed-login lockout, password policy, MFA.

---

## 19. Performance Strategy

### 19.1 Budgets (25,000 students · ~150k receivables · ~100k payments, single VPS)

| Interaction | p95 target |
|---|---|
| Global search keystroke → results | < 150 ms server |
| Student list page (filters + outstanding) | < 250 ms |
| Student 360 header/tab | < 300 ms |
| **Collect payment commit** (txn incl. receipt) | < 400 ms |
| Dashboard full load (parallel widgets) | < 1.5 s (each widget < 600 ms cached) |
| Report page (50 rows + totals) | < 1.0 s |
| CSV/XLSX export ≤ 5k rows | starts streaming < 1 s |
| First contentful route (cached assets) | < 1.5 s on mid-range laptop; initial JS ≤ 200 KB gz (route-split) |

### 19.2 Database
Compound/partial indexes listed in §3.3 (each tied to a screen); `student_year_balances` read model for list/sort/filter by outstanding; `student.current` projection; pre-aggregated `daily_snapshots`; aggregation pipelines with early `$match` on `institutionId + year`; `lean()` + projections; no `$lookup` on unbounded sets (page results first, then enrich); `maxTimeMS` on reads; `explain` tests in CI; separate analytical reads can later target a secondary.

### 19.3 API / backend
Pagination everywhere (max 100); server-side filtering/sorting; lookup maps (classes/divisions/categories/teachers) cached in-process + Redis; **version-keyed Redis cache** for dashboard/outstanding (§13.3); compression; ETags on cacheable GETs; heavy work (exports, imports, promotions, fan-out, snapshots, reconcile) in BullMQ with concurrency caps so the API stays responsive; connection pool sized to instance count; graceful shutdown (drain jobs).

### 19.4 Frontend
Route-level code splitting (`React.lazy`), chart library & PDF viewer loaded on demand, icon tree-shaking, self-hosted subset fonts, TanStack Query caching with `staleTime` aligned to server TTL + `placeholderData` for pagination, hover-prefetch for Student 360, debounced (250 ms) + cancellable search, virtualised rows only for very long lists, memoised table columns, `useDeferredValue` for filter typing, no money computation client-side, image sizes constrained (logo/photo).

### 19.5 Verification
k6 scenarios (search, list, collect, dashboard, export) against the 25k seed in CI nightly; Lighthouse CI budget on key pages; regression alert if any budget exceeds +20 %.

---

## 20+. DevOps & CI/CD (supporting §1.6)

**CI (GitHub Actions):** install (pnpm cache) → lint (ESLint incl. boundaries, Prettier) → typecheck → unit → integration (Mongo RS + Redis service containers) → OpenAPI generation + drift check → build (web, api) → Playwright e2e (against compose stack) → security (OSV, gitleaks, ZAP baseline nightly) → Docker build (multi-stage, non-root) → push to registry.
**CD:** tag → build images → deploy to staging automatically → manual approval → production via compose pull on the VPS (`migrate` one-shot first: indexes/migrations; then rolling `api` restart; worker graceful drain) with health-gated rollback to previous image tag.
**Environments:** local · ci · staging · prod; config parity via env; feature flags via `SystemSetting` for risky rules (e.g., `lateFee.materialize`).
**Observability:** pino JSON → stdout → host log rotation/shipping; Sentry; `/readyz`; BullMQ dashboard (bull-board) behind admin auth in staging only.
