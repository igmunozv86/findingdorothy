import assert from 'node:assert/strict';
import test from 'node:test';
import { calibrationBins, observeVenue, refitWeights } from './calibrate.js';
import { extractSignals, INITIAL_WEIGHTS } from './signals.js';
import {
  applySignals,
  betaFromMean,
  cellMean,
  confidenceFor,
  displayPercent,
  labelFor,
  observeCell,
  resolveCell,
  scoreForecast,
  startingCells,
} from './score.js';

test('bar weekend prior is Beta(6.6, 3.4), a starting assumption', () => {
  const cell = betaFromMean(0.66);
  assert.equal(cell.alpha, 6.6);
  assert.equal(cell.beta, 3.4);
  assert.equal(cell.assumption, true);
  assert.ok(Math.abs(cellMean(cell) - 0.66) < 1e-9);
});

test('a busy observation raises the mean and a quiet one lowers it', () => {
  const start = betaFromMean(0.66);
  const busy = observeCell(start, true, '2026-10-06T00:00:00Z');
  const quiet = observeCell(start, false, '2026-10-06T00:00:00Z');
  assert.equal(busy.alpha, 7.6);
  assert.equal(busy.beta, 3.4);
  assert.ok(cellMean(busy) > cellMean(start));
  assert.equal(quiet.alpha, 6.6);
  assert.equal(quiet.beta, 4.4);
  assert.ok(cellMean(quiet) < cellMean(start));
  assert.equal(busy.assumption, false);
});

test('every starting signal kind moves the posterior in the signed direction', () => {
  const prior = 0.66;
  const cases = [
    ['event_tonight', 1, 1],
    ['recurring_night', 1, 1],
    ['trends_spike', 0.5, 1],
    ['crowd_phrase', 1, 1],
    ['rain_outdoor', 1, -1],
    ['counter', 0.4, 1],
    ['checkin', 1, 1],
    ['hour_phase', 0.25, 1],
    ['hour_phase', -0.5, -1],
  ];
  for (const [kind, x, direction] of cases) {
    const { p, used, rejected } = applySignals(prior, [{ kind, x }], INITIAL_WEIGHTS);
    assert.equal(rejected.length, 0, kind);
    assert.equal(used.length, 1, kind);
    if (direction > 0) assert.ok(p > prior, kind);
    else assert.ok(p < prior, kind);
  }
});

test('an unknown signal kind is rejected and does not move the probability', () => {
  const { p, used, rejected } = applySignals(0.66, [{ kind: 'vibes', x: 1 }], INITIAL_WEIGHTS);
  assert.equal(used.length, 0);
  assert.equal(rejected[0].kind, 'vibes');
  assert.ok(/unknown/.test(rejected[0].reason));
  assert.ok(Math.abs(p - 0.66) < 1e-9);
});

test('a zero signal is rejected instead of being accepted and ignored', () => {
  const { used, rejected } = applySignals(0.5, [{ kind: 'event_tonight', x: 0 }], INITIAL_WEIGHTS);
  assert.equal(used.length, 0);
  assert.match(rejected[0].reason, /does not move/);
});

test('confidence comes from the cell sample size and a live signal', () => {
  assert.equal(confidenceFor(10, []), 'low');
  assert.equal(confidenceFor(12, [{ kind: 'event_tonight', x: 1 }]), 'low');
  assert.equal(confidenceFor(20, []), 'medium');
  assert.equal(confidenceFor(49, [{ kind: 'counter', x: 0.5 }]), 'medium');
  assert.equal(confidenceFor(50, []), 'medium');
  assert.equal(confidenceFor(50, [{ kind: 'event_tonight', x: 1 }]), 'high');
  assert.equal(confidenceFor(Number.NaN, []), 'low');
});

test('display percent rounds to the nearest 5', () => {
  assert.equal(displayPercent(0.66), 65);
  assert.equal(displayPercent(0.637), 65);
  assert.equal(displayPercent(0.63), 65);
  assert.equal(displayPercent(0.02), 0);
  assert.equal(displayPercent(0.99), 100);
});

test('low confidence shows the pattern and never a go claim', () => {
  const low = labelFor(90, 'low', { dayName: 'Saturday', categoryName: 'bathhouse', drivers: ['An event is on tonight.'] });
  assert.equal(low.action, 'pattern');
  assert.match(low.label, /^90% — Saturday pattern for a bathhouse\./);
  assert.match(low.label, /An event is on tonight/);
  assert.doesNotMatch(low.label, /busy/);

  const high = labelFor(65, 'high', { dayName: 'Saturday', categoryName: 'bathhouse', drivers: ['An event is on tonight.'] });
  assert.equal(high.action, 'maybe');
  assert.equal(high.label, '65% — moderate for a Saturday bathhouse. An event is on tonight.');

  const go = labelFor(85, 'medium', { dayName: 'Saturday', categoryName: 'bathhouse', drivers: [] });
  assert.equal(go.action, 'go');
  assert.match(go.label, /busy for a Saturday bathhouse/);
});

test('a closed door is zero and is not a probability', () => {
  const scored = scoreForecast({
    cell: betaFromMean(0.84),
    signals: [{ kind: 'event_tonight', x: 1 }],
    weights: INITIAL_WEIGHTS,
    closed: true,
  });
  assert.equal(scored.percent, 0);
  assert.equal(scored.p_busy, 0);
  assert.deepEqual(scored.drivers, ['Closed now']);
});

test('venue cell wins over the category assumption', () => {
  const cells = startingCells();
  cells['venue:lisbon-tr3s:weekend'] = { alpha: 40, beta: 10, assumption: false, updated_at: '2026-10-06' };
  const resolved = resolveCell(cells, { id: 'lisbon-tr3s', category: 'bar', city: 'Lisbon' }, 'weekend');
  assert.equal(resolved.key, 'venue:lisbon-tr3s:weekend');
  assert.equal(cellMean(resolved), 0.8);
});

test('an outcome is stored on the venue cell, seeded from the category prior', () => {
  const cells = observeVenue(startingCells(), { id: 'paris-cox', category: 'bar', city: 'Paris' }, 'weekend', true, '2026-10-06');
  const cell = cells['venue:paris-cox:weekend'];
  assert.equal(cell.alpha, 7.6);
  assert.equal(cell.beta, 3.4);
  assert.equal(startingCells()['category:bar:weekend'].alpha, 6.6);
});

test('event tonight is extracted only when the events file says so', () => {
  const missing = extractSignals({ extras: {} });
  assert.ok(missing.missing.some((item) => item.kind === 'event_tonight'));
  assert.ok(!missing.signals.some((item) => item.kind === 'event_tonight'));

  const present = extractSignals({ extras: { eventsFile: {}, eventTonight: true } });
  assert.ok(present.signals.some((item) => item.kind === 'event_tonight' && item.x === 1));
});

test('a raw headcount is rejected and does not become a counter signal', () => {
  const extracted = extractSignals({ extras: { eventsFile: {}, liveCount: { count: 40 } } });
  assert.ok(extracted.rejected.some((item) => item.kind === 'counter'));
  assert.ok(!extracted.signals.some((item) => item.kind === 'counter'));
});

test('calibration bins compare predictions with outcomes', () => {
  const bins = calibrationBins([
    { p_pred: 0.62, busy: 1 },
    { p_pred: 0.63, busy: 0 },
    { p_pred: 0.9, busy: 1 },
  ]);
  const mid = bins.find((bin) => bin.label === '60–65%');
  assert.equal(mid.n, 2);
  assert.equal(mid.empirical, 0.5);
  const high = bins.find((bin) => bin.label === '90–95%');
  assert.equal(high.empirical, 1);
});

test('weights stay at the starting values until there are enough outcomes', () => {
  const few = refitWeights([{ p_prior: 0.5, y: 1, x: { event_tonight: 1 } }], INITIAL_WEIGHTS);
  assert.equal(few.refit, false);
  assert.equal(few.weights.event_tonight, INITIAL_WEIGHTS.event_tonight);
});

test('enough outcomes can move a weight away from the start', () => {
  const samples = [];
  for (let i = 0; i < 30; i += 1) {
    samples.push({ p_prior: 0.4, y: 1, x: { event_tonight: 1, hour_phase: 0 } });
  }
  const fitted = refitWeights(samples, INITIAL_WEIGHTS, { minRows: 20, steps: 80, lr: 0.2, lambda: 0.01 });
  assert.equal(fitted.refit, true);
  assert.ok(fitted.weights.event_tonight > INITIAL_WEIGHTS.event_tonight);
});
