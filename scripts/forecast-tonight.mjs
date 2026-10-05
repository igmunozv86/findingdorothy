// scripts/forecast-tonight.mjs
// The first "product": score tonight's busyness for every seed venue and print it.
// Run: node scripts/forecast-tonight.mjs
// Phase 0: priors are hand-set category defaults (the "hierarchical prior" idea
// from ARCHITECTURE.md in 6 lines). Phase 2 replaces them with mined data.

import { readFileSync } from 'node:fs';
import { scoreForecast, labelFor } from '../packages/forecast/score.js';

const seed = JSON.parse(readFileSync(new URL('../data/seed-venues.json', import.meta.url)));

// Category-level priors: P(busy) by night type. This is the fallback layer
// the architecture calls "category priors" — real per-venue data sharpens it later.
const PRIORS = {
  sauna: { weekend: { p: 0.95, drivers: ['Weekend pattern', '24h schedule'] }, weeknight: { p: 0.45, drivers: ['Weeknight pattern', '24h schedule'] } },
  bar:   { weekend: { p: 0.7,  drivers: ['Weekend pattern', 'Castro foot traffic'] }, weeknight: { p: 0.4, drivers: ['Weeknight pattern', 'Castro foot traffic'] } },
};

const now = new Date();
const dow = now.getDay(); // 0=Sunday
const isWeekend = dow === 0 || dow === 5 || dow === 6;
const dayName = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

console.log(`\nFindingDorothy — Scene Forecast · San Francisco · ${dayName}`);
console.log('─'.repeat(58));

for (const v of seed.venues) {
  const cat = PRIORS[v.category] ?? PRIORS.bar;
  const t = isWeekend ? cat.weekend : cat.weeknight;
  // n_obs is small on purpose: these are priors, not measurements → medium/low confidence.
  const prior = { p_busy: t.p, n_obs: 12, drivers: t.drivers };
  const { score, confidence, drivers } = scoreForecast(prior, []);
  const { label } = labelFor(score, confidence);
  const name = `${v.name} (${v.category}, ${v.neighborhood})`.padEnd(38);
  console.log(`${name} ${score.toFixed(1)}/10  ${label} · ${confidence}`);
  console.log(`${''.padEnd(38)} drivers: ${drivers.join(' · ')}`);
}
console.log('─'.repeat(58));
console.log('Prototype priors — expected patterns, not live counts.\n');
