# FindingDorothy — System Architecture v0
*2026-10-04 · Prototype-stage technical blueprint. Launch cities: San Francisco, Madrid, Paris, Cologne.*

## City files (current)

Staging is the research inbox. Production is `data/cities/<slug>.json`. The page reads production only.

- A worker writes `data/staging/cities/<slug>.json` and `data/staging/reports/<slug>.json`. It does not copy a published city into staging, and it does not edit `data/cities/` or `apps/web/index.html`.
- `node scripts/select-venues.mjs` calls `validateForMerge` in `packages/cities/validate.js`. That is the one validator. Schema errors, fewer than 5 venues, and a missing or incomplete research report all fail. Review flags, including under half the venues with verified hours, print before merge and do not fail the check.
- `node scripts/merge-cities.mjs` copies a passing file into `data/cities/`, prints a diff, then deletes the staging city and its report. The inbox is empty when nothing is in flight. A failing file stays in staging.
- `node scripts/build-web.mjs` loads `data/cities/` through `validateCity` (schema only). A city already published under the 5-venue floor stays on the page until a worker replaces it. New thin files cannot merge.
- `data/cities.json` was a stale city index. Nothing in the build reads it. City identity lives on each `data/cities/<slug>.json`.
- Display names, stored categories, the conditional Events chip, and country flags live in `packages/cities/taxonomy.js`. The page does not carry a second copy.
- Open and closed labels are computed in the browser from each venue's `hours` and the city timezone. The page does not embed a 24-hour string list.

## The system in one picture

```
[SOURCES] → [INGESTION] → [EXTRACTION (LLM)] → [SIGNAL STORE] → [FORECAST ENGINE] → [B2C APP]
   │              │                │                    ↑                   │              │
   │         (deterministic)  (LLM judgment      (Postgres)        (deterministic,    (static → fullstack)
   │                           + code guards)                        Bayesian)               │
   │                                                                   ↑                    ↓
[VENUE COUNTER WIDGET] → [OCCUPANCY API] ──────────────────────────────┘            [FEEDBACK LOOP]
   (B2B SaaS)               (venue-reported counts)                          (check-ins, accuracy votes → calibration)
```

Two-sided by design: the B2B counter feeds ground-truth occupancy into the same store that powers the B2C forecast. Each side makes the other more valuable.

## Components

### 1. Ingestion layer — deterministic code
Scheduled collectors (daily/weekly cron jobs). No LLM here — this is plumbing.
- **Review collectors:** Google Places API (ratings, counts, hours — note: *no* Popular Times API exists), TripAdvisor, gay blogs/guides, Reddit/forums.
- **Event calendar:** Pride dates, circuit parties, festivals — refreshed seasonally (agent-assisted, human-verified).
- **Google Trends:** weekly pulls per venue/city (pytrends or equivalent).
- Every raw item stored with: source URL, retrieved timestamp, raw text. **No record without provenance.**

### 2. Extraction layer — LLM agents (where LLMs earn their keep)
The one place LLMs are load-bearing: turning messy human text into structured, cited signals.
- **Job:** review text → `{venue, aspect, sentiment, evidence_date, quote}` where aspect ∈ {cleanliness, safety, crowd, facilities, staff, value}.
- **Every signal carries its citation** (source + date). No citation = doesn't ship. Ever.
- **Deterministic guards around it:** schema enforcement, date parsing, dedup, quarantine rules (rebrands split history; extreme outliers flagged, never silently averaged; single unverified allegations labeled as such).
- The bullshit-detector applied: LLM does ambiguous judgment ("is this review about cleanliness?"), code does everything else (collecting, validating, aggregating, dating).

### 3. Signal store — Postgres
| Table | Purpose |
|---|---|
| `venues` | id, name, city, category, hours, status (operating/closed/rebranded) |
| `sources` | id, url, type, retrieved_at |
| `signals` | id, venue_id, source_id, aspect, sentiment, evidence_date, quote, weight |
| `priors` | venue_id × day_of_week × hour → p_busy, n_obs, updated_at |
| `live_signals` | venue_id, ts, kind (checkin / trends_spike / event / counter), value |
| `predictions` | every forecast served: venue_id, ts, score, confidence, drivers, model_version — **required for calibration** |
| `feedback` | prediction_id, anonymous user hash, was_accurate, reported_busyness, ts |
| `venue_links` | rebrands: old_venue_id → new_venue_id, split_date (quarantines incompatible histories) |

### 4. Forecast engine — deterministic, Bayesian
Nowcasting: P(busy right now | signals). No LLM in the scoring path.
- **Prior:** P(busy | venue, dow, hour) mined from review patterns ("Saturdays packed"). Hierarchical fallback when data is thin: venue → category+city → category. *There is always a prior — never a blank.*
- **Update:** live signals (counter counts, check-ins, Trends spikes, events, weather) adjust via weighted likelihood.
- **Output:** score 0–10, confidence tier, top-2 drivers. Confidence gates display:
  - High (live counter data) → "🔥 312 inside now"
  - Medium (strong pattern + signals) → "Worth going now · Expected"
  - Low → no *now*-claim; show the historical pattern + "not enough live signal"
- **Conservative by design:** false "go" is far costlier than false "stay". Optimize precision on go-recommendations.
- **Every prediction logged** — calibration ("our Saturday calls were right 82% last month") is computed, not claimed.

### 5. B2C app
- **v0 (now):** static prototype — homepage + Madrid deep-dive. No backend.
- **v1:** fullstack — city pages, venue pages, forecast API. Privacy-first: no account for basics, location used once on-device, never stored.
- **Feedback capture:** one-tap check-in ("I'm here: dead / ok / packed"), "was the forecast right?" — anonymous, aggregated, seconds not surveys.

### 6. B2B counter — the wedge
- **Widget:** JS snippet venues embed on their site → live "N inside now" badge (the Chilli model, standardized).
- **Ingestion API:** `POST /occupancy {venue_id, count, ts, source}` with API key. Sources tiered: `staff_tap` (free, 5-min setup) → `pos_integration` (timed-entry systems) → `sensor` (hardware upsell).
- **Venue dashboard:** busy-hour analytics, their forecast accuracy, anonymized competitor benchmarks. This is what they pay for.
- **Anti-gaming:** anomaly detection on counts; consumer feedback cross-checks venues (lie → flagged). No single source dominates.

### 7. Calibration loop — the moat
`predictions` × `feedback` → nightly job adjusts priors and reporter weights → published accuracy stats. The model visibly improves in public; wrongness becomes the product getting better. This loop is what Grindr can't copy by scraping.

## What the LLM does vs. what code does
| LLM (judgment) | Code (everything else) |
|---|---|
| Is this review about cleanliness? | Collecting, scheduling, retries |
| What aspect/sentiment? | Schema validation, dedup, date parsing |
| Which venue does "the sauna near Sol" mean? | Aggregation, weighting, decay math |
| Is this a rebrand or the same venue? | Bayesian updates, thresholds, quarantine |
| Draft the venue summary | Citations, freshness badges, serving |

## Build order
- **Phase 0 (now):** static prototype. Seed SF data next (dogfood city).
- **Phase 1:** ingestion + extraction pipeline; Postgres schema; venue pages rendered from real signals (not hand-written).
- **Phase 2:** forecast engine v1 — priors from review patterns; Scene Forecast on homepage.
- **Phase 3:** B2B counter MVP — staff-tap app + widget + occupancy API; pilot with 2–3 SF venues.
- **Phase 4:** check-ins, Trends integration, calibration loop live; venue dashboard v1.

## Suggested repo layout
```
findingdorothy/
  apps/web          # B2C app (static → fullstack)
  apps/widget       # B2B embeddable counter
  apps/venue-app    # staff tap-to-count (PWA)
  packages/forecast # Bayesian engine (pure functions, tested)
  services/ingestion
  services/extraction  # LLM agents + deterministic guards
  infra/            # Postgres schema, crons, deploys
```

## Cost architecture — scalable, efficient, low-cost
The rule: **LLMs are a batch cost, never a serving cost.** The forecast engine is pure arithmetic; serving a prediction costs ~$0. All LLM spend happens offline, in nightly batches, on small models.

- **Extraction uses small models.** Review → signal is classification/extraction, not reasoning. A mini-class model handles it. Never the flagship for bulk work.
- **Cascade pattern:** cheap model first; only escalate low-confidence ambiguous cases to a bigger model. Expect ~95% to never escalate.
- **Three cost commandments:** batch (nightly, not real-time — reviews don't need instant extraction), cache (never re-extract a review), incremental (only new reviews since last run).
- **Deterministic pre-filters before any LLM call:** language ID, dedup, length/quality filters, keyword routing. Shrink what reaches the model.
- **Summaries from templates in v1:** venue descriptions generated deterministically from structured signals; LLM polish only if it earns its cost.
- **Back-of-envelope:** 1,000 venues × 50 reviews/mo = 50K extractions ≈ **~$5/month** on mini-class models. At 100K venues ≈ ~$500/mo. One B2B venue at $100/mo funds extraction for ~20,000 venues. The unit economics work because the SaaS side pays for the intelligence side.
- **Infra stays boring:** Postgres on a small instance, static hosting for v0, cron jobs. The expensive traps to avoid: real-time LLM per query, re-processing old data, flagship models for classification tasks.

## Non-negotiables
1. No number without a source. No source without a date.
2. No *now*-claim below the confidence threshold — silence beats a wrong guess.
3. Check-ins anonymous and aggregated. No accounts for basics.
4. Venues can be wrong; the loop corrects them publicly.
5. Useful with zero users; the network sharpens, never carries.
