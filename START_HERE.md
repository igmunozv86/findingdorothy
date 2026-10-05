# START HERE — FindingDorothy builder's guide
*For Nacho, PM. You know the what; this is the how. 30 minutes, terminal + Cursor.*

## The 5-minute mental model

Think of it as a kitchen. Four jobs, four folders:

| Job | Folder | Plain English |
|---|---|---|
| **Collect** | `services/ingestion` | Grocery shopping. Cron jobs fetch reviews, events, Trends. No thinking, just fetching. |
| **Understand** | `services/extraction` | The prep cook. Reads messy review text, outputs tidy labeled ingredients: "this review says the bathrooms are dirty, visited March 2026." This is the *only* place an LLM works. |
| **Predict** | `packages/forecast` | The recipe. Pure math: prior odds + live signals = score out of 10. No LLM. No internet. Same input → same output, every time. |
| **Show** | `apps/web` | The plate. The app. Takes scores, shows them beautifully. |

Data flows one way: collect → understand → predict → show. If something looks wrong on screen, you walk *backwards* down the chain to find which job messed up. That's debugging.

## The three things to internalize

**1. The database is the product.** The app is just a window into Postgres. Everything valuable — signals, priors, predictions, feedback — lives in the 8 tables in `infra/schema.sql`. If you understand the tables, you understand the company.

**2. Nothing is real-time except the counter.** Reviews get processed in nightly batches (cheap). The forecast is computed on request (free — it's arithmetic). Only the B2B venue counter is live. This is why the whole thing costs ~$5/month at 1,000 venues.

**3. Confidence gates everything.** Notice the script output: every venue says "Not enough live signal." That's not a bug — it's the product working. With thin priors (`n_obs: 12`), the engine *refuses* to make a now-claim. Change `n_obs` to 60 in `scripts/forecast-tonight.mjs`, rerun, and watch the labels flip to "Decent tonight." You just tuned the product's honesty threshold. That's the job.

## Your first hour — the ladder

**Step 1: run the scorer (2 min).**
```bash
cd ~/workspace/findingdorothy
node scripts/forecast-tonight.mjs
```
You just ran the forecast engine. That's the core loop: seed venues → priors → scores → labels.

**Step 2: break it on purpose (10 min).**
Open `packages/forecast/score.js`. Change the weekend sauna prior from `0.75` to `0.95` in the script. Rerun. See the score move. Now you understand the *entire* forecast: it's a number in, a number out. Everything else is getting better numbers in.

**Step 3: add a venue (10 min).**
Open `data/seed-venues.json`. Add a real SF spot you know. Rerun the script. You just did "ingestion" by hand — Phase 1 automates this exact step.

**Step 4: read the schema (15 min).**
Open `infra/schema.sql`. Read each `CREATE TABLE` like a spec: *what fact does this table remember, and why?* If you can explain all 8 tables out loud, you can run every engineering conversation about this project.

## What each folder will become

- `apps/web` — the B2C app. Phase 0: the static prototype artifacts. Phase 2: reads scores from an API.
- `apps/widget` — the B2B counter badge venues embed. One JS snippet.
- `apps/venue-app` — staff phone app: big "+1 / −1" buttons. The $0-hardware tier.
- `services/ingestion` — cron jobs hitting Google/TripAdvisor/blogs. Starts Phase 1.
- `services/extraction` — the LLM prep cook + deterministic guards. Starts Phase 1.
- `infra/` — schema (done), then deploy scripts and cron definitions.

## Your PM superpower here

You own the **what**: which venues matter, what "a good forecast" looks like, what the venue dashboard must show to be worth $100/mo. The repo owns the **how**. When an engineer (or Cursor) asks "what should X do?", your answer lives in `ARCHITECTURE.md` and `DECISIONS.md` — that's your spec. Point at it.

Next rung after this ladder: Phase 1 — replace `seed-venues.json` with the first real ingestion collector.
