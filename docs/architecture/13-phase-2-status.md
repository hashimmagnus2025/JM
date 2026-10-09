# 13 · Phase 2 — Authentication + RBAC (+ Parent collection)

**Date:** 2026-10-09 · Scope: Parent collection (client decision), authentication, sessions, users, roles, permissions, audit core. No frontend.

## 13.1 Parent collection (client decision)

`parents` is a separate collection (one document per real person, shared by siblings): unique normalized 10-digit `mobile` per institution, name/email/address/status, reserved `userId` for the future parent portal. `Student.guardians` is now `[{ parentId, relation, isPrimary, isFeeContact }]` (exactly one primary; the relation belongs to the *link*) plus a flat `parentIds[]` with an index for sibling / family-wise queries. `mobileSearch` was removed (search goes through `parents`). Docs 02, 05 and 06 are updated; collection count is now **42**. Parent create/edit/search endpoints arrive with the Students phase (permissions `parent.view` / `parent.manage` already exist).

## 13.2 What was built

| Area | Where |
|---|---|
| Permission registry (75 permissions, groups, labels) + 7 built-in roles + `PRIVILEGED_PERMISSIONS` | `packages/shared/src/permissions.ts` |
| Password hashing (Argon2id, OWASP parameters), policy (length, common, repeated, personal, mixed classes), temporary-password generator | `modules/auth/password.ts` |
| JWT access token (HS256 pinned, issuer + audience validated, 15 min) and opaque 256-bit refresh token (only its SHA-256 stored) | `modules/auth/tokens.ts` |
| Login (equal-timing unknown e-mail, 5-failure lock for 15 min, uniform errors), refresh **rotation with reuse detection**, multi-tab grace, idle (8 h) and absolute (7 d) lifetime, logout, logout-all, session list/revoke, change password | `modules/auth/auth.service.ts` |
| Per-request principal from server state (TTL cache + explicit invalidation) | `modules/auth/principal.ts` |
| Middleware: `authenticate` (Bearer), `authorize(...perms)`, strict Zod `validate`, forced password change gate | `http/middleware.ts` |
| Routes: `/api/v1/auth/{login,refresh,logout,logout-all,me,change-password,sessions}`; `/api/v1/{users,roles,permissions}` | `modules/auth/auth.routes.ts`, `modules/identity/identity.routes.ts` |
| Users + roles service with escalation guards | `modules/identity/identity.service.ts` |
| **Tamper-evident audit chain** (SHA-256 hash chain, secrets redacted, race-safe append) | `modules/audit/*` |
| Uniform error model (`{error:{code,message,details,requestId}}`), CORS allow-list, login rate limit | `lib/errors.ts`, `app.ts` |
| MongoDB repositories + seed (`db:seed`: institution, built-in roles kept in sync with the registry, first Super Admin) | `modules/auth/mongo-repos.ts`, `db/seed.ts` |

## 13.3 Security properties (each has a test)

- Refresh token only in an **httpOnly, SameSite=Strict, path-scoped** cookie, never in JSON; `X-Requested-With` header required on cookie endpoints; dead tokens clear the cookie.
- **Reuse of a rotated refresh token ends the whole login family**; a replay within 10 s is treated as a multi-tab race and does not.
- Wrong password and unknown e-mail are indistinguishable; a disabled account is revealed only after the right password.
- Permissions are **never read from the token**; role / status / password changes apply on the next request; token version and session revocation each independently end old tokens.
- Forged tokens (wrong secret, `alg: none`, wrong audience, garbage) are rejected; expiry enforced.
- No privilege escalation (see doc 03 §6.1); last Super Admin protected; built-in roles read-only; optimistic versions on role edits.
- Audit entries never contain passwords, hashes or tokens; the chain detects edits, deletions, reordering and forged hashes.
- Unexpected errors are a generic 500 with no internals.

## 13.4 Verification

| Check | Result |
|---|---|
| Unit + HTTP tests (in-memory repositories) | ✅ all pass (`pnpm check` exit 0) |
| **Same auth scenarios on real MongoDB (Atlas test DB)** | ✅ 35 tests (repositories, atomic session rotation, concurrent audit writers, seed, full HTTP stack) |
| Ledger integration suite on real MongoDB | ✅ 41 tests still pass |
| Permission matrix: every route × every built-in role (403 exactly where the permission is missing) | ✅ |
| **Mutation check** — 20 deliberately broken security rules (lockout, reuse detection, absolute expiry, rotation race, session revocation, authorize, token version, privilege escalation, last Super Admin, idle timeout, password length, audit hash, JWT audience, cookie httpOnly, self-deactivate, built-in role edit, CSRF header, forced password change, user enumeration, lock bypass) | ✅ **20 / 20 caught** (two real test gaps found and closed during the run) |

## 13.5 Defects found while building (and fixed)

1. First run on real MongoDB in Phase 1 had shown `sanitizeFilter` blocking the ledger adapter's own `$ne`/`$in`; the auth repositories use `mongoose.trusted` for internal operators from the start.
2. Concurrent audit writers exhausted their retry budget (30 simultaneous writers) → writers inside one process now queue, other processes retry with jittered back-off; the unique `(institutionId, seq)` index still decides every collision.
3. A `{institutionId: ObjectId, ...record}` spread let a string id overwrite the ObjectId (caught by the type checker).
4. The first escalation rule ("you may only grant what you hold") stopped an Admin from creating Fee Collectors; narrowed to administration-grade permissions.
5. Malformed JSON used to return 500; it is now a clear 400 `INVALID_JSON`.

## 13.6 Open items / honest limits

- **Not built yet:** TOTP MFA, forgot-password / e-mail reset (needs the e-mail provider, BRC-H1), IP allow-list, Redis-backed rate limit and cache invalidation (the in-memory limiter is per process), password-breach list beyond the small built-in one. Admin-created users get a one-time temporary password shown in the API response (no e-mail delivery yet).
- **Ledger audit entries are not chained yet** (`PaymentPostingService` writes plain audit rows); they should go through `AuditService` when the payment HTTP layer is built (Phase 11).
- A role/user change made on one API instance reaches another within the 10 s cache TTL.
- Login resolves the user by e-mail across the single institution of the deployment; multi-institution would add an institution code to login.
- **BRC-J1** (final role matrix) is still open: the built-in matrix is a seed; roles are editable data.

## 13.7 How to run

```bash
cp .env.example .env            # set MONGO_URI, JWT_ACCESS_SECRET, SEED_ADMIN_EMAIL
pnpm --filter @sfm/api db:migrate
pnpm --filter @sfm/api db:seed  # prints a one-time temporary password for the first Super Admin
pnpm --filter @sfm/api dev      # http://localhost:4000/api/v1/auth/login
```
