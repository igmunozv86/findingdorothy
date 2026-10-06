// Refit signal weights and venue cells from logged forecasts and outcomes.
// With no labels this writes the starting-assumption report and does not invent a fit.
// Run: node scripts/calibrate.mjs

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { calibrationBins, observeVenue, refitWeights } from '../packages/forecast/calibrate.js';
import { loadCells } from '../packages/forecast/assemble.js';
import { INITIAL_WEIGHTS } from '../packages/forecast/signals.js';
import { slotForDow } from '../packages/forecast/score.js';

const root = new URL('../', import.meta.url);
const forecastDir = new URL('data/forecast/', root);
mkdirSync(forecastDir, { recursive: true });

const cellsPath = new URL('cells.json', forecastDir);
const weightsPath = new URL('weights.json', forecastDir);
const labelsPath = new URL('labels.json', forecastDir);
const logPath = new URL('predictions.log', forecastDir);
const reportPath = new URL('CALIBRATION.md', forecastDir);

const cells = loadCells(cellsPath);
const labels = loadLabels(labelsPath);
const predictions = loadPredictions(logPath);
const venues = loadVenues(new URL('data/cities/', root));

let cellUpdates = 0;
const joined = [];
for (const label of labels) {
  const venue = venues.get(label.venue_id);
  if (!venue || (label.busy !== 0 && label.busy !== 1)) continue;
  const when = new Date(label.timestamp_utc);
  const dow = Number.isNaN(when.getTime()) ? 1 : localDow(when, venue.tz);
  const slot = slotForDow(dow);
  const key = `venue:${venue.id}:${slot}`;
  const before = JSON.stringify(cells[key] || null);
  const next = observeVenue(cells, venue, slot, label.busy === 1, label.timestamp_utc);
  Object.assign(cells, next);
  if (JSON.stringify(cells[key]) !== before) cellUpdates += 1;
  const prediction = nearestPrediction(predictions, label);
  if (prediction) {
    joined.push({
      p_pred: prediction.p_pred,
      p_prior: prediction.p_prior,
      y: label.busy,
      busy: label.busy,
      x: prediction.signals || {},
    });
  }
}

const fitted = refitWeights(joined, INITIAL_WEIGHTS);
const bins = calibrationBins(joined);
const updatedAt = new Date().toISOString();

writeFileSync(cellsPath, `${JSON.stringify({
  note: cellUpdates
    ? 'Venue cells include outcome updates. Category cells remain the starting assumptions until a venue cell replaces them.'
    : 'Starting assumptions from the old category priors. Effective sample size alpha+beta = 10. Not learned. Zero observation updates.',
  updated_at: cellUpdates ? updatedAt : null,
  cells,
}, null, 2)}\n`);

writeFileSync(weightsPath, `${JSON.stringify({
  note: fitted.refit
    ? 'Signal weights refit from labeled outcomes, shrunk toward the loaded weights.'
    : 'Starting assumptions. Not learned. Zero refits.',
  updated_at: fitted.refit ? updatedAt : null,
  weights: fitted.weights,
}, null, 2)}\n`);

writeFileSync(reportPath, report({ fitted, bins, joined: joined.length, labels: labels.length, cellUpdates }));
console.log(`calibration: ${fitted.refit ? 'refit' : fitted.reason}; labels ${labels.length}; joined ${joined.length}`);

function report({ fitted, bins, joined, labels, cellUpdates }) {
  const lines = [
    '# Calibration',
    '',
    fitted.refit
      ? `Status: refit on ${joined} joined outcomes.`
      : 'Status: starting assumptions. Zero refits.',
    '',
    fitted.refit
      ? 'Signal weights were refit by logistic regression, shrunk toward the previous weights. Venue Beta cells were updated from the same labels.'
      : 'No labeled outcomes were joined to a logged forecast, so weights and category Beta cells stay at the documented starting values (effective sample size 10). Nothing here was learned from observations.',
    '',
    `- Labels read: ${labels}`,
    `- Joined to a prediction: ${joined}`,
    `- Venue cell updates: ${cellUpdates}`,
    `- Refit: ${fitted.refit ? 'yes' : `no — ${fitted.reason}`}`,
    '',
    '| Bin | Predictions | Mean predicted | Empirical busy rate | Error |',
    '| --- | --- | --- | --- | --- |',
  ];
  if (!bins.length) lines.push('| — | 0 | — | — | — |');
  for (const bin of bins) {
    lines.push(`| ${bin.label} | ${bin.n} | ${pct(bin.mean_pred)} | ${pct(bin.empirical)} | ${pct(bin.error)} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function pct(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

function loadLabels(fileUrl) {
  try {
    const raw = JSON.parse(readFileSync(fileUrl, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.labels;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function loadPredictions(fileUrl) {
  try {
    return readFileSync(fileUrl, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function loadVenues(dir) {
  const map = new Map();
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.json'))) {
    const city = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    for (const venue of city.venues || []) {
      map.set(venue.id, { ...venue, city: city.meta.name, tz: city.meta.tz });
    }
  }
  return map;
}

function nearestPrediction(predictions, label) {
  const at = Date.parse(label.timestamp_utc);
  if (!Number.isFinite(at)) return null;
  let best = null;
  let bestGap = Infinity;
  for (const row of predictions) {
    if (row.venue_id !== label.venue_id) continue;
    const gap = Math.abs(Date.parse(row.timestamp_utc) - at);
    if (gap < bestGap && gap <= 3 * 60 * 60 * 1000) {
      best = row;
      bestGap = gap;
    }
  }
  return best;
}

function localDow(date, timeZone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}
