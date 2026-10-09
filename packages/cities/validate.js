// Schema for data/cities/<slug>.json. The build calls this and stops on any error.
// venue_count and verified_pct are computed later. They must not be stored.
// Run: node packages/cities/validate.js

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EVENT_TYPES, STORED_CATEGORIES } from './taxonomy.js';

const REGIONS = ['North America', 'Europe', 'Latin America', 'Asia-Pacific', 'Middle East', 'Africa'];
const CATEGORIES = STORED_CATEGORIES;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TZ = /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)+$/;
const VENUE_KEYS = ['id', 'name', 'category', 'neighborhood', 'address', 'lat', 'lon', 'hours', 'hours_verified', 'review_features', 'instagram', 'sources', 'events_url', 'live_counter'];
const MIN_VENUES = 5;
const REPORT_KEYS = ['slug', 'retrieved_at', 'categories', 'anchors'];
const AUDIT_KEYS = ['category', 'queries', 'sources_checked', 'candidates'];
const CANDIDATE_KEYS = ['name', 'kept', 'reason'];
const ANCHOR_KEYS = ['name', 'decision', 'reason', 'source'];

export { REGIONS, CATEGORIES, MIN_VENUES };

export function validateCity(city, filename) {
  const errors = [];
  const slug = String(filename || '').replace(/\.json$/, '');
  if (!city || typeof city !== 'object' || Array.isArray(city)) {
    return [`${slug}: city file must be an object`];
  }
  for (const key of Object.keys(city)) {
    if (key !== 'meta' && key !== 'venues' && key !== 'events') {
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

  errors.push(...validateEvents(slug, city.events));
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
    errors.push(`${label}: verified hours need a tier 3 source, the venue's own site, Instagram, or Facebook page`);
  }
  return errors;
}

function validateHours(label, hours, verified) {
  if (hours === 'no recent data') return verified ? [`${label}: verified hours need a 24h flag or a day window`] : [];
  if (hours === '24h') return verified ? [] : [`${label}: 24h hours must be verified`];
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) {
    return [`${label}: hours must be "no recent data", "24h", or a day window`];
  }
  const errors = [];
  const keys = Object.keys(hours);
  if (!keys.length) errors.push(`${label}: empty hours are not a schedule`);
  for (const key of keys) {
    if (!DAYS.includes(key)) errors.push(`${label}: bad day ${key}`);
    const span = hours[key];
    const openOnly = Array.isArray(span) && span.length === 1 && CLOCK.test(span[0]);
    const full = Array.isArray(span) && span.length === 2 && CLOCK.test(span[0]) && CLOCK.test(span[1]);
    if (verified && !full) errors.push(`${label}: ${key} needs an open and a close as HH:MM`);
    else if (!verified && !openOnly && !full) errors.push(`${label}: ${key} needs an open time, or an open and a close, as HH:MM`);
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
// A city under half verified hours is a backfill flag. It prints before merge.
export function reviewFlags(city) {
  const slug = city?.meta?.slug || 'city';
  const flags = [];
  const venues = city?.venues || [];
  for (const venue of venues) {
    const tiers = new Set((venue.sources || []).map((source) => source && source.tier).filter((tier) => Number.isInteger(tier)));
    if (tiers.size < 2) {
      flags.push(`${slug}: ${venue.id || venue.name}: name and address are not confirmed in two tiers`);
    }
  }
  const dance = venues.filter((venue) => venue.category === 'bar' || venue.category === 'club').length;
  const sauna = venues.filter((venue) => venue.category === 'sauna').length;
  const fun = venues.filter((venue) => venue.category === 'cruise' || venue.category === 'sex').length;
  if (dance < 4 || sauna < 2 || fun < 2) {
    flags.push(`${slug}: thin result, dance=${dance} sauna=${sauna} fun=${fun}`);
  }
  const verified = venues.filter((venue) => venue.hours_verified === true).length;
  if (venues.length && verified * 2 < venues.length) {
    flags.push(`${slug}: ${verified} of ${venues.length} venues have verified hours — run the hours backfill before merge`);
  }
  return flags;
}

// Merge gate on top of the schema. The build keeps using validateCity so a city
// already published under this floor stays on the page until its worker replaces it.
// A new or refreshed file with fewer than 5 venues must not merge.
export function completenessErrors(city, filename) {
  const slug = String(filename || city?.meta?.slug || 'city').replace(/\.json$/, '');
  const count = Array.isArray(city?.venues) ? city.venues.length : 0;
  if (count < MIN_VENUES) {
    return [`${slug}: ${count} venues — a city file with fewer than ${MIN_VENUES} venues fails validation`];
  }
  return [];
}

function httpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

// Worker audit. One file per city at data/staging/reports/<slug>.json.
// Every stored category needs the queries that were run and the pages that were opened.
export function validateReport(report, city) {
  const slug = city?.meta?.slug || 'city';
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return [`${slug}: research report is required at data/staging/reports/${slug}.json`];
  }
  const errors = [];
  for (const key of Object.keys(report)) {
    if (!REPORT_KEYS.includes(key)) errors.push(`${slug}: report field ${key} is unknown`);
  }
  if (report.slug !== slug) errors.push(`${slug}: report slug must match the city`);
  if (!ISO_DATE.test(report.retrieved_at || '')) errors.push(`${slug}: report retrieved_at must be YYYY-MM-DD`);
  const audits = Array.isArray(report.categories) ? report.categories : null;
  if (!audits) {
    errors.push(`${slug}: report categories must cover ${CATEGORIES.join(', ')}`);
  } else {
    const seen = new Set();
    for (const audit of audits) {
      if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
        errors.push(`${slug}: each category audit must be an object`);
        continue;
      }
      for (const key of Object.keys(audit)) {
        if (!AUDIT_KEYS.includes(key)) errors.push(`${slug}: category audit field ${key} is unknown`);
      }
      if (!CATEGORIES.includes(audit.category)) {
        errors.push(`${slug}: category audit must be one of ${CATEGORIES.join(', ')}`);
        continue;
      }
      if (seen.has(audit.category)) errors.push(`${slug}: duplicate category audit ${audit.category}`);
      seen.add(audit.category);
      const label = `${slug}: ${audit.category}`;
      if (!Array.isArray(audit.queries) || !audit.queries.length || audit.queries.some((query) => typeof query !== 'string' || !query.trim())) {
        errors.push(`${label}: queries must list the searches that were run`);
      }
      if (!Array.isArray(audit.sources_checked) || !audit.sources_checked.length || audit.sources_checked.some((url) => !httpUrl(url))) {
        errors.push(`${label}: sources_checked must list the pages that were opened`);
      }
      if (!Array.isArray(audit.candidates)) {
        errors.push(`${label}: candidates must be an array, empty only after the queries were run`);
        continue;
      }
      for (const candidate of audit.candidates) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
          errors.push(`${label}: each candidate must be an object`);
          continue;
        }
        for (const key of Object.keys(candidate)) {
          if (!CANDIDATE_KEYS.includes(key)) errors.push(`${label}: candidate field ${key} is unknown`);
        }
        if (!candidate.name || typeof candidate.name !== 'string') errors.push(`${label}: candidate name is required`);
        if (candidate.kept !== true && candidate.kept !== false) errors.push(`${label}: ${candidate.name || 'candidate'} kept must be true or false`);
        if (!candidate.reason || typeof candidate.reason !== 'string' || !candidate.reason.trim()) {
          errors.push(`${label}: ${candidate.name || 'candidate'} needs a reason for kept or dropped`);
        }
        if (candidate.kept === true) {
          const names = (city?.venues || []).map((venue) => String(venue.name || '').trim().toLowerCase());
          if (!names.includes(String(candidate.name).trim().toLowerCase())) {
            errors.push(`${label}: kept ${candidate.name} is not in the city file`);
          }
        }
      }
    }
    for (const category of CATEGORIES) {
      if (!seen.has(category)) errors.push(`${slug}: missing category audit for ${category}`);
    }
  }
  const anchors = Array.isArray(report.anchors) ? report.anchors : null;
  if (!anchors || anchors.length < 2 || anchors.length > 3) {
    errors.push(`${slug}: anchors must name 2 or 3 venues a local guide would list first`);
  } else {
    for (const anchor of anchors) {
      if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) {
        errors.push(`${slug}: each anchor must be an object`);
        continue;
      }
      for (const key of Object.keys(anchor)) {
        if (!ANCHOR_KEYS.includes(key)) errors.push(`${slug}: anchor field ${key} is unknown`);
      }
      if (!anchor.name || typeof anchor.name !== 'string') errors.push(`${slug}: anchor name is required`);
      if (anchor.decision !== 'included' && anchor.decision !== 'ruled_out') {
        errors.push(`${slug}: ${anchor.name || 'anchor'} decision must be included or ruled_out`);
      }
      if (!anchor.reason || typeof anchor.reason !== 'string' || !anchor.reason.trim()) {
        errors.push(`${slug}: ${anchor.name || 'anchor'} needs a reason`);
      }
      if (anchor.decision === 'ruled_out' && !httpUrl(anchor.source)) {
        errors.push(`${slug}: ${anchor.name || 'anchor'} ruled out needs a source url`);
      }
      if (anchor.decision === 'included') {
        const names = (city?.venues || []).map((venue) => String(venue.name || '').trim().toLowerCase());
        if (!names.includes(String(anchor.name || '').trim().toLowerCase())) {
          errors.push(`${slug}: anchor ${anchor.name} is marked included but is not in the city file`);
        }
      }
    }
  }
  return errors;
}

export function validateForMerge(city, filename, report) {
  return [
    ...validateCity(city, filename),
    ...completenessErrors(city, filename),
    ...validateReport(report, city),
  ];
}

export function loadReport(slug) {
  const url = new URL(`../../data/staging/reports/${slug}.json`, import.meta.url);
  if (!existsSync(url)) return null;
  return JSON.parse(readFileSync(url, 'utf8'));
}

const EVENT_KEYS = ['name', 'type', 'start', 'end', 'source'];

function validateEvents(slug, events) {
  if (!Array.isArray(events)) return [`${slug}: events must be an array`];
  const errors = [];
  events.forEach((event, index) => {
    const label = `${slug}: events[${index}]`;
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      errors.push(`${label} must be an object`);
      return;
    }
    for (const key of Object.keys(event)) {
      if (!EVENT_KEYS.includes(key)) errors.push(`${label}: unknown field ${key}`);
    }
    if (!event.name || typeof event.name !== 'string') errors.push(`${label}: name is required`);
    if (!EVENT_TYPES.includes(event.type)) errors.push(`${label}: type must be pride`);
    if (!ISO_DATE.test(event.start || '')) errors.push(`${label}: start must be YYYY-MM-DD`);
    if (!ISO_DATE.test(event.end || '')) errors.push(`${label}: end must be YYYY-MM-DD`);
    if (ISO_DATE.test(event.start || '') && ISO_DATE.test(event.end || '') && event.end < event.start) {
      errors.push(`${label}: end is before start`);
    }
    if (typeof event.source !== 'string' || !/^https?:\/\//.test(event.source)) {
      errors.push(`${label}: source must be the organizer http(s) page`);
    }
  });
  return errors;
}

function assertResearchGate() {
  const thin = completenessErrors({ meta: { slug: 'tokyo' }, venues: [{ name: 'Only' }] }, 'tokyo.json');
  if (!thin.some((error) => error.includes('fewer than 5'))) {
    throw new Error('a city under 5 venues must fail the merge gate');
  }
  const missing = validateReport(null, { meta: { slug: 'tokyo' } });
  if (!missing.length) throw new Error('a missing research report must fail the merge gate');
  const half = reviewFlags({
    meta: { slug: 'sample' },
    venues: [
      { name: 'A', category: 'bar', hours_verified: true, sources: [{ tier: 0 }, { tier: 3 }] },
      { name: 'B', category: 'sauna', hours_verified: false, sources: [{ tier: 0 }, { tier: 3 }] },
      { name: 'C', category: 'cruise', hours_verified: false, sources: [{ tier: 0 }, { tier: 3 }] },
    ],
  });
  if (!half.some((flag) => flag.includes('hours backfill before merge'))) {
    throw new Error('under half verified hours must flag the backfill before merge');
  }
  const even = reviewFlags({
    meta: { slug: 'sample' },
    venues: [
      { name: 'A', category: 'bar', hours_verified: true, sources: [{ tier: 0 }, { tier: 3 }] },
      { name: 'B', category: 'sauna', hours_verified: true, sources: [{ tier: 0 }, { tier: 3 }] },
    ],
  });
  if (even.some((flag) => flag.includes('hours backfill'))) {
    throw new Error('exactly half verified hours is not under the backfill line');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertResearchGate();
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
  console.log('research gate rejects fewer than 5 venues, a missing audit, and flags the hours backfill');
}
