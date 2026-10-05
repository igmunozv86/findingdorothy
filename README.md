# FindingDorothy

Gay travel intel, powered by real reviews. Two-sided: a stats-first travel intel app (B2C) and a live-occupancy counter for venues (B2B SaaS). The counter feeds ground truth into the consumer forecast — each side makes the other more valuable.

- **Product thinking:** see [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Decisions:** see [DECISIONS.md](./DECISIONS.md)
- **Launch cities:** San Francisco → Madrid → Paris → Cologne

## Repo layout

```
apps/web          # B2C app (static prototype → fullstack)
apps/widget       # B2B embeddable counter ("N inside now" badge)
apps/venue-app    # staff tap-to-count (PWA, $0 hardware tier)
packages/forecast # Bayesian forecast engine — pure functions, no LLM, tested
services/ingestion  # review/event/Trends collectors (deterministic)
services/extraction # LLM extraction agents + deterministic guards
infra/            # Postgres schema-as-code, crons, deploys
```

## Phases

- **Phase 0 (now):** static prototype, seed SF data.
- **Phase 1:** ingestion + extraction pipeline; Postgres live; venue pages from real signals.
- **Phase 2:** forecast engine v1; Scene Forecast on homepage.
- **Phase 3:** B2B counter MVP; 2–3 SF pilot venues.
- **Phase 4:** check-ins, calibration loop, venue dashboard.

## Cost rules

LLMs are a batch cost, never a serving cost. Mini-class models for extraction, cascade on low confidence, batch + cache + incremental. One $100/mo venue funds extraction for ~20,000 venues.
