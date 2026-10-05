// packages/forecast/score.js
// Pure functions. No I/O, no LLM. Deterministic — unit-test everything here.

/**
 * P(busy) for a venue at a given local datetime.
 * @param {object} prior - { p_busy: 0..1, n_obs: number, drivers: string[] }
 *   Hierarchical: venue → category+city → category. There is always a prior.
 * @param {Array} liveSignals - [{ kind, value, weight }]
 *   kinds: checkin | trends_spike | event | counter | weather
 * @returns {{ score: number, confidence: 'high'|'medium'|'low', drivers: string[] }}
 */
export function scoreForecast(prior, liveSignals = []) {
  // v0: prior-driven; live signals nudge. Full Bayesian update lands in Phase 2.
  let p = prior.p_busy;
  const drivers = [...(prior.drivers || [])];

  for (const s of liveSignals) {
    // TODO(phase-2): weighted likelihood update per signal kind.
    // Counter data (venue-reported) gets the highest weight;
    // single check-ins the lowest. No single source ever dominates.
    void s;
  }

  const score = Math.round(p * 10 * 10) / 10;
  const hasLive = liveSignals.some((s) => s.kind === 'counter' || s.kind === 'checkin');
  const confidence =
    prior.n_obs >= 50 && hasLive ? 'high' : prior.n_obs >= 20 ? 'medium' : 'low';

  return { score, confidence, drivers: drivers.slice(0, 2) };
}

/**
 * Conservative display mapping. A false "go" costs far more than a false "stay",
 * so low confidence NEVER produces a now-claim — it shows the pattern instead.
 */
export function labelFor(score, confidence) {
  if (confidence === 'low') return { label: 'Not enough live signal', action: 'pattern' };
  if (score >= 8) return { label: 'Worth going now', action: 'go' };
  if (score >= 6) return { label: 'Decent tonight', action: 'maybe' };
  return { label: 'Quiet tonight', action: 'skip' };
}
