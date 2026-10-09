# JM — Student Fee Management, Collection & Receivables Platform

Architecture and decisions: **[docs/architecture/00-README.md](docs/architecture/00-README.md)** ·
final business-rule decisions: [11](docs/architecture/11-business-rule-decisions.md) ·
Phase 0/1 status & verification: [12](docs/architecture/12-phase-0-1-status.md)

```
apps/api         Express 5 + Mongoose — pure finance engine (src/domain), posting kernel (src/modules/payments), models (src/db)
packages/shared  money (integer paise), business dates (IST), canonical JSON
apps/web         React web app (sign-in, shell, academic years, categories, institution, settings)
packages/ui      design tokens ("Ledger"), WCAG-tested
ops/docker       Dockerfile + local Mongo-replica-set/Redis/MinIO stack
```

## Chalane ke liye (3 steps)

1. `npm install`-jaisa kaam ek baar: `pnpm install`  (pnpm = npm ka monorepo version, PC par pehle se hai)
2. Pehli baar sirf: `npm run db:migrate` phir `npm run db:seed` (`.env` mein `SEED_ADMIN_EMAIL` set karke)
3. Roz: **`npm run dev`** — API http://localhost:4100 aur website http://localhost:5173 dono ek saath chalte hain.

Tests: `npm run check` · Browser tests: `npm run e2e` (throwaway DB chahiye) · Details: docs/architecture/15-frontend-foundation.md
Docker files (`ops/`) sirf baad ke deployment ke liye hain; local chalane ke liye zaroori nahi.
