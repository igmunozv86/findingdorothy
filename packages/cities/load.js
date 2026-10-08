// Reads every data/cities/<slug>.json file. Computed counts are added here.
// A failing file throws. The page is not written.

import { readdirSync, readFileSync } from 'node:fs';
import { validateCity } from './validate.js';

export function loadCities(directory) {
  const names = readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
  if (!names.length) throw new Error(`No city files in ${directory}`);
  const errors = [];
  const cities = [];
  for (const name of names) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(new URL(name, directory)));
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      continue;
    }
    errors.push(...validateCity(raw, name));
    if (!raw?.meta) continue;
    const venues = Array.isArray(raw.venues) ? raw.venues : [];
    const verified = venues.filter((venue) => venue.hours_verified === true).length;
    cities.push({
      id: raw.meta.slug,
      name: raw.meta.name,
      country: raw.meta.country,
      region: raw.meta.region,
      gayborhood: raw.meta.gayborhood,
      lat: raw.meta.lat,
      lon: raw.meta.lon,
      tz: raw.meta.tz,
      status: raw.meta.status,
      live: raw.meta.status === 'live',
      last_updated: raw.meta.last_updated,
      venue_count: venues.length,
      verified_pct: venues.length ? Math.round((verified / venues.length) * 1000) / 10 : 0,
      events: Array.isArray(raw.events) ? raw.events : [],
      venues: venues.map((venue) => ({ ...venue, city: raw.meta.name })),
    });
  }
  if (errors.length) {
    const preview = errors.slice(0, 40).join('\n');
    const more = errors.length > 40 ? `\n… and ${errors.length - 40} more` : '';
    throw new Error(`${errors.length} city schema errors\n${preview}${more}`);
  }
  return cities;
}
