import { pathToFileURL } from 'node:url';
// Dry-run prints the requests that would be sent and does not call them.
//
// node services/ingestion/enrich.mjs --dry-run "Steamworks" "San Francisco"

const ASPECTS = ['cleanliness', 'safety', 'crowd', 'facilities', 'staff', 'value'];
const DELAY_MS = 1000;
const FSQ_VERSION = '2025-06-17';

const SIGNAL_SHAPE = {
  venue_id: null,
  source_id: null,
  aspect: 'one of cleanliness | safety | crowd | facilities | staff | value',
  sentiment: 'number from -1 to 1',
  evidence_date: null,
  quote: null,
  weight: 1,
  source_url: 'required; dropped when missing',
  retrieved_at: 'ISO time the source was read',
};

let lastRequestAt = 0;

export class RateLimitStop extends Error {
  constructor(source, url) {
    super(`429 from ${source}; stopped`);
    this.name = 'RateLimitStop';
    this.source = source;
    this.url = url;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function keepSignal(signal) {
  if (!signal || typeof signal.source_url !== 'string' || signal.source_url.length === 0) return null;
  if (!signal.retrieved_at) return null;
  if (!ASPECTS.includes(signal.aspect)) return null;
  if (typeof signal.sentiment !== 'number' || signal.sentiment < -1 || signal.sentiment > 1) return null;
  return {
    venue_id: signal.venue_id ?? null,
    source_id: signal.source_id ?? null,
    aspect: signal.aspect,
    sentiment: signal.sentiment,
    evidence_date: signal.evidence_date ?? null,
    quote: signal.quote ?? null,
    weight: typeof signal.weight === 'number' ? signal.weight : 1,
    source_url: signal.source_url,
    retrieved_at: signal.retrieved_at,
  };
}

function notePlan(options, plan) {
  if (options.dryRun) options.plans.push(plan);
}

function noData(source) {
  console.log(`no recent data: ${source}`);
}

function redact(plan) {
  const headers = {};
  for (const [name, value] of Object.entries(plan.headers || {})) {
    if (/authorization/i.test(name)) headers[name] = `Bearer $${plan.env}`;
    else if (/api-key/i.test(name)) headers[name] = `$${plan.env}`;
    else headers[name] = value;
  }
  return {
    source: plan.source,
    method: plan.method,
    url: plan.url,
    headers,
    body: plan.body || null,
    blocked: Boolean(plan.blocked),
    skipped: Boolean(plan.skip),
    note: plan.note || '',
  };
}

async function send(plan, options) {
  if (options.dryRun) {
    notePlan(options, redact(plan));
    return null;
  }
  if (plan.blocked) {
    noData(plan.source);
    return null;
  }
  if (plan.skip) {
    noData(plan.source);
    return null;
  }
  if (!plan.key) {
    noData(plan.source);
    return null;
  }
  const wait = DELAY_MS - (Date.now() - lastRequestAt);
  if (lastRequestAt && wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const response = await fetch(plan.url, {
    method: plan.method,
    headers: plan.headers,
    body: plan.body ? JSON.stringify(plan.body) : undefined,
  });
  if (response.status === 429) throw new RateLimitStop(plan.source, plan.url);
  if (!response.ok) {
    noData(plan.source);
    return null;
  }
  const text = await response.text();
  if (!text.trim()) {
    noData(plan.source);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function authHeader(envName, key) {
  return key ? `Bearer ${key}` : `Bearer $${envName}`;
}

export async function fetchYelp(venue, options = {}) {
  const url = new URL('https://api.yelp.com/v3/businesses/search');
  url.searchParams.set('term', venue.name);
  url.searchParams.set('location', venue.city);
  url.searchParams.set('categories', 'gaybars');
  url.searchParams.set('limit', '5');
  const key = process.env.YELP_API_KEY || '';
  const payload = await send({
    source: 'yelp',
    env: 'YELP_API_KEY',
    method: 'GET',
    url: url.toString(),
    headers: { Authorization: authHeader('YELP_API_KEY', key), Accept: 'application/json' },
    key,
    note: 'Details and reviews are requested only after this search returns a business id.',
  }, options);
  if (!payload || typeof payload !== 'object') return [];
  const signals = [];
  // TODO: map a review to aspect + sentiment without guessing. Hours and price stay out of signals until then.
  // A business url alone is not a signal. Drop anything that cannot fill the table.
  for (const business of payload.businesses || []) {
    const kept = keepSignal({
      aspect: business.aspect,
      sentiment: business.sentiment,
      quote: business.quote,
      source_url: business.url,
      retrieved_at: new Date().toISOString(),
    });
    if (kept) signals.push(kept);
  }
  if (signals.length === 0) noData('yelp');
  return signals;
}

export async function fetchFoursquare(venue, options = {}) {
  const url = new URL('https://places-api.foursquare.com/places/search');
  url.searchParams.set('query', venue.name);
  url.searchParams.set('near', venue.city);
  url.searchParams.set('limit', '5');
  const key = process.env.FOURSQUARE_API_KEY || '';
  const payload = await send({
    source: 'foursquare',
    env: 'FOURSQUARE_API_KEY',
    method: 'GET',
    url: url.toString(),
    headers: {
      Authorization: authHeader('FOURSQUARE_API_KEY', key),
      Accept: 'application/json',
      'X-Places-Api-Version': FSQ_VERSION,
    },
    key,
    note: 'Tips use GET /places/{fsq_place_id}/tips only after search returns an id.',
  }, options);
  if (!payload || typeof payload !== 'object') return [];
  const signals = [];
  const places = payload.results || payload.places || [];
  for (const place of places) {
    const popularity = place.popularity;
    const sourceUrl = place.link || place.website || '';
    if (typeof popularity !== 'number' || popularity < 0 || popularity > 1 || !sourceUrl) continue;
    const kept = keepSignal({
      aspect: 'crowd',
      sentiment: Math.min(1, Math.max(-1, popularity * 2 - 1)),
      source_url: sourceUrl,
      retrieved_at: new Date().toISOString(),
    });
    if (kept) signals.push(kept);
  }
  if (signals.length === 0) noData('foursquare');
  return signals;
}

export async function fetchGooglePlaces(venue, options = {}) {
  const key = process.env.GOOGLE_PLACES_API_KEY || '';
  const payload = await send({
    source: 'google_places',
    env: 'GOOGLE_PLACES_API_KEY',
    method: 'POST',
    url: 'https://places.googleapis.com/v1/places:searchText',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key || '$GOOGLE_PLACES_API_KEY',
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.googleMapsUri',
        'places.rating',
        'places.regularOpeningHours',
        'places.reviews',
        'places.photos',
      ].join(','),
    },
    body: { textQuery: `${venue.name} ${venue.city}`, pageSize: 5 },
    key,
    note: 'Popular Times is not a Places API field and is not requested.',
  }, options);
  if (!payload || typeof payload !== 'object') return [];
  const signals = [];
  // TODO: a review needs an explicit aspect before it can be stored. Do not guess one from the text.
  for (const place of payload.places || []) {
    const kept = keepSignal({
      aspect: place.aspect,
      sentiment: place.sentiment,
      source_url: place.googleMapsUri,
      retrieved_at: new Date().toISOString(),
    });
    if (kept) signals.push(kept);
  }
  if (signals.length === 0) noData('google_places');
  return signals;
}

export async function fetchEventbrite(venue, options = {}) {
  const key = process.env.EVENTBRITE_TOKEN || '';
  const organizationId = process.env.EVENTBRITE_ORGANIZATION_ID || '';
  if (!organizationId) {
    const plan = {
      source: 'eventbrite',
      env: 'EVENTBRITE_TOKEN',
      method: 'GET',
      url: 'https://www.eventbriteapi.com/v3/events/search/',
      headers: { Authorization: authHeader('EVENTBRITE_TOKEN', key) },
      skip: true,
      note: 'Public event search was shut down on 2019-12-12. This URL is not called. City-wide party discovery needs an Eventbrite partner feed.',
    };
    if (options.dryRun) {
      notePlan(options, redact(plan));
      return [];
    }
    noData('eventbrite');
    return [];
  }
  const url = new URL(`https://www.eventbriteapi.com/v3/organizations/${encodeURIComponent(organizationId)}/events/`);
  url.searchParams.set('status', 'live');
  const payload = await send({
    source: 'eventbrite',
    env: 'EVENTBRITE_TOKEN',
    method: 'GET',
    url: url.toString(),
    headers: { Authorization: authHeader('EVENTBRITE_TOKEN', key), Accept: 'application/json' },
    key,
    note: 'Organization events only. Not a city-wide gay-party search. Ticket tiers are read only if the payload includes them and a source url.',
  }, options);
  if (!payload || typeof payload !== 'object') return [];
  const signals = [];
  for (const event of payload.events || []) {
    const kept = keepSignal({
      aspect: event.aspect,
      sentiment: event.sentiment,
      evidence_date: typeof event.start?.local === 'string' ? event.start.local.slice(0, 10) : null,
      quote: event.name?.text || null,
      source_url: event.url,
      retrieved_at: new Date().toISOString(),
    });
    if (kept) signals.push(kept);
  }
  if (signals.length === 0) noData('eventbrite');
  return signals;
}

function pagePlan(source, url, options) {
  const allowed = process.env.SOURCES_TOS_CHECK === '1';
  return {
    source,
    env: 'SOURCES_TOS_CHECK',
    method: 'GET',
    url,
    headers: { Accept: 'text/html' },
    blocked: !allowed,
    key: allowed ? 'tos-checked' : '',
    note: allowed
      ? 'ToS flag is on. HTML is fetched and stored only when a signal has source_url, aspect, and sentiment.'
      : 'SOURCES_TOS_CHECK is off. The page is not requested.',
  };
}

export async function fetchGayCities(venue, options = {}) {
  const url = new URL('https://www.gaycities.com/search/');
  url.searchParams.set('q', `${venue.name} ${venue.city}`);
  const payload = await send(pagePlan('gaycities', url.toString(), options), options);
  if (typeof payload !== 'string' || !payload.trim()) return [];
  // TODO: after ToS review, parse listing urls and quotes. Do not invent a gay-venue claim from a page title.
  noData('gaycities');
  return [];
}

export async function fetchTravelGay(venue, options = {}) {
  const url = new URL('https://www.travelgay.com/');
  url.searchParams.set('s', `${venue.name} ${venue.city}`);
  const payload = await send(pagePlan('travelgay', url.toString(), options), options);
  if (typeof payload !== 'string' || !payload.trim()) return [];
  noData('travelgay');
  return [];
}

export async function enrichVenue(venue, options = {}) {
  const plans = [];
  const run = { ...options, plans };
  const signals = [];
  const sources = [
    fetchYelp,
    fetchFoursquare,
    fetchGooglePlaces,
    fetchEventbrite,
    fetchGayCities,
    fetchTravelGay,
  ];
  let stopped = null;
  for (const fetchSource of sources) {
    if (stopped) break;
    try {
      const found = await fetchSource(venue, run);
      for (const signal of found) {
        const kept = keepSignal(signal);
        if (kept) signals.push(kept);
      }
    } catch (error) {
      if (error instanceof RateLimitStop) {
        stopped = { source: error.source, url: error.url, status: 429 };
        break;
      }
      throw error;
    }
  }
  return {
    venue: { name: venue.name, city: venue.city },
    dry_run: Boolean(options.dryRun),
    tripadvisor: 'MANUAL_ONLY',
    requests: plans,
    signals,
    signal_shape: SIGNAL_SHAPE,
    stopped,
  };
}

function readArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const words = argv.filter((arg) => arg !== '--dry-run');
  const [name, city] = words;
  if (!name || !city) {
    console.error('Usage: node services/ingestion/enrich.mjs --dry-run "Venue name" "City"');
    process.exit(1);
  }
  return { dryRun, venue: { name, city } };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { dryRun, venue } = readArgs(process.argv.slice(2));
  const result = await enrichVenue(venue, { dryRun });
  console.log(JSON.stringify(result, null, 2));
}
