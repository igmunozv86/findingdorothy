// Schema for data/cities/<slug>.json. The build calls this and stops on any error.
// venue_count and verified_pct are computed later. They must not be stored.
// Run: node packages/cities/validate.js

import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REGIONS = ['North America', 'Europe', 'Latin America', 'Asia-Pacific', 'Middle East', 'Africa'];
const CATEGORIES = ['bar', 'club', 'sauna', 'cruise', 'sex'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TZ = /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)+$/;
const VENUE_KEYS = ['id', 'name', 'category', 'neighborhood', 'address', 'lat', 'lon', 'hours', 'hours_verified', 'review_features', 'instagram', 'sources', 'events_url', 'live_counter'];
const PRIDE_YEARS = ['2026', '2027'];

export { REGIONS, CATEGORIES };

export function validateCity(city, filename) {
  const errors = [];
  const slug = String(filename || '').replace(/\.json$/, '');
  if (!city || typeof city !== 'object' || Array.isArray(city)) {
    return [`${slug}: city file must be an object`];
  }
  for (const key of Object.keys(city)) {
    if (key !== 'meta' && key !== 'venues' && key !== 'pride') {
      errors.push(`${slug}: unknown field ${key}`);
    }
  }
  const meta = city.meta;
  if (!meta || typeof meta !== 'object') {
    errors.push(`${slug}: meta is required`);
    return errors;
  }
  if (meta.slug !== slug) errors.push(`${slug}: meta.slug must match the filename`);
  if (!meta.name || typeof meta.name !== 'string') errors.push(`${slug}: meta.name is required`);
  if (!meta.country || typeof meta.country !== 'string') errors.push(`${slug}: meta.country is required`);
  if (!REGIONS.includes(meta.region)) errors.push(`${slug}: region must be one of ${REGIONS.join(', ')}`);
  if (!(meta.gayborhood === null || typeof meta.gayborhood === 'string')) {
    errors.push(`${slug}: gayborhood must be a string or null`);
  }
  if (!Number.isFinite(meta.lat) || !Number.isFinite(meta.lon)) errors.push(`${slug}: city lat and lon are required`);
  if (meta.status !== 'seeded' && meta.status !== 'live') errors.push(`${slug}: status must be seeded or live`);
  if (!ISO_DATE.test(meta.last_updated || '')) errors.push(`${slug}: last_updated must be YYYY-MM-DD`);
  if (!TZ.test(meta.tz || '')) errors.push(`${slug}: tz is required so the clock can use the city's local time`);

  if (!Array.isArray(city.venues)) {
    errors.push(`${slug}: venues must be an array`);
  } else {
    const seen = new Set();
    for (const venue of city.venues) errors.push(...validateVenue(slug, venue, seen));
  }

  errors.push(...validatePride(slug, city.pride));
  return errors;
}

function validateVenue(slug, venue, seen) {
  const errors = [];
  if (!venue || typeof venue !== 'object') return [`${slug}: venue must be an object`];
  const label = `${slug}: ${venue.id || venue.name || 'venue'}`;
  for (const key of Object.keys(venue)) {
    if (!VENUE_KEYS.includes(key)) errors.push(`${label}: unknown field ${key}`);
  }
  if (typeof venue.id !== 'string' || !venue.id.startsWith(`${slug}-`) || seen.has(venue.id)) {
    errors.push(`${label}: id must be unique and start with ${slug}-`);
  }
  seen.add(venue.id);
  if (!venue.name || typeof venue.name !== 'string') errors.push(`${label}: name is required`);
  if (!CATEGORIES.includes(venue.category)) errors.push(`${label}: category must be bar, club, sauna, cruise, or sex`);
  if (!venue.neighborhood || !venue.address) errors.push(`${label}: neighborhood and address are required`);
  const latNull = venue.lat === null;
  const lonNull = venue.lon === null;
  if (latNull !== lonNull || (!latNull && (!Number.isFinite(venue.lat) || !Number.isFinite(venue.lon)))) {
    errors.push(`${label}: lat and lon are both numbers or both null`);
  }
  if ('phone' in venue) errors.push(`${label}: do not store a phone number`);
  errors.push(...validateHours(label, venue.hours, venue.hours_verified === true));
  if (venue.hours_verified !== true && venue.hours_verified !== false) {
    errors.push(`${label}: hours_verified must be true or false`);
  }
  if (!Array.isArray(venue.review_features) || venue.review_features.length < 2 || venue.review_features.length > 4) {
    errors.push(`${label}: review_features needs 2 to 4 phrases`);
  } else if (venue.review_features.some((phrase) => typeof phrase !== 'string' || !phrase.trim())) {
    errors.push(`${label}: review_features must be short factual strings`);
  }
  if (!(venue.instagram === null || typeof venue.instagram === 'string')) {
    errors.push(`${label}: instagram is a handle or null`);
  }
  if (!('live_counter' in venue)) {
    errors.push(`${label}: live_counter is required, or null`);
  } else if (venue.live_counter !== null && (typeof venue.live_counter !== 'string' || !/^https?:\/\//.test(venue.live_counter))) {
    errors.push(`${label}: live_counter must be null or the venue's own counter page`);
  }
  if ('events_url' in venue && venue.events_url !== null) {
    if (typeof venue.events_url !== 'string' || !/^https?:\/\//.test(venue.events_url)) {
      errors.push(`${label}: events_url must be an http(s) url or null`);
    }
  }
  errors.push(...validateSources(label, venue.sources));
  if (venue.hours_verified === true && !(venue.sources || []).some((source) => source && source.tier === 3)) {
    errors.push(`${label}: verified hours need a tier 3 source, the venue's own site or Instagram`);
  }
  return errors;
}

function validateHours(label, hours, verified) {
  if (!verified) {
    return hours === 'no recent data' ? [] : [`${label}: unknown hours must be "no recent data"`];
  }
  if (hours === '24h') return [];
  if (!hours || hours === 'no recent data' || typeof hours !== 'object' || Array.isArray(hours)) {
    return [`${label}: verified hours need a 24h flag or a day window`];
  }
  const errors = [];
  const keys = Object.keys(hours);
  if (!keys.length) errors.push(`${label}: empty hours are not a schedule`);
  for (const key of keys) {
    if (!DAYS.includes(key)) errors.push(`${label}: bad day ${key}`);
    const span = hours[key];
    if (!Array.isArray(span) || span.length !== 2 || !CLOCK.test(span[0]) || !CLOCK.test(span[1])) {
      errors.push(`${label}: ${key} needs an open and a close as HH:MM`);
    }
  }
  return errors;
}

function validateSources(label, sources) {
  if (!Array.isArray(sources) || sources.length < 2) {
    return [`${label}: needs at least two sources`];
  }
  const errors = [];
  for (const source of sources) {
    if (!source || !Number.isInteger(source.tier) || source.tier < 0 || source.tier > 3) {
      errors.push(`${label}: source tier must be 0, 1, 2, or 3`);
      continue;
    }
    if (typeof source.url !== 'string' || !/^https?:\/\//.test(source.url)) {
      errors.push(`${label}: source url must be http(s)`);
    }
    if (!ISO_DATE.test(source.retrieved_at || '')) errors.push(`${label}: source retrieved_at must be YYYY-MM-DD`);
  }
  return errors;
}

// Agent review, not a merge failure by itself. Tier 4 is Nacho's QA and is not a source.
export function reviewFlags(city) {
  const slug = city?.meta?.slug || 'city';
  const flags = [];
  for (const venue of city?.venues || []) {
    const tiers = new Set((venue.sources || []).map((source) => source && source.tier).filter((tier) => Number.isInteger(tier)));
    if (tiers.size < 2) {
      flags.push(`${slug}: ${venue.id || venue.name}: name and address are not confirmed in two tiers`);
    }
  }
  const venues = city?.venues || [];
  const dance = venues.filter((venue) => venue.category === 'bar' || venue.category === 'club').length;
  const sauna = venues.filter((venue) => venue.category === 'sauna').length;
  const fun = venues.filter((venue) => venue.category === 'cruise' || venue.category === 'sex').length;
  if (dance < 4 || sauna < 2 || fun < 2) {
    flags.push(`${slug}: thin result, dance=${dance} sauna=${sauna} fun=${fun}`);
  }
  return flags;
}

function validatePride(slug, pride) {
  if (!pride || typeof pride !== 'object' || Array.isArray(pride)) return [`${slug}: pride block is required`];
  const errors = [];
  for (const key of Object.keys(pride)) {
    if (!PRIDE_YEARS.includes(key)) errors.push(`${slug}: pride year ${key} is not 2026 or 2027`);
  }
  for (const year of PRIDE_YEARS) {
    if (!(year in pride)) errors.push(`${slug}: pride.${year} is required, or null`);
    const row = pride[year];
    if (row == null) continue;
    if (!row || typeof row !== 'object') {
      errors.push(`${slug}: pride.${year} must be an object or null`);
      continue;
    }
    if (!ISO_DATE.test(row.date || '')) errors.push(`${slug}: pride.${year}.date must be YYYY-MM-DD`);
    if (!row.event_name || typeof row.event_name !== 'string') errors.push(`${slug}: pride.${year}.event_name is required`);
    if (typeof row.source_url !== 'string' || !/^https?:\/\//.test(row.source_url)) {
      errors.push(`${slug}: pride.${year}.source_url must be http(s)`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = new URL('../../data/cities/', import.meta.url);
  const names = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  const errors = [];
  for (const name of names) {
    const city = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    errors.push(...validateCity(city, name));
  }
  if (errors.length) {
    console.error(errors.slice(0, 40).join('\n'));
    console.error(`${errors.length} city schema errors`);
    process.exit(1);
  }
  console.log(`ok ${names.length} city files`);
}
