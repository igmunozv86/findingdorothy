// Score every seed venue for right now and print the sources behind each number.
// Run: node scripts/forecast-tonight.mjs

import { readFileSync } from 'node:fs';
import { periodLabel, zonedNow } from '../packages/forecast/open.js';
import { SOURCE_NOTES, assembleForecast, isShutdown } from '../packages/forecast/assemble.js';
import { fetchWeather } from '../packages/forecast/weather.js';

const seed = JSON.parse(readFileSync(new URL('../data/seed-venues.json', import.meta.url)));
const when = zonedNow(new Date(), 'America/Los_Angeles');

let weather = null;
try {
  weather = await fetchWeather(37.7749, -122.4194, 'America/Los_Angeles');
} catch (err) {
  console.error(`Weather unavailable: ${err.message}`);
}

console.log(`\nFindingDorothy — ${periodLabel(when.hour)} · San Francisco · ${when.dateLabel} · ${when.timeLabel}`);
console.log('─'.repeat(72));
console.log('Sources');
for (const [name, note] of SOURCE_NOTES) {
  const extra = name === 'Weather' && weather ? ` Right now: ${weather.summary} (${weather.observedAt}).` : '';
  console.log(`  ${name.padEnd(18)} ${note}${extra}`);
}
console.log('─'.repeat(72));

const ranked = seed.venues
  .map((venue) => ({ venue, forecast: assembleForecast(venue, when, { weather }) }))
  .filter(({ venue, forecast }) => !isShutdown(venue) && forecast.status.open)
  .sort((a, b) => b.forecast.score - a.forecast.score || a.venue.name.localeCompare(b.venue.name));

ranked.forEach(({ venue, forecast }, index) => {
  const name = `${index + 1}. ${venue.name} (${venue.category}, ${venue.neighborhood})`.padEnd(42);
  console.log(`${name} ${forecast.score.toFixed(1)}/10  ${forecast.label} · ${forecast.confidence}`);
  console.log(`${''.padEnd(42)} ${forecast.status.text}`);
  console.log(`${''.padEnd(42)} ${forecast.summary}`);
  for (const source of forecast.sources) {
    if (source.kind === 'missing') continue;
    console.log(`${''.padEnd(42)} ${source.name}: ${source.detail}`);
  }
});

const shut = seed.venues.filter((venue) => !isShutdown(venue) && !assembleForecast(venue, when, { weather }).status.open);
const gone = seed.venues.filter((venue) => isShutdown(venue));
if (shut.length) {
  console.log('Not ranked — shut right now');
  for (const venue of shut) {
    const forecast = assembleForecast(venue, when, { weather });
    console.log(`  ${venue.name}: ${forecast.status.text}`);
  }
}
if (gone.length) {
  console.log(`Removed — out of business: ${gone.map((venue) => venue.name).join(', ')}`);
} else {
  console.log('Out of business: none of these places have that signal.');
}
console.log('─'.repeat(72));
console.log('Low confidence on purpose: no check-ins and no venue counter, so this is a pattern, not a live count.\n');
