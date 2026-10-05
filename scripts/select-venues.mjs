// Checks data/seed-venues.json against services/ingestion/select-venues.md.
// Run: node scripts/select-venues.mjs

import { readFileSync } from 'node:fs';

const seed = JSON.parse(readFileSync(new URL('../data/seed-venues.json', import.meta.url)));
const cities = JSON.parse(readFileSync(new URL('../data/cities.json', import.meta.url)));
const names = new Set(cities.map((city) => city.name));
const categories = new Set(['bar', 'sauna', 'cruise', 'sex']);
const venues = seed.venues || [];
const errors = [];
const seen = new Set();

for (const venue of venues) {
  const label = venue.id || venue.name || '(missing id)';
  if (!venue.id || seen.has(venue.id)) errors.push(`${label}: id missing or duplicated`);
  seen.add(venue.id);
  if (!names.has(venue.city)) errors.push(`${label}: city ${JSON.stringify(venue.city)} is not a cities.json name`);
  if (!categories.has(venue.category)) errors.push(`${label}: category must be bar, sauna, cruise, or sex`);
  if (!venue.name || !venue.address || !venue.neighborhood) errors.push(`${label}: name, address, and neighborhood are required`);
  if (!Array.isArray(venue.review_features) || venue.review_features.length === 0) {
    errors.push(`${label}: review_features must be phrases from the source page`);
  }
  if ('phone' in venue) errors.push(`${label}: do not store a phone number`);
  if (venue.hours && typeof venue.hours === 'object' && Object.keys(venue.hours).length === 0) {
    errors.push(`${label}: empty hours object is not an unknown schedule; use null`);
  }
  const located = Number.isFinite(venue.lat) && Number.isFinite(venue.lon);
  if (!located) errors.push(`${label}: lat and lon must come from a Nominatim address lookup`);
  if (venue.hours_verified === true) {
    if (venue.hours == null) errors.push(`${label}: verified hours need a stored window`);
    if (typeof venue.source_url !== 'string' || !/^https?:\/\//.test(venue.source_url)) {
      errors.push(`${label}: verified hours need an http source_url from the venue site or official Instagram`);
    }
  } else if (venue.hours == null && (typeof venue.hours_note !== 'string' || venue.hours_note.length === 0)) {
    console.log(`note: ${label} has unconfirmed hours and no hours_note`);
  }
}

const byCity = new Map();
for (const venue of venues) {
  if (!byCity.has(venue.city)) byCity.set(venue.city, []);
  byCity.get(venue.city).push(venue);
}

for (const city of cities) {
  const list = byCity.get(city.name) || [];
  const verified = list.filter((venue) => venue.hours_verified).length;
  const sections = {
    dance: list.filter((venue) => venue.category === 'bar').length,
    sauna: list.filter((venue) => venue.category === 'sauna').length,
    fun: list.filter((venue) => venue.category === 'cruise' || venue.category === 'sex').length,
  };
  console.log(`${city.name} live=${city.live} venues=${list.length} verified_hours=${verified} dance=${sections.dance} sauna=${sections.sauna} fun=${sections.fun}`);
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log(`ok ${venues.length} venues`);
