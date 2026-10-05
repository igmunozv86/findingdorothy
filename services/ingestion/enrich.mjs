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
    if (/authorization/i.test(name)) {
      headers[name] = /^basic/i.test(String(value))
        ? `Basic $${plan.env}:$REDDIT_CLIENT_SECRET`
        : `Bearer $${plan.env}`;
    } else if (/api-key/i.test(name)) headers[name] = `$${plan.env}`;
    else headers[name] = value;
  }
  return {
    source: plan.source,
    method: plan.method,
    url: redactUrl(plan.url, plan.env),
    headers,
    body: plan.rawBody || plan.form || plan.body || null,
    blocked: Boolean(plan.blocked),
    skipped: Boolean(plan.skip),
    query_language: plan.queryLanguage || '',
    note: plan.note || '',
  };
}

function redactUrl(url, env) {
  return String(url || '').replace(/([?&](?:apikey|app_id)=)[^&]*/gi, `$1$${env || 'KEY'}`);
}

const responseCache = new Map();
const USER_AGENT = 'FindingDorothy/phase0';

function isBrazil(venue) {
  const city = String(venue.city || '');
  return city === 'São Paulo' || city === 'Sao Paulo' || /brazil|brasil/i.test(city);
}

function searchPhrases(venue) {
  const phrases = [{ lang: 'en', q: `${venue.name} ${venue.city}` }];
  if (isBrazil(venue)) phrases.push({ lang: 'pt', q: `${venue.name} ${venue.city} horários` });
  return phrases;
}

function logQuery(source, phrase) {
  console.error(`query language: ${phrase.lang} — ${source} — ${phrase.q}`);
}

function escapeOverpassRegex(value) {
  return String(value).replace(/["\\]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function overpassQuery(name, bbox, lang) {
  const pattern = escapeOverpassRegex(name);
  const nameKey = lang === 'pt' ? 'name:pt' : 'name:en';
  return `[out:json][timeout:25];
(
  nwr["name"~"${pattern}",i](${bbox});
  nwr["${nameKey}"~"${pattern}",i](${bbox});
);
out tags center;`;
}

async function send(plan, options) {
  if (plan.cacheKey && responseCache.has(plan.cacheKey)) return responseCache.get(plan.cacheKey);
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
    body: plan.form
      ? new URLSearchParams(plan.form).toString()
      : plan.rawBody
        ? plan.rawBody
        : plan.body
          ? JSON.stringify(plan.body)
          : undefined,
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
    const parsed = JSON.parse(text);
    if (plan.cacheKey) responseCache.set(plan.cacheKey, parsed);
    return parsed;
  } catch {
    if (plan.cacheKey) responseCache.set(plan.cacheKey, text);
    return text;
  }
}

function authHeader(envName, key) {
  return key ? `Bearer ${key}` : `Bearer $${envName}`;
}

export async function fetchYelp(venue, options = {}) {
  const key = process.env.YELP_API_KEY || '';
  if (!options.dryRun && !key) {
    noData('yelp');
    return [];
  }
  const signals = [];
  for (const phrase of searchPhrases(venue)) {
    logQuery('yelp', phrase);
    const url = new URL('https://api.yelp.com/v3/businesses/search');
    url.searchParams.set('term', phrase.lang === 'pt' ? `${venue.name} horários` : venue.name);
    url.searchParams.set('location', venue.city);
    url.searchParams.set('locale', phrase.lang === 'pt' ? 'pt_BR' : 'en_US');
    url.searchParams.set('categories', 'gaybars');
    url.searchParams.set('limit', '5');
    const payload = await send({
      source: 'yelp',
      env: 'YELP_API_KEY',
      method: 'GET',
      url: url.toString(),
      headers: { Authorization: authHeader('YELP_API_KEY', key), Accept: 'application/json' },
      key,
      queryLanguage: phrase.lang,
      note: 'Details and reviews are requested only after this search returns a business id.',
    }, options);
    if (!payload || typeof payload !== 'object') continue;
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
  }
  if (!options.dryRun && signals.length === 0) noData('yelp');
  return signals;
}

export async function fetchFoursquare(venue, options = {}) {
  const key = process.env.FOURSQUARE_API_KEY || '';
  if (!options.dryRun && !key) {
    noData('foursquare');
    return [];
  }
  const signals = [];
  for (const phrase of searchPhrases(venue)) {
    logQuery('foursquare', phrase);
    const url = new URL('https://places-api.foursquare.com/places/search');
    url.searchParams.set('query', phrase.lang === 'pt' ? `${venue.name} horários` : venue.name);
    url.searchParams.set('near', venue.city);
    url.searchParams.set('limit', '5');
    const payload = await send({
      source: 'foursquare',
      env: 'FOURSQUARE_API_KEY',
      method: 'GET',
      url: url.toString(),
      headers: {
        Authorization: authHeader('FOURSQUARE_API_KEY', key),
        Accept: 'application/json',
        'Accept-Language': phrase.lang === 'pt' ? 'pt-BR' : 'en',
        'X-Places-Api-Version': FSQ_VERSION,
      },
      key,
      queryLanguage: phrase.lang,
      note: 'Tips use GET /places/{fsq_place_id}/tips only after search returns an id.',
    }, options);
    if (!payload || typeof payload !== 'object') continue;
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
  }
  if (!options.dryRun && signals.length === 0) noData('foursquare');
  return signals;
}

export async function fetchGooglePlaces(venue, options = {}) {
  const key = process.env.GOOGLE_PLACES_API_KEY || '';
  if (!options.dryRun && !key) {
    noData('google_places');
    return [];
  }
  const signals = [];
  for (const phrase of searchPhrases(venue)) {
    logQuery('google_places', phrase);
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
        'Accept-Language': phrase.lang === 'pt' ? 'pt-BR' : 'en',
      },
      body: { textQuery: phrase.q, pageSize: 5, languageCode: phrase.lang === 'pt' ? 'pt-BR' : 'en' },
      key,
      queryLanguage: phrase.lang,
      note: 'Popular Times is not a Places API field and is not requested.',
    }, options);
    if (!payload || typeof payload !== 'object') continue;
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
  }
  if (!options.dryRun && signals.length === 0) noData('google_places');
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

function redditSearchUrl(query) {
  const search = new URL('https://oauth.reddit.com/search');
  search.searchParams.set('q', query);
  search.searchParams.set('type', 'link');
  search.searchParams.set('sort', 'new');
  search.searchParams.set('limit', '5');
  return search;
}

function redditSignals(payload) {
  const signals = [];
  for (const child of payload?.data?.children || []) {
    const post = child.data || {};
    const kept = keepSignal({
      aspect: post.aspect,
      sentiment: post.sentiment,
      quote: post.title || null,
      evidence_date: post.created_utc ? new Date(post.created_utc * 1000).toISOString().slice(0, 10) : null,
      source_url: typeof post.permalink === 'string' ? `https://www.reddit.com${post.permalink}` : '',
      retrieved_at: new Date().toISOString(),
    });
    if (kept) signals.push(kept);
  }
  return signals;
}

export async function fetchReddit(venue, options = {}) {
  const clientId = process.env.REDDIT_CLIENT_ID || '';
  const clientSecret = process.env.REDDIT_CLIENT_SECRET || '';
  const token = await send({
    source: 'reddit',
    env: 'REDDIT_CLIENT_ID',
    method: 'POST',
    url: 'https://www.reddit.com/api/v1/access_token',
    headers: {
      Authorization: clientId ? `Basic ${clientId}:${clientSecret}` : 'Basic $REDDIT_CLIENT_ID:$REDDIT_CLIENT_SECRET',
      'User-Agent': 'FindingDorothy/phase0',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    form: { grant_type: 'client_credentials' },
    key: clientId && clientSecret ? clientId : '',
    note: 'App-only OAuth token. The search call runs only after this returns access_token.',
  }, options);
  const phrases = searchPhrases(venue);
  if (!token || typeof token.access_token !== 'string') {
    if (options.dryRun) {
      for (const phrase of phrases) {
        logQuery('reddit', phrase);
        await send({
          source: 'reddit',
          env: 'REDDIT_ACCESS_TOKEN',
          method: 'GET',
          url: redditSearchUrl(phrase.q).toString(),
          headers: {
            Authorization: 'Bearer $REDDIT_ACCESS_TOKEN',
            'User-Agent': 'FindingDorothy/phase0',
            Accept: 'application/json',
          },
          key: 'dry-run',
          queryLanguage: phrase.lang,
          note: 'Site-wide post search. A post is kept only when it already has aspect, sentiment, and a permalink.',
        }, options);
      }
    }
    return [];
  }
  const signals = [];
  for (const phrase of phrases) {
    logQuery('reddit', phrase);
    const payload = await send({
      source: 'reddit',
      env: 'REDDIT_ACCESS_TOKEN',
      method: 'GET',
      url: redditSearchUrl(phrase.q).toString(),
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'User-Agent': 'FindingDorothy/phase0',
        Accept: 'application/json',
      },
      key: token.access_token,
      queryLanguage: phrase.lang,
      note: 'Site-wide post search. A post is kept only when it already has aspect, sentiment, and a permalink.',
    }, options);
    if (payload && typeof payload === 'object') signals.push(...redditSignals(payload));
  }
  if (signals.length === 0) noData('reddit');
  return signals;
}

export async function fetchForums() {
  // No endpoint covers every forum. Reddit search is the forum API. Other boards are not crawled.
  return [];
}

export async function fetchGayCities(venue, options = {}) {
  if (!options.dryRun && process.env.SOURCES_TOS_CHECK !== '1') {
    noData('gaycities');
    return [];
  }
  for (const phrase of searchPhrases(venue)) {
    logQuery('gaycities', phrase);
    const url = new URL('https://www.gaycities.com/search/');
    url.searchParams.set('q', phrase.q);
    const plan = pagePlan('gaycities', url.toString(), options);
    plan.queryLanguage = phrase.lang;
    const payload = await send(plan, options);
    if (typeof payload !== 'string' || !payload.trim()) continue;
    // TODO: after ToS review, parse listing urls and quotes. Do not invent a gay-venue claim from a page title.
    noData('gaycities');
    return [];
  }
  return [];
}

export async function fetchTravelGay(venue, options = {}) {
  if (!options.dryRun && process.env.SOURCES_TOS_CHECK !== '1') {
    noData('travelgay');
    return [];
  }
  for (const phrase of searchPhrases(venue)) {
    logQuery('travelgay', phrase);
    const url = new URL('https://www.travelgay.com/');
    url.searchParams.set('s', phrase.q);
    const plan = pagePlan('travelgay', url.toString(), options);
    plan.queryLanguage = phrase.lang;
    const payload = await send(plan, options);
    if (typeof payload !== 'string' || !payload.trim()) continue;
    noData('travelgay');
    return [];
  }
  return [];
}

export async function fetchOverpass(venue, options = {}) {
  // Nominatim, then Overpass, each awaited. This source is never run with Promise.all.
  const nominatim = new URL('https://nominatim.openstreetmap.org/search');
  nominatim.searchParams.set('q', venue.city);
  nominatim.searchParams.set('format', 'jsonv2');
  nominatim.searchParams.set('limit', '1');
  logQuery('overpass', { lang: 'en', q: venue.city });
  const places = await send({
    source: 'overpass',
    env: 'NONE',
    method: 'GET',
    url: nominatim.toString(),
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    key: 'public',
    cacheKey: `nominatim:${venue.city}`,
    queryLanguage: 'en',
    note: 'Nominatim city lookup. The Overpass bounding box is this response boundingbox. Coordinates are not hardcoded.',
  }, options);
  const box = Array.isArray(places) ? places[0]?.boundingbox : null;
  let bbox = null;
  if (Array.isArray(box) && box.length === 4) {
    const [south, north, west, east] = box;
    bbox = `${south},${west},${north},${east}`;
  }
  if (!bbox && !options.dryRun) {
    noData('overpass');
    return [];
  }
  const bboxToken = bbox || '{{bbox}}';
  const signals = [];
  for (const phrase of searchPhrases(venue)) {
    logQuery('overpass', phrase);
    const query = overpassQuery(venue.name, bboxToken, phrase.lang);
    const payload = await send({
      source: 'overpass',
      env: 'NONE',
      method: 'POST',
      url: 'https://overpass-api.de/api/interpreter',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      form: { data: query },
      key: 'public',
      cacheKey: `overpass:${query}`,
      queryLanguage: phrase.lang,
      note: 'Single-threaded and cached by query text. opening_hours, address tags, coordinates, and lgbtq/gay tags are read from the element. They are not aspects, so they are not stored as signals.',
    }, options);
    if (!payload || typeof payload !== 'object') continue;
    for (const element of payload.elements || []) {
      const sourceUrl = element.type && element.id
        ? `https://www.openstreetmap.org/${element.type}/${element.id}`
        : '';
      const kept = keepSignal({
        aspect: element.tags?.aspect,
        sentiment: typeof element.tags?.sentiment === 'number' ? element.tags.sentiment : undefined,
        source_url: sourceUrl,
        retrieved_at: new Date().toISOString(),
      });
      if (kept) signals.push(kept);
    }
  }
  if (!options.dryRun && signals.length === 0) noData('overpass');
  return signals;
}

export async function fetchWikidata(venue, options = {}) {
  const signals = [];
  for (const phrase of searchPhrases(venue)) {
    logQuery('wikidata', phrase);
    const url = new URL('https://www.wikidata.org/w/api.php');
    url.searchParams.set('action', 'wbsearchentities');
    url.searchParams.set('search', phrase.q);
    url.searchParams.set('language', phrase.lang);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '5');
    const found = await send({
      source: 'wikidata',
      env: 'NONE',
      method: 'GET',
      url: url.toString(),
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      key: 'public',
      cacheKey: `wikidata:search:${phrase.lang}:${phrase.q}`,
      queryLanguage: phrase.lang,
      note: 'wbgetentities runs only after this search returns a Q-id. Address (P969), coordinates (P625), and inception (P571) are not aspects and are not stored as signals.',
    }, options);
    const ids = (found?.search || []).map((item) => item.id).filter((id) => /^Q\d+$/.test(String(id)));
    if (ids.length === 0) continue;
    const entities = new URL('https://www.wikidata.org/w/api.php');
    entities.searchParams.set('action', 'wbgetentities');
    entities.searchParams.set('ids', ids.join('|'));
    entities.searchParams.set('props', 'claims');
    entities.searchParams.set('format', 'json');
    const payload = await send({
      source: 'wikidata',
      env: 'NONE',
      method: 'GET',
      url: entities.toString(),
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      key: 'public',
      cacheKey: `wikidata:entities:${ids.join('|')}`,
      queryLanguage: phrase.lang,
      note: 'Claims P969, P625, and P571. A signal is kept only when the payload already has aspect, sentiment, and a source url.',
    }, options);
    for (const entity of Object.values(payload?.entities || {})) {
      const kept = keepSignal({
        aspect: entity.aspect,
        sentiment: entity.sentiment,
        source_url: entity.id ? `https://www.wikidata.org/wiki/${entity.id}` : '',
        retrieved_at: new Date().toISOString(),
      });
      if (kept) signals.push(kept);
    }
  }
  if (options.dryRun) {
    notePlan(options, redact({
      source: 'wikidata',
      env: 'NONE',
      method: 'GET',
      url: 'https://www.wikidata.org/w/api.php?action=wbgetentities&ids={Q-id}&props=claims&format=json',
      skip: true,
      note: 'Not called in a dry run. The Q-id comes from wbsearchentities and is not guessed.',
    }));
  }
  if (!options.dryRun && signals.length === 0) noData('wikidata');
  return signals;
}

function locationPhrases(venue) {
  const phrases = [{ lang: 'en', q: venue.city }];
  if (isBrazil(venue)) phrases.push({ lang: 'pt', q: `${venue.city} Brasil` });
  return phrases;
}

function songkickMetroId(payload) {
  const location = payload?.resultsPage?.results?.location;
  const list = Array.isArray(location) ? location : location ? [location] : [];
  for (const item of list) {
    const id = item?.metroArea?.id;
    if (typeof id === 'number' && Number.isInteger(id)) return id;
  }
  return null;
}

export async function fetchSongkick(venue, options = {}) {
  const key = process.env.SONGKICK_API_KEY || '';
  if (!options.dryRun && !key) {
    noData('songkick');
    return [];
  }
  const signals = [];
  for (const phrase of locationPhrases(venue)) {
    logQuery('songkick', phrase);
    const url = new URL('https://api.songkick.com/api/3.0/search/locations.json');
    url.searchParams.set('query', phrase.q);
    url.searchParams.set('apikey', key || '$SONGKICK_API_KEY');
    const payload = await send({
      source: 'songkick',
      env: 'SONGKICK_API_KEY',
      method: 'GET',
      url: url.toString(),
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      key,
      queryLanguage: phrase.lang,
      note: 'Metro calendar is requested only after this location search returns a metro area id.',
    }, options);
    const metroId = songkickMetroId(payload);
    if (metroId == null) continue;
    const calendar = new URL(`https://api.songkick.com/api/3.0/metro_areas/${metroId}/calendar.json`);
    calendar.searchParams.set('apikey', key);
    const events = await send({
      source: 'songkick',
      env: 'SONGKICK_API_KEY',
      method: 'GET',
      url: calendar.toString(),
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      key,
      queryLanguage: phrase.lang,
      note: 'Metro-area calendar. An event is kept only when it already has aspect, sentiment, and a Songkick uri.',
    }, options);
    const eventList = events?.resultsPage?.results?.event;
    const eventsForMetro = Array.isArray(eventList) ? eventList : eventList ? [eventList] : [];
    for (const event of eventsForMetro) {
      const kept = keepSignal({
        aspect: event.aspect,
        sentiment: event.sentiment,
        quote: event.displayName || null,
        evidence_date: event.start?.date || null,
        source_url: event.uri || '',
        retrieved_at: new Date().toISOString(),
      });
      if (kept) signals.push(kept);
    }
  }
  if (options.dryRun) {
    notePlan(options, redact({
      source: 'songkick',
      env: 'SONGKICK_API_KEY',
      method: 'GET',
      url: 'https://api.songkick.com/api/3.0/metro_areas/{metro_area_id}/calendar.json?apikey=$SONGKICK_API_KEY',
      skip: true,
      note: 'Not called in a dry run. metro_area_id comes from the location search and is not guessed.',
    }));
  }
  if (!options.dryRun && signals.length === 0) noData('songkick');
  return signals;
}

export async function fetchTicketmaster(venue, options = {}) {
  const key = process.env.TICKETMASTER_API_KEY || '';
  if (!options.dryRun && !key) {
    noData('ticketmaster');
    return [];
  }
  const signals = [];
  for (const phrase of searchPhrases(venue)) {
    logQuery('ticketmaster', phrase);
    const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
    url.searchParams.set('keyword', phrase.q);
    url.searchParams.set('city', venue.city);
    url.searchParams.set('apikey', key || '$TICKETMASTER_API_KEY');
    const payload = await send({
      source: 'ticketmaster',
      env: 'TICKETMASTER_API_KEY',
      method: 'GET',
      url: url.toString(),
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      key,
      queryLanguage: phrase.lang,
      note: 'Discovery events for this keyword and city. countryCode is omitted. An event is kept only when it already has aspect, sentiment, and a url.',
    }, options);
    for (const event of payload?._embedded?.events || []) {
      const kept = keepSignal({
        aspect: event.aspect,
        sentiment: event.sentiment,
        quote: event.name || null,
        evidence_date: event.dates?.start?.localDate || null,
        source_url: event.url || '',
        retrieved_at: new Date().toISOString(),
      });
      if (kept) signals.push(kept);
    }
  }
  if (!options.dryRun && signals.length === 0) noData('ticketmaster');
  return signals;
}

export async function fetchBandsintown(venue, options = {}) {
  const key = process.env.BANDSINTOWN_API_KEY || '';
  const artist = typeof venue.artist === 'string' ? venue.artist.trim() : '';
  if (!artist) {
    if (options.dryRun) {
      notePlan(options, redact({
        source: 'bandsintown',
        env: 'BANDSINTOWN_API_KEY',
        method: 'GET',
        url: 'https://rest.bandsintown.com/artists/{artist_name}/events/?app_id=$BANDSINTOWN_API_KEY',
        skip: true,
        note: 'The public API lists events for one artist. There is no city calendar. This venue has no artist name, so the URL is not called. City is read from each event venue when an artist is known.',
      }));
    } else {
      noData('bandsintown');
    }
    return [];
  }
  if (!options.dryRun && !key) {
    noData('bandsintown');
    return [];
  }
  logQuery('bandsintown', { lang: 'en', q: artist });
  const url = new URL(`https://rest.bandsintown.com/artists/${encodeURIComponent(artist)}/events/`);
  url.searchParams.set('app_id', key || '$BANDSINTOWN_API_KEY');
  url.searchParams.set('date', 'upcoming');
  const payload = await send({
    source: 'bandsintown',
    env: 'BANDSINTOWN_API_KEY',
    method: 'GET',
    url: url.toString(),
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    key,
    queryLanguage: 'en',
    note: 'Artist events. The city is taken from the event venue. An event is kept only when it already has aspect, sentiment, and a url.',
  }, options);
  const signals = [];
  for (const event of Array.isArray(payload) ? payload : []) {
    const kept = keepSignal({
      aspect: event.aspect,
      sentiment: event.sentiment,
      quote: event.description || event.title || null,
      evidence_date: typeof event.datetime === 'string' ? event.datetime.slice(0, 10) : null,
      source_url: event.url || '',
      retrieved_at: new Date().toISOString(),
    });
    if (kept) signals.push(kept);
  }
  if (!options.dryRun && signals.length === 0) noData('bandsintown');
  return signals;
}

function misterbGuide(venue) {
  if (venue.city === 'São Paulo' || venue.city === 'Sao Paulo') {
    return 'https://www.misterbandb.com/gay-guide/brazil/sao-paulo/';
  }
  return '';
}

export async function fetchMisterbnb(venue, options = {}) {
  const guide = misterbGuide(venue);
  if (!guide) {
    if (options.dryRun) {
      notePlan(options, redact({
        source: 'misterbnb',
        env: 'SOURCES_TOS_CHECK',
        method: 'GET',
        url: 'https://www.misterbandb.com/gay-guide/',
        skip: true,
        note: 'No confirmed city-guide path for this city. The path is not guessed. São Paulo uses https://www.misterbandb.com/gay-guide/brazil/sao-paulo/',
      }));
    } else {
      noData('misterbnb');
    }
    return [];
  }
  if (!options.dryRun && process.env.SOURCES_TOS_CHECK !== '1') {
    noData('misterbnb');
    return [];
  }
  logQuery('misterbnb', { lang: 'en', q: `${venue.name} ${venue.city}` });
  const plan = pagePlan('misterbnb', guide, options);
  plan.queryLanguage = 'en';
  plan.note = `${plan.note} Confirmed São Paulo city guide. Listing text is not turned into a signal without aspect and sentiment.`;
  const payload = await send(plan, options);
  if (typeof payload !== 'string' || !payload.trim()) return [];
  noData('misterbnb');
  return [];
}

export async function fetchResidentAdvisor(_venue, options = {}) {
  if (options.dryRun) {
    notePlan(options, redact({
      source: 'resident_advisor',
      env: 'NONE',
      method: 'NONE',
      url: '',
      skip: true,
      note: 'MANUAL_ONLY. The Resident Advisor API is partner-only. No request is sent. Club nights and DJ lineups are marked for human review.',
    }));
  }
  return [];
}

export async function fetchScruffGrindr(_venue, options = {}) {
  if (options.dryRun) {
    notePlan(options, redact({
      source: 'scruff_grindr',
      env: 'NONE',
      method: 'NONE',
      url: '',
      skip: true,
      note: 'MANUAL_ONLY. Scruff and Grindr expose venues and events inside the apps. There is no public API. No request is sent. Marked for human review.',
    }));
  }
  return [];
}

export async function enrichVenue(venue, options = {}) {
  const plans = [];
  const run = { ...options, plans };
  const signals = [];
  // Awaited one at a time. Overpass is never parallelized.
  const sources = [
    fetchOverpass,
    fetchWikidata,
    fetchYelp,
    fetchFoursquare,
    fetchGooglePlaces,
    fetchEventbrite,
    fetchReddit,
    fetchSongkick,
    fetchTicketmaster,
    fetchBandsintown,
    fetchGayCities,
    fetchTravelGay,
    fetchMisterbnb,
    fetchResidentAdvisor,
    fetchScruffGrindr,
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
    resident_advisor: 'MANUAL_ONLY',
    scruff_grindr: 'MANUAL_ONLY',
    forums: 'NO_UNIVERSAL_API',
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
