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

```bash
pnpm install && pnpm check
```

Frontend, e2e and how to run everything: [docs/architecture/15-frontend-foundation.md](docs/architecture/15-frontend-foundation.md)
