// Score live venues for right now and print the sources behind each percent.
// Run: node scripts/forecast-tonight.mjs

import { appendFileSync, readFileSync } from 'node:fs';
import { periodLabel, zonedNow } from '../packages/forecast/open.js';
import { SOURCE_NOTES, assembleForecast, isShutdown, loadForecastInputs } from '../packages/forecast/assemble.js';
import { fetchWeather } from '../packages/forecast/weather.js';
import { loadCities } from '../packages/cities/load.js';

const cities = loadCities(new URL('../data/cities/', import.meta.url)).filter((city) => city.live);
const forecastInputs = loadForecastInputs(import.meta.url);
const home = cities.find((city) => city.id === 'san-francisco') || cities[0];
const when = zonedNow(new Date(), home?.tz || 'UTC');
const predicted = new Set();

let weather = null;
if (home) {
  try {
    weather = await fetchWeather(home.lat, home.lon, home.tz);
  } catch (err) {
    console.error(`Weather unavailable: ${err.message}`);
  }
}

console.log(`\nFindingDorothy — ${periodLabel(when.hour)} · ${home?.name || 'unknown'} · ${when.dateLabel} · ${when.timeLabel}`);
console.log('─'.repeat(72));
console.log('Sources');
for (const [name, note] of SOURCE_NOTES) {
  const extra = name === 'Weather' && weather ? ` Right now: ${weather.summary} (${weather.observedAt}).` : '';
  console.log(`  ${name.padEnd(18)} ${note}${extra}`);
}
console.log('─'.repeat(72));

const eventsCache = new Map();

function eventsFor(timeZone) {
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (eventsCache.has(dateKey)) return eventsCache.get(dateKey);
  let file = null;
  try {
    file = JSON.parse(readFileSync(new URL(`../data/events/${dateKey}.json`, import.meta.url), 'utf8'));
  } catch {
    file = null;
  }
  eventsCache.set(dateKey, file);
  return file;
}

const venues = cities.flatMap((city) => city.venues.map((venue) => ({ ...venue, tz: city.tz })));
const ranked = venues
  .map((venue) => ({ venue, forecast: score(venue) }))
  .filter(({ venue, forecast }) => !isShutdown(venue) && forecast.status.open)
  .sort((a, b) => b.forecast.percent - a.forecast.percent || a.venue.name.localeCompare(b.venue.name));

ranked.slice(0, 15).forEach(({ venue, forecast }, index) => {
  const name = `${index + 1}. ${venue.name} (${venue.category}, ${venue.neighborhood})`.padEnd(46);
  console.log(`${name} ${forecast.percent}%  ${forecast.confidence}`);
  console.log(`${''.padEnd(46)} ${forecast.label}`);
  console.log(`${''.padEnd(46)} ${forecast.status.text}`);
  for (const source of forecast.sources) {
    if (source.kind === 'missing' || source.kind === 'rejected') continue;
    console.log(`${''.padEnd(46)} ${source.name}: ${source.detail}`);
  }
});

console.log('─'.repeat(72));
console.log('Low confidence is the starting state: α+β = 10 and no live signal, so this is a pattern, not a count.\n');

function score(venue) {
  const tz = venue.tz || home?.tz || 'UTC';
  const local = zonedNow(new Date(), tz);
  const eventsFile = eventsFor(tz);
  const event = eventsFile && eventsFile[venue.id];
  return assembleForecast(venue, local, {
    weather: venue.city === home?.name ? weather : null,
    cells: forecastInputs.cells,
    weights: forecastInputs.weights,
    eventsFile,
    eventTonight: Boolean(event?.event_tonight),
    onPredict: (row) => {
      if (predicted.has(row.venue_id)) return;
      predicted.add(row.venue_id);
      appendFileSync(new URL('../data/forecast/predictions.log', import.meta.url), `${JSON.stringify(row)}\n`);
    },
  });
}
