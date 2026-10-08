# 14 · UI/UX Design System & Experience Architecture

## 14.1 Design intent

**Name: "Ledger"** — an original visual language for a financial product that school office staff use all day.

| Attribute | How it shows up |
|---|---|
| **Trustworthy** | Calm, paper-like neutrals; deep teal brand (growth, money) instead of generic indigo/purple; no gradients on data; double-rule totals borrowed from accounting statements. |
| **Scannable money** | Tabular numerals everywhere, right-aligned amounts, Indian digit grouping (`₹1,25,000`), compact KPI form (`₹4.25 Cr`, `₹75 L`) — exactly the notation used in the SOW. Red only for *overdue*, never for "all outstanding". |
| **Obvious** | One primary action per screen; human labels ("Dues", "Late fee", "Class teacher"); no database words; every number explains itself on hover/disclosure. |
| **Quiet** | Motion only to explain change (150–240 ms); respects `prefers-reduced-motion`. |
| **One product** | All components consume the same tokens; no one-off colors/spacings (lint rule + Storybook review). |

## 14.2 Tokens (CSS variables → Tailwind theme; light + dark)

**Color (light)**

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F7F8F6` | app background (warm paper) |
| `--surface` / `--surface-2` | `#FFFFFF` / `#F0F3F1` | cards / inset panels, table zebra hover |
| `--border` / `--border-strong` | `#DDE3DF` / `#C3CDC8` | hairlines / inputs |
| `--text` / `--text-muted` / `--text-subtle` | `#14201C` / `#4F5F58` / `#6F7F78` | body / secondary / hints (all ≥ 4.5:1 on surface) |
| `--brand-50…900` | `#EAF6F2 #CFEBE2 #A2D7C7 #6FBDA7 #3FA088 #1F8670 #136D5B #0F5748 #0C4439 #08302A` | **primary = brand-600** (white text 6.2:1) |
| `--success` (bg) | `#1B7F4F` (`#E3F4EA`) | Paid, success |
| `--warning` (bg) | `#8A5A00` (`#FFF1D0`) | Due soon, pending approval |
| `--danger` (bg) | `#B42318` (`#FDE8E6`) | Overdue, reversed, destructive |
| `--info` (bg) | `#1D5FA8` (`#E5EFFB`) | informational |
| `--neutral` (bg) | `#4F5F58` (`#EBEFED`) | Unpaid/inactive/not due |

**Dark mode** is token-swapped (not inverted): `--bg #0E1513 · --surface #141D1A · --surface-2 #1A2521 · --border #26332E · --text #E6EEEA · --muted #A3B5AC · brand-500 #4BB59B (primary on dark, dark text)`; statuses use lightened foregrounds on 15%-alpha backgrounds. Contrast verified in CI (axe) for both themes.

**Chart palette (colour-blind-safe categorical, 8):** `#136D5B #2F5D9E #D69E2E #D9593D #7B61B8 #4AA3C7 #8A9A2B #64748B` — plus *always* direct labels/patterns for status series (never colour alone). Sequential ramp = brand scale; aging ramp = single hue light→dark (older = darker).

**Typography:** *Inter Variable* (self-hosted, subset, `font-display: swap`) with `font-variant-numeric: tabular-nums` globally on numerals. Scale: 12 / 13 / 14 *(base for dense tables)* / 16 *(base for forms)* / 18 / 20 / 24 / 30 / 36. Weights 400/500/600. Line-height 1.4 body, 1.2 headings. KPI numerals 30/600. PDFs/receipts: *Noto Sans* (has ₹).

**Space / shape / depth:** 4-px grid (`1=4 … 12=48`); radii `sm 6 · md 8 (inputs, buttons) · lg 12 (cards) · xl 16 (dialogs)`; elevation `e0` border-only · `e1 0 1px 2px rgb(16 32 27/6%)` · `e2 0 4px 12px rgb(16 32 27/8%)` · `e3 0 12px 32px rgb(16 32 27/14%)` (dialogs/drawers). Focus ring: 2 px `--brand-500` + 2 px offset, always visible on keyboard focus.

**Motion:** durations `120 / 180 / 240 ms`, easing `cubic-bezier(.2,0,0,1)`. Used for: route fade/slide-up (8 px), dialog scale-in (0.98→1), drawer slide, dropdown fade, chart entrance (one-time, 400 ms), success check draw (receipt issued). Disabled under `prefers-reduced-motion`.

## 14.3 Component inventory (built on shadcn/Radix, restyled to tokens)

**Foundations:** Button (primary/secondary/ghost/destructive/link; loading state), IconButton, Input, **MoneyInput** (₹ prefix, Indian grouping while typing, integer-paise value, no float math, paste-safe), DateInput (business-date, DD MMM YYYY display), Select/Combobox, **AsyncStudentPicker**, Textarea, Checkbox/Radio/Switch, Tabs, Accordion, Tooltip, Popover, Dialog, **ConfirmDialog** (variant *requires reason*, used for reversals), Drawer/Sheet, Dropdown, Command palette, Toast (sonner), Alert/Banner, Badge, Avatar, Skeleton, Progress, Pagination, Breadcrumb, Stepper.

**Data display:** **DataTable** (TanStack Table: server pagination/sort/filter, column visibility, sticky header & first column, row selection + bulk action bar, row actions, density toggle, CSV/XLSX/PDF export menu, saved views, responsive "card list" mode < 768 px), **FilterBar** (chips + advanced popover; URL-synced), **MoneyText** (tabular, right-aligned, `compact` option, negative/credit styling), **StatusBadge** (icon + text + colour; maps payment×due state), **KpiCard** (value, delta, sparkline, link), **LedgerCard / FeeSummaryCard** (signature: label–amount rows, double-rule total), **InstallmentTimeline**, **AllocationPreview**, **AuditTimeline**, **AcademicTimeline**, **ChartCard** (Recharts wrapper: title, filters, legend, empty/error states, accessible data-table toggle), **EmptyState**, **ErrorState** (+ retry, request-id copy), **PermissionGate** (hides, never merely disables, unauthorized actions; backend still enforces), **PageHeader** (title, breadcrumbs, primary action), **QueryBoundary** (standard loading/empty/error/unauthorized/not-found handling for any query).

## 14.4 Information architecture — improved navigation

Your structure is kept in spirit; changes are driven by task frequency and by removing screens that would only be thin filters of another:

```
Dashboard
Students ........ All students · Add student · Enrollment & Promotion · (Academic history lives inside Student 360)
Collect ......... Collect fee (POS-style, keyboard-first)  ← promoted to top level: most frequent daily task
Fees ............ Fee structures (versions, installment plans) · Dues & Outstanding (tabs: All · Overdue · Due soon · Aging)
                  · Opening balances · Adjustments & approvals · Transactions (tabs: Payments · Receipts · Reversals)
Academic ........ Academic years · Classes · Divisions · Teachers · Assignment board
Communication ... Reminders (Queue · Compose · Rules) · Templates · History
Reports ......... Report hub (grouped catalogue) · Saved exports
Administration .. Users · Roles & access (permission matrix) · Data import · Audit log · Collection targets · Settings
```
Rationale: *Installments* are always viewed per student or inside Outstanding — a standalone page would duplicate it; *Overdue/Aging* are saved views of Outstanding (same table, one mental model); *Payments/Receipts/Reversals* are one ledger with tabs; *Roles & Permissions* is one matrix editor; **Collect** gets top-level placement for cashiers (and becomes the mobile bottom-nav centre button). Navigation items are filtered by permission; sidebar collapses to icons; breadcrumbs everywhere.

**Global chrome:** left sidebar · top bar (global search ⌘K · **Academic year switcher** (persisted; default = current year; clearly flags non-current/closed years with a banner) · notifications · user menu) · page content max-width 1440 px.

## 14.5 Screen blueprints (key flows)

| Screen | Layout & behaviour |
|---|---|
| **Dashboard** | §13.6. Filter chips top; KPI strip; widgets independent; everything drills down. |
| **Students list** | Search + filters (class, division, teacher, status, fee status, category, year) · columns: student, class-div, class teacher, guardian/mobile (masked per permission), outstanding, overdue chip, status · bulk: remind, export · row click → Student 360 · empty state with "Add student / Import". |
| **Add student** | 6-step stepper (§10); persistent right-hand **Live summary** panel (student + fee summary) on ≥ 1024 px; bottom summary sheet on mobile. |
| **Student 360** | §10B. Sticky identity header + tabs. |
| **Collect fee** | Two-pane: left = student context & **dues table** (checkbox rows, overdue first); right = payment panel (amount, method, reference, date, remarks) + allocation preview + balance-after; confirm dialog; success screen with receipt actions. Keyboard: `/` focus search · `↑↓` rows · `Space` select · `Ctrl+Enter` open confirm (never auto-submits). |
| **Outstanding** | `groupBy` tabs (Student · Class · Division · Teacher · Fee type · Installment) with totals row, aging mini-bars, bulk "Send reminder". |
| **Fee structure** | Matrix by class × category for the selected year; structure editor with versions timeline, **diff** between versions, publish confirmation showing *"Affects new admissions only"*. |
| **Teachers / Assignment board** | §9.6. |
| **Reminders** | §12.9. |
| **Reports hub** | Cards grouped (Collection · Receivables · Academic · Communication · Audit); each report: filter bar → table/chart → export menu; large exports show progress + notification. |
| **Roles & access** | Permission matrix grouped by module, diff-on-save, "users affected" count. |
| **Import** | Stepper: Template → Upload → Validation results (Total/Valid/Invalid/Duplicate/Missing/Errors tiles) → Confirm → Progress → Report. |

## 14.6 State coverage (mandatory for every screen)

Every data region renders through `QueryBoundary`, which guarantees:

| State | Behaviour |
|---|---|
| **Loading** | Skeletons that match final layout (no spinners-only); no layout shift. |
| **Empty** | Explains *why* (no data vs. filters hide everything) + next action; "Clear filters". |
| **Success** | Toast for background actions; inline confirmation for financial actions (receipt issued screen). |
| **Validation error** | Field-level (RHF + server `details[]` mapped to fields) + summary on submit, focus moved to first error, errors linked via `aria-describedby`. |
| **API error** | Friendly message from `error.code` catalogue + "Try again" + copyable request ID; never raw text/stack. |
| **Network error / offline** | Global banner "You're offline — changes can't be saved"; queries pause/retry with back-off; **mutations touching money are never queued offline**. |
| **Unauthorized (401)** | Silent single-flight refresh → retry once → else redirect to login with return URL. |
| **Forbidden (403)** | Dedicated page explaining the missing permission and who to ask. |
| **Not found (404)** | Friendly page with search/back. |
| **Stale preview / conflict (409)** | Inline "This changed while you were working" with refreshed values. |
| **Route crash** | Per-route error boundary → Sentry (with request ID) + recover button. |

## 14.7 Money & number presentation rules
- Display: `₹1,25,000` (en-IN). Zero shown as `₹0` (not blank). Credits/advance with `Cr` label. Negative adjustments shown as `−₹5,000` in muted-green on ledger cards.
- KPI/compact: `₹4.25 Cr`, `₹75 L`, `₹12,500` (tooltip shows exact).
- Tables: right-aligned, tabular, totals row in `--surface-2` with top double rule; sticky totals on long tables.
- Percentages 0 dp in tables (`85%`), 1 dp in KPI detail.
- Dates `10 Oct 2026` (tooltip: weekday, relative "in 2 days"/"181 days overdue"). Academic year `2026-27`.
- **Never** show internal IDs/ObjectIds, collection names or enum constants; labels come from a central `labels.ts`.

## 14.8 Responsiveness

| Breakpoint | Behaviour |
|---|---|
| ≥ 1280 desktop (primary) | Sidebar + dense tables (14 px) + two-pane collect/summary panels. |
| 1024–1279 laptop | Sidebar collapses to icons on demand; summary panels stay right. |
| 768–1023 tablet | Overlay sidebar; tables keep key columns, others behind column picker; drawers full-height. |
| < 768 mobile | **Bottom nav: Search · Collect · Students · Dashboard**; tables → card lists; Student 360 with segmented tabs; Fee status & installments as stacked cards; payment confirmation as bottom sheet; touch targets ≥ 44 px. Admin-heavy screens (fee structures, imports, role matrix) show "best on a larger screen" notice but remain functional read-only. |

## 14.9 Accessibility (WCAG 2.2 AA target)
Semantic landmarks & headings; Radix primitives for dialog/menu/tabs/combobox (focus trap & restore, roving tabindex); full keyboard operability incl. tables (row actions reachable), skip-link; visible focus; form labels, required/invalid states, `aria-describedby` for hints/errors, `aria-live` region for toasts and async results (e.g., "Receipt R-… issued"); status never by colour alone (icon+text); targets ≥ 24 px (44 px mobile); `prefers-reduced-motion`/`prefers-color-scheme` respected; charts have text alternative + "View as table"; automated **axe** checks in Playwright on every key screen in both themes; manual screen-reader pass on Collect and Admission flows before release.

## 14.10 UX writing
Plain English, institution vocabulary configurable (e.g., "Division" ↔ "Section"). Errors state *what happened + what to do* (*"This UPI reference was already used for another payment (Receipt R-000412). Check the reference number."*). Destructive/financial confirmations restate **who, how much, what changes**. All strings from a message catalogue (i18n-ready; **BRC-J4**).

## 14.11 Design-system delivery
Tokens as source of truth (`packages/ui/tokens`) → Tailwind preset + CSS variables · Storybook with a11y addon & visual snapshots for each component state · "Ledger" documentation page (principles, do/don't) · lint rules banning raw hex/px outside tokens · **Phase-0 UI kit milestone** delivered before feature screens so all modules inherit it.
