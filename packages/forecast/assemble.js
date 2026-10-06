// Turn posted hours, the Beta prior, and whatever signals we actually have
// into one probability. Closed is still a hard zero. No live headcount is invented.

import { readFileSync } from 'node:fs';
import { placeStatus } from './open.js';
import { extractSignals, INITIAL_WEIGHTS, loadWeights } from './signals.js';
import {
  CATEGORY_PRIORS,
  labelFor,
  resolveCell,
  scoreForecast,
  slotForDow,
  startingCells,
} from './score.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function summaryWithCountNote(pattern, hasLiveCount) {
  const base = String(pattern).replace(/ No live count\.$/, '').trimEnd();
  return hasLiveCount ? base : `${base} No live count.`;
}

export function isShutdown(venue) {
  const flag = String(venue.status || '').toLowerCase();
  return flag === 'closed' || flag === 'out_of_business' || flag === 'shutdown' || venue.out_of_business === true;
}

export function loadCells(fileUrl) {
  const cells = startingCells();
  try {
    const raw = JSON.parse(readFileSync(fileUrl, 'utf8'));
    const stored = raw.cells && typeof raw.cells === 'object' ? raw.cells : raw;
    for (const [key, cell] of Object.entries(stored)) {
      if (cell && Number.isFinite(cell.alpha) && Number.isFinite(cell.beta)) cells[key] = cell;
    }
  } catch {
    // Starting assumptions only.
  }
  return cells;
}

export function dayScore(venue, dow, cells = startingCells()) {
  if (!openOnDow(venue.hours, dow)) return 0;
  const slot = slotForDow(dow);
  const cell = resolveCell(cells, venue, slot);
  const scored = scoreForecast({ cell, signals: [], weights: INITIAL_WEIGHTS });
  return scored.percent;
}

export function assembleForecast(venue, when, extras = {}) {
  const status = placeStatus(venue.hours, when);
  const cells = extras.cells || startingCells();
  const weights = extras.weights || INITIAL_WEIGHTS;
  const slot = slotForDow(status.patternDay);
  const category = CATEGORY_PRIORS[venue.category] ? venue.category : 'bar';
  const cat = CATEGORY_PRIORS[category];
  const cell = resolveCell(cells, venue, slot);
  const features = venue.review_features || [];
  const sources = [
    { name: status.unconfirmed ? 'Hours' : 'Posted hours', kind: 'gate', detail: status.text },
  ];

  if (!status.open) {
    const scored = scoreForecast({ cell, signals: [], weights, closed: true });
    const { label, action } = labelFor(scored.percent, scored.confidence, { closed: true });
    return {
      ...scored,
      label,
      action,
      status,
      summary: 'Closed right now, so expected busyness is 0.',
      sources: sources.concat(staticMissing()),
      cell_key: cell.key,
    };
  }

  const extracted = extractSignals({
    features,
    phase: status.phase || 'mid',
    weekday: status.patternDay,
    weather: extras.weather,
    extras,
  });
  const scored = scoreForecast({ cell, signals: extracted.signals, weights });
  const rejected = [...extracted.rejected, ...scored.rejected];
  const dayName = DAY_NAMES[status.patternDay] || 'Tonight';
  const { label, action } = labelFor(scored.percent, scored.confidence, {
    dayName,
    categoryName: cat.name,
    drivers: scored.drivers,
  });

  sources.push({
    name: 'Category prior',
    kind: cell.assumption === false ? 'learned' : 'assumption',
    detail: `${cell.key} · starting mean ${Math.round(scored.p_prior * 100)}% · n=${trimNum(scored.effective_n)}`,
  });
  for (const used of scored.used) {
    sources.push({ name: used.kind, kind: 'signal', detail: `x=${used.x} · w=${used.w} · Δlogit=${trimNum(used.delta)}` });
  }
  for (const item of extracted.missing) {
    sources.push({ name: item.kind, kind: 'missing', detail: item.reason });
  }
  for (const item of rejected) {
    sources.push({ name: item.kind, kind: 'rejected', detail: item.reason });
  }

  const summary = summaryWithCountNote(label, extras.liveCount);
  if (typeof extras.onPredict === 'function') {
    const signalMap = {};
    for (const used of scored.used) signalMap[used.kind] = used.x;
    extras.onPredict({
      venue_id: venue.id,
      timestamp_utc: new Date().toISOString(),
      p_pred: scored.p_busy,
      p_prior: scored.p_prior,
      features: { category, slot, phase: status.phase || 'mid', cell_key: cell.key },
      signals: signalMap,
    });
  }

  return {
    ...scored,
    label,
    action,
    status,
    summary,
    sources,
    cell_key: cell.key,
  };
}

export function defaultForecastPaths(rootUrl) {
  return {
    cells: new URL('../data/forecast/cells.json', rootUrl),
    weights: new URL('../data/forecast/weights.json', rootUrl),
  };
}

export function loadForecastInputs(rootUrl) {
  const paths = defaultForecastPaths(rootUrl);
  return {
    cells: loadCells(paths.cells),
    weights: loadWeights(paths.weights),
  };
}

export const SOURCE_NOTES = [
  ['Posted hours', 'A closed door is 0%. Unconfirmed hours stay open for the pattern and say so.'],
  ['Beta prior', 'Starting assumption from the old category odds, α+β = 10. A venue cell replaces it only after a real busy/quiet outcome.'],
  ['Signals', 'Log-odds weights are starting assumptions until calibration refits them. A missing signal is logged, not treated as zero evidence.'],
  ['Hour phase', 'Time-of-night nudge from posted hours. Starting assumption, not a fitted weight.'],
  ['Weather', 'Open-Meteo. Rain lowers an outdoor venue. Indoor rain is not a signal.'],
  ['Not wired', 'Check-ins, venue occupancy (0–1), Google Trends. A raw headcount is rejected until it is an occupancy fraction.'],
];

function staticMissing() {
  return [
    { name: 'event_tonight', kind: 'missing', detail: 'events file missing' },
    { name: 'trends_spike', kind: 'missing', detail: 'Google Trends not pulled' },
    { name: 'counter', kind: 'missing', detail: 'venue counter unwired' },
    { name: 'checkin', kind: 'missing', detail: 'check-ins unwired' },
  ];
}

function openOnDow(hours, dow) {
  if (hours === '24h') return true;
  if (!hours || hours === 'no recent data' || typeof hours !== 'object') return true;
  return Boolean(hours[DAY_KEYS[dow]]);
}

function trimNum(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
