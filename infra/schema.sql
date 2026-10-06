-- FindingDorothy schema v0 — Postgres
-- Schema-as-code: the running instance comes in Phase 1.
-- Every signal needs a source; every source needs a date.

CREATE TABLE venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  category TEXT NOT NULL, -- sauna | bar | club | hotel | event
  hours JSONB,             -- e.g. {"mon": ["10:00","24:00"]} or "24h"
  status TEXT NOT NULL DEFAULT 'operating', -- operating | closed | rebranded
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  type TEXT NOT NULL, -- google | tripadvisor | blog | reddit | trends | ...
  retrieved_at TIMESTAMPTZ NOT NULL,
  raw_text TEXT
);

CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id),
  source_id UUID NOT NULL REFERENCES sources(id),
  aspect TEXT NOT NULL, -- cleanliness | safety | crowd | facilities | staff | value
  sentiment REAL NOT NULL, -- -1..1
  evidence_date DATE,       -- when the visit/review refers to; null if unknown
  quote TEXT,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE priors (
  venue_id UUID NOT NULL REFERENCES venues(id),
  dow INT NOT NULL,  -- 0=Sunday .. 6=Saturday
  hour INT NOT NULL, -- 0..23
  p_busy REAL NOT NULL,
  n_obs INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (venue_id, dow, hour)
);

CREATE TABLE live_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id),
  ts TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL, -- checkin | trends_spike | event | counter | weather
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id),
  ts TIMESTAMPTZ NOT NULL, -- the moment predicted for
  score REAL NOT NULL,     -- 0..10
  confidence TEXT NOT NULL, -- high | medium | low
  drivers JSONB NOT NULL,   -- e.g. ["Sunday pattern", "24h weekend schedule"]
  model_version TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID REFERENCES predictions(id),
  venue_id UUID NOT NULL REFERENCES venues(id),
  user_hash TEXT NOT NULL, -- anonymous
  was_accurate BOOLEAN,
  reported_busyness TEXT,  -- dead | ok | packed
  ts TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Rebrands: quarantine incompatible histories, never average across them.
CREATE TABLE venue_links (
  old_venue_id UUID NOT NULL REFERENCES venues(id),
  new_venue_id UUID NOT NULL REFERENCES venues(id),
  split_date DATE NOT NULL,
  reason TEXT, -- rebrand | relocation
  PRIMARY KEY (old_venue_id, new_venue_id)
);

-- Pride calendar. Phase 0 reads data/pride-events.json, same fields.
-- A date ships only when the organizer's own page states that year's dates.
-- Do not project next year from a tradition such as "the last weekend in June".
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES calendar_events(id),
  kind TEXT NOT NULL, -- pride-week | parade | festival
  name TEXT NOT NULL,
  city_id TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  place TEXT,
  note TEXT,
  source_url TEXT NOT NULL,
  source_name TEXT NOT NULL,
  retrieved_at DATE NOT NULL,
  CHECK (end_date >= start_date),
  CHECK (kind IN ('pride-week', 'parade', 'festival')),
  CHECK (source_url ~ '^https://')
);

CREATE INDEX idx_signals_venue ON signals(venue_id);
CREATE INDEX idx_live_signals_venue_ts ON live_signals(venue_id, ts DESC);
CREATE INDEX idx_predictions_venue_ts ON predictions(venue_id, ts DESC);
CREATE INDEX idx_feedback_venue_ts ON feedback(venue_id, ts DESC);
