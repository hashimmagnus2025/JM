# 14 · Phase 3 — Institution, Settings, Academic Years, Student Categories (backend)

**Date:** 2026-10-09 · Frontend for these screens follows in the web app (see §14.6).

## 14.1 What was built

| Area | Behaviour | Where |
|---|---|---|
| **Institution profile** | View/edit name, short name, address, contact, registration no., receipt footer, academic start month, extra details. Time zone (IST) and currency (INR) are fixed in v1; the institution code is permanent. Every edit audited with before/after. Logo upload arrives with the file-storage phase. | `modules/setup/setup.service.ts` → `InstitutionService` |
| **Typed settings registry** | 15 settings, each with a Zod schema, label, group, description, BRC reference and a default equal to the client decision (due-soon 7 days, aging 30/60/90 from original due date, expected excludes opening balance, oldest-due-first, advance off, reversal threshold **null** (no hard-coded amount), `REC-2026-000001`, multiple divisions per teacher, ₹120/student …). Invalid stored values fall back to the default instead of breaking the system. Updates validate, audit (with optional reason), and refresh the typed cache at once; `DELETE` resets to default. | `packages/shared/src/settings.ts`, `SettingsService` |
| **Academic years** | Create (label must agree with dates; 300–400 days; no overlap; unique label), edit **only while PLANNED**, activate / deactivate, **exactly one current** (setting a new one unsets the old; a planned year becomes active), close (reason + blockers, never the current year), reopen (reason, only if closed). Past records stay unchanged (SOW §4). | `domain/academic/academic-year.ts` (pure), `AcademicYearService` |
| **Student categories** | Create / rename / reorder / deactivate; code permanent and unique; never deleted; seed creates `GENERAL`. | `CategoryService` |
| Routes | `/api/v1/{institution,settings,academic-years,student-categories}` with permission checks per route (matrix-tested for every built-in role). New permissions `studentCategory.view/manage`. | `setup.routes.ts` |
| Wiring | `compose.ts` builds every service from a Mongo connection (used by the server and by integration tests). | `apps/api/src/compose.ts` |

Placeholders for later phases: `YearGuards.closeBlockers()` / `hasData()` — divisions, enrollments, pending reversals and adjustments plug in here so a year cannot be closed or sent back to *planned* while it carries data.

## 14.2 Verification

| Check | Result |
|---|---|
| Pure year rules | ✅ 26 tests (label/date agreement, overlap boundaries, transitions, current-year plan, close blockers, next-year suggestion) |
| Setup HTTP tests (in-memory) incl. permission matrix × 7 roles | ✅ |
| Settings registry (every default valid for its own schema, client-decision defaults) | ✅ 7 tests |
| **Real MongoDB (Atlas test DB), 85 integration tests in total** (ledger 41 + auth 35 + setup 9) | ✅ all pass |
| **Mutation check — 17 deliberately broken rules** (overlap, edit lock, close blockers, current-year close, setting validation, label/date, closed→current, data guard, transitions, 300/400-day limits, old-current unset, current→planned, reopen of non-closed, settings cache, reset, category order) | ✅ **17 / 17 caught** (2 test gaps found and closed: reopening a non-closed year, settings-cache refresh) |

## 14.3 Defects found by real-MongoDB testing (fixed)

1. **Audit chain broke after a database round-trip:** Mongoose silently drops empty objects (`address: {}`) when saving, so the stored entry no longer matched its hash. The audit schema now sets `minimize: false`; the end-to-end test (institution edit → settings → years → close → categories) verifies one intact chain on MongoDB.
2. Two people making different years current at the same moment: the unique "one current year" index guarantees one winner; the loser now gets a clear `409 CONCURRENT_CHANGE` instead of a 500 (and the repository no longer tries to "restore" the old year over the winner).

## 14.4 Design decisions

- Closing the current year is refused (make another year current first); reopening needs a reason and is audited.
- Only administration-grade permissions are escalation-checked when granting roles (doc 03) — unchanged.
- Deactivating a year is only possible if it is not current and carries no data (guard hook).

## 14.5 Open items

- Logo upload (needs S3 file service), institution-level validation of the academic start month against year dates.
- Year "clone structure from previous year" arrives with Classes + Divisions (Phase 4).
- BRC-A1 (single institution), BRC-C5 (academic vs financial year basis) remain on their defaults.

## 14.6 Frontend

The web app (`apps/web`) starts after this commit with: sign-in, app shell, and the screens for these setup features.
