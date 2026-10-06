// Bin forecasts, refit signal weights, and update Beta cells from outcomes.
// Pure functions. The script in scripts/calibrate.mjs does the file writes.

import { cellMean, logit, observeCell, resolveCell } from './score.js';

export function calibrationBins(rows) {
  const bins = [];
  for (let start = 0; start < 100; start += 5) {
    const group = rows.filter((row) => {
      const pct = Number(row.p_pred) * 100;
      if (!Number.isFinite(pct)) return false;
      if (start === 95) return pct >= 95 && pct <= 100;
      return pct >= start && pct < start + 5;
    });
    if (!group.length) continue;
    const hits = group.filter((row) => row.busy === 1 || row.busy === true).length;
    const empirical = hits / group.length;
    const meanPred = group.reduce((sum, row) => sum + Number(row.p_pred), 0) / group.length;
    bins.push({
      label: `${start}–${start + 5}%`,
      n: group.length,
      mean_pred: meanPred,
      empirical,
      error: empirical - meanPred,
    });
  }
  return bins;
}

// Logistic regression on logit(p_prior) + w·x, shrunk toward the starting weights.
// Fewer than minRows outcomes leaves the weights untouched.
export function refitWeights(samples, initial, { minRows = 20, steps = 400, lr = 0.08, lambda = 2 } = {}) {
  const weights = { ...initial };
  if (!Array.isArray(samples) || samples.length < minRows) {
    return {
      weights,
      refit: false,
      reason: `need ${minRows} labeled outcomes, have ${samples ? samples.length : 0}`,
    };
  }
  const kinds = Object.keys(initial);
  for (let step = 0; step < steps; step += 1) {
    const grad = Object.fromEntries(kinds.map((kind) => [kind, lambda * (weights[kind] - initial[kind])]));
    for (const row of samples) {
      let z = logit(row.p_prior ?? 0.5);
      for (const kind of kinds) z += weights[kind] * (row.x?.[kind] || 0);
      const p = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
      const err = p - (row.y ? 1 : 0);
      for (const kind of kinds) grad[kind] += err * (row.x?.[kind] || 0);
    }
    for (const kind of kinds) weights[kind] -= (lr * grad[kind]) / samples.length;
  }
  return { weights, refit: true, reason: null };
}

// One outcome updates that venue's own cell, seeded from the fallback prior
// so a single label does not rewrite the category assumption.
export function observeVenue(cells, venue, slot, busy, updatedAt) {
  const next = { ...cells };
  const key = `venue:${venue.id}:${slot}`;
  const current = next[key] || resolveCell(next, venue, slot);
  next[key] = observeCell(current, Boolean(busy), updatedAt);
  return next;
}

export function meanOf(cell) {
  return cellMean(cell);
}
