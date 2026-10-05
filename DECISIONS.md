# Decision log — FindingDorothy
_Recorded as we go. "Decided" = locked; "Open" = needs a call._

| Date | Decision | Status |
|---|---|---|
| 2026-10-04 | Monorepo layout (`apps/*`, `packages/*`, `services/*`, `infra/*`) | Decided |
| 2026-10-04 | Postgres for the signal store; schema-as-code now (`infra/schema.sql`), running instance in Phase 1 | Decided |
| 2026-10-04 | Forecast engine = deterministic Bayesian; no LLM in the scoring path | Decided |
| 2026-10-04 | LLM = batch extraction only; mini-class models; cascade on low confidence; batch + cache + incremental | Decided |
| 2026-10-04 | Check-ins anonymous + aggregated; no accounts for B2C basics | Decided |
| 2026-10-04 | GitHub repo visibility | **Open** — recommendation: private |
| 2026-10-04 | B2C web stack for v1 | **Open** — recommendation: Next.js on Vercel + Neon Postgres |
| 2026-10-04 | LLM provider for extraction (Phase 1) | **Open** — decide on cost/quality eval, not brand |
