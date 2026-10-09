# 15 · Frontend foundation (`apps/web`) — first screens

**Date:** 2026-10-09 · Stack: React 19 · Vite · TypeScript · Tailwind v4 (tokens from `packages/ui`) · Radix (dialog, menu) · React Router · TanStack Query · Zustand · React Hook Form + Zod · Sonner · Lucide.

## 15.1 Screens built

| Screen | Behaviour |
|---|---|
| **Sign in** | Validated form, friendly errors (wrong password, locked, rate-limited), silent session restore on reload. |
| **Choose a new password** | Forced for users with a temporary password; nothing else is reachable until done. Also available from the account menu. |
| **Dashboard** | Guided "Set up your school" checklist driven by live data (institution profile, current academic year, categories, settings); shows the current year. The real management dashboard arrives with the finance screens. |
| **Academic years** | List with Current/Active/Planned/Closed; create (pre-filled with the suggested next year), edit while planned, activate, make current, move back to planned, close and reopen **with a mandatory reason**; actions appear only when allowed by state and permission. |
| **Student categories** | List, add, rename, switch on/off (never deleted). |
| **Institution** | Profile form (basic, address, contact, receipt footer, other details); read-only for users without `institution.manage`; sticky save bar. |
| **Settings** | 15 rules grouped, each with a plain-language summary, BRC reference, "Changed" marker, a purpose-built editor (numbers, switches, choices, rupees, aging buckets, receipt numbering with live preview, billing point, payment methods) and *Use default*. Every change is sent with an optional reason for the audit log. |
| **Shell** | Permission-filtered sidebar, mobile drawer, account menu, light/dark/system theme, skip-link, route-level code splitting (initial JS ≈ 136 kB gzip, each screen loaded on demand), route error boundary, 403 / 404 pages. |

## 15.2 Design & UX rules implemented

- Original "Ledger" tokens (`packages/ui`) mapped to Tailwind utilities; light and dark; `prefers-reduced-motion` honoured.
- Status is never colour alone (icon + text); toasts restyled with our tokens because the library's "rich colours" failed WCAG AA (4.25 : 1) — found by the automated check.
- Every data region has loading, error (with retry and request reference), forbidden and empty states (`QueryBoundary`).
- Plain language everywhere; server error *codes* are mapped to friendly messages (`lib/messages.ts`); raw server text is never the only thing shown.
- Business dates are never converted through time zones (`formatDate`).

## 15.3 Security properties of the client

- The access token lives **in memory only**; the refresh token is an httpOnly cookie. A test asserts that no token reaches `localStorage` / `sessionStorage`.
- Expired tokens are renewed silently with a **single-flight** refresh (several failing requests → one refresh), then the request is retried; a lost session sends the user to sign-in.
- `PermissionGate` / menu filtering only hide things; the backend enforces every permission again.
- In development the Vite dev server proxies `/api` so the SameSite=Strict cookie behaves exactly as in production (`API_PROXY_TARGET`, `WEB_PORT` configurable).

## 15.4 Verification

| Check | Result |
|---|---|
| Web unit/component tests (API client, messages, formatting, login, route guard, academic-year and category screens incl. permission-dependent actions, error states) | ✅ 33 |
| **End-to-end in real Chromium against the real API and MongoDB** (`pnpm e2e`, 9 tests): login validation, forced password change, reload restores the session, no JWT in storage, create + make-current a year (overlap refused), edit institution, change and reset a setting, add a category, sign out, **phone viewport** (drawer, no horizontal scroll) | ✅ 9 / 9 |
| **Automated accessibility (axe, WCAG 2.1 A/AA)** on login, dashboard, academic years (empty + filled), institution, settings, and the phone layout | ✅ no violations |
| Production build | ✅ route-split bundles |

## 15.5 Defects found by running it for real (fixed)

1. **Toast contrast** 4.25 : 1 (library "rich colours") → restyled with design tokens.
2. **API client**: the shared refresh promise could serve a stale result for one tick, and a request that failed *after* another request had already renewed the token triggered a second, needless refresh → refresh state is cleared immediately and such requests simply retry with the new token.
3. Toast overlapped the account menu → moved to bottom-right.
4. A port conflict with another local application on `:4000` → e2e uses dedicated ports (API 4100, web 5174).

## 15.6 Not built yet / honest limits

- No screens yet for: Users & Roles administration, classes/divisions, teachers, students, fees, collection, reports (their backends/phases come first). The sidebar only shows what exists.
- Component library is small and hand-built on Radix primitives; no Storybook yet.
- No i18n library (strings are centralised in `lib/messages.ts` for later).
- The e2e suite needs a **throwaway MongoDB** (`E2E_MONGO_URI`, name must contain `e2e` or `test`; it is wiped). CI runs it against a local replica set.
- **Hosting note:** the shared Atlas cluster used during development is at its **500-collection limit** (other projects use most of it). Staging/production need their own cluster.

## 15.7 Run it

```bash
pnpm install
cp .env.example .env                       # MONGO_URI, JWT_ACCESS_SECRET, SEED_ADMIN_EMAIL
pnpm --filter @sfm/api db:migrate && pnpm --filter @sfm/api db:seed
pnpm --filter @sfm/api dev                 # API   http://localhost:4000
pnpm --filter @sfm/web dev                 # web   http://localhost:5173  (proxies /api)
E2E_MONGO_URI='…/sfm_test?…' pnpm e2e      # browser tests on a throwaway DB
```
