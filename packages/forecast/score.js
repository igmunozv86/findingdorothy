// Beta-Binomial cells and log-odds signal updates. Pure functions. No I/O.
// Category means below are starting assumptions (the old hand-set priors),
// stored with effective sample size 10 so day-one confidence stays low.

export const PRIOR_ESS = 10;

// Starting assumptions, not learned values. Weekend is Fri/Sat/Sun.
export const CATEGORY_PRIORS = {
  bar: { weekend: 0.66, weeknight: 0.38, name: 'bar' },
  club: { weekend: 0.7, weeknight: 0.42, name: 'club' },
  cruise: { weekend: 0.68, weeknight: 0.4, name: 'cruising bar' },
  sex: { weekend: 0.58, weeknight: 0.4, name: 'sex club' },
  sauna: { weekend: 0.84, weeknight: 0.5, name: 'bathhouse' },
};

const LIVE_KINDS = new Set(['counter', 'checkin', 'event_tonight']);

export function betaFromMean(p, ess = PRIOR_ESS) {
  const mean = clamp(p, 0.001, 0.999);
  return {
    alpha: round4(mean * ess),
    beta: round4((1 - mean) * ess),
    assumption: true,
    updated_at: null,
  };
}

export function startingCells() {
  const cells = {};
  for (const [category, prior] of Object.entries(CATEGORY_PRIORS)) {
    for (const slot of ['weekend', 'weeknight']) {
      cells[`category:${category}:${slot}`] = betaFromMean(prior[slot]);
    }
  }
  return cells;
}

export function cellMean(cell) {
  const total = cell.alpha + cell.beta;
  if (!Number.isFinite(total) || total <= 0) return 0.5;
  return cell.alpha / total;
}

// Conjugate Beta-Binomial: a busy observation adds to alpha, a quiet one to beta.
export function observeCell(cell, busy, updatedAt = null) {
  return {
    alpha: cell.alpha + (busy ? 1 : 0),
    beta: cell.beta + (busy ? 0 : 1),
    assumption: false,
    updated_at: updatedAt,
  };
}

export function resolveCell(cells, venue, slot) {
  const category = CATEGORY_PRIORS[venue.category] ? venue.category : 'bar';
  const city = venue.city || 'unknown';
  const keys = [
    `venue:${venue.id}:${slot}`,
    `category-city:${category}:${city}:${slot}`,
    `category:${category}:${slot}`,
  ];
  for (const key of keys) {
    const cell = cells && cells[key];
    if (cell && Number.isFinite(cell.alpha) && Number.isFinite(cell.beta)) {
      return { key, alpha: cell.alpha, beta: cell.beta, assumption: cell.assumption === true, updated_at: cell.updated_at ?? null };
    }
  }
  const prior = CATEGORY_PRIORS[category][slot === 'weekend' ? 'weekend' : 'weeknight'];
  return { key: `category:${category}:${slot}`, ...betaFromMean(prior) };
}

export function slotForDow(dow) {
  return dow === 0 || dow === 5 || dow === 6 ? 'weekend' : 'weeknight';
}

export function logit(p) {
  const c = clamp(p, 0.001, 0.999);
  return Math.log(c / (1 - c));
}

export function expit(z) {
  if (z > 20) return 1 / (1 + Math.exp(-20));
  if (z < -20) return 1 / (1 + Math.exp(20));
  return 1 / (1 + Math.exp(-z));
}

export function applySignals(pPrior, signals, weights) {
  let z = logit(pPrior);
  const used = [];
  const rejected = [];
  for (const signal of signals || []) {
    const kind = signal && signal.kind;
    if (!kind || !Object.prototype.hasOwnProperty.call(weights, kind)) {
      rejected.push({ kind: kind || 'unknown', reason: `unknown signal kind ${kind || 'missing'}` });
      continue;
    }
    const x = Number(signal.x);
    if (!Number.isFinite(x)) {
      rejected.push({ kind, reason: 'signal x is not a number' });
      continue;
    }
    const w = Number(weights[kind]);
    const delta = w * x;
    if (delta === 0) {
      rejected.push({ kind, reason: 'signal does not move the posterior' });
      continue;
    }
    z += delta;
    used.push({ kind, x, w, delta });
  }
  return { p: expit(z), used, rejected };
}

export function confidenceFor(effectiveN, usedSignals) {
  const n = Number(effectiveN);
  if (!Number.isFinite(n)) return 'low';
  const live = (usedSignals || []).some((signal) => LIVE_KINDS.has(signal.kind) && signal.x);
  if (n >= 50 && live) return 'high';
  if (n >= 20) return 'medium';
  return 'low';
}

export function displayPercent(p) {
  if (!Number.isFinite(p)) return 0;
  const pct = Math.round((p * 100) / 5) * 5;
  return Math.min(100, Math.max(0, pct));
}

const DRIVER_TEXT = {
  event_tonight: 'An event is on tonight.',
  recurring_night: 'A weekly night is on the venue notes.',
  trends_spike: 'Search interest is up.',
  crowd_phrase: 'Reviews mention a crowd.',
  rain_outdoor: 'Rain is on an outdoor spot.',
  counter: 'The venue counter is in.',
  checkin: 'A check-in says it is busy.',
};

export function driverText(used) {
  if (used.kind === 'hour_phase') {
    return used.delta > 0 ? 'In the busy part of the night.' : 'Outside the busiest hours.';
  }
  return DRIVER_TEXT[used.kind] || null;
}

/**
 * @returns {{ p_busy: number, percent: number, confidence: string, drivers: string[], effective_n: number, used: object[], rejected: object[], p_prior: number }}
 */
export function scoreForecast({ cell, signals = [], weights, closed = false }) {
  if (closed) {
    return {
      p_busy: 0,
      p_prior: 0,
      percent: 0,
      confidence: 'low',
      drivers: ['Closed now'],
      effective_n: 0,
      used: [],
      rejected: [],
    };
  }
  const mean = cellMean(cell);
  const { p, used, rejected } = applySignals(mean, signals, weights);
  const effective_n = cell.alpha + cell.beta;
  const confidence = confidenceFor(effective_n, used);
  const drivers = used
    .slice()
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 2)
    .map(driverText)
    .filter(Boolean);
  return {
    p_busy: p,
    p_prior: mean,
    percent: displayPercent(p),
    confidence,
    drivers,
    effective_n,
    used,
    rejected,
  };
}

/**
 * Low confidence never makes a now-claim. It shows the pattern.
 * Medium and high use the same percent, with a busy / quiet word.
 */
export function labelFor(percent, confidence, context = {}) {
  if (context.closed) return { label: 'Closed right now.', action: 'skip' };
  const day = context.dayName || 'Tonight';
  const place = context.categoryName || 'venue';
  const fact = (context.drivers || []).find((line) => line && line !== 'Closed now' && !/busy part|busiest hours/.test(line));
  const tail = fact ? ` ${fact}` : '';
  if (confidence === 'low') {
    return { label: `${percent}% — ${day} pattern for a ${place}.${tail}`, action: 'pattern' };
  }
  const tone = percent >= 70 ? 'busy' : percent >= 45 ? 'moderate' : 'quiet';
  const action = tone === 'busy' ? 'go' : tone === 'quiet' ? 'skip' : 'maybe';
  return { label: `${percent}% — ${tone} for a ${day} ${place}.${tail}`, action };
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}
