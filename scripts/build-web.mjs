// scripts/build-web.mjs
// Phase 0: score every venue for right now and write one standalone page.
// Run: node scripts/build-web.mjs
// A city is one file in data/cities/<slug>.json. The template reads that file only.
// A fresh live reading replaces the signal line with the count.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { periodLabel, placeStatus, zonedNow } from '../packages/forecast/open.js';
import { assembleForecast, dayScore, isShutdown, loadForecastInputs } from '../packages/forecast/assemble.js';
import { freshOccupancy, signalMarkup } from '../packages/forecast/live.js';
import { fetchWeather } from '../packages/forecast/weather.js';
import { loadCities } from '../packages/cities/load.js';

function publicAuthConfig() {
  let file = {};
  const path = new URL('../data/auth.json', import.meta.url);
  if (existsSync(path)) {
    try { file = JSON.parse(readFileSync(path, 'utf8')); } catch { file = {}; }
  }
  return {
    url: process.env.SUPABASE_URL || file.url || '',
    anon: process.env.SUPABASE_ANON_KEY || file.anon || '',
    google: process.env.GOOGLE_CLIENT_ID || file.googleClientId || '',
    apple: process.env.APPLE_CLIENT_ID || file.appleClientId || '',
  };
}

const AUTH = publicAuthConfig();
const CITIES = loadCities(new URL('../data/cities/', import.meta.url));
const LIVE = CITIES.filter((city) => city.live);

function allVenues() {
  return CITIES.flatMap((city) => city.venues);
}

const GROUPS = [
  { id: 'dance', title: 'Dance and drinks', categories: ['bar', 'club'], icon: 'music' },
  { id: 'sauna', title: 'Saunas', categories: ['sauna'], icon: 'sauna' },
  { id: 'fun', title: 'Cruisy', categories: ['sex', 'cruise'], icon: 'fire' },
];

const SCENES = [
  { id: 'dance', name: 'Dance and drinks', copy: 'Bars and clubs — which nights they peak, and how packed they get.' },
  { id: 'sauna', name: 'Saunas', copy: 'Hours, and when the steam is up.' },
  { id: 'fun', name: 'Cruisy', copy: 'Cruise bars and sex clubs, mapped honestly.' },
];

const weatherByCity = {};

const RAIN_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.4 15h11.3a3.5 3.5 0 0 0 .4-7 5.1 5.1 0 0 0-9.9-1.2A4 4 0 0 0 6.4 15z"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M8.2 17.2v2.3M12 17.2v3.1M15.8 17.2v2.3"/></svg>`;
const SNOW_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.4 14h11.3a3.5 3.5 0 0 0 .4-7 5.1 5.1 0 0 0-9.9-1.2A4 4 0 0 0 6.4 14z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M8 16.6v2.2M7 17.7h2M12 17v2.4M10.8 18.2h2.4M16 16.6v2.2M15 17.7h2"/></svg>`;

const FLAGS = {
  USA: '🇺🇸',
  Spain: '🇪🇸',
  Portugal: '🇵🇹',
  France: '🇫🇷',
  Germany: '🇩🇪',
  UK: '🇬🇧',
  Netherlands: '🇳🇱',
  Italy: '🇮🇹',
  Chile: '🇨🇱',
  Brazil: '🇧🇷',
  Argentina: '🇦🇷',
  Colombia: '🇨🇴',
  Peru: '🇵🇪',
  Uruguay: '🇺🇾',
  Mexico: '🇲🇽',
  Canada: '🇨🇦',
  Australia: '🇦🇺',
  Thailand: '🇹🇭',
  Taiwan: '🇹🇼',
  Japan: '🇯🇵',
  'Hong Kong': '🇭🇰',
  Israel: '🇮🇱',
  'South Africa': '🇿🇦',
};

function placeLabel(city) {
  return `${city.name}, ${city.country}`;
}

function flagHtml(country) {
  const flag = FLAGS[country];
  if (!flag) return '';
  return `<span class="flag" aria-hidden="true">${flag}</span>`;
}

function tempLabel(tempC) {
  if (!Number.isFinite(tempC)) return '';
  const c = Math.round(tempC);
  const f = Math.round((tempC * 9) / 5 + 32);
  return `${c}°C / ${f}°F`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function scoreVenue(v, when) {
  const city = CITIES.find((item) => item.name === v.city);
  const eventsFile = eventsFor(city?.tz);
  const event = eventsFile && eventsFile[v.id];
  return assembleForecast(v, when, {
    weather: weatherByCity[v.city] || null,
    liveCount: liveByVenue.get(v.id) || null,
    eventsFile,
    eventTonight: Boolean(event?.event_tonight),
    eventName: event?.event_name || null,
    cells: forecastInputs.cells,
    weights: forecastInputs.weights,
    onPredict: recordPrediction,
  });
}

const WEEK = [
  { dow: 1, label: 'Mon' },
  { dow: 2, label: 'Tue' },
  { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' },
  { dow: 5, label: 'Fri' },
  { dow: 6, label: 'Sat' },
  { dow: 0, label: 'Sun' },
];

function scoreForDow(v, day) {
  return dayScore(v, day, forecastInputs.cells);
}

function weekHtml(v, when, shut) {
  const days = WEEK.map((day) => ({ ...day, score: scoreForDow(v, day.dow) }));
  const peak = Math.max(...days.map((day) => day.score));
  const cols = days.map((day) => {
    const height = Math.max(8, Math.min(100, day.score));
    const opacity = day.score === peak ? 1 : 0.4;
    const today = day.dow === when.weekday ? ' is-today' : '';
    const peakClass = day.score === peak ? ' is-peak' : '';
    return `<div class="week-col${today}${peakClass}"><div class="week-track"><span style="height:${height}%;opacity:${opacity}"></span></div><small>${day.label}</small></div>`;
  }).join('');
  const tone = shut ? ' is-shut' : '';
  return `          <p class="week-label">This week</p>
          <div class="week${tone}" role="img" aria-label="Expected busyness Monday through Sunday">
            ${cols}
          </div>`;
}

const ICONS = {
  music: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><ellipse cx="7.4" cy="17.4" rx="2.8" ry="2.15" transform="rotate(-18 7.4 17.4)"/><ellipse cx="16.6" cy="15.3" rx="2.8" ry="2.15" transform="rotate(-18 16.6 15.3)"/><path d="M9.7 5.1v11.2M18.9 3.1v11.1M9.7 5.1 18.9 3.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square"/></svg>`,
  sauna: `<svg viewBox="0 0 248.914 248.914" fill="currentColor" aria-hidden="true"><path d="M185.05,137.067c0.905,0.784,2.016,1.167,3.127,1.167c1.335,0,2.669-0.561,3.612-1.643c0.737-0.859,17.978-21.112,4.909-37.563c-7.257-9.126-1.899-14.433-0.728-15.422c2.035-1.647,2.361-4.63,0.728-6.681c-1.643-2.067-4.662-2.403-6.72-0.758c-5.013,3.991-11.621,15.145-0.766,28.808c8.139,10.242-4.527,25.214-4.648,25.359C182.838,132.321,183.052,135.341,185.05,137.067z"/><path d="M226.381,130.328c-1.727,1.993-1.512,5.013,0.485,6.739c0.905,0.784,2.017,1.167,3.127,1.167c1.335,0,2.67-0.561,3.612-1.643c0.738-0.859,17.979-21.112,4.91-37.563c-7.258-9.126-1.899-14.433-0.729-15.422c2.035-1.647,2.362-4.63,0.729-6.681c-1.643-2.067-4.662-2.403-6.721-0.758c-5.013,3.991-11.621,15.145-0.766,28.808C239.169,115.216,226.503,130.184,226.381,130.328z"/><path d="M55.165,76.162c-2.065-1.641-5.076-1.305-6.721,0.758c-1.634,2.051-1.305,5.034,0.716,6.681c1.176,0.989,6.524,6.293-0.716,15.422c-13.065,16.456,4.163,36.709,4.907,37.559c0.943,1.092,2.28,1.652,3.615,1.652c1.108,0,2.221-0.393,3.125-1.167c1.998-1.731,2.212-4.751,0.488-6.744c-0.128-0.145-12.788-15.116-4.651-25.358C66.776,91.307,60.168,80.152,55.165,76.162z"/><path d="M11.535,136.592c0.943,1.092,2.28,1.643,3.615,1.643c1.108,0,2.221-0.383,3.125-1.167c1.998-1.727,2.212-4.746,0.488-6.739c-0.128-0.145-12.788-15.117-4.651-25.358c10.849-13.663,4.24-24.817-0.763-28.808c-2.065-1.641-5.075-1.305-6.721,0.758c-1.633,2.051-1.304,5.034,0.717,6.681c1.176,0.989,6.524,6.296-0.717,15.422C-6.443,115.479,10.79,135.732,11.535,136.592z"/><circle cx="124.165" cy="56.452" r="24.468"/><path d="M14.337,194.454h72.188c5.276,0,9.558-4.284,9.558-9.559v-11.71v-6.356c0-0.145,0.037-0.275,0.037-0.42c-0.028-7.892,6.394-14.313,14.3-14.313c6.55,0,12.031,4.452,13.74,10.463c1.696-6.011,7.18-10.463,13.742-10.463c7.893,0,14.314,6.422,14.328,14.313c-0.032,0.145,0.01,0.275,0.01,0.42v6.356v11.71c0,5.274,4.274,9.559,9.558,9.559h72.778c7.925,0,14.338-6.272,14.338-14.021c0-7.747-6.413-14.024-14.338-14.024h-54.623c2.212-2.739,2.847-6.585,1.27-9.997l-25.688-55.557c-0.438-0.938-1.036-1.736-1.699-2.457c-2.623-9.29-11.92-13.581-23.083-13.581h-13.189c-10.79,0-19.81,4.042-22.766,12.701c-1.076,0.884-1.988,1.988-2.616,3.337l-25.688,55.557c-1.575,3.412-0.94,7.258,1.271,9.997H14.337C6.422,166.409,0,172.687,0,180.434C0,188.182,6.422,194.454,14.337,194.454z M154.648,162.904v-18.416l9.227,19.942c0.331,0.732,0.803,1.372,1.288,1.979h-10.818C154.518,165.266,154.648,164.1,154.648,162.904z M83.849,164.431l9.819-21.24v19.714c0,1.195,0.131,2.361,0.306,3.505H82.549C83.046,165.803,83.503,165.163,83.849,164.431z"/><path d="M100.867,166.461v40.911c0,5.274,4.277,9.559,9.558,9.559c5.276,0,9.558-4.284,9.558-9.559v-40.911c0-5.283-4.282-9.559-9.558-9.559C105.14,156.902,100.867,161.178,100.867,166.461z"/><path d="M128.347,166.461v40.911c0,5.274,4.277,9.559,9.556,9.559c5.279,0,9.559-4.284,9.559-9.559v-40.911c0-5.283-4.279-9.559-9.559-9.559C132.619,156.902,128.347,161.178,128.347,166.461z"/></svg>`,
  fire: `<svg viewBox="0 0 92.27 122.88" aria-hidden="true"><path fill="#EC6F59" d="M18.61,54.89C15.7,28.8,30.94,10.45,59.52,0C42.02,22.71,74.44,47.31,76.23,70.89c4.19-7.15,6.57-16.69,7.04-29.45c21.43,33.62,3.66,88.57-43.5,80.67c-4.33-0.72-8.5-2.09-12.3-4.13C10.27,108.8,0,88.79,0,69.68C0,57.5,5.21,46.63,11.95,37.99C12.85,46.45,14.77,52.76,18.61,54.89z"/><path fill="#FAD15C" d="M33.87,92.58c-4.86-12.55-4.19-32.82,9.42-39.93c0.1,23.3,23.05,26.27,18.8,51.14c3.92-4.44,5.9-11.54,6.25-17.15c6.22,14.24,1.34,25.63-7.53,31.43c-26.97,17.64-50.19-18.12-34.75-37.72C26.53,84.73,31.89,91.49,33.87,92.58z"/></svg>`,
};

function groupIcon(group) {
  const svg = ICONS[group.icon];
  if (!svg) return '';
  return `<span class="group-icon ${escapeHtml(group.id)}" role="img" aria-hidden="true">${svg}</span>`;
}

function mapLinks(v, when) {
  const status = placeStatus(v.hours, when);
  const hours = `          <p class="hours ${status.open ? 'open' : 'closed'}">${escapeHtml(status.text)}</p>`;
  if (!v.address) return hours;
  const query = encodeURIComponent(`${v.name} ${v.address}`);
  const google = `https://www.google.com/maps/search/?api=1&query=${query}`;
  const apple = `https://maps.apple.com/?q=${query}`;
  return `          <p class="address">${escapeHtml(v.address)}</p>
${hours}
          <p class="maps">
            <a href="${google}" target="_blank" rel="noopener noreferrer">Google Maps</a>
            <a href="${apple}" target="_blank" rel="noopener noreferrer">Apple Maps</a>
          </p>`;
}

function loadLiveByVenue(nowMs) {
  try {
    const raw = JSON.parse(readFileSync(new URL('../data/live-occupancy.json', import.meta.url), 'utf8'));
    const rows = Array.isArray(raw) ? raw : Object.values(raw);
    const live = new Map();
    for (const row of rows) {
      const fresh = freshOccupancy(row, nowMs);
      if (fresh) live.set(fresh.venueId, fresh);
    }
    return live;
  } catch {
    return new Map();
  }
}

const liveByVenue = loadLiveByVenue(Date.now());
const forecastInputs = loadForecastInputs(import.meta.url);
const eventsCache = new Map();
const predicted = new Set();

function localDateKey(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function eventsFor(timeZone) {
  const dateKey = localDateKey(timeZone || 'UTC');
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

function recordPrediction(row) {
  if (!row.venue_id || predicted.has(row.venue_id)) return;
  predicted.add(row.venue_id);
  appendFileSync(new URL('../data/forecast/predictions.log', import.meta.url), `${JSON.stringify(row)}\n`);
}

function cardHtml(v, when, basic) {
  const { percent, confidence, status } = scoreVenue(v, when);
  const width = Math.max(0, Math.min(100, percent));
  const scoreText = `${percent}%`;
  const closingSoon = !basic && status.minutesLeft != null && status.minutesLeft <= 60;
  const quiet = basic || closingSoon;
  const hot = !quiet && confidence !== 'low' && percent >= 80 ? `<span class="hot">Hot</span>` : '';
  const tag = basic
    ? `<span class="badge closed">Closed</span>`
    : closingSoon
      ? `<span class="badge closing">Closing Soon</span>`
      : `<span class="badge ${escapeHtml(confidence)}">${escapeHtml(confidence)}</span>`;
  const hoursTag = status.unconfirmed
    ? `<span class="badge unconfirmed">Hours not confirmed</span>`
    : '';
  const features = (v.review_features || []).map((d) => `<li>${escapeHtml(d)}</li>`).join('');
  const reviews = features
    ? `          <p class="reviews-label">From reviews</p>
          <ul class="features">${features}</ul>`
    : '';
  const live = quiet ? null : (liveByVenue.get(v.id) || null);
  const meter = quiet
    ? ''
    : `
          <div class="meter">
            <div class="meter-head">
              <p class="meter-title">Expected busyness right now</p>
              <p class="score">${escapeHtml(scoreText)}</p>
            </div>
            <div class="bar" role="img" aria-label="Expected busyness ${escapeHtml(scoreText)}, from quiet to packed">
              <span style="width:${width}%"></span>
            </div>
            <div class="meter-scale"><span>Quiet</span><span>Packed</span></div>
            ${signalMarkup(confidence === 'low' ? 'Pattern, not a live count' : 'Live signals in', live)}
          </div>`;

  return `        <article class="card" id="venue-${escapeHtml(v.id)}">
          <div class="card-top">
            <h4>${escapeHtml(v.name)}</h4>
            <span class="card-pills">${hot}${tag}${hoursTag}</span>
          </div>
          <p class="neighborhood">${escapeHtml(v.neighborhood)}</p>
${mapLinks(v, when)}${meter}
${weekHtml(v, when, basic || closingSoon)}
${reviews}
        </article>`;
}

function previewHtml() {
  let best = null;
  for (const city of LIVE) {
    const when = zonedNow(new Date(), city.tz);
    for (const venue of allVenues()) {
      if (venue.city !== city.name || isShutdown(venue)) continue;
      const forecast = scoreVenue(venue, when);
      if (
        !best
        || forecast.percent > best.forecast.percent
        || (forecast.percent === best.forecast.percent && venue.name.localeCompare(best.venue.name) < 0)
      ) {
        best = { venue, forecast };
      }
    }
  }
  if (!best) return '';
  const { venue, forecast } = best;
  const width = Math.max(0, Math.min(100, forecast.percent));
  const scoreText = `${forecast.percent}%`;
  const place = venue.neighborhood
    ? `<p class="hero-preview-place">${escapeHtml(venue.neighborhood)}</p>`
    : '';
  return `      <div class="hero-preview">
        <p class="hero-preview-kicker">Scene Forecast</p>
        <p class="hero-preview-name">${escapeHtml(venue.name)}</p>
        ${place}
        <div class="hero-preview-meter">
          <div class="bar" role="img" aria-label="Expected busyness ${escapeHtml(scoreText)}"><span style="width:${width}%"></span></div>
          <p class="hero-preview-score">${escapeHtml(scoreText)}</p>
        </div>
      </div>`;
}

function isClosingSoon(forecast) {
  const { status } = forecast;
  return Boolean(status.open) && !status.unconfirmed && status.minutesLeft != null && status.minutesLeft <= 60;
}

function groupHtml(group, venues, when, cityId) {
  const operating = venues.filter((venue) => !isShutdown(venue));
  const scored = operating.map((venue) => ({ venue, forecast: scoreVenue(venue, when) }));
  const byScore = (a, b) => b.forecast.percent - a.forecast.percent || a.venue.name.localeCompare(b.venue.name);
  const byName = (a, b) => a.venue.name.localeCompare(b.venue.name);
  const ranked = scored
    .filter(({ forecast }) => forecast.status.open && !forecast.status.unconfirmed && !isClosingSoon(forecast))
    .sort(byScore);
  const unconfirmed = scored
    .filter(({ forecast }) => forecast.status.unconfirmed)
    .sort(byName);
  const closing = scored
    .filter(({ forecast }) => isClosingSoon(forecast))
    .sort((a, b) => a.forecast.status.minutesLeft - b.forecast.status.minutesLeft || byName(a, b));
  const shut = scored
    .filter(({ forecast }) => !forecast.status.open)
    .sort(byName);
  const gone = venues.filter((venue) => isShutdown(venue));
  const cards = [
    ...ranked.map(({ venue }) => cardHtml(venue, when, false)),
    ...unconfirmed.map(({ venue }) => cardHtml(venue, when, false)),
    ...closing.map(({ venue }) => cardHtml(venue, when, false)),
    ...shut.map(({ venue }) => cardHtml(venue, when, true)),
  ];
  const empty = venues.length ? 'Nothing open right now.' : 'Nothing listed here yet.';
  const body = cards.length
    ? `<div class="cards">\n${cards.join('\n')}\n        </div>`
    : `<p class="empty">${empty}</p>`;
  const aside = gone.length
    ? `\n        <p class="aside">Removed — out of business: ${escapeHtml(gone.map((venue) => venue.name).join(', '))}.</p>`
    : '';
  return `      <section class="group" id="group-${escapeHtml(cityId)}-${escapeHtml(group.id)}">
        <h3>${groupIcon(group)}${escapeHtml(group.title)}</h3>
        ${body}${aside}
      </section>`;
}

function scenesHtml() {
  const cards = SCENES.map((scene) => {
    const group = GROUPS.find((item) => item.id === scene.id);
    return `          <button type="button" class="scene-card" data-group="${escapeHtml(scene.id)}">
            <span class="scene-mark">${groupIcon(group)}</span>
            <span>
              <span class="scene-name">${escapeHtml(scene.name)}</span>
              <span class="scene-copy">${escapeHtml(scene.copy)}</span>
            </span>
          </button>`;
  }).join('\n');
  return `    <section class="scenes" aria-labelledby="scenes-title">
      <div class="scenes-inner">
        <h2 id="scenes-title">Every city, three scenes</h2>
        <div class="scene-grid">
${cards}
        </div>
      </div>
    </section>`;
}

function sectionMenu(cityId) {
  const items = GROUPS.map((group) => `        <button type="button" data-jump="group-${escapeHtml(cityId)}-${escapeHtml(group.id)}">${escapeHtml(group.title)}</button>`).join('\n');
  return `      <nav class="jump-menu" id="jump-menu-${escapeHtml(cityId)}" aria-label="Jump to a section">
${items}
      </nav>`;
}

function cityPageHtml(city) {
  const when = zonedNow(new Date(), city.tz);
  const venues = city.venues;
  const groups = GROUPS.map((group) => {
    const inGroup = venues.filter((v) => group.categories.includes(v.category));
    return groupHtml(group, inGroup, when, city.id);
  }).join('\n');
  const report = weatherByCity[city.name];
  const temp = report ? tempLabel(report.tempC) : '';
  const rainLabel = report?.raining ? 'Raining' : 'Rain likely';

  return `  <main class="view" id="${escapeHtml(city.id)}" hidden>
    <section class="city-hero block">
      <p class="back"><a href="#home">Home</a></p>
${prideBanners(city)}
      <p class="eyebrow" data-period>${escapeHtml(periodLabel(when.hour))}</p>
      <h1>${escapeHtml(placeLabel(city))}</h1>
      <p class="lede">${flagHtml(city.country)}<span data-date>${escapeHtml(when.dateLabel)}</span></p>
      <p class="now-line" data-weather data-lat="${city.lat}" data-lon="${city.lon}">
        <span class="now-time" data-clock data-tz="${escapeHtml(city.tz)}">${escapeHtml(when.timeLabel)}</span>
        <span class="now-temp" data-temp>${escapeHtml(temp)}</span>
        <span class="rain" data-rain ${report?.rainLikely ? '' : 'hidden'} role="img" aria-label="${escapeHtml(rainLabel)}">${RAIN_ICON}</span>
      </p>
${sectionMenu(city.id)}
    </section>
    <section class="block city-body">
${groups}
    </section>
    <button type="button" class="menu-back" hidden>Menu</button>
  </main>`;
}

function mapPoint(lat, lon) {
  const x = ((lon + 168) / 348) * 760;
  const y = ((78 - lat) / 140) * 400;
  return `${x.toFixed(1)} ${y.toFixed(1)}`;
}

function mapPath(points) {
  return `M${points.map(([lat, lon]) => mapPoint(lat, lon)).join(' L')} Z`;
}

const CONTINENTS = [
  {
    id: 'North America',
    name: 'North America',
    path: mapPath([
      [71, -156], [72, -128], [70, -96], [73, -84], [66, -62], [60, -64],
      [51, -56], [47, -53], [45, -66], [41, -70], [35, -76], [30, -81],
      [25, -80], [18, -88], [15, -83], [9, -80], [14, -92], [20, -105],
      [23, -110], [32, -117], [40, -124], [49, -126], [58, -138], [60, -152], [65, -166],
    ]),
  },
  {
    id: 'Latin America',
    name: 'Latin America',
    path: mapPath([
      [12, -73], [11, -62], [8, -60], [5, -51], [0, -50], [-5, -35],
      [-8, -35], [-15, -39], [-23, -41], [-33, -52], [-40, -62], [-52, -68],
      [-55, -68], [-52, -74], [-46, -75], [-30, -72], [-18, -70], [-5, -81],
      [0, -80], [8, -77],
    ]),
  },
  {
    id: 'Europe',
    name: 'Europe',
    path: mapPath([
      [71, 26], [69, 18], [64, 10], [60, 5], [54, 8], [52, -6], [48, -5],
      [43, -8], [37, -9], [36, -2], [36, 6], [38, 16], [40, 19], [36, 23],
      [41, 29], [47, 30], [54, 28], [60, 28], [66, 30],
    ]),
  },
  {
    id: 'Africa',
    name: 'Africa',
    path: mapPath([
      [35, -6], [37, 10], [32, 25], [30, 33], [22, 37], [12, 44], [11, 51],
      [2, 42], [-12, 44], [-25, 35], [-34, 26], [-35, 19], [-22, 14],
      [-8, 12], [5, 8], [5, -4], [12, -17], [20, -17], [28, -13], [33, -8],
    ]),
  },
  {
    id: 'Asia-Pacific',
    name: 'Asia-Pacific',
    paths: [
      mapPath([
        [72, 66], [76, 100], [73, 130], [70, 160], [66, 170], [60, 164],
        [54, 142], [42, 132], [38, 128], [31, 122], [22, 114], [10, 106],
        [1, 104], [7, 98], [8, 80], [15, 74], [22, 70], [25, 62], [27, 56],
        [22, 58], [26, 50], [36, 36], [41, 29], [46, 40], [55, 50], [62, 58],
      ]),
      mapPath([
        [-12, 131], [-14, 136], [-17, 146], [-25, 153], [-34, 151], [-38, 147],
        [-35, 137], [-34, 124], [-26, 113], [-20, 118], [-15, 125],
      ]),
    ],
  },
  {
    id: 'Middle East',
    name: 'Middle East',
    path: mapPath([
      [37, 32], [37, 44], [31, 48], [22, 55], [16, 43], [22, 38], [29, 34], [33, 34],
    ]),
  },
];

function continentCount(id) {
  return LIVE.filter((city) => city.region === id).length;
}

function cityCountLabel(count) {
  return count === 1 ? '1 city' : `${count} cities`;
}

function citiesPageHtml() {
  const lands = CONTINENTS.map((continent) => {
    const label = `${continent.name}, ${cityCountLabel(continentCount(continent.id))}`;
    const paths = (continent.paths || [continent.path]).map((d) => `          <path class="land" d="${d}"/>`).join('\n');
    return `        <g data-continent="${continent.id}" role="button" tabindex="0" aria-label="${escapeHtml(label)}">
${paths}
        </g>`;
  }).join('\n');
  const buttons = CONTINENTS.map((continent) => {
    return `          <li><button type="button" data-continent="${continent.id}"><span>${escapeHtml(continent.name)}</span><span class="continent-count">${continentCount(continent.id)}</span></button></li>`;
  }).join('\n');
  return `  <main class="view" id="cities" hidden>
    <section class="block cities-page">
      <p class="back"><a href="#home">Home</a></p>
      <div class="cities-brand">
        <img src="assets/icon-mark.png" alt="">
        <h1>Find the <span class="fun">City</span> ready for you</h1>
        <p class="subhead">Pick a region. The number indicates indexed cities.</p>
      </div>
      <div class="cities-layout">
        <svg class="world-svg" viewBox="0 0 760 400" role="group" aria-label="World map">
${lands}
        </svg>
        <ul class="continent-list">
${buttons}
        </ul>
        <div class="continent-cities" id="continent-cities">
          <p class="continent-hint" id="continent-hint">Tap a region to see its cities.</p>
          <h2 id="continent-title" hidden></h2>
          <ul id="continent-city-list"></ul>
        </div>
      </div>
    </section>
  </main>`;
}

const cityLookup = JSON.stringify(LIVE.map(({ id, name, country, lat, lon, region }) => ({
  id,
  name,
  country,
  lat,
  lon,
  continent: region,
})));
const prideCityLookup = JSON.stringify(CITIES.map(({ id, name, country }) => ({ id, name, country })));
const continentNames = JSON.stringify(Object.fromEntries(CONTINENTS.map((continent) => [continent.id, continent.name])));

for (const city of CITIES) {
  if (!city.live) continue;
  try {
    weatherByCity[city.name] = await fetchWeather(city.lat, city.lon, city.tz);
  } catch (err) {
    console.error(`${city.name} weather unavailable: ${err.message}`);
  }
}

const venueInvite = `
    <section class="venue-invite" aria-label="For venues">
      <div class="venue-invite-card">
        <div class="venue-invite-copy">
          <span class="venue-mark" aria-hidden="true">
            <svg viewBox="0 0 64.216 64.216" fill="currentColor">
              <path d="M49.147,17.246c0-5.088-4.139-9.229-9.229-9.229c-5.092,0-9.229,4.141-9.229,9.229c0,0.092,0.01,0.178,0.015,0.27h-4.443l-1.676-9.92L16.184,0l-1.115,1.23l7.979,7.207l1.531,9.078h-6.403l-0.222,0.395c-1.261,2.213-1.927,4.485-2.149,7.385c0,3.247,0.201,5.819,1.585,8.774c1.974,4.174,5.522,7.193,9.708,7.914v19.319c-3.848,0.154-6.717,0.738-6.717,1.439c0,0.815,3.914,1.475,8.732,1.475c4.829,0,8.737-0.657,8.737-1.475c0-0.701-2.865-1.285-6.713-1.439V41.961c1.298-0.244,2.536-0.717,3.685-1.364c6.567-3.676,8.086-11.247,7.745-14.546C46.362,24.906,49.147,21.412,49.147,17.246z M20.012,32.742c-0.741,0-1.347-0.604-1.347-1.346c0-0.744,0.605-1.346,1.347-1.346c0.743,0,1.348,0.602,1.348,1.346C21.36,32.139,20.756,32.742,20.012,32.742z M17.385,24.926c0.202-2.074,0.771-4.068,1.708-5.846h5.749l1.209,7.172C20.55,27.848,17.385,24.926,17.385,24.926z M26.539,34.19c-0.802,0-1.451-0.647-1.451-1.448c0-0.801,0.649-1.449,1.451-1.449c0.135,0,0.256,0.043,0.38,0.076l0.253,1.51l0.817-0.137C27.989,33.543,27.34,34.19,26.539,34.19z M31.406,31.914c-0.517,0-0.933-0.414-0.933-0.93s0.416-0.934,0.933-0.934c0.512,0,0.931,0.418,0.931,0.934S31.918,31.914,31.406,31.914z M33.165,35.851c-0.455,0-0.828-0.369-0.828-0.828c0-0.457,0.373-0.83,0.828-0.83c0.461,0,0.829,0.373,0.829,0.83S33.626,35.851,33.165,35.851z M36.997,28.186c-0.173,0-0.311-0.139-0.311-0.309c0-0.172,0.138-0.311,0.311-0.311c0.176,0,0.313,0.139,0.313,0.311C37.307,28.047,37.173,28.186,36.997,28.186z M38.19,32.742c-0.484,0-0.883-0.393-0.883-0.881c0-0.484,0.396-0.877,0.883-0.877s0.879,0.393,0.879,0.877C39.069,32.35,38.676,32.742,38.19,32.742z M29.23,24.926c-0.551,0.301-1.076,0.549-1.593,0.764l-1.112-6.609c0,0,12.411-0.131,12.417-0.139c0.921,1.762,1.568,3.93,1.771,5.985C40.714,24.926,36.686,20.838,29.23,24.926z M42.465,25.432c-0.049-0.207-0.237-0.791-0.256-0.936l1.571-0.68c0,0-1.874-3.305-3.012-5.231c0.078-0.051,0.15-0.109,0.218-0.172c1.811,1.875,4.473,4.076,4.473,4.076l1.09-1.467c0,0-2.871-1.917-5.199-3.119c0.024-0.056,0.04-0.116,0.058-0.175c2.519,0.726,5.935,1.304,5.935,1.304l0.218-1.785c0,0-0.001-0.021-0.001-0.033c-2.034-0.271-4.077-0.31-6.1-0.133c-0.007-0.048-0.011-0.097-0.022-0.144c2.547-0.629,5.809-1.838,5.809-1.838l-0.731-1.685c0,0-3.123,1.547-5.328,2.97c-0.035-0.049-0.074-0.095-0.114-0.139c1.883-1.811,4.116-4.509,4.116-4.509l-1.467-1.09c0,0-1.938,2.904-3.139,5.238c-0.053-0.025-0.108-0.044-0.165-0.063c0.729-2.521,1.312-5.966,1.312-5.966s-1.172-0.221-1.783-0.221c-0.011,0-0.031,0.002-0.031,0.002s-0.228,3.487-0.104,6.111c-0.06,0.004-0.118,0.007-0.176,0.018c-0.627-2.547-1.84-5.816-1.84-5.816l-1.686,0.734c0,0,1.542,3.108,2.961,5.312c-0.051,0.034-0.095,0.075-0.142,0.115c-1.813-1.881-4.497-4.101-4.497-4.101l-1.09,1.463c0,0,2.876,1.921,5.205,3.123c-0.027,0.055-0.052,0.111-0.073,0.17c-2.517-0.724-5.922-1.301-5.922-1.301s-0.22,1.17-0.22,1.785c0,0.012,0.002,0.033,0.002,0.033s3.436,0.224,6.053,0.104c0.003,0.045,0.007,0.089,0.014,0.133h-7.075c-0.004-0.092-0.015-0.178-0.015-0.27c0-4.744,3.859-8.607,8.607-8.607c4.746,0,8.605,3.863,8.605,8.607C48.525,21.102,45.964,24.34,42.465,25.432z"/>
            </svg>
          </span>
          <div>
            <p class="eyebrow">For venues</p>
            <h2>Bring <span class="fun">the crowd</span> through the door.</h2>
            <p>Share how busy you are, and tell us about your events. Travelers looking for the night see it here.</p>
          </div>
        </div>
        <a class="btn solid" href="#venues">Contact us!</a>
      </div>
    </section>
`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseIso(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!match) return null;
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  const utc = new Date(Date.UTC(y, mo - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) return null;
  return { y, mo, d, utc };
}

function formatPrideDay(iso) {
  const day = parseIso(iso);
  return `${WEEKDAYS[day.utc.getUTCDay()]} ${day.d} ${MONTHS[day.mo - 1].slice(0, 3)} ${day.y}`;
}

function formatPrideRange(start, end) {
  if (start === end) return formatPrideDay(start);
  const a = parseIso(start);
  const b = parseIso(end);
  if (a.y === b.y && a.mo === b.mo) {
    return `${WEEKDAYS[a.utc.getUTCDay()]} ${a.d} – ${WEEKDAYS[b.utc.getUTCDay()]} ${b.d} ${MONTHS[a.mo - 1].slice(0, 3)} ${a.y}`;
  }
  return `${formatPrideDay(start)} – ${formatPrideDay(end)}`;
}

function prideEvents() {
  const events = [];
  for (const city of CITIES) {
    for (const row of city.events || []) {
      let sourceName = 'Source';
      try {
        sourceName = new URL(row.source).hostname.replace(/^www\./, '');
      } catch {
        sourceName = 'Source';
      }
      events.push({
        id: `${city.id}-${row.start}`,
        name: row.name,
        city_id: city.id,
        start: row.start,
        end: row.end,
        source_url: row.source,
        source_name: sourceName,
      });
    }
  }
  return events;
}

function prideBanners(city) {
  return prideEvents()
    .filter((event) => event.city_id === city.id && !event.parent_id)
    .map((event) => {
      const title = event.kind === 'pride-week' ? `Pride week in ${city.name}` : `Pride in ${city.name}`;
      const when = formatPrideRange(event.start, event.end);
      return `      <a class="pride-banner" href="#pride" hidden data-start="${event.start}" data-end="${event.end}">
        <img src="assets/icon-mark.png" alt="">
        <span>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(when)} · ${escapeHtml(event.name)}</span>
        </span>
      </a>`;
    }).join('\n');
}

function prideListItem(event) {
  const city = CITIES.find((item) => item.id === event.city_id);
  const place = event.place ? ` · ${escapeHtml(event.place)}` : '';
  const where = city.live
    ? `<a href="#city/${escapeHtml(city.id)}">${escapeHtml(city.name)}, ${escapeHtml(city.country)}</a>`
    : `${escapeHtml(city.name)}, ${escapeHtml(city.country)}`;
  return `            <li data-city="${escapeHtml(event.city_id)}" data-start="${event.start}" data-end="${event.end}">
              <p class="pride-when">${escapeHtml(formatPrideRange(event.start, event.end))}</p>
              <p class="pride-what">${escapeHtml(event.name)}</p>
              <p class="pride-where">${flagHtml(city.country)} ${where}${place}</p>
              <a class="pride-source" href="${escapeHtml(event.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(event.source_name)}</a>
            </li>`;
}

function prideResultsHtml() {
  const rows = prideEvents()
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name))
    .map((event) => prideListItem(event))
    .join('\n');
  return `      <div class="pride-cal" id="pride-results">
        <ul class="pride-simple">
${rows}
        </ul>
        <p class="pride-none" id="pride-none" hidden></p>
      </div>`;
}

function pridePageHtml() {
  return `  <main class="view" id="pride" hidden>
    <section class="hero tonight-hero pride-hero">
      <img class="tonight-hero-photo" src="assets/calendar-hero.jpg" alt="">
      <div class="tonight-hero-shade" aria-hidden="true"></div>
      <div class="tonight-hero-inner">
        <img class="hero-mark" src="assets/icon-mark.png" alt="">
        <h1>Plan your vacations around<br><span class="fun">Fun Events</span></h1>
        <p class="subhead">Check the gay calendar <svg class="pride-flag" viewBox="0 0 22 16" aria-hidden="true"><rect width="22" height="2.67" fill="#E40303"/><rect width="22" height="2.67" y="2.67" fill="#FF8C00"/><rect width="22" height="2.67" y="5.33" fill="#FFED00"/><rect width="22" height="2.67" y="8" fill="#008026"/><rect width="22" height="2.67" y="10.67" fill="#24408E"/><rect width="22" height="2.67" y="13.33" fill="#732982"/></svg></p>
      </div>
    </section>
    <section class="block pride-page">
      <div class="outlook" id="outlook">
${calendarNav('outlook')}
      </div>
    </section>
  </main>`;
}

const SCENE_GROUPS = [
  { id: 'dance', name: 'Dance and drinks', categories: ['bar', 'club'] },
  { id: 'sauna', name: 'Saunas', categories: ['sauna'] },
  { id: 'sexy', name: 'Cruisy', categories: ['cruise', 'sex'] },
];

function sceneGroup(category) {
  const match = SCENE_GROUPS.find((group) => group.categories.includes(category));
  return match ? match.id : 'dance';
}

function sceneGroupName(category) {
  const match = SCENE_GROUPS.find((group) => group.categories.includes(category));
  return match ? match.name : 'Dance and drinks';
}

const NIGHT_HOURS = [18, 19, 20, 21, 22, 23, 0, 1, 2];

function peakClock(hour) {
  const suffix = hour >= 12 ? 'pm' : 'am';
  return `${hour % 12 || 12}${suffix}`;
}

function forecastAt(venue, city, dow, hour, eventTonight) {
  const base = zonedNow(new Date(), city.tz);
  return assembleForecast(venue, {
    weekday: dow,
    hour,
    minute: 0,
    minutes: hour * 60,
    dateLabel: base.dateLabel,
    timeLabel: base.timeLabel,
  }, {
    weather: weatherByCity[city.name] || null,
    liveCount: liveByVenue.get(venue.id) || null,
    eventsFile: eventsFor(city.tz),
    eventTonight,
    cells: forecastInputs.cells,
    weights: forecastInputs.weights,
  });
}

function nightPeak(venue, city, dow) {
  let best = null;
  for (const hour of NIGHT_HOURS) {
    const forecast = forecastAt(venue, city, dow, hour, false);
    if (!forecast.status.open) continue;
    if (!best || forecast.percent >= best.percent) best = { percent: forecast.percent, hour };
  }
  return best || { percent: 0, hour: 21 };
}

function calendarOffset(timeZone, days) {
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = key.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days, 12));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(utc);
}

function weekendLabel(weekday, timeZone) {
  let friday = 5 - weekday;
  if (weekday === 6) friday = -1;
  if (weekday === 0) friday = 5;
  return `${calendarOffset(timeZone, friday)} – ${calendarOffset(timeZone, friday + 1)}`;
}

function snapshotVenue(venue, city) {
  const now = zonedNow(new Date(), city.tz);
  const eventsFile = eventsFor(city.tz);
  const event = eventsFile && eventsFile[venue.id];
  const eventTonight = Boolean(event?.event_tonight);
  const curve = [];
  const open = [];
  const hoursLines = [];
  let confidence = 'low';
  let hoursText = '';
  for (let hour = 0; hour < 24; hour += 1) {
    const forecast = forecastAt(venue, city, now.weekday, hour, eventTonight);
    curve.push(forecast.percent);
    open.push(Boolean(forecast.status.open));
    hoursLines.push(forecast.status.text);
    if (hour === now.hour) {
      confidence = forecast.confidence;
      hoursText = forecast.status.text;
    }
  }
  let peak = open.findIndex(Boolean);
  if (peak < 0) peak = curve.indexOf(Math.max(...curve));
  for (let hour = 0; hour < 24; hour += 1) {
    if (open[hour] && curve[hour] >= curve[peak]) peak = hour;
  }
  const fri = nightPeak(venue, city, 5);
  const sat = nightPeak(venue, city, 6);
  const weekend = fri.percent >= sat.percent ? { ...fri, day: 'Fri' } : { ...sat, day: 'Sat' };
  return {
    id: venue.id,
    name: venue.name,
    cat: sceneGroupName(venue.category),
    area: venue.neighborhood || '',
    vibes: [sceneGroup(venue.category)],
    conf: confidence,
    unsure: venue.hours == null || venue.hours === 'no recent data',
    verified: Boolean(venue.hours_verified),
    peak,
    curve,
    open,
    weekend,
    week: WEEK.map((day) => scoreForDow(venue, day.dow)),
    live: (() => {
      const reading = venue.live_counter ? liveByVenue.get(venue.id) : null;
      return reading ? { count: reading.count, at: reading.retrievedAt } : null;
    })(),
    addr: venue.address || '',
    features: venue.review_features || [],
    event: event?.event_name || null,
    eventUrl: venue.events_url || null,
    hoursText,
    hoursLines,
    lat: typeof venue.lat === 'number' ? venue.lat : null,
    lon: typeof venue.lon === 'number' ? venue.lon : null,
  };
}

function buildTonight() {
  const cities = LIVE.map((city) => {
    const now = zonedNow(new Date(), city.tz);
    const venues = city.venues.map((venue) => snapshotVenue(venue, city));
    const openNow = venues.filter((venue) => venue.open[now.hour]);
    const best = openNow.reduce((max, venue) => Math.max(max, venue.curve[now.hour]), 0);
    const score = openNow.reduce((sum, venue) => sum + venue.curve[now.hour], 0);
    return {
      id: city.id,
      name: city.name,
      country: city.country,
      lat: city.lat,
      lon: city.lon,
      tz: city.tz,
      flag: FLAGS[city.country] || '',
      weekday: now.weekday,
      hour: now.hour,
      weekend: weekendLabel(now.weekday, city.tz),
      best,
      score,
      weather: {
        temp: weatherByCity[city.name] ? tempLabel(weatherByCity[city.name].tempC) : '',
        rain: Boolean(weatherByCity[city.name]?.rainLikely),
        raining: Boolean(weatherByCity[city.name]?.raining),
        snowing: Boolean(weatherByCity[city.name]?.snowing),
      },
      events: (city.events || []).map((event) => ({
        name: event.name,
        type: event.type,
        start: event.start,
        end: event.end,
        source: event.source,
      })),
      venues,
    };
  });
  cities.sort((a, b) => b.score - a.score || b.best - a.best);
  const fallback = cities.some((city) => city.id === 'san-francisco') ? 'san-francisco' : cities[0]?.id;
  return { defaultCity: fallback, cities };
}

const tonightData = buildTonight();

function tonightLine(venue, mode) {
  if (mode === 'weekend') return `Peaks ~${peakClock(venue.weekend.hour)}`;
  if (venue.unsure) return `Hours not confirmed · peaks ~${peakClock(venue.peak)}`;
  return `Open now · peaks ~${peakClock(venue.peak)}`;
}

function busyNote() {
  return 'usual for this hour';
}

function whyStats() {
  const venues = LIVE.flatMap((city) => city.venues);
  const events = LIVE.flatMap((city) => city.events || []);
  return {
    cities: LIVE.length,
    venues: venues.length,
    verified: venues.filter((venue) => venue.hours_verified).length,
    live: venues.filter((venue) => venue.live_counter).length,
    events: events.length,
  };
}

function whyProof() {
  const city = tonightData.cities.find((item) => item.id === tonightData.defaultCity) || tonightData.cities[0];
  const open = city.venues.filter((venue) => venue.open[city.hour]);
  const pool = open.length ? open : city.venues;
  const venue = pool.slice().sort((a, b) => b.curve[city.hour] - a.curve[city.hour])[0];
  return { city, venue, open: open.includes(venue) };
}

function whyPageHtml() {
  const stats = whyStats();
  const proof = whyProof();
  const { city, venue } = proof;
  const percent = venue.curve[city.hour];
  const chilli = tonightData.cities
    .flatMap((item) => item.venues.map((row) => ({ city: item, venue: row })))
    .find((row) => row.venue.live_counter || row.venue.id === 'sao-paulo-hotel-chilli');
  const liveCount = chilli && chilli.venue.live && Number.isInteger(chilli.venue.live.count)
    ? chilli.venue.live.count
    : null;
  const forecastLine = proof.open
    ? `${escapeHtml(venue.name)} in ${escapeHtml(city.name)} is ${percent}% right now — usual for this hour, not a live count.`
    : `${escapeHtml(venue.name)} in ${escapeHtml(city.name)} is closed this hour. The card says so. The forecast for the hour is ${percent}%.`;
  const liveLine = liveCount == null
    ? 'Hotel Chilli in São Paulo is the venue that publishes a headcount, on hotelchilli.com.br. The number shows on its card only while that reading is fresh.'
    : `Hotel Chilli in São Paulo is publishing ${liveCount} inside right now, from hotelchilli.com.br. The number stays up only while that reading is fresh.`;
  return `  <main class="view" id="why" hidden>
    <section class="yd-hero">
      <img class="yd-hero-photo" src="assets/why/hero-pride.jpg" alt="Crowd at a pride parade, rainbow flags raised">
      <div class="yd-hero-shade" aria-hidden="true"></div>
      <div class="yd-hero-inner">
        <div>
          <p class="eyebrow">Why FindingDorothy</p>
          <h1>Stop guessing where the night is.</h1>
          <p class="yd-sub">FindingDorothy ranks gay bars, clubs, saunas and parties for tonight, in ${stats.cities} cities, and shows a live headcount when a venue publishes one.</p>
          <div class="yd-cta-pair">
            <div class="yd-cta-row">
              <a class="btn yd-go" href="#home">Start exploring</a>
              <span class="yd-friction">Free forever for travelers</span>
            </div>
            <div class="yd-cta-row">
              <a class="btn light" href="#venues">For venues</a>
              <span class="yd-friction">Free pilot for launch venues</span>
            </div>
          </div>
        </div>
        <a class="yd-proof" href="#home">
          <p class="yd-proof-kicker">${escapeHtml(city.flag)} ${escapeHtml(city.name)} · tonight</p>
          <p class="yd-proof-name">${escapeHtml(venue.name)}</p>
          <p class="yd-proof-meta">${escapeHtml(venue.cat)}${venue.area ? ` · ${escapeHtml(venue.area)}` : ''}</p>
          <p class="yd-proof-score"><span>${percent}%</span> ${escapeHtml(busyNote())}</p>
          <p class="yd-proof-line">${proof.open ? `Open now · peaks ~${peakClock(venue.peak)}` : escapeHtml(venue.hoursText)}</p>
        </a>
      </div>
    </section>
    <section class="yd-block yd-split" id="venues">
      <figure>
        <img src="assets/why/venues-floor.jpg" alt="People dancing on a packed club floor">
      </figure>
      <div>
        <p class="eyebrow">For venues</p>
        <h2>Your slowest Tuesday is invisible. We make it visible.</h2>
        <p>${liveLine}</p>
        <ul class="yd-points">
          <li>${stats.live} live counter, shown with a Live badge and the venue’s own headcount.</li>
          <li>${stats.verified} of ${stats.venues} venues have hours taken from the venue’s own site.</li>
          <li>Travelers open a city and see tonight ranked before they go out.</li>
        </ul>
        <div class="yd-cta-row">
          <a class="btn solid" href="#venues">Talk to us</a>
          <span class="yd-friction">Free pilot for launch venues</span>
        </div>
      </div>
    </section>
    <section class="yd-block">
      <p class="eyebrow">For travelers</p>
      <h2>Land in a new city. Know where the night is.</h2>
      <div class="yd-pillars">
        <article>
          <img src="assets/why/travelers-disco.jpg" alt="Friends together under disco lights">
          <h3>Scene forecast</h3>
          <p>${forecastLine}</p>
        </article>
        <article>
          <img src="assets/why/travelers-drag.jpg" alt="Drag queen performing on stage">
          <h3>Real reviews, cited</h3>
          <p>Every venue carries at least two sources. ${stats.verified} have hours from the venue’s own site. We never hallucinate a busy night.</p>
        </article>
        <article>
          <img src="assets/why/events-pride.jpg" alt="People marching in a pride parade">
          <h3>Pride and events</h3>
          <p>${stats.events} pride dates, each from the organizer’s page. The Fun Calendar shows the day, and an empty day stays empty.</p>
        </article>
      </div>
      <div class="yd-cta-row">
        <a class="btn solid" href="#home">Start exploring</a>
        <span class="yd-friction">Free forever for travelers</span>
      </div>
    </section>
    <section class="yd-numbers" aria-label="By the numbers">
      <p><strong>${stats.cities}</strong> cities</p>
      <p><strong>${stats.venues}</strong> venues</p>
      <p><strong>${stats.verified}</strong> hours from the venue’s own site</p>
      <p><strong>${stats.live}</strong> live counter</p>
      <p><strong>${stats.events}</strong> pride dates</p>
    </section>
    <section class="yd-steps">
      <img src="assets/why/steps-night.jpg" alt="">
      <div class="yd-steps-shade" aria-hidden="true"></div>
      <div class="yd-steps-inner">
        <h2>How it works</h2>
        <ol>
          <li><span>1</span> Pick your city.</li>
          <li><span>2</span> See tonight, ranked by the forecast.</li>
          <li><span>3</span> Go where it’s actually on.</li>
        </ol>
      </div>
    </section>
    <section class="yd-trust">
      <p>If we don’t have recent data, we say so. ${stats.venues - stats.verified} venues still say no recent data for hours. Verified hours, cited sources, and a live count only when the venue just published one.</p>
    </section>
    <section class="yd-final">
      <h2>Stop guessing where the night is.</h2>
      <div class="yd-cta-pair">
        <div class="yd-cta-row">
          <a class="btn solid" href="#home">Start exploring</a>
          <span class="yd-friction">Free forever for travelers</span>
        </div>
        <div class="yd-cta-row">
          <a class="btn ghost" href="#venues">For venues</a>
          <span class="yd-friction">Free pilot for launch venues</span>
        </div>
      </div>
    </section>
  </main>`;
}

function liveLine(venue) {
  if (!venue.live || !Number.isInteger(venue.live.count)) return '';
  return `<span class="tonight-live"><span class="live-dot" aria-hidden="true"></span><span class="badge live">Live</span> ${venue.live.count} inside right now</span>`;
}

function conceptHtml(features) {
  const items = (features || []).slice(0, 5);
  if (!items.length) return '';
  return `<span class="tonight-concepts">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</span>`;
}

function tonightRow(venue, hour, mode) {
  const percent = mode === 'weekend' ? venue.weekend.percent : venue.curve[hour];
  const place = venue.area ? ` · ${escapeHtml(venue.area)}` : '';
  const note = mode === 'weekend' ? 'weekend peak' : busyNote();
  const live = mode === 'weekend' ? '' : liveLine(venue);
  return `          <li><button type="button" class="tonight-row" data-venue="${escapeHtml(venue.id)}"><span class="tonight-name">${escapeHtml(venue.name)}</span><span class="tonight-score"><span class="forecast-badge">${percent}%</span><span class="forecast-note">${escapeHtml(note)}</span></span><span class="tonight-meta">${escapeHtml(venue.cat)}${place}</span><span class="tonight-hours">${escapeHtml(venue.hoursText)}</span>${live}<span class="tonight-when">${escapeHtml(tonightLine(venue, mode))}</span>${conceptHtml(venue.features)}</button></li>`;
}

function tonightRail(venues, hour, mode) {
  if (!venues.length) {
    const text = mode === 'tonight' ? 'Nothing open right now.' : 'Nothing open right now.';
    return `        <p class="tonight-empty">${text}</p>`;
  }
  if (mode === 'tonight') {
    return `        <ol class="tonight-list">\n${venues.map((venue) => tonightRow(venue, hour, mode)).join('\n')}\n        </ol>`;
  }
  const head = venues.slice(0, 8).map((venue) => tonightRow(venue, hour, mode)).join('\n');
  const tail = venues.slice(8).map((venue) => tonightRow(venue, hour, mode)).join('\n');
  const more = tail
    ? `        <details class="show-more"><summary>Show more</summary><div class="more-clip"><div class="more-clip-inner"><ol class="tonight-list">\n${tail}\n        </ol></div></div></details>`
    : '';
  return `        <ol class="tonight-list">\n${head}\n        </ol>\n${more}`;
}

function closedListHtml(venues, id = 'closed-list', title = 'Closed') {
  if (!venues.length) return `      <div class="closed-block" id="${id}" hidden></div>`;
  const items = venues
    .map((venue) => `          <li><button type="button" class="closed-row" data-venue="${escapeHtml(venue.id)}"><span class="closed-name">${escapeHtml(venue.name)}</span><span class="closed-cat">${escapeHtml(venue.cat)}</span><span class="closed-hours">${escapeHtml(venue.hoursText)}</span></button></li>`)
    .join('\n');
  return `      <div class="closed-block" id="${id}">
        <p class="closed-label">${escapeHtml(title)}</p>
        <ul class="closed-list">
${items}
        </ul>
      </div>`;
}

function prideCountdown(iso, today) {
  const days = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (days < 0) return null;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return `in ${days} days`;
  const weeks = Math.round(days / 7);
  if (weeks < 4) return `in ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
  const [ty, tm] = today.split('-').map(Number);
  const [ey, em] = iso.split('-').map(Number);
  const monthDiff = (ey - ty) * 12 + (em - tm);
  if (monthDiff === 1) return 'next month';
  if (monthDiff > 1) return `in ${monthDiff} months`;
  return `in ${weeks} weeks`;
}

function calendarNav(prefix) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    .map((name, index) => `<option value="${index + 1}">${name}</option>`)
    .join('');
  return `      <div class="cal-nav">
        <button type="button" id="${prefix}-prev" aria-label="Previous month">‹</button>
        <div class="cal-pick" id="${prefix}-label">
          <select id="${prefix}-month" aria-label="Month">${months}</select>
          <select id="${prefix}-year" aria-label="Year"></select>
        </div>
        <button type="button" id="${prefix}-next" aria-label="Next month">›</button>
      </div>
      <div id="${prefix}-body"></div>`;
}

function barWhen(timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  const bag = {};
  for (const part of fmt.formatToParts(new Date())) bag[part.type] = part.value;
  return { dayName: bag.weekday, shortDate: `${bag.month} ${Number(bag.day)}` };
}

function skyMark(city) {
  if (city.weather.snowing) return `<span class="wx is-snow" data-wx role="img" aria-label="Snowing">${SNOW_ICON}</span>`;
  if (city.weather.raining) return `<span class="wx is-rain" data-wx role="img" aria-label="Raining">${RAIN_ICON}</span>`;
  return `<span class="wx" data-wx hidden role="img" aria-label=""></span>`;
}

function nowLineHtml(city) {
  return `    <div class="now-bar">
      <button type="button" class="now-line" id="now-line" aria-expanded="false" aria-controls="city-picker">
        <span class="now-flag" data-flag>${city.flag}</span>
        <span class="now-place" data-place>${escapeHtml(city.name)}, ${escapeHtml(city.country)}</span>
        <svg class="now-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16.5 20.5 21" stroke-linecap="round"/></svg>
      </button>
      <div class="city-picker" id="city-picker" hidden>
        <form class="area-search" role="search">
          <input id="city-picker-search" type="search" placeholder="Search your location to find fun near you" autocomplete="off" enterkeyhint="search">
          <button type="submit" aria-label="Search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16.5 20.5 21" stroke-linecap="round"/></svg>
          </button>
        </form>
        <ul id="city-picker-list"></ul>
      </div>
    </div>`;
}

function homeTonightHtml() {
  const city = tonightData.cities.find((item) => item.id === tonightData.defaultCity) || tonightData.cities[0];
  const inDance = (venue) => (venue.vibes || []).includes('dance');
  const tonightVenues = city.venues
    .filter((venue) => inDance(venue) && venue.open[city.hour])
    .sort((a, b) => b.curve[city.hour] - a.curve[city.hour]);
  const weekendVenues = city.venues
    .filter((venue) => inDance(venue) && venue.weekend.percent > 0)
    .sort((a, b) => b.weekend.percent - a.weekend.percent);
  const closedVenues = city.venues
    .filter((venue) => inDance(venue) && !venue.open[city.hour])
    .sort((a, b) => a.name.localeCompare(b.name));
  const chips = `${SCENE_GROUPS
    .map((group) => `          <button type="button" class="vibe-chip" data-group="${group.id}" aria-pressed="${group.id === 'dance' ? 'true' : 'false'}">${escapeHtml(group.name)}</button>`)
    .join('\n')}
          <button type="button" class="vibe-chip" data-group="events">Events</button>`;
  const weekendHidden = city.weekday === 5 || city.weekday === 6 ? ' hidden' : '';
  return `    <section class="hero tonight-hero">
      <img class="tonight-hero-photo" src="assets/home-hero.jpg" alt="">
      <div class="tonight-hero-shade" aria-hidden="true"></div>
      <div class="tonight-hero-inner">
        <img class="hero-mark" src="assets/icon-mark.png" alt="">
        <h1>Know where the <span class="fun">fun</span><br>is going.</h1>
        <p class="subhead">Gay travel intel, powered by real data.</p>
${nowLineHtml(city)}
      </div>
    </section>
    <div id="city-rails">
    <section class="tonight-block" id="tonight">
      <div class="tonight-head">
        <h2 id="tonight-title">Right now</h2>
        <p class="now-facts rank-note" id="now-facts" data-weather data-lat="${city.lat}" data-lon="${city.lon}">
          <span class="now-day" data-day>${escapeHtml(barWhen(city.tz).dayName)}</span>
          <span class="now-date" data-date>${escapeHtml(barWhen(city.tz).shortDate)}</span>
          <span class="now-time" data-clock data-tz="${escapeHtml(city.tz)}">${escapeHtml(zonedNow(new Date(), city.tz).timeLabel)}</span>
          <span class="now-temp" data-temp>${escapeHtml(city.weather.temp)}</span>
          ${skyMark(city)}
        </p>
      </div>
      <div class="vibe-row" id="vibe-row">
${chips}
      </div>
      <div id="tonight-list">
${tonightRail(tonightVenues, city.hour, 'tonight')}
      </div>
${closedListHtml(closedVenues)}
    </section>
    <section class="tonight-block" id="for-you" hidden>
      <div class="tonight-head">
        <h2>For You</h2>
        <p class="rank-note">Tonight at your saved spots</p>
      </div>
      <div id="for-you-list"></div>
    </section>
    <section class="tonight-block" id="weekend"${weekendHidden}>
      <div class="tonight-head">
        <h2>This weekend</h2>
        <p class="rank-note" id="weekend-dates">${escapeHtml(city.weekend)}</p>
        <p class="rank-note" id="weekend-peak">ranked by the weekend peak</p>
      </div>
      <div class="vibe-row" id="weekend-groups">
${chips}
      </div>
      <div id="weekend-list">
${tonightRail(weekendVenues, city.hour, 'weekend')}
      </div>
${closedListHtml(city.venues.filter((venue) => inDance(venue) && venue.weekend.percent === 0).sort((a, b) => a.name.localeCompare(b.name)), 'weekend-closed', 'Closed this weekend')}
    </section>
    </div>
    <div class="sheet-back" id="sheet-back" hidden>
      <aside class="sheet" id="venue-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <button type="button" class="sheet-handle" id="sheet-handle" aria-label="Drag to close"></button>
        <div class="sheet-body" id="sheet-body"></div>
      </aside>
    </div>`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FindingDorothy — Know where the night is going</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=Poppins:wght@700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: light;
      --bg: #ffffff;
      --text: #111111;
      --muted: #6b6b76;
      --line: #ececf1;
      --yellow: #ffc531;
      --orange: #ff7a18;
      --grad: linear-gradient(90deg, #ffc531, #ff7a18);
      --grad-shut: linear-gradient(90deg, #d8d8e0, #5c5c66);
      --section: 2.25rem;
      --card-gap: 0.75rem;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: auto; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, sans-serif;
      font-size: 16px;
      font-weight: 400;
      line-height: 1.45;
    }
    h1, h2, .card h4, .why-grid h3, .acc-link, .acc-toggle, .now-time, .now-temp, .score {
      font-family: Poppins, sans-serif;
      letter-spacing: -0.02em;
    }
    img { max-width: 100%; }
    a { color: inherit; }
    button, a { -webkit-tap-highlight-color: transparent; }
    .top-stack {
      position: sticky;
      top: 0;
      z-index: 30;
    }
    .app-banner {
      margin: 0;
      padding: 0.38rem 1rem;
      background: #111;
      color: #fff;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.35;
      text-align: center;
    }
    .app-banner a,
    .app-banner a:visited {
      color: #ff7a18;
      font-weight: 600;
      text-decoration: none;
    }
    .app-banner a:hover,
    .app-banner a:focus-visible { text-decoration: underline; }
    .site-header {
      position: relative;
      display: flex;
      align-items: center;
      gap: 1.25rem;
      min-height: 68px;
      padding: 0.65rem 1.25rem;
      background:
        linear-gradient(90deg, #ffc531, #ff7a18) bottom / 100% 4px no-repeat,
        #fff;
      border-bottom: 0;
    }
    .header-auth {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .btn-login,
    .btn-signup {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      padding: 0.4rem 0.95rem;
      border-radius: 999px;
      font: inherit;
      font-size: 15px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
    }
    .btn-login {
      border: 1px solid #111;
      background: #fff;
      color: #111;
    }
    .btn-login:hover,
    .btn-login:focus-visible { background: #f6f6f8; }
    .btn-signup {
      border: 0;
      background: #ff7a18;
      color: #111;
    }
    .btn-signup:hover,
    .btn-signup:focus-visible { background: #ff8d38; }
    .logo {
      display: block;
      flex: none;
      height: 36px;
    }
    .logo img {
      display: block;
      height: 36px;
      width: auto;
    }
    .logo { order: 1; }
    .nav-panel { order: 2; }
    .header-auth { order: 3; }
    .nav-toggle { order: 4; }
    .nav-panel {
      display: flex;
      align-items: center;
      gap: 1.35rem;
      margin-left: auto;
    }
    .site-nav {
      display: flex;
      align-items: center;
      gap: 1.15rem;
    }
    .site-nav a {
      color: var(--text);
      font-size: 16px;
      font-weight: 500;
      text-decoration: none;
    }
    .site-nav a:hover,
    .site-nav a:focus-visible { color: var(--orange); }
    .home-sheet {
      width: min(430px, 100%);
      margin: 0 auto;
      padding: 0.15rem 1.15rem 0;
    }
    .app-pill {
      display: none;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      padding: 0.62rem 1.05rem;
      background: #111;
      color: #fff;
      font-size: 16px;
      font-weight: 500;
      text-decoration: none;
      white-space: nowrap;
    }
    .app-pill:hover,
    .app-pill:focus-visible { background: #2a2a2a; }
    span.app-pill { cursor: default; }
    span.app-pill:hover,
    span.app-pill:focus-visible { background: #111; }
    main.view { padding-bottom: 8rem; }
    main.view.is-leaving {
      animation: view-out 0.2s ease forwards;
      pointer-events: none;
    }
    main.view.is-entering { animation: view-in 0.46s cubic-bezier(0.2, 0.8, 0.2, 1); }
    @keyframes view-out {
      to { opacity: 0; transform: translateY(-12px); }
    }
    @keyframes view-in {
      from { opacity: 0; transform: translateY(22px); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      main.view.is-leaving,
      main.view.is-entering,
      .area-suggest { animation: none; }
    }
    .soon { padding-top: 4.5rem; }
    .soon h1 {
      margin: 0;
      font-size: 64px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .soon p {
      margin: 0.85rem 0 0;
      color: var(--muted);
      font-size: 16px;
    }
    .nav-toggle {
      display: none;
      margin-left: 0.65rem;
      width: 42px;
      height: 42px;
      padding: 0;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      cursor: pointer;
    }
    .nav-toggle span {
      display: block;
      width: 16px;
      height: 2px;
      margin: 4px auto;
      background: #111;
      border-radius: 2px;
    }
    .hero {
      display: block;
      width: auto;
      margin: 0;
      padding: 1.5rem 0 0.6rem;
      text-align: center;
    }
    .hero h1 {
      margin: 0;
      font-size: 36px;
      font-weight: 800;
      letter-spacing: -0.035em;
      line-height: 1.02;
      text-align: center;
    }
    .hero-mark {
      display: block;
      width: 68px;
      height: 68px;
      margin: 0 auto 0.85rem;
      object-fit: contain;
    }
    .fun { color: #ff7a18; }
    .loc-note {
      min-height: 1.3em;
      margin: 0.85rem 0 0;
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
    }
    .world {
      display: grid;
      grid-template-rows: 0fr;
      margin-top: 0;
      opacity: 0;
      transition: grid-template-rows 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.35s ease, margin-top 0.45s ease;
    }
    .world.is-open {
      grid-template-rows: 1fr;
      margin-top: 0.4rem;
      opacity: 1;
    }
    .world-clip { overflow: hidden; min-height: 0; }
    .acc {
      margin: 0.2rem 0 0;
      padding: 0;
      list-style: none;
      border-top: 1px solid var(--line);
    }
    .acc-item {
      border-bottom: 1px solid var(--line);
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.4s ease, transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .world.is-open .acc-item { opacity: 1; transform: none; }
${LIVE.map((_, index) => `    .world.is-open .acc-item:nth-child(${index + 1}) { transition-delay: ${(index + 1) * 40}ms; }`).join('\n')}
    .acc-link, .acc-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 0.9rem 0;
      border: 0;
      background: none;
      color: #111;
      font: inherit;
      font-family: Poppins, sans-serif;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
      text-align: left;
      text-decoration: none;
      cursor: pointer;
    }
    .acc-link span { color: #ff7a18; font-family: Inter, sans-serif; font-size: 13px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }
    .chev {
      width: 0.5rem;
      height: 0.5rem;
      border-right: 2px solid #111;
      border-bottom: 2px solid #111;
      transform: rotate(45deg);
      transition: transform 0.3s ease;
    }
    .acc-toggle[aria-expanded="true"] .chev { transform: rotate(225deg); }
    .acc-panel {
      display: grid;
      grid-template-rows: 0fr;
      color: var(--muted);
      transition: grid-template-rows 0.35s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .acc-panel.is-open { grid-template-rows: 1fr; }
    .acc-panel-clip { overflow: hidden; min-height: 0; }
    .acc-panel p { margin: 0; padding: 0 0 0.9rem; }
    @media (prefers-reduced-motion: reduce) {
      .world, .acc-item, .acc-panel, .chev { transition: none; }
    }
    .city-hero { padding-bottom: 0.4rem; }
    .city-hero h1 {
      margin: 0;
      font-size: 64px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .pride-banner {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      width: min(100%, 34rem);
      margin: 0 0 1.15rem;
      padding: 0.75rem 0.95rem;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: #fff;
      box-shadow: inset 3px 0 0 #ff7a18;
      color: inherit;
      text-decoration: none;
    }
    .pride-banner[hidden] { display: none; }
    .pride-banner img {
      width: 40px;
      height: 40px;
      flex: none;
      object-fit: contain;
    }
    .pride-banner strong {
      display: block;
      font-family: Poppins, sans-serif;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .pride-banner span span {
      display: block;
      margin-top: 0.12rem;
      color: var(--muted);
      font-size: 14px;
    }
    .pride-banner:hover, .pride-banner:focus-visible { border-color: #ff7a18; }
    .back { margin: 0 0 1.1rem; }
    .back a { color: var(--muted); font-weight: 500; text-decoration: none; }
    .back a:hover, .back a:focus-visible { color: #111; }
    .city-body { padding-top: 0.4rem; }
    .aside {
      margin: 0.85rem 0 0;
      color: var(--muted);
      font-size: 16px;
    }
    .subhead {
      margin: 0.9rem 0 0;
      color: var(--muted);
      font-family: Inter, sans-serif;
      font-size: 15px;
      font-weight: 400;
      letter-spacing: 0;
      line-height: 1.35;
    }
    .area-search {
      position: relative;
      display: block;
      margin: 2rem 0 0;
    }
    .area-search[hidden] { display: none; }
    .area-search input {
      width: 100%;
      height: 64px;
      margin: 0;
      padding: 0 3rem 0 1.25rem;
      border: 1.5px solid #d5d5de;
      border-radius: 999px;
      background: #fff;
      color: #111;
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      text-align: left;
    }
    .area-search input::placeholder { color: #222; font-weight: 500; }
    .area-search input:focus { outline: 2px solid #ff7a18; outline-offset: 1px; }
    .area-search button {
      position: absolute;
      top: 0;
      right: 0.2rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 64px;
      padding: 0;
      border: 0;
      background: none;
      color: #111;
      cursor: pointer;
    }
    .area-search svg { width: 22px; height: 22px; display: block; }
    .area-suggest {
      list-style: none;
      margin: 0.7rem 0 0;
      padding: 0.35rem;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: #fff;
      box-shadow: 0 18px 40px rgba(17, 17, 17, 0.1);
      animation: suggest-in 0.24s ease;
    }
    @keyframes suggest-in {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: none; }
    }
    .area-suggest[hidden] { display: none; }
    .area-suggest a {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
      min-height: 52px;
      padding: 0.7rem 0.95rem;
      border-radius: 14px;
      color: #111;
      font-family: Poppins, sans-serif;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.02em;
      text-decoration: none;
    }
    .area-suggest a span {
      color: var(--muted);
      font-family: Inter, sans-serif;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0;
    }
    .area-suggest a:hover,
    .area-suggest a:focus-visible,
    .area-suggest a.is-go {
      background: #fff7f2;
      box-shadow: inset 3px 0 0 #ff7a18;
    }
    .area-suggest .area-empty {
      margin: 0;
      padding: 0.75rem 0.9rem;
      color: var(--muted);
      font-size: 14px;
    }
    .area-block { margin-top: 2rem; text-align: left; }
    .area-block[hidden] { display: none; }
    .area-label {
      margin: 0 0 0.9rem;
      color: #111;
      font-family: Poppins, sans-serif;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.2;
      text-align: center;
    }
    .area-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.55rem;
      margin: 0;
    }
    .area-chip {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 42px;
      padding: 0.4rem 0.35rem;
      border: 0;
      border-radius: 12px;
      background: #ececf1;
      color: #111;
      font-family: Inter, sans-serif;
      font-size: 12px;
      font-weight: 500;
      letter-spacing: -0.02em;
      line-height: 1.15;
      white-space: nowrap;
      text-align: center;
      text-decoration: none;
      appearance: none;
      cursor: pointer;
    }
    a.area-chip:hover,
    a.area-chip:focus-visible { background: #ececf1; }
    #browse-world { font-weight: 700; }
    .hero .loc-note { min-height: 0; margin: 0.4rem 0 0; font-size: 13px; }
    .hero .loc-note:empty { display: none; }
    .home-sheet .city-pick { width: 100%; margin: 0.2rem 0 0; text-align: left; }
    #home.view { padding-bottom: 10rem; }
    .hero-cta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.7rem;
      margin-top: 1.6rem;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      padding: 0.75rem 1.2rem;
      border-radius: 999px;
      border: 1.5px solid #111;
      font: inherit;
      font-size: 16px;
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;
    }
    .btn.solid { background: #111; color: #fff; }
    .btn.solid:hover,
    .btn.solid:focus-visible { background: #2a2a2a; }
    .btn.ghost { background: #fff; color: #111; }
    .btn.ghost:hover,
    .btn.ghost:focus-visible { background: #fafafa; }
    .btn.light { border-color: #fff; color: #fff; background: transparent; }
    .btn.light:hover,
    .btn.light:focus-visible { background: rgba(255, 255, 255, 0.08); }
    .hero-preview {
      justify-self: end;
      width: min(100%, 320px);
      padding: 0.9rem 1rem 0.85rem;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: #fff;
      color: inherit;
      text-decoration: none;
    }
    .hero-preview-kicker {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .hero-preview-name {
      margin: 0.35rem 0 0;
      font-family: Poppins, sans-serif;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.2;
    }
    .hero-preview-place {
      margin: 0.15rem 0 0;
      color: var(--muted);
      font-size: 14px;
    }
    .hero-preview-meter {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      margin-top: 0.75rem;
    }
    .hero-preview-meter .bar { flex: 1; margin-top: 0; }
    .hero-preview-score {
      margin: 0;
      font-family: Poppins, sans-serif;
      font-size: 14px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
    }
    .hero-preview-label {
      margin: 0.45rem 0 0;
      font-size: 14px;
      font-weight: 500;
    }
    .scenes {
      width: 100%;
      margin: 5rem 0 0;
      padding: 1.55rem 1.15rem 1.7rem;
      background: #111 url("assets/scenes-night.jpg") center 42% / cover no-repeat;
    }
    .scenes-inner {
      width: min(430px, 100%);
      margin: 0 auto;
    }
    .scenes h2 {
      margin: 0 0 0.95rem;
      color: #fff;
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.15;
      text-align: center;
    }
    .scene-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 0.7rem;
    }
    .scene-card {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      width: 100%;
      min-width: 0;
      padding: 0.85rem 0.9rem;
      border: 1px solid transparent;
      border-radius: 16px;
      background: #fff;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .scene-card.is-on { border-color: #ff7a18; }
    .scene-mark {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: #ff7a18;
      color: #fff;
    }
    .scene-mark .group-icon { width: 18px; height: 18px; color: #fff; }
    .scene-mark .group-icon.fun { width: 13px; height: 18px; }
    .scene-mark .group-icon.fun svg path { fill: #fff; }
    .scene-card > span { min-width: 0; }
    .scene-name {
      display: block;
      font-family: Poppins, sans-serif;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.2;
    }
    .scene-copy {
      display: block;
      margin-top: 0.15rem;
      color: #6d6d78;
      font-family: Inter, sans-serif;
      font-size: 13px;
      font-weight: 400;
      letter-spacing: 0;
      line-height: 1.35;
    }
    .city-pick {
      width: min(1120px, calc(100% - 2.5rem));
      margin: 0 auto;
    }
    .block {
      width: min(1120px, calc(100% - 2.5rem));
      margin: 0 auto;
      padding: 2.6rem 0;
      scroll-margin-top: 120px;
    }
    .eyebrow {
      margin: 0 0 0.4rem;
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .block h2, .why h2, .pride h2, .venues-band h2 {
      margin: 0;
      font-size: 36px;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .lede {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin: 0.45rem 0 0;
      color: var(--muted);
    }
    .flag { font-size: 1.05rem; line-height: 1; }
    .now-line {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.7rem;
      margin: 0.15rem 0 0;
    }
    .now-time, .now-temp {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .rain {
      display: inline-flex;
      width: 1.65rem;
      height: 1.65rem;
      color: #2f6fed;
    }
    .rain[hidden] { display: none; }
    .rain svg { width: 100%; height: 100%; display: block; }
    .jump-menu { display: none; }
    .menu-back { display: none; }
    .group { margin-top: 1.6rem; scroll-margin-top: 7.5rem; }
    .group h3 {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      margin: 0 0 0.85rem;
      font-family: Inter, sans-serif;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .group-icon {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 1.15rem;
      height: 1.15rem;
      color: #111;
    }
    .group-icon.fun { width: 0.85rem; height: 1.2rem; }
    .group-icon svg { width: 100%; height: 100%; display: block; }
    .cards {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.9rem;
    }
    .card {
      min-width: 0;
      padding: 1.05rem 1.05rem 1rem;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 18px;
      scroll-margin-top: 120px;
    }
    .card-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .card h4 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .card-pills {
      display: inline-flex;
      flex: none;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
      gap: 0.35rem;
    }
    .hot {
      border-radius: 999px;
      padding: 0.18rem 0.55rem;
      background: var(--grad);
      color: #111;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.02em;
    }
    .badge {
      border-radius: 999px;
      padding: 0.18rem 0.55rem;
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
      text-transform: capitalize;
    }
    .badge.closed { color: #111; }
    .badge.closing, .badge.unconfirmed { color: #111; border-color: #ff7a18; }
    .badge.live {
      margin: 0 0.4rem;
      border: 0;
      background: var(--grad);
      color: #111;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      vertical-align: 0.05em;
    }
    .live-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #18a34a;
      vertical-align: 0.05em;
      animation: live-pulse 1.6s ease-out infinite;
    }
    @keyframes live-pulse {
      0% { box-shadow: 0 0 0 0 rgba(24, 163, 74, 0.55); }
      100% { box-shadow: 0 0 0 7px rgba(24, 163, 74, 0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .live-dot { animation: none; }
    }
    .neighborhood, .address { margin: 0.15rem 0 0; }
    .neighborhood { color: var(--muted); }
    .hours { margin: 0.4rem 0 0; font-size: 16px; font-weight: 500; }
    .hours.closed { color: #111; }
    .maps {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem 0.85rem;
      margin: 0.35rem 0 0.9rem;
    }
    .maps a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      padding: 0.4rem 0.9rem;
      border: 1px solid #111;
      border-radius: 999px;
      background: #fff;
      color: #111;
      font-size: 15px;
      font-weight: 500;
      text-decoration: none;
    }
    .meter-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .meter-title, .week-label, .reviews-label {
      margin: 0;
      color: var(--muted);
      font-family: Inter, sans-serif;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .score {
      margin: 0;
      font-size: 18px;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .bar {
      height: 10px;
      margin-top: 0.45rem;
      border-radius: 999px;
      background: #f3f3f6;
      overflow: hidden;
    }
    .bar span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--grad);
    }
    .meter-scale {
      display: flex;
      justify-content: space-between;
      margin-top: 0.28rem;
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
    }
    .signal {
      margin: 0.4rem 0 0.15rem;
      color: var(--muted);
    }
    .signal[data-live-at] { color: #111; font-weight: 500; }
    .week-label { margin-top: 0.95rem; }
    .week {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 0.35rem;
      margin-top: 0.45rem;
    }
    .week-col { min-width: 0; text-align: center; }
    .week-track {
      display: flex;
      align-items: flex-end;
      height: 52px;
    }
    .week-track span {
      display: block;
      width: 100%;
      border-radius: 6px 6px 3px 3px;
      background: var(--grad);
    }
    .week.is-shut .week-track span { background: var(--grad-shut); }
    .week.is-shut .week-col.is-peak small { color: #6b6b76; }
    .week-col small {
      display: block;
      margin-top: 0.28rem;
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
    }
    .week-col.is-peak small { color: #111; font-weight: 500; }
    .week-col.is-today small { text-decoration: underline; text-underline-offset: 2px; }
    .reviews-label { margin-top: 0.95rem; }
    .features {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin: 0.45rem 0 0;
      padding: 0;
      list-style: none;
    }
    .features li {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0.2rem 0.6rem;
      background: #fff;
      font-size: 13px;
      font-weight: 500;
    }
    .empty {
      margin: 0;
      padding: 1rem 1.1rem;
      border: 1px dashed var(--line);
      border-radius: 16px;
      color: var(--muted);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 1.1rem;
    }
    .chip, .foot-list button {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0.5rem 0.9rem;
      background: #fff;
      color: #111;
      font: inherit;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
    }
    .chip.is-on {
      border-color: #111;
      background: #111;
      color: #fff;
    }
    .chip:hover, .chip:focus-visible,
    .foot-list button:hover, .foot-list button:focus-visible { border-color: #111; }
    .why-grid, .pride-copy {
      display: grid;
      gap: 0.9rem;
      margin-top: 1.2rem;
    }
    .why-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .why-grid article, .pride-copy {
      padding: 1.15rem 1.15rem 1.2rem;
      border: 1px solid var(--line);
      border-radius: 18px;
      background:
        linear-gradient(var(--grad), var(--grad)) top / 100% 4px no-repeat,
        #fff;
    }
    .why-grid h3, .pride h2 { margin: 0.35rem 0 0; }
    .why-grid h3 { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
    .why-hero h1 {
      margin: 0;
      max-width: 16em;
      font-size: 64px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .why-lead {
      margin: 1.15rem 0 0;
      max-width: 40rem;
      color: #111;
      font-size: 18px;
      line-height: 1.5;
    }
    .why-num {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      background: var(--grad);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .why-meter {
      height: 10px;
      margin-top: 1rem;
      border-radius: 999px;
      background: #f3f3f6;
      overflow: hidden;
    }
    .why-meter span {
      display: block;
      width: 72%;
      height: 100%;
      border-radius: inherit;
      background: var(--grad);
    }
    .why-meter-scale {
      display: flex;
      justify-content: space-between;
      margin-top: 0.28rem;
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
    }
    .why-truth {
      display: inline-block;
      margin: 0.9rem 0 0;
      padding: 0.2rem 0.6rem;
      border: 1px solid #ff7a18;
      border-radius: 999px;
      color: #111;
      font-size: 13px;
      font-weight: 500;
    }
    .why-grid p, .pride p, .venues-band p {
      margin: 0.45rem 0 0;
      color: var(--muted);
    }
    .venues-band {
      background: #111;
      color: #fff;
      scroll-margin-top: 120px;
    }
    .venues-band .band-inner {
      width: min(1120px, calc(100% - 2.5rem));
      margin: 0 auto;
      padding: 3.2rem 0;
    }
    .venues-band .eyebrow { color: #c8c8d0; }
    .venues-band p { max-width: 36rem; color: #d5d5dc; }
    .venues-band .btn { margin-top: 1.2rem; }
    .venue-invite {
      width: min(1120px, calc(100% - 2.5rem));
      margin: 96px auto 5rem;
    }
    .venue-invite-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.35rem;
      padding: 48px 32px;
      border: 1px solid var(--line);
      border-radius: 22px;
      background:
        linear-gradient(var(--grad), var(--grad)) top / 100% 4px no-repeat,
        #fff;
      text-align: center;
    }
    .venue-invite-copy {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.35rem;
      min-width: 0;
      text-align: center;
    }
    .venue-mark {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(90deg, #FFC531, #FF7A18);
      color: #fff;
    }
    .venue-mark svg { width: 30px; height: 30px; display: block; }
    .venue-invite h2 {
      margin: 0.35rem auto 0;
      max-width: 12em;
      font-size: 36px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.1;
      text-align: center;
    }
    .venue-invite p {
      margin: 0.7rem auto 0;
      max-width: 36rem;
      color: var(--muted);
      font-size: 16px;
      text-align: center;
    }
    .venue-invite .btn { margin-top: 1.05rem; }
    .get-app {
      padding: 1.05rem 0 0;
      background: #fff;
      text-align: center;
    }
    .get-app p {
      margin: 0;
      color: #111;
      font-family: Inter, sans-serif;
      font-size: 15px;
      font-weight: 400;
      letter-spacing: 0;
      line-height: 1.35;
    }
    .get-app-badges {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      margin-top: 0.7rem;
    }
    .get-app-badges img { display: block; height: 32px; width: auto; }
    .get-app-badges .play { height: 48px; margin: -8px 0; }
    .home-venue { margin: 2.5rem 0 4.75rem; }
    .home-venue-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: min(640px, 100%);
      margin: 0 auto;
      padding: 1.45rem 1.2rem 1.35rem;
      border: 1px solid var(--line);
      border-radius: 22px;
      background: #fff;
      text-align: center;
    }
    .home-venue .venue-mark { width: 42px; height: 42px; }
    .home-venue .venue-mark svg { width: 22px; height: 22px; }
    .home-venue .eyebrow {
      margin: 0.85rem 0 0;
      font-size: 12px;
      letter-spacing: 0.12em;
    }
    .home-venue h2 {
      margin: 0.35rem auto 0;
      max-width: 12em;
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.08;
    }
    .home-venue p {
      margin: 0.7rem auto 0;
      max-width: 22rem;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.4;
    }
    .home-venue .btn {
      min-width: 168px;
      margin-top: 1.05rem;
      padding: 0.72rem 1.6rem;
    }
    .foot-simple {
      display: block;
      padding: 1.7rem 1.35rem 2rem;
    }
    .foot-brand {
      display: inline-block;
      line-height: 0;
    }
    .foot-brand img {
      display: block;
      height: 36px;
      width: auto;
    }
    .foot-logo {
      display: inline-block;
      margin-bottom: 1.4rem;
      line-height: 0;
    }
    .foot-logo img {
      display: block;
      height: 40px;
      width: auto;
    }
    .foot-simple nav {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.72rem;
      margin-top: 1.15rem;
    }
    .foot-simple nav a {
      color: #fff;
      font-family: Inter, sans-serif;
      font-size: 16px;
      font-weight: 400;
      letter-spacing: 0;
      text-decoration: none;
    }
    .foot-simple .photo-credits {
      margin: 1.35rem 0 0;
      color: #8d8d98;
      font-size: 13px;
      line-height: 1.45;
    }
    .foot-simple .legal {
      margin-top: 0.35rem;
      padding-top: 0;
      border-top: 0;
      color: #c8c8d0;
      font-size: 13px;
    }
    .site-footer {
      background: #111;
      color: #fff;
      scroll-margin-top: 120px;
    }
    .site-footer::after {
      content: "";
      display: block;
      height: 4px;
      background: linear-gradient(90deg, #ffc531, #ff7a18);
    }
    .foot-inner {
      width: min(1120px, calc(100% - 2.5rem));
      margin: 0 auto;
      padding: 2.6rem 0 1.6rem;
    }
    .foot-cols {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1.5rem;
    }
    .site-footer h3 {
      margin: 0 0 0.7rem;
      font-family: Inter, sans-serif;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .foot-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .foot-list li { margin: 0.35rem 0; }
    .foot-list span, .foot-list a, .foot-list button {
      border: 0;
      padding: 0;
      background: none;
      color: #d5d5dc;
      font-size: 16px;
      font-weight: 400;
      text-decoration: none;
      cursor: pointer;
    }
    .foot-list a:hover, .foot-list a:focus-visible,
    .foot-list button:hover, .foot-list button:focus-visible { color: #fff; }
    .legal {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      color: #b7b7c2;
      font-size: 13px;
      font-weight: 400;
    }
    .legal p { margin: 0.25rem 0; }
    @media (max-width: 759px) {
      .site-header { gap: 0.4rem; min-height: 56px; padding: 0.45rem 0.65rem; }
      .logo, .logo img { height: 26px; }
      .nav-panel { order: 4; margin-left: 0; }
      .header-auth { order: 2; margin-left: auto; gap: 0.3rem; }
      .nav-toggle { display: inline-block; order: 3; margin-left: 0.15rem; width: 36px; height: 36px; }
      .btn-login, .btn-signup { min-height: 30px; padding: 0.15rem 0.5rem; font-size: 12px; }
      .profile-btn { width: 30px; height: 30px; }
      .profile-btn svg { width: 16px; height: 16px; }
      @media (max-width: 380px) {
        .site-header { gap: 0.15rem; padding-left: 0.4rem; padding-right: 0.4rem; }
        .header-auth { gap: 0.15rem; }
        .btn-login, .btn-signup { padding: 0.1rem 0.3rem; font-size: 11px; }
        .profile-btn { width: 26px; height: 26px; }
        .nav-toggle { width: 28px; height: 28px; margin-left: 0; }
      }
      .nav-panel {
        display: none;
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        flex-direction: column;
        align-items: stretch;
        gap: 0.35rem;
        margin: 0;
        padding: 0.4rem 1rem 1rem;
        background: #fff;
        border-bottom: 1px solid var(--line);
      }
      .site-header.is-open .nav-panel { display: flex; }
      .site-nav { flex-direction: column; align-items: stretch; gap: 0; }
      .site-nav a { padding: 0.75rem 0; border-bottom: 1px solid var(--line); }
      .app-banner { font-size: 12.5px; padding: 0.45rem 0.75rem; }
      .cards, .why-grid, .foot-cols { grid-template-columns: minmax(0, 1fr); }
      .soon h1, .city-hero h1, .why-hero h1, .cities-page h1 { font-size: 42px; }
      .block h2, .why h2, .pride h2, .venues-band h2, .venue-invite h2 { font-size: 28px; }
      .venue-invite-card { width: 100%; }
      .venue-invite-copy { width: 100%; }
      .venues-band .btn { width: 100%; }
      .meter-head { flex-direction: column; align-items: flex-start; gap: 0.15rem; }
      .jump-menu {
        display: flex;
        flex-direction: column;
        margin-top: 1.15rem;
        border-top: 1px solid var(--line);
      }
      .jump-menu button {
        display: flex;
        align-items: center;
        width: 100%;
        min-height: 48px;
        padding: 0.35rem 0;
        border: 0;
        border-bottom: 1px solid var(--line);
        border-radius: 0;
        background: transparent;
        color: #111;
        font: inherit;
        font-size: 16px;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
      }
      .jump-menu button:hover,
      .jump-menu button:focus-visible { color: var(--orange); }
      .menu-back {
        position: fixed;
        z-index: 20;
        right: 1rem;
        bottom: 1.15rem;
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        min-height: 44px;
        padding: 0.55rem 1.1rem;
        border: 0;
        border-radius: 999px;
        background: #111;
        color: #fff;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        font: inherit;
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
      }
      .menu-back::before {
        content: "";
        width: 0.45rem;
        height: 0.45rem;
        border-left: 2px solid #fff;
        border-top: 2px solid #fff;
        transform: translateY(1px) rotate(45deg);
      }
      .menu-back[hidden] { display: none; }
    }
    @media (min-width: 760px) {
      .get-app { display: none; }
      .home-sheet {
        width: min(1120px, calc(100% - 3rem));
        padding-top: 2.6rem;
      }
      .hero { padding: 1.6rem 0 1rem; }
      .hero-mark { width: 84px; height: 84px; margin-bottom: 1.15rem; }
      .hero h1 { font-size: 56px; }
      .subhead { font-size: 18px; margin-top: 1.1rem; }
      .area-search,
      .area-suggest,
      .area-block {
        width: min(760px, 100%);
        margin-left: auto;
        margin-right: auto;
      }
      .area-search { margin-top: 2.6rem; }
      .area-search input { height: 68px; font-size: 17px; }
      .area-search button { height: 68px; }
      .area-block { margin-top: 2.6rem; }
      .area-label { font-size: 28px; }
      .area-chip { font-size: 15px; min-height: 46px; }
      .scenes {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 500px;
        margin-top: 6.5rem;
        padding: 3.2rem 1.5rem;
      }
      .scenes-inner { width: min(1120px, 100%); }
      .scenes h2 { font-size: 34px; margin-bottom: 1.25rem; }
      .scene-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 1rem;
      }
      .home-venue { margin-top: 4rem; margin-bottom: 6.5rem; }
      .foot-inner { display: none; }
      .foot-simple {
        width: min(1120px, calc(100% - 3rem));
        margin: 0 auto;
        padding: 2.4rem 0 2rem;
        text-align: left;
      }
      .foot-simple nav {
        flex-direction: column;
        align-items: flex-start;
      }
    }
    .cities-page h1 {
      margin: 0;
      font-size: 36px;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.05;
    }
    .cities-brand {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .cities-brand img {
      width: 68px;
      height: 68px;
      margin: 0 auto 0.85rem;
      object-fit: contain;
    }
    .cities-brand .subhead {
      max-width: 40rem;
      margin-top: 1.4rem;
    }
    .cities-layout {
      display: grid;
      gap: 1rem;
      margin-top: 4.25rem;
    }
    .world-svg {
      width: 100%;
      height: auto;
      display: block;
      overflow: hidden;
      border-radius: 20px;
      background: #f6f6f8;
    }
    .world-svg .land {
      fill: #d5d5de;
      stroke: #f6f6f8;
      stroke-width: 2.5;
      stroke-linejoin: round;
      cursor: pointer;
    }
    .world-svg g.is-on .land { fill: #ff7a18; }
    .world-svg g:focus-visible { outline: none; }
    .world-svg g:focus-visible .land { stroke: #111; stroke-width: 3; }
    .continent-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.5rem;
    }
    .continent-list button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      width: 100%;
      min-height: 48px;
      padding: 0.7rem 0.95rem;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fff;
      color: #111;
      font: inherit;
      font-size: 16px;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }
    .continent-list button .continent-count {
      flex: none;
      color: #ff7a18;
      font-family: Poppins, sans-serif;
      font-size: 16px;
      font-weight: 700;
    }
    .continent-list button.is-on {
      border-color: #ff7a18;
      background: #fff7f2;
    }
    .continent-cities { margin-top: 0.2rem; }
    .continent-hint {
      margin: 0;
      color: var(--muted);
      font-size: 15px;
    }
    .continent-hint[hidden],
    .continent-cities h2[hidden] { display: none; }
    .continent-cities h2 {
      margin: 0;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.03em;
      scroll-margin-top: 120px;
    }
    .continent-cities ul {
      list-style: none;
      margin: 0.35rem 0 0;
      padding: 0;
    }
    .continent-cities a {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      min-height: 52px;
      padding: 0.8rem 0;
      border-bottom: 1px solid var(--line);
      color: #111;
      font-family: Poppins, sans-serif;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
      text-decoration: none;
    }
    .continent-cities a span {
      color: var(--muted);
      font-family: Inter, sans-serif;
      font-size: 14px;
      font-weight: 500;
    }
    .continent-empty {
      margin: 0.55rem 0 0;
      color: var(--muted);
      font-size: 15px;
    }
    .pride-page .area-search,
    .pride-page .area-suggest {
      width: min(640px, 100%);
      margin-right: auto;
      margin-left: auto;
      text-align: left;
    }
    .pride-simple li[hidden] { display: none; }
    .pride-cal {
      width: min(640px, 100%);
      margin: 1.75rem auto 0;
    }
    .pride-simple {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .pride-simple li {
      padding: 0.85rem 0;
      border-bottom: 1px solid var(--line);
    }
    .pride-when {
      margin: 0;
      color: #ff7a18;
      font-family: Poppins, sans-serif;
      font-size: 14px;
      font-weight: 700;
    }
    .pride-what {
      margin: 0.15rem 0 0;
      font-family: Poppins, sans-serif;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .pride-where {
      margin: 0.15rem 0 0;
      color: var(--muted);
      font-size: 14px;
    }
    .pride-where a { color: #111; font-weight: 600; text-decoration: none; }
    .pride-where a:hover, .pride-where a:focus-visible { color: #ff7a18; }
    .pride-source {
      display: inline-block;
      margin-top: 0.25rem;
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
    }
    .pride-source:hover, .pride-source:focus-visible { color: #111; }
    .pride-none {
      margin: 0.4rem 0 0;
      color: var(--muted);
      text-align: center;
    }
    .pride-none[hidden] { display: none; }
    @media (min-width: 760px) {
      .cities-layout {
        grid-template-columns: minmax(0, 1.45fr) minmax(240px, 0.72fr);
        align-items: start;
        gap: 1.5rem;
        margin-top: 5rem;
      }
      .continent-cities { grid-column: 1 / -1; }
      .cities-page h1 { font-size: 48px; }
      .cities-brand img { width: 84px; height: 84px; margin-bottom: 1.15rem; }
      .pride-cal { margin-top: 2.25rem; }
      .tonight-list { grid-template-columns: 1fr 1fr; gap: 0.75rem; }
      .tonight-row {
        padding: 0.9rem 1rem;
        border: 1px solid var(--line);
        border-radius: 16px;
      }
      .sheet {
        top: 0;
        right: 0;
        bottom: 0;
        left: auto;
        width: min(420px, 100%);
        max-height: none;
        border-radius: 0;
      }
      .sheet.is-full { width: min(560px, 100%); }
    }
    .tonight-hero, .tonight-block { width: min(1120px, calc(100% - 2.3rem)); margin: 0 auto; }
    .tonight-hero {
      position: relative;
      width: 100%;
      max-width: none;
      margin: 0;
      padding: 0;
      overflow: visible;
      color: #111;
    }
    .tonight-hero-photo {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center 42%;
    }
    .tonight-hero-shade {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0) calc(100% - 210px), rgba(255, 255, 255, 0.55) calc(100% - 165px), rgba(255, 255, 255, 0.9) calc(100% - 115px), #fff calc(100% - 35px), #fff 100%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.58), rgba(255, 255, 255, 0.68)),
        rgba(255, 255, 255, 0.42);
    }
    .tonight-hero-inner {
      position: relative;
      width: min(1120px, calc(100% - 2.3rem));
      margin: 0 auto;
      padding: 2.4rem 0 1.5rem;
    }
    .tonight-hero h1 { color: #111; }
    .tonight-hero .subhead { color: var(--muted); }
    .tonight-hero .hero-mark { width: 120px; height: 120px; }
    .pride-hero .tonight-hero-photo { object-position: center 32%; }
    .pride-hero .tonight-hero-inner { padding-bottom: 4.2rem; }
    .pride-page.block { padding-top: 0.6rem; }
    .pride-page .outlook { margin-top: 0.4rem; }
    .pride-page .hero-mark { width: 120px; height: 120px; }
    @media (min-width: 760px) {
      .tonight-hero .hero-mark,
      .pride-page .hero-mark { width: 156px; height: 156px; }
      .tonight-hero-inner { padding: 3.4rem 0 1.7rem; }
      .pride-hero .tonight-hero-inner { padding-bottom: 5rem; }
    }
    .tonight-block { padding: var(--section) 0 0; }
    .pride-upcoming[hidden], #weekend[hidden] { display: none; }
    .pride-upcoming h2 { display: flex; align-items: center; gap: 0.55rem; margin: 0 0 0.65rem; font-size: 28px; font-weight: 800; }
    .subhead .pride-flag {
      display: inline-block;
      width: 22px;
      height: 16px;
      margin-left: 0.35rem;
      vertical-align: -3px;
      border-radius: 2px;
    }
    .pride-upcoming article + article { margin-top: 0.85rem; }
    .pride-count { margin: 0.15rem 0 0; color: var(--muted); font-size: 14px; }
    #tonight, #weekend { scroll-margin-top: 120px; }
    .tonight-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.35rem 0.8rem; }
    .tonight-head h2 { margin: 0; font-size: 28px; font-weight: 800; }
    .now-facts {
      display: inline-flex;
      flex: 1 1 0;
      min-width: 0;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.3rem 0.45rem;
    }
    .now-facts .now-day,
    .now-facts .now-date,
    .now-facts .now-time,
    .now-facts .now-temp {
      font-family: Inter, sans-serif;
      font-size: 14px;
      font-weight: 400;
      letter-spacing: 0;
      color: var(--muted);
    }
    .now-facts .wx {
      display: inline-flex;
      width: 1.15rem;
      height: 1.15rem;
    }
    .now-facts .wx[hidden] { display: none; }
    .now-facts .wx.is-rain { color: #2f6fed; }
    .now-facts .wx.is-snow { color: #6aa7e8; }
    .now-facts .wx svg { width: 100%; height: 100%; display: block; }
    .rank-note { margin: 0; color: var(--muted); font-size: 14px; }
    .vibe-chip {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--text);
      font: inherit;
      font-weight: 500;
      cursor: pointer;
    }
    .vibe-row { display: flex; gap: 0.45rem; overflow-x: auto; padding: 0.85rem 0 0.2rem; }
    .vibe-chip { flex: none; border-radius: 999px; padding: 0.4rem 0.8rem; }
    .vibe-chip[aria-pressed="true"] { background: #111; color: #fff; border-color: #111; }
    .vibe-chip[hidden], #tonight-list[hidden], #weekend-list[hidden], #weekend-peak[hidden], #for-you[hidden] { display: none; }
    .event-card { cursor: default; }
    .event-card .pride-when, .event-card .pride-where, .event-card .pride-source { grid-column: 1 / -1; margin: 0; }
    .event-busy {
      grid-column: 2;
      grid-row: 1;
      margin: 0;
      font-family: Poppins, sans-serif;
      font-weight: 700;
      background: var(--grad);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .cal-nav { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 0.75rem; margin-top: 0.85rem; }
    .cal-nav p { margin: 0; font-family: Poppins, sans-serif; font-weight: 700; font-size: 18px; }
    .cal-pick { display: flex; align-items: center; gap: 0.45rem; }
    .cal-pick select {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      color: #111;
      font-family: Poppins, sans-serif;
      font-weight: 700;
      font-size: 16px;
      padding: 0.4rem 0.75rem;
      cursor: pointer;
    }
    .cal-nav button {
      width: 36px;
      height: 36px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      color: #111;
      font: inherit;
      font-size: 20px;
      cursor: pointer;
    }
    .cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0.55rem; margin-top: 1.35rem; }
    .cal-dow { color: var(--muted); font-size: 12px; text-align: center; }
    .cal-day {
      min-height: 52px;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .cal-day.is-out { color: #b5b5be; }
    .cal-day.has-event { box-shadow: inset 0 -3px 0 #ff7a18; }
    .cal-day.is-on { background: #111; color: #fff; }
    .cal-agenda { margin-top: 2.25rem; }
    .cal-empty { margin: 0; color: var(--muted); }
    #outlook-body > .cal-empty { margin-top: 2.25rem; }
    .outlook { width: min(1120px, calc(100% - 2.3rem)); margin: 3.5rem auto 0; }
    .event-card .tonight-name { display: flex; align-items: center; gap: 0.4rem; margin: 0; }
    .tonight-list { list-style: none; margin: 0.75rem 0 0; padding: 0; display: grid; gap: 0; }
    .tonight-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.1rem 0.75rem;
      width: 100%;
      padding: 0.85rem 0;
      border: 0;
      border-bottom: 1px solid var(--line);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .tonight-name { font-weight: 500; }
    .tonight-score { display: flex; flex-direction: column; align-items: flex-end; gap: 0.1rem; }
    .forecast-badge {
      font-family: Poppins, sans-serif;
      font-weight: 700;
      background: var(--grad);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .forecast-note { color: var(--muted); font-size: 12px; font-weight: 500; line-height: 1.2; text-align: right; }
    .tonight-live {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 0.45rem;
      margin-top: 0.2rem;
      color: #111;
      font-size: 14px;
      font-weight: 600;
    }
    .tonight-live .live-dot { display: inline-block; margin: 0; flex: none; }
    .tonight-hours { grid-column: 1 / -1; font-size: 14px; }
    .tonight-concepts { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.15rem; }
    .tonight-concepts span {
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      background: #f4f4f7;
      color: #111;
      font-size: 12px;
    }
    .forecast-explain { margin: 0.35rem 0 0; color: var(--muted); font-size: 14px; }
    .live-dot {
      width: 8px;
      height: 8px;
      margin-left: 0.35rem;
      border-radius: 50%;
      background: #1f9d55;
      justify-self: end;
    }
    .tonight-meta, .tonight-when { grid-column: 1 / -1; color: var(--muted); font-size: 14px; }
    .tonight-empty { color: var(--muted); }
    .tonight-empty a { color: #ff7a18; font-weight: 600; }
    .closed-block { margin-top: 1.35rem; }
    .closed-block[hidden] { display: none; }
    .closed-label { margin: 0; color: var(--muted); font-size: 14px; font-weight: 500; }
    .closed-list { list-style: none; margin: 0.35rem 0 0; padding: 0; }
    .closed-row {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.1rem;
      width: 100%;
      padding: 0.55rem 0;
      border: 0;
      border-bottom: 1px solid var(--line);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .closed-cat, .closed-hours { color: var(--muted); font-size: 14px; }
    .show-more { margin-top: 0.35rem; }
    .show-more summary { cursor: pointer; font-weight: 500; }
    .now-bar {
      position: relative;
      z-index: 5;
      width: min(560px, 100%);
      margin: 1.35rem auto 0;
    }
    #now-line {
      width: 100%;
      max-width: 100%;
      margin: 0;
      flex-wrap: nowrap;
      justify-content: center;
      gap: 0.75rem;
      padding: 1.05rem 1.5rem;
      border: 0;
      border-radius: 999px;
      background: #fff;
      box-shadow: 0 10px 28px rgba(17, 17, 17, 0.28);
      color: #111;
      font: inherit;
      cursor: pointer;
    }
    .now-flag, .now-search { flex: none; white-space: nowrap; }
    .now-flag { font-size: 28px; line-height: 1; }
    .now-place {
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #now-line .now-place {
      font-family: Inter, sans-serif;
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 0;
      line-height: 1.2;
    }
    .now-search { width: 24px; height: 24px; }
    @media (max-width: 759px) {
      .now-bar { width: 100%; margin-top: 1.1rem; }
      #now-line { gap: 0.55rem; padding: 0.9rem 1.05rem; }
      #now-line .now-place { font-size: 18px; }
      .now-flag { font-size: 22px; }
      .now-search { width: 20px; height: 20px; }
    }
    .city-picker {
      position: absolute;
      z-index: 40;
      top: calc(100% + 0.45rem);
      left: 0;
      width: 100%;
      padding: 0.75rem;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: #fff;
      transform-origin: top center;
      opacity: 0;
      transform: scale(0.96);
    }
    .city-picker.is-on {
      opacity: 1;
      transform: none;
      transition: opacity 180ms ease, transform 180ms ease;
    }
    .city-picker .area-search { margin: 0; }
    .city-picker .area-search input { height: 44px; font-size: 16px; }
    .city-picker .area-search button { width: 44px; height: 44px; }
    .city-picker ul { list-style: none; margin: 0.5rem 0 0; padding: 0; max-height: 280px; overflow: auto; }
    .city-picker li button {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      width: 100%;
      padding: 0.65rem 0.35rem;
      border: 0;
      border-bottom: 1px solid var(--line);
      background: transparent;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .city-picker .picker-city {
      min-width: 0;
      overflow: hidden;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .city-picker .picker-country {
      flex: none;
      color: var(--muted);
      font-size: 14px;
      font-weight: 400;
    }
    .city-picker li:last-child button { border-bottom: 0; }
    .city-picker .picker-empty { margin: 0.7rem 0.2rem 0.2rem; color: var(--muted); font-size: 14px; }
    .sheet-back {
      position: fixed;
      inset: 0;
      z-index: 50;
      background: rgba(17, 17, 17, 0.28);
      opacity: 0;
      transition: opacity 200ms linear;
    }
    .sheet-back.is-on { opacity: 1; }
    .sheet-back[hidden] { display: none; }
    .sheet {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      border-radius: 18px 18px 0 0;
      background: #fff;
      overflow: auto;
      transform: translateY(110%);
      transition: transform 280ms cubic-bezier(0.32, 0.72, 0, 1);
    }
    .sheet-back.is-on .sheet { transform: none; }
    .sheet.is-full { max-height: 100vh; border-radius: 0; }
    .sheet-handle {
      width: 42px;
      height: 4px;
      margin: 0.7rem auto;
      border: 0;
      border-radius: 999px;
      background: #d8d8e0;
      cursor: grab;
    }
    .sheet-body { padding: 0 1.15rem 1.5rem; }
    .sheet-body h3 { margin: 0; font-size: 28px; }
    .sheet-save {
      border: 0;
      background: transparent;
      color: #111;
      font: inherit;
      cursor: pointer;
    }
    .sheet-save svg { width: 22px; height: 22px; fill: none; stroke: currentColor; }
    .sheet-save.is-on svg { fill: currentColor; stroke: none; }
    .profile-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 1px solid #111;
      border-radius: 999px;
      background: #fff;
      color: #111;
      cursor: pointer;
    }
    .profile-btn svg { width: 18px; height: 18px; display: block; }
    .auth-skel {
      display: inline-block;
      width: 64px;
      height: 32px;
      border-radius: 999px;
      background: linear-gradient(90deg, #f3f3f6 0%, #fff 50%, #f3f3f6 100%);
      background-size: 200% 100%;
      animation: shimmer 1.1s ease-in-out infinite;
    }
    .auth-skel.is-wide { width: 118px; }
    .auth-skel[hidden] { display: none; }
    @keyframes shimmer {
      from { background-position: 100% 0; }
      to { background-position: -100% 0; }
    }
    .account-back {
      position: fixed;
      inset: 0;
      z-index: 60;
      background: rgba(17, 17, 17, 0.28);
      opacity: 0;
      transition: opacity 200ms linear;
    }
    .account-back.is-on { opacity: 1; }
    .account-back[hidden] { display: none; }
    .account-sheet {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      border-radius: 18px 18px 0 0;
      background: #fff;
      overflow: auto;
      transform: translateY(110%);
      transition: transform 280ms cubic-bezier(0.32, 0.72, 0, 1);
    }
    .account-back.is-on .account-sheet { transform: none; }
    .account-body { padding: 0 1.15rem 1.5rem; transition: opacity 180ms ease; }
    .account-body.is-out { opacity: 0; }
    .account-body h3 { margin: 0 0 0.35rem; font-size: 28px; }
    .account-menu { list-style: none; margin: 0.4rem 0 0; padding: 0; }
    .account-menu button {
      display: block;
      width: 100%;
      padding: 0.9rem 0;
      border: 0;
      border-bottom: 1px solid var(--line);
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 16px;
      text-align: left;
      cursor: pointer;
    }
    .auth-google, .auth-apple, .auth-send, .account-body .btn-login, .account-body .btn-signup {
      display: flex;
      width: 100%;
      min-height: 44px;
      align-items: center;
      justify-content: center;
      margin-top: 0.55rem;
      border-radius: 999px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .auth-google, .account-body .btn-login {
      border: 1px solid #111;
      background: #fff;
      color: #111;
    }
    .auth-apple, .auth-send, .account-body .btn-signup {
      border: 0;
      background: #111;
      color: #fff;
    }
    .auth-send { background: #ff7a18; color: #111; }
    .account-field, .sheet-body textarea, .account-body textarea, .account-body select {
      display: block;
      width: 100%;
      margin-top: 0.7rem;
      padding: 0.75rem 0.85rem;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fff;
      color: inherit;
      font: inherit;
    }
    .account-body textarea, .sheet-body textarea { min-height: 88px; resize: vertical; }
    .auth-note, .auth-error, .account-empty { margin: 0.75rem 0 0; color: var(--muted); font-size: 14px; }
    .auth-error { color: #111; }
    .auth-prompt { margin: 0 0 0.8rem; font-weight: 600; }
    .account-check { display: flex; gap: 0.55rem; align-items: flex-start; margin-top: 0.7rem; font-size: 14px; }
    .google-slot { display: flex; justify-content: center; min-height: 44px; margin-top: 0.55rem; }
    .google-slot:empty { display: none; }
    .toast {
      position: fixed;
      left: 50%;
      bottom: 1.25rem;
      z-index: 70;
      transform: translateX(-50%);
      margin: 0;
      padding: 0.7rem 1rem;
      border-radius: 999px;
      background: #111;
      color: #fff;
      font-size: 14px;
    }
    .toast[hidden] { display: none; }
    @media (min-width: 760px) {
      .account-sheet {
        top: 50%;
        right: auto;
        bottom: auto;
        left: 50%;
        width: min(420px, calc(100% - 2rem));
        max-height: min(680px, 86vh);
        border-radius: 18px;
        transform: translate(-50%, -46%);
      }
      .account-back.is-on .account-sheet { transform: translate(-50%, -50%); }
      .account-sheet .sheet-handle { display: none; }
    }
    .curve, .week-curve { width: 100%; height: 112px; margin-top: 0.35rem; }
    .verified { color: #1f7a43; font-size: 13px; font-weight: 500; }
    @media (min-width: 760px) {
      .tonight-list { grid-template-columns: 1fr 1fr; gap: 0.75rem; }
      .tonight-row {
        padding: 0.9rem 1rem;
        border: 1px solid var(--line);
        border-radius: 16px;
      }
      .sheet {
        top: 0;
        right: 0;
        bottom: 0;
        left: auto;
        width: min(420px, 100%);
        max-height: none;
        border-radius: 0;
      }
      .sheet.is-full { width: min(560px, 100%); }
      .sheet { transform: translateX(16px); }
      .sheet-back.is-on .sheet { transform: none; }
      .tonight-list { gap: var(--card-gap); }
    }
    #city-rails, #city-rails * { overflow-anchor: none; }
    main.view { transition: opacity 320ms ease; }
    main.view.is-leaving { opacity: 0; transition-duration: 220ms; pointer-events: none; }
    main.view.is-entering { opacity: 0; transition: none; }
    #now-line, #city-rails { transition: opacity 320ms ease, transform 320ms ease; }
    #now-line.is-out, #city-rails.is-out { opacity: 0; pointer-events: none; }
    #city-rails.is-out { transform: translateY(8px); }
    #now-line.is-in, #city-rails.is-in { opacity: 0; transition: none; }
    #city-rails.is-in { transform: translateY(10px); }
    .more-clip { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 240ms ease; }
    .show-more[open] .more-clip { grid-template-rows: 1fr; }
    .more-clip-inner { overflow: hidden; }
    .show-more[open] .more-clip .tonight-list { animation: rise 240ms ease-out; }
    .rise { animation: rise 240ms ease-out both; }
    @keyframes rise {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    }
    #why { background: #fff; }
    #venues { scroll-margin-top: 96px; }
    .yd-hero {
      position: relative;
      display: flex;
      align-items: flex-end;
      min-height: 92svh;
      overflow: hidden;
      color: #fff;
    }
    .yd-hero-photo, .yd-steps > img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .yd-hero-shade {
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, rgba(17, 17, 17, 0.28), rgba(17, 17, 17, 0.86));
    }
    .yd-steps-shade {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(#ffc531, #ff7a18) top / 100% 4px no-repeat,
        linear-gradient(180deg, rgba(17, 17, 17, 0.28), rgba(17, 17, 17, 0.86));
    }
    .yd-hero-inner, .yd-steps-inner, .yd-block, .yd-trust, .yd-final, .yd-numbers {
      width: min(1120px, calc(100% - 2.3rem));
      margin: 0 auto;
    }
    .yd-hero-inner {
      position: relative;
      display: grid;
      gap: 1.6rem;
      padding: 3.2rem 0 2.4rem;
    }
    .yd-hero .eyebrow, .yd-steps .eyebrow { color: #ffd9a8; }
    .yd-hero h1, .yd-block h2, .yd-steps h2, .yd-final h2 {
      margin: 0.35rem 0 0;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.05;
    }
    .yd-hero h1 { max-width: 11em; font-size: 42px; }
    .yd-sub, .yd-block p, .yd-trust p, .yd-pillar p, .yd-friction {
      color: #d7d7de;
      font-size: 17px;
      line-height: 1.5;
    }
    .yd-sub { max-width: 38rem; margin: 1rem 0 0; }
    .yd-cta-pair { display: grid; gap: 0.85rem; margin-top: 1.4rem; }
    .yd-cta-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.7rem; }
    .yd-friction { margin: 0; color: #c8c8d0; font-size: 14px; }
    .yd-hero .yd-friction { color: #efe7dc; }
    .btn.yd-go {
      border: 0;
      background: linear-gradient(90deg, #ffc531, #ff7a18);
      color: #111;
      font-weight: 700;
    }
    .yd-proof {
      display: block;
      padding: 1rem 1.05rem 1.05rem;
      border-radius: 16px;
      background: #fff;
      color: #111;
      text-decoration: none;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
    }
    .yd-proof-kicker, .yd-proof-meta, .yd-proof-line { margin: 0; color: #6b6b76; font-size: 14px; }
    .yd-proof-name {
      margin: 0.3rem 0 0;
      font-family: Poppins, sans-serif;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .yd-proof-meta { margin-top: 0.15rem; }
    .yd-proof-score {
      display: flex;
      align-items: baseline;
      gap: 0.45rem;
      margin: 0.8rem 0 0;
      color: #6b6b76;
      font-size: 14px;
    }
    .yd-proof-score span {
      font-family: Poppins, sans-serif;
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.03em;
      background: linear-gradient(90deg, #ffc531, #ff7a18);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .yd-proof-line { margin-top: 0.35rem; }
    .yd-block { padding: 4.2rem 0 0; }
    .yd-block h2, .yd-final h2 { max-width: 16em; font-size: 36px; color: #111; }
    .yd-block p { margin: 0.9rem 0 0; color: #3a3a44; }
    .yd-split { display: grid; gap: 1.4rem; align-items: center; }
    .yd-split figure { margin: 0; }
    .yd-split img, .yd-pillars img {
      display: block;
      width: 100%;
      height: 240px;
      object-fit: cover;
      border-radius: 18px;
    }
    .yd-points { margin: 1rem 0 0; padding: 0; list-style: none; }
    .yd-points li {
      margin-top: 0.55rem;
      padding-left: 0.9rem;
      border-left: 3px solid #ff7a18;
      color: #111;
      font-size: 16px;
      line-height: 1.4;
    }
    .yd-block .yd-cta-row { margin-top: 1.3rem; }
    .yd-block .yd-friction, .yd-final .yd-friction { color: #6b6b76; }
    .yd-pillars { display: grid; gap: 1.3rem; margin-top: 1.5rem; }
    .yd-pillars h3 { margin: 0.8rem 0 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
    .yd-numbers {
      display: grid;
      gap: 1rem;
      margin-top: 4.2rem;
      padding: 1.6rem 0;
      border-top: 1px solid #ececf1;
      border-bottom: 1px solid #ececf1;
    }
    .yd-numbers p { margin: 0; color: #6b6b76; font-size: 15px; }
    .yd-numbers strong {
      display: block;
      color: #111;
      font-family: Poppins, sans-serif;
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1;
    }
    .yd-steps {
      position: relative;
      margin-top: 4.2rem;
      overflow: hidden;
      color: #fff;
    }
    .yd-steps-inner { position: relative; padding: 3.4rem 0; }
    .yd-steps h2 { color: #fff; font-size: 36px; }
    .yd-steps ol { margin: 1.2rem 0 0; padding: 0; list-style: none; display: grid; gap: 0.8rem; }
    .yd-steps li { display: flex; align-items: baseline; gap: 0.7rem; font-size: 18px; }
    .yd-steps li span {
      font-family: Poppins, sans-serif;
      font-weight: 800;
      background: linear-gradient(90deg, #ffc531, #ff7a18);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .yd-trust { padding: 2.2rem 0 0; }
    .yd-trust p { margin: 0; color: #3a3a44; font-size: 17px; line-height: 1.5; }
    .yd-final { padding: 3.2rem 0 4.5rem; }
    @media (min-width: 760px) {
      .yd-hero { min-height: calc(100svh - 76px); }
      .yd-hero-inner { grid-template-columns: minmax(0, 1.15fr) minmax(260px, 0.75fr); align-items: end; padding-top: 5rem; }
      .yd-hero h1 { font-size: 64px; }
      .yd-split { grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 2.4rem; }
      .yd-split img { height: 360px; }
      .yd-pillars { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.1rem; }
      .yd-numbers { grid-template-columns: repeat(5, minmax(0, 1fr)); padding: 2rem 0; }
      .yd-steps ol { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .yd-block h2, .yd-steps h2, .yd-final h2 { font-size: 48px; }
    }
  </style>
</head>
<body>
  <!-- Sauna icon: Freepik via SVG Repo, CC BY 3.0. Flame icon: UXWing. Night photo: Phat Doan, Pexels. -->
  <div class="top-stack">
    <p class="app-banner" hidden>Finding Dorothy experience is much better <a id="app-link" href="https://play.google.com/store" target="_blank" rel="noopener noreferrer">using the App</a></p>
    <header class="site-header">
      <a class="logo" href="#home" aria-label="FindingDorothy">
        <img src="assets/logo-v4-warm.jpg" alt="FindingDorothy">
      </a>
      <div class="header-auth" id="header-auth">
        <button type="button" class="profile-btn" id="profile-btn" aria-label="Account">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 19.2c1.4-3 3.8-4.4 7-4.4s5.6 1.4 7 4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <span class="auth-skel" id="auth-skel" hidden></span>
        <span class="auth-skel is-wide" id="auth-skel-wide" hidden></span>
        <button type="button" class="btn-login" id="login-btn">Login</button>
        <button type="button" class="btn-signup" id="signup-btn">Sign up for free</button>
      </div>
      <button type="button" class="nav-toggle" aria-label="Open menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <div class="nav-panel">
        <nav class="site-nav" aria-label="Primary">
          <a href="#home">Home</a>
          <a href="#pride">Fun Calendar</a>
          <a href="#why">Why FindingDorothy</a>
        </nav>
      </div>
    </header>
  </div>
  <main class="view" id="home">
${homeTonightHtml()}
  </main>
${whyPageHtml()}
${pridePageHtml()}
  <footer class="site-footer">
    <div class="foot-simple">
      <a class="foot-brand" href="#home">
        <img src="assets/logo-reversed.jpg" alt="FindingDorothy">
      </a>
      <nav aria-label="Footer">
        <a href="#home">Home</a>
        <a href="#pride">Fun Calendar</a>
        <a href="#why">Why FindingDorothy</a>
        <a href="#login" id="foot-login">Login</a>
        <a href="#signup" id="foot-signup">Sign up for free</a>
      </nav>
      <p class="photo-credits">Photos: Dibakar Roy, Yura Forrat, Anastasiya Badun, cottonbro studio, Phat Doan, Pexels.</p>
      <p class="legal">© 2026 FindingDorothy</p>
    </div>
  </footer>
  <div class="account-back" id="account-back" hidden>
    <div class="account-sheet" id="account-sheet" role="dialog" aria-modal="true" aria-label="Account">
      <button type="button" class="sheet-handle" id="account-handle" aria-label="Drag to close"></button>
      <div class="account-body" id="account-body"></div>
    </div>
  </div>
  <p class="toast" id="toast" hidden role="status"></p>
  <script>
    const cities = ${cityLookup};
    const tonight = ${JSON.stringify(tonightData)};
    const prideCities = ${prideCityLookup};
    const continentNames = ${continentNames};
    const rainIcon = ${JSON.stringify(RAIN_ICON)};
    const snowIcon = ${JSON.stringify(SNOW_ICON)};
    const authConfig = ${JSON.stringify(AUTH)};
    const header = document.querySelector('.site-header');
    const toggle = document.querySelector('.nav-toggle');
    const appLink = document.getElementById('app-link');
    const appleStore = 'https://apps.apple.com/';
    const playStore = 'https://play.google.com/store';
    const agent = navigator.userAgent || '';
    const applePhone = /iPhone|iPad|iPod/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const android = /Android/.test(agent);
    const apple = applePhone || /Macintosh|Mac OS X/.test(agent);
    if (applePhone || android) document.querySelector('.app-banner').hidden = false;
    if (android) appLink.href = playStore;
    else if (apple) appLink.href = appleStore;
    const areaSearch = document.getElementById('area-search');
    const suggest = document.getElementById('area-suggest');
    const areaBlock = document.getElementById('area-block');
    const areaLabel = document.getElementById('area-label');
    const picks = document.getElementById('area-picks');

    function closeMenu() {
      header.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
    }

    toggle.addEventListener('click', () => {
      const open = header.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    header.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

    function playView(id, anchor) {
      const shown = document.querySelector('main.view:not([hidden])');
      const same = shown && shown.id === id;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const atTop = window.scrollY < 2;
      const finish = () => {
        document.querySelectorAll('main.view').forEach((view) => {
          view.hidden = view.id !== id;
          view.classList.remove('is-leaving', 'is-entering');
        });
        if (anchor) {
          requestAnimationFrame(() => {
            document.getElementById(anchor)?.scrollIntoView({ behavior: 'auto', block: 'start' });
          });
          return;
        }
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      };
      if (!viewReady || reduce || (same && (anchor || atTop))) {
        finish();
        return;
      }
      if (shown) shown.classList.add('is-leaving');
      window.setTimeout(() => {
        finish();
        const next = document.getElementById(id);
        if (!next) return;
        next.classList.add('is-entering');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => next.classList.remove('is-entering'));
        });
      }, 220);
    }

    function settleView(id, event) {
      if (event) event.preventDefault();
      closeMenu();
      if (id === 'home') {
        if (location.hash) history.pushState(null, '', location.pathname + location.search);
      } else if (location.hash !== '#' + id) {
        history.pushState(null, '', '#' + id);
      }
      playView(id, null);
    }
    document.querySelectorAll('a.logo, a.foot-brand, a[href="#home"], a[href="#pride"], a[href="#why"]').forEach((link) => {
      link.addEventListener('click', (event) => {
        const id = (link.getAttribute('href') || '#home').slice(1) || 'home';
        settleView(id, event);
      });
    });

    function paintClock() {
      const clock = document.querySelector('#now-facts [data-clock]');
      if (!clock || !clock.dataset.tz) return;
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: clock.dataset.tz,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hourCycle: 'h23',
      });
      const bag = {};
      for (const part of fmt.formatToParts(new Date())) bag[part.type] = part.value;
      let hour = Number(bag.hour);
      if (hour === 24) hour = 0;
      const minute = String(bag.minute).padStart(2, '0');
      const suffix = hour >= 12 ? 'PM' : 'AM';
      clock.textContent = (hour % 12 || 12) + ':' + minute + ' ' + suffix;
      const day = document.querySelector('#now-facts [data-day]');
      const date = document.querySelector('#now-facts [data-date]');
      if (day) day.textContent = bag.weekday;
      if (date) date.textContent = bag.month + ' ' + Number(bag.day);
    }
    paintClock();
    setInterval(paintClock, 1000);

    function isSnowCode(code) {
      return (code >= 71 && code <= 77) || code === 85 || code === 86;
    }

    function paintSky(node, kind) {
      const icon = node.querySelector('[data-wx]');
      if (!icon) return;
      icon.classList.toggle('is-rain', kind === 'rain');
      icon.classList.toggle('is-snow', kind === 'snow');
      icon.hidden = !kind;
      icon.setAttribute('aria-label', kind === 'snow' ? 'Snowing' : kind === 'rain' ? 'Raining' : '');
      icon.innerHTML = kind === 'snow' ? snowIcon : kind === 'rain' ? rainIcon : '';
    }

    function applyWeather(node, report) {
      const temp = node.querySelector('[data-temp]');
      if (temp && Number.isFinite(report.tempC)) {
        const c = Math.round(report.tempC);
        const f = Math.round(report.tempC * 9 / 5 + 32);
        temp.textContent = c + '°C / ' + f + '°F';
      }
      const snowing = isSnowCode(report.code);
      const raining = !snowing && (report.precipMm >= 0.3 || isRainCode(report.code));
      paintSky(node, snowing ? 'snow' : raining ? 'rain' : '');
    }

    function isRainCode(code) {
      return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
    }

    async function paintWeather() {
      for (const node of document.querySelectorAll('[data-weather]')) {
        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.searchParams.set('latitude', node.dataset.lat);
        url.searchParams.set('longitude', node.dataset.lon);
        url.searchParams.set('current', 'temperature_2m,precipitation,weather_code');
        url.searchParams.set('hourly', 'precipitation_probability');
        url.searchParams.set('forecast_hours', '6');
        url.searchParams.set('timezone', 'auto');
        try {
          const data = await fetch(url).then((res) => res.json());
          const current = data.current || {};
          const key = String(current.time || '').slice(0, 13);
          const times = (data.hourly && data.hourly.time) || [];
          const chances = (data.hourly && data.hourly.precipitation_probability) || [];
          const index = times.findIndex((stamp) => String(stamp).slice(0, 13) === key);
          applyWeather(node, {
            tempC: current.temperature_2m,
            precipMm: current.precipitation || 0,
            code: current.weather_code,
            probability: index >= 0 ? chances[index] : null,
          });
        } catch (err) {
          void err;
        }
      }
    }
    paintWeather();

    document.querySelectorAll('[data-jump]').forEach((button) => {
      button.addEventListener('click', () => {
        document.getElementById(button.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    const mobileMenu = window.matchMedia('(max-width: 759px)');
    document.querySelectorAll('.menu-back').forEach((menuBack) => {
      const page = menuBack.closest('main');
      const jumpMenu = page.querySelector('.jump-menu');
      if (!jumpMenu) return;
      let menuInView = true;
      const syncMenuBack = () => {
        menuBack.hidden = !mobileMenu.matches || page.hidden || menuInView;
      };
      const menuWatch = new IntersectionObserver((entries) => {
        menuInView = entries.some((entry) => entry.isIntersecting);
        syncMenuBack();
      }, { rootMargin: '-72px 0px 0px 0px', threshold: 0.2 });
      menuWatch.observe(jumpMenu);
      mobileMenu.addEventListener('change', syncMenuBack);
      menuBack.addEventListener('click', () => {
        jumpMenu.closest('.city-hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    document.querySelectorAll('.scene-card').forEach((card) => {
      card.addEventListener('click', () => {
        const on = card.classList.contains('is-on');
        document.querySelectorAll('.scene-card').forEach((other) => other.classList.remove('is-on'));
        if (!on) card.classList.add('is-on');
      });
    });

    function showView() {
      const raw = location.hash.replace('#', '');
      const cityLink = /^city\\/([a-z0-9-]+)$/.exec(raw);
      let current = 'home';
      let anchor = null;
      if (cityLink) {
        const match = tonight.cities.find((city) => city.id === cityLink[1]);
        if (match && match.id !== homeCityId) {
          homeCityId = match.id;
          nowGroup = 'dance';
          weekendGroup = 'dance';
          try { localStorage.setItem('fd-city', match.id); } catch (err) {}
          renderHome(true);
        }
        current = 'home';
      } else if (raw === 'cities' || raw === 'more-cities') {
        history.replaceState(null, '', location.pathname + location.search);
        current = 'home';
      } else if (raw === 'pride' || raw.indexOf('pride/') === 0) {
        current = 'pride';
        const day = raw.slice(6);
        if (/^\\d{4}-\\d{2}-\\d{2}$/.test(day)) {
          outlookCal.key = day.slice(0, 7);
          outlookCal.day = day;
          paintOutlook();
        }
      } else if (raw && raw !== 'home') {
        const node = document.getElementById(raw);
        const view = node && node.closest ? node.closest('main.view') : null;
        if (view) {
          current = view.id;
          if (node !== view) anchor = raw;
        }
      }
      revealView(current, anchor);
      viewReady = true;
    }

    function revealView(id, anchor) {
      playView(id, anchor);
    }

    function distanceKm(a, b) {
      const toRad = (deg) => deg * Math.PI / 180;
      const dLat = toRad(b.lat - a.lat);
      const dLon = toRad(b.lon - a.lon);
      const lat1 = toRad(a.lat);
      const lat2 = toRad(b.lat);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    let here = null;
    let locating = null;
    let viewReady = false;
    let viewToken = 0;

    function nearestRanked(limit) {
      return cities
        .map((city) => ({ city, distance: distanceKm(here, city) }))
        .sort((a, b) => a.distance - b.distance || a.city.id.localeCompare(b.city.id))
        .slice(0, limit);
    }

    function funWord() {
      const word = document.createElement('span');
      word.className = 'fun';
      word.textContent = 'fun';
      return word;
    }

    function paintNear(ranked) {
      const top = ranked[0];
      areaLabel.replaceChildren();
      if (!top) {
        areaLabel.textContent = 'No cities are open yet.';
      } else if (top.distance < 40) {
        areaLabel.append("You're in ", top.city.name, '. The nearest ');
        areaLabel.append(funWord());
        areaLabel.append(' is here.');
      } else if (top.distance < 400) {
        areaLabel.append(top.city.name, ' is the nearest ');
        areaLabel.append(funWord());
        areaLabel.append('.');
      } else {
        areaLabel.append('From here, the nearest ');
        areaLabel.append(funWord());
        areaLabel.append(' is ', top.city.name, '.');
      }
      picks.querySelectorAll('[data-pick]').forEach((node) => node.remove());
      const full = document.getElementById('browse-world');
      for (const item of ranked) {
        const link = document.createElement('a');
        link.className = 'area-chip';
        link.dataset.pick = item.city.id;
        link.href = '#' + item.city.id;
        link.textContent = item.city.name;
        picks.insertBefore(link, full);
      }
      areaSearch.form.hidden = true;
      suggest.hidden = true;
      areaBlock.hidden = false;
    }

    function askLocation() {
      if (here) return Promise.resolve(here);
      if (locating) return locating;
      locating = new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          locating = null;
          reject(new Error('unavailable'));
          return;
        }
        navigator.geolocation.getCurrentPosition((pos) => {
          here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          paintNear(nearestRanked(7));
          resolve(here);
        }, (err) => {
          locating = null;
          reject(err);
        }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
      });
      return locating;
    }

    function foldName(value) {
      return value.normalize('NFD').replace(/\\p{M}/gu, '').toLowerCase();
    }

    function renderSuggest() {
      const query = foldName(areaSearch.value.trim());
      suggest.replaceChildren();
      if (!query) {
        suggest.hidden = true;
        return;
      }
      const matches = cities
        .filter((city) => foldName(city.name).includes(query))
        .sort((a, b) => {
          const rank = (id) => tonight.cities.findIndex((city) => city.id === id);
          return rank(a.id) - rank(b.id);
        });
      suggest.hidden = false;
      if (!matches.length) {
        const item = document.createElement('li');
        item.className = 'area-empty';
        item.textContent = 'No city matches that.';
        suggest.appendChild(item);
        return;
      }
      for (const city of matches) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = '#' + city.id;
        link.textContent = city.name;
        const place = document.createElement('span');
        place.textContent = city.country;
        link.append(place);
        item.appendChild(link);
        suggest.appendChild(item);
      }
    }

    if (areaSearch && suggest) {
      areaSearch.addEventListener('input', renderSuggest);
      suggest.addEventListener('click', (event) => {
        const link = event.target.closest('a');
        if (!link || !suggest.contains(link)) return;
        event.preventDefault();
        suggest.querySelectorAll('a').forEach((node) => node.classList.remove('is-go'));
        link.classList.add('is-go');
        const href = link.getAttribute('href');
        window.setTimeout(() => {
          if (location.hash === href) showView();
          else location.hash = href;
        }, 160);
      });
      areaSearch.form.addEventListener('submit', (event) => {
        event.preventDefault();
        const links = [...suggest.querySelectorAll('a')];
        if (links.length === 1) location.hash = links[0].getAttribute('href');
      });
    }

    const continentHint = document.getElementById('continent-hint');
    const continentTitle = document.getElementById('continent-title');
    const continentList = document.getElementById('continent-city-list');

    function showContinent(id) {
      document.querySelectorAll('[data-continent]').forEach((node) => {
        const on = node.getAttribute('data-continent') === id;
        node.classList.toggle('is-on', on);
        if (node.tagName === 'BUTTON') node.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const matches = cities
        .filter((city) => city.continent === id)
        .sort((a, b) => {
          const rank = (id) => tonight.cities.findIndex((city) => city.id === id);
          return rank(a.id) - rank(b.id);
        });
      continentHint.hidden = true;
      continentTitle.hidden = false;
      continentTitle.textContent = continentNames[id] || 'Cities';
      continentList.replaceChildren();
      if (!matches.length) {
        const empty = document.createElement('li');
        empty.className = 'continent-empty';
        empty.textContent = 'No cities there yet.';
        continentList.appendChild(empty);
      } else {
        for (const city of matches) {
          const item = document.createElement('li');
          const link = document.createElement('a');
          link.href = '#' + city.id;
          link.textContent = city.name;
          const place = document.createElement('span');
          place.textContent = city.country;
          link.append(place);
          item.appendChild(link);
          continentList.appendChild(item);
        }
      }
      if (window.matchMedia('(max-width: 759px)').matches) {
        continentTitle.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    document.querySelectorAll('[data-continent]').forEach((node) => {
      node.addEventListener('click', () => showContinent(node.getAttribute('data-continent')));
    });
    document.querySelectorAll('.world-svg [data-continent]').forEach((node) => {
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          showContinent(node.getAttribute('data-continent'));
        }
      });
    });


    function expireLiveCounts() {
      const maxAge = 15 * 60 * 1000;
      document.querySelectorAll('.signal[data-live-at]').forEach((node) => {
        const at = Date.parse(node.getAttribute('data-live-at'));
        if (!Number.isFinite(at) || Date.now() - at >= maxAge) {
          const fallback = node.getAttribute('data-fallback') || 'Not enough live signal';
          node.removeAttribute('data-live-at');
          node.removeAttribute('data-fallback');
          node.textContent = fallback;
          const why = node.parentElement && node.parentElement.querySelector('.why');
          if (why && why.hasAttribute('data-fallback-why')) {
            why.textContent = why.getAttribute('data-fallback-why');
            why.removeAttribute('data-fallback-why');
          }
        }
      });
    }
    expireLiveCounts();
    setInterval(expireLiveCounts, 30000);

    const prideResults = document.getElementById('pride-results');
    if (prideResults) {
      const prideMonths = ${JSON.stringify(MONTHS)};
      const prideYears = ['2026', '2027'];
      const prideCountryAliases = {
        'united states': 'USA',
        america: 'USA',
        'united kingdom': 'UK',
        britain: 'UK',
        brasil: 'Brazil',
        espana: 'Spain',
        deutschland: 'Germany',
        italia: 'Italy',
        holland: 'Netherlands',
        nederland: 'Netherlands'
      };
      function countryHit(city, query) {
        const country = foldName(city.country);
        if (!query) return false;
        if (country === query || country.startsWith(query)) return true;
        if (query.length >= 4 && country.includes(query)) return true;
        if (query.length < 3) return false;
        return Object.keys(prideCountryAliases).some((alias) => {
          return foldName(prideCountryAliases[alias]) === country && (alias === query || alias.startsWith(query));
        });
      }
      function placeHit(city, query) {
        return foldName(city.name).includes(query) || countryHit(city, query);
      }
      const prideSearch = document.getElementById('pride-search');
      const prideSuggest = document.getElementById('pride-suggest');
      const prideNone = document.getElementById('pride-none');
      function prideToday() {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return { iso: now.getFullYear() + '-' + month + '-' + day, year: now.getFullYear(), month: now.getMonth() + 1 };
      }
      function monthStillAhead(year, month, today) {
        return Number(year) > today.year || (Number(year) === today.year && month >= today.month);
      }
      function eventHitsMonth(start, end, month, year) {
        const startKey = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7));
        const endKey = Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7));
        const years = year ? [year] : prideYears;
        return years.some((item) => {
          const key = Number(item) * 12 + month;
          return key >= startKey && key <= endKey;
        });
      }
      function parsePrideQuery(raw) {
        const original = foldName(raw.trim());
        if (!original) return { empty: true };
        const yearMatch = original.match(/\\b(2026|2027)\\b/);
        const year = yearMatch ? yearMatch[1] : '';
        const yearPrefix = original.match(/\\b20\\d{0,2}\\b/);
        const pendingYear = !year && yearPrefix && yearPrefix[0] !== '2026' && yearPrefix[0] !== '2027';
        const tokens = original.replace(/\\b20\\d{0,2}\\b/g, ' ').split(/[^a-z]+/).filter(Boolean);
        let month = 0;
        let ambiguousMonth = false;
        const consumed = new Set();
        tokens.forEach((token, index) => {
          if (token.length < 2) return;
          const hits = [];
          prideMonths.forEach((name, indexMonth) => {
            if (foldName(name).startsWith(token)) hits.push(indexMonth + 1);
          });
          if (hits.length === 1 && token.length >= 3) {
            month = hits[0];
            consumed.add(index);
          } else if (hits.length > 1) ambiguousMonth = true;
        });
        const cityQuery = tokens.filter((token, index) => !consumed.has(index)).join(' ');
        let cityIds = null;
        let country = '';
        if (cityQuery) {
          const matches = prideCities.filter((city) => placeHit(city, cityQuery));
          if (!matches.length && !month && !year) return ambiguousMonth || pendingYear ? { pending: true } : { invalid: true };
          if (matches.length) {
            cityIds = matches.map((city) => city.id);
            const countries = [...new Set(matches.map((city) => city.country))];
            const byCountry = matches.filter((city) => countryHit(city, cityQuery));
            if (countries.length === 1 && byCountry.length === matches.length) country = countries[0];
          }
        }
        if (!year && !month && !cityIds) return pendingYear || ambiguousMonth ? { pending: true } : { invalid: true };
        return { year: year, month: month, cityIds: cityIds, country: country };
      }
      function prideEmptyText(parsed) {
        if (!parsed || parsed.invalid) return 'Nothing matches that.';
        const city = parsed.cityIds && parsed.cityIds.length === 1
          ? prideCities.find((item) => item.id === parsed.cityIds[0])
          : null;
        const monthName = parsed.month ? prideMonths[parsed.month - 1] : '';
        const place = city ? city.name : parsed.country;
        if (place && parsed.year && monthName) return 'Nothing published for ' + place + ' in ' + monthName + ' ' + parsed.year + ' yet.';
        if (place && parsed.year) return 'Nothing published for ' + place + ' in ' + parsed.year + ' yet.';
        if (place && monthName) return 'Nothing published for ' + place + ' in ' + monthName + ' yet.';
        if (place) return 'Nothing published for ' + place + ' yet.';
        if (parsed.cityIds && parsed.cityIds.length > 1) return 'Nothing published for those cities yet.';
        if (parsed.year && monthName) return 'Nothing published for ' + monthName + ' ' + parsed.year + ' yet.';
        if (parsed.year) return 'Nothing published for ' + parsed.year + ' yet.';
        if (monthName) return 'Nothing published for ' + monthName + ' yet.';
        return '';
      }
      function applyPrideQuery() {
        const today = prideToday().iso;
        const parsed = parsePrideQuery(prideSearch.value);
        const open = parsed.empty || parsed.pending;
        let any = false;
        prideResults.querySelectorAll('.pride-simple li').forEach((item) => {
          const start = item.getAttribute('data-start');
          const end = item.getAttribute('data-end');
          let show = end >= today;
          if (!open && show && !parsed.invalid) {
            if (parsed.year && (parsed.year < start.slice(0, 4) || parsed.year > end.slice(0, 4))) show = false;
            if (parsed.month && !eventHitsMonth(start, end, parsed.month, parsed.year)) show = false;
            if (parsed.cityIds && !parsed.cityIds.includes(item.getAttribute('data-city'))) show = false;
          }
          if (parsed.invalid) show = false;
          item.hidden = !show;
          if (show) any = true;
        });
        prideNone.hidden = true;
        if (!any) {
          const text = prideEmptyText(open ? {} : parsed);
          if (text) {
            prideNone.hidden = false;
            prideNone.textContent = text;
          }
        }
      }
      function prideSuggestions(raw) {
        const query = foldName(raw.trim());
        if (!query) return [];
        const today = prideToday();
        const parsed = parsePrideQuery(raw);
        const seen = new Set();
        const cities = [];
        const years = [];
        const months = [];
        function push(bucket, label, hint, value) {
          const key = foldName(value);
          if (seen.has(key) || key === query) return;
          seen.add(key);
          bucket.push({ label: label, hint: hint, value: value });
        }
        const number = query.match(/20\\d{0,2}/);
        if (number) {
          prideYears.forEach((year) => {
            if (year.startsWith(number[0]) && year !== number[0]) push(years, year, 'Year', year);
          });
        }
        const exactCity = parsed.cityIds && parsed.cityIds.length === 1
          ? prideCities.find((city) => city.id === parsed.cityIds[0])
          : null;
        const placeLabel = exactCity ? exactCity.name : parsed.country;
        const barePlace = query.replace(/\\b20\\d{2}\\b/g, ' ').replace(/\\s+/g, ' ').trim();
        if (placeLabel && foldName(placeLabel) === barePlace && !parsed.year) {
          prideYears.forEach((year) => {
            const has = [...prideResults.querySelectorAll('.pride-simple li')].some((item) => {
              const inPlace = exactCity
                ? item.getAttribute('data-city') === exactCity.id
                : parsed.cityIds.includes(item.getAttribute('data-city'));
              return inPlace
                && item.getAttribute('data-end') >= today.iso
                && item.getAttribute('data-start').slice(0, 4) <= year
                && item.getAttribute('data-end').slice(0, 4) >= year;
            });
            if (has) push(years, placeLabel + ' ' + year, 'Year', placeLabel + ' ' + year);
          });
        }
        const tokens = query.split(/[^a-z0-9]+/).filter(Boolean);
        tokens.forEach((token) => {
          if (token.length < 2 || /^20\\d{0,2}$/.test(token)) return;
          prideMonths.forEach((name, index) => {
            if (!foldName(name).startsWith(token)) return;
            prideYears.forEach((year) => {
              const month = index + 1;
              if (!monthStillAhead(year, month, today)) return;
              const prefix = placeLabel && foldName(placeLabel) !== token ? placeLabel + ' ' : '';
              push(months, prefix + name + ' ' + year, 'Month', (prefix + name + ' ' + year).trim());
            });
          });
        });
        if (parsed.year && !parsed.month) {
          const seenMonths = new Set();
          prideResults.querySelectorAll('.pride-simple li').forEach((item) => {
            if (item.getAttribute('data-end') < today.iso) return;
            if (parsed.cityIds && !parsed.cityIds.includes(item.getAttribute('data-city'))) return;
            const start = item.getAttribute('data-start');
            const end = item.getAttribute('data-end');
            prideMonths.forEach((name, index) => {
              const month = index + 1;
              if (!eventHitsMonth(start, end, month, parsed.year)) return;
              if (!monthStillAhead(parsed.year, month, today)) return;
              seenMonths.add(month);
            });
          });
          seenMonths.forEach((month) => {
            const name = prideMonths[month - 1];
            const prefix = placeLabel ? placeLabel + ' ' : '';
            push(months, prefix + name + ' ' + parsed.year, 'Month', (prefix + name + ' ' + parsed.year).trim());
          });
        }
        const cityNeedle = tokens.filter((token) => {
          if (/^20\\d{0,2}$/.test(token) || !/[a-z]/.test(token)) return false;
          const hits = prideMonths.filter((name) => foldName(name).startsWith(token));
          return !(hits.length === 1 && token.length >= 3);
        }).join(' ');
        if (cityNeedle) {
          const countryNames = [...new Set(prideCities.filter((city) => countryHit(city, cityNeedle)).map((city) => city.country))];
          countryNames.sort((a, b) => a.localeCompare(b, 'en')).forEach((country) => {
            push(cities, country, 'Country', country);
          });
          prideCities
            .filter((city) => foldName(city.name).includes(cityNeedle) || countryHit(city, cityNeedle))
            .sort((a, b) => a.name.localeCompare(b.name, 'en'))
            .forEach((city) => {
              if (exactCity && city.id === exactCity.id && query.includes(foldName(city.name))) return;
              const nameHit = foldName(city.name).includes(cityNeedle);
              const fullCountry = countryHit(city, cityNeedle) && query.includes(foldName(city.country));
              if (!nameHit && !fullCountry) return;
              push(cities, city.name, city.country, city.name);
            });
        }
        const digits = /^20\\d{0,2}$/.test(query);
        const ordered = digits ? years.concat(months, cities) : cities.concat(years, months);
        return ordered.slice(0, 8);
      }
      function renderPrideSuggest() {
        const suggestions = prideSuggestions(prideSearch.value);
        prideSuggest.replaceChildren();
        if (!suggestions.length) {
          prideSuggest.hidden = true;
          return;
        }
        prideSuggest.hidden = false;
        suggestions.forEach((suggestion) => {
          const item = document.createElement('li');
          const link = document.createElement('a');
          link.href = '#pride';
          link.textContent = suggestion.label;
          const hint = document.createElement('span');
          hint.textContent = suggestion.hint;
          link.appendChild(hint);
          link.addEventListener('click', (event) => {
            event.preventDefault();
            prideSearch.value = suggestion.value;
            applyPrideQuery();
            renderPrideSuggest();
          });
          item.appendChild(link);
          prideSuggest.appendChild(item);
        });
      }
      prideSearch.addEventListener('input', () => {
        applyPrideQuery();
        renderPrideSuggest();
      });
      prideSearch.form.addEventListener('submit', (event) => {
        event.preventDefault();
        const suggestions = prideSuggestions(prideSearch.value);
        if (suggestions.length === 1) prideSearch.value = suggestions[0].value;
        prideSuggest.hidden = true;
        applyPrideQuery();
      });
      applyPrideQuery();
    }

    const GROUPS = [
      { id: 'dance', name: 'Dance and drinks' },
      { id: 'sauna', name: 'Saunas' },
      { id: 'sexy', name: 'Cruisy' },
    ];
    const WEEK_DOW = [1, 2, 3, 4, 5, 6, 0];
    const WEEK_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let homeCityId = tonight.defaultCity;
    let nowGroup = 'dance';
    let weekendGroup = 'dance';
    try {
      const storedCity = localStorage.getItem('fd-city');
      if (storedCity && tonight.cities.some((city) => city.id === storedCity)) homeCityId = storedCity;
    } catch (err) {}
    const hashCity = /^#city\\/([a-z0-9-]+)$/.exec(location.hash);
    if (hashCity && tonight.cities.some((city) => city.id === hashCity[1])) homeCityId = hashCity[1];

    function peakText(hour) {
      return (hour % 12 || 12) + (hour >= 12 ? 'pm' : 'am');
    }

    function cityClock(timeZone) {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        hour: '2-digit',
        hourCycle: 'h23',
      });
      const bag = {};
      for (const part of fmt.formatToParts(new Date())) bag[part.type] = part.value;
      let hour = Number(bag.hour);
      if (hour === 24) hour = 0;
      return { hour, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(bag.weekday) };
    }

    function homeCity() {
      return tonight.cities.find((city) => city.id === homeCityId) || tonight.cities[0];
    }

    function activeHour(city) {
      const clock = cityClock(city.tz);
      return clock.weekday === city.weekday ? clock.hour : city.hour;
    }

    function savedIds() {
      if (account.user) return account.venues.slice();
      return [];
    }

    function busyNote() {
      return 'usual for this hour';
    }

    function appendLiveLine(parent, venue) {
      if (!venue.live || !Number.isInteger(venue.live.count)) return;
      const line = document.createElement('span');
      line.className = 'tonight-live';
      const dot = document.createElement('span');
      dot.className = 'live-dot';
      dot.setAttribute('aria-hidden', 'true');
      const badge = document.createElement('span');
      badge.className = 'badge live';
      badge.textContent = 'Live';
      line.append(dot, badge, document.createTextNode(venue.live.count + ' inside right now'));
      parent.append(line);
    }

    function rowButton(venue, percent, line, note) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tonight-row';
      button.setAttribute('data-venue', venue.id);
      const name = document.createElement('span');
      name.className = 'tonight-name';
      name.textContent = venue.name;
      const score = document.createElement('span');
      score.className = 'tonight-score';
      const badge = document.createElement('span');
      badge.className = 'forecast-badge';
      badge.textContent = percent + '%';
      const meaning = document.createElement('span');
      meaning.className = 'forecast-note';
      meaning.textContent = note;
      score.append(badge, meaning);
      const meta = document.createElement('span');
      meta.className = 'tonight-meta';
      meta.textContent = venue.area ? venue.cat + ' · ' + venue.area : venue.cat;
      const hours = document.createElement('span');
      hours.className = 'tonight-hours';
      const clockHour = activeHour(homeCity());
      hours.textContent = venue.hoursLines ? venue.hoursLines[clockHour] : venue.hoursText;
      const when = document.createElement('span');
      when.className = 'tonight-when';
      when.textContent = line;
      button.append(name, score, meta, hours);
      appendLiveLine(button, venue);
      button.append(when);
      const concepts = (venue.features || []).slice(0, 5);
      if (concepts.length) {
        const row = document.createElement('span');
        row.className = 'tonight-concepts';
        concepts.forEach((feature) => {
          const chip = document.createElement('span');
          chip.textContent = feature;
          row.append(chip);
        });
        button.append(row);
      }
      return button;
    }

    function fillRail(node, venues, lineFor, showAll) {
      node.hidden = false;
      node.replaceChildren();
      if (!venues.length) {
        const empty = document.createElement('p');
        empty.className = 'tonight-empty';
        empty.textContent = 'Nothing open right now.';
        node.append(empty);
        return;
      }
      const list = document.createElement('ol');
      list.className = 'tonight-list';
      const visible = showAll ? venues : venues.slice(0, 8);
      visible.forEach((venue) => {
        const item = document.createElement('li');
        const lined = lineFor(venue);
        item.append(rowButton(venue, lined.percent, lined.line, lined.note));
        list.append(item);
      });
      node.append(list);
      if (showAll || venues.length <= 8) return;
      const details = document.createElement('details');
      details.className = 'show-more';
      const summary = document.createElement('summary');
      summary.textContent = 'Show more';
      const clip = document.createElement('div');
      clip.className = 'more-clip';
      const inner = document.createElement('div');
      inner.className = 'more-clip-inner';
      const rest = document.createElement('ol');
      rest.className = 'tonight-list';
      venues.slice(8).forEach((venue) => {
        const item = document.createElement('li');
        const lined = lineFor(venue);
        item.append(rowButton(venue, lined.percent, lined.line, lined.note));
        rest.append(item);
      });
      inner.append(rest);
      clip.append(inner);
      details.append(summary, clip);
      node.append(details);
    }

    function renderPicker() {
      const list = document.getElementById('city-picker-list');
      const query = foldName(document.getElementById('city-picker-search').value.trim());
      const ranked = tonight.cities.slice().sort((a, b) => {
        const ap = a.id === account.profile.homeCity || account.cities.indexOf(a.id) !== -1;
        const bp = b.id === account.profile.homeCity || account.cities.indexOf(b.id) !== -1;
        if (ap !== bp) return ap ? -1 : 1;
        if (ap && bp) {
          if (a.id === account.profile.homeCity) return -1;
          if (b.id === account.profile.homeCity) return 1;
          return account.cities.indexOf(a.id) - account.cities.indexOf(b.id);
        }
        return a.name.localeCompare(b.name, 'en');
      });
      list.replaceChildren();
      let shown = 0;
      ranked.forEach((city) => {
        if (query && foldName(city.name + ' ' + city.country).indexOf(query) === -1) return;
        shown += 1;
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        const name = document.createElement('span');
        name.className = 'picker-city';
        name.textContent = city.name;
        const place = document.createElement('span');
        place.className = 'picker-country';
        place.textContent = city.country;
        button.append(name, place);
        button.addEventListener('click', () => chooseCity(city.id, true));
        item.append(button);
        list.append(item);
      });
      if (!shown) {
        const empty = document.createElement('li');
        empty.className = 'picker-empty';
        empty.textContent = 'No city matches that.';
        list.append(empty);
      }
    }

    function paintNow(city) {
      const line = document.getElementById('now-line');
      const facts = document.getElementById('now-facts');
      facts.dataset.lat = String(city.lat);
      facts.dataset.lon = String(city.lon);
      facts.querySelector('[data-clock]').dataset.tz = city.tz;
      line.querySelector('[data-place]').textContent = city.name + ', ' + city.country;
      line.querySelector('[data-flag]').textContent = city.flag;
      facts.querySelector('[data-temp]').textContent = city.weather.temp;
      paintSky(facts, city.weather.snowing ? 'snow' : city.weather.raining ? 'rain' : '');
      paintClock();
      paintWeather();
    }

    let homeFade = 0;
    function motionNodes() {
      return [document.getElementById('now-line'), document.getElementById('city-rails')].filter(Boolean);
    }
    function renderHome(fade) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!fade || reduce) {
        paintHome();
        if (fade) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        return;
      }
      const token = ++homeFade;
      const nodes = motionNodes();
      nodes.forEach((node) => node.classList.add('is-out'));
      window.setTimeout(() => {
        if (token !== homeFade) return;
        paintHome();
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        nodes.forEach((node) => {
          node.classList.remove('is-out');
          node.classList.add('is-in');
        });
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (token !== homeFade) return;
            motionNodes().forEach((node) => node.classList.remove('is-in'));
          });
        });
      }, 260);
    }

    function cityToday(timeZone) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    }

    function prideWhen(iso) {
      const parts = iso.split('-');
      const y = Number(parts[0]);
      const m = Number(parts[1]);
      const d = Number(parts[2]);
      const utc = new Date(Date.UTC(y, m - 1, d));
      const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return weekdays[utc.getUTCDay()] + ' ' + d + ' ' + months[m - 1] + ' ' + y;
    }

    function prideCountdown(iso, today) {
      const days = Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
      if (days < 0) return '';
      if (days === 0) return 'today';
      if (days === 1) return 'tomorrow';
      if (days < 7) return 'in ' + days + ' days';
      const weeks = Math.round(days / 7);
      if (weeks < 4) return 'in ' + weeks + (weeks === 1 ? ' week' : ' weeks');
      const todayParts = today.split('-');
      const isoParts = iso.split('-');
      const monthDiff = (Number(isoParts[0]) - Number(todayParts[0])) * 12 + (Number(isoParts[1]) - Number(todayParts[1]));
      if (monthDiff === 1) return 'next month';
      if (monthDiff > 1) return 'in ' + monthDiff + ' months';
      return 'in ' + weeks + ' weeks';
    }

    function paintGroups(node, active) {
      node.querySelectorAll('[data-group]').forEach((button) => {
        button.setAttribute('aria-pressed', button.getAttribute('data-group') === active ? 'true' : 'false');
      });
    }

    function paintClosedList(node, venues, title) {
      node.replaceChildren();
      if (!venues.length) {
        node.hidden = true;
        return;
      }
      const label = document.createElement('p');
      label.className = 'closed-label';
      label.textContent = title;
      const list = document.createElement('ul');
      list.className = 'closed-list';
      venues.forEach((venue) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'closed-row';
        button.setAttribute('data-venue', venue.id);
        const name = document.createElement('span');
        name.className = 'closed-name';
        name.textContent = venue.name;
        const cat = document.createElement('span');
        cat.className = 'closed-cat';
        cat.textContent = venue.cat;
        const hours = document.createElement('span');
        hours.className = 'closed-hours';
        hours.textContent = venue.hoursLines ? venue.hoursLines[activeHour(homeCity())] : venue.hoursText;
        button.append(name, cat, hours);
        item.append(button);
        list.append(item);
      });
      node.append(label, list);
      node.hidden = false;
    }

    function inGroup(venue, group) {
      return !group || venue.vibes.indexOf(group) !== -1;
    }

    function paintEventChips() {
      document.querySelectorAll('[data-group="events"]').forEach((button) => {
        button.hidden = false;
      });
    }

    function eventCard(event, today) {
      const card = document.createElement('article');
      card.className = 'tonight-row event-card';
      const name = document.createElement('p');
      name.className = 'tonight-name';
      if (event.flag) {
        const flag = document.createElement('span');
        flag.className = 'flag';
        flag.setAttribute('aria-hidden', 'true');
        flag.textContent = event.flag;
        name.append(flag, document.createTextNode(event.name));
      } else name.textContent = event.name;
      const when = document.createElement('p');
      when.className = 'pride-when';
      when.textContent = event.start === event.end ? prideWhen(event.start) : prideWhen(event.start) + ' – ' + prideWhen(event.end);
      card.append(name, when);
      if (event.city) {
        const where = document.createElement('p');
        where.className = 'pride-where';
        where.textContent = event.city;
        card.append(where);
      }
      if (event.start <= today && event.end >= today) {
        const busy = document.createElement('p');
        busy.className = 'event-busy';
        busy.textContent = 'Busy';
        card.append(busy);
      }
      if (event.source) {
        const link = document.createElement('a');
        link.className = 'pride-source';
        link.href = event.source;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        try { link.textContent = new URL(event.source).hostname.replace(/^www\\./, ''); }
        catch (err) { link.textContent = 'Source'; }
        card.append(link);
      }
      return card;
    }

    function eventDateLabel(iso) {
      const parts = iso.split('-');
      return Number(parts[2]) + ' ' + CAL_MONTHS[Number(parts[1]) - 1] + ' ' + parts[0];
    }

    function nextEventOutside(events, start, end, today) {
      return events
        .filter((event) => event.end >= today && !overlaps(event, start, end))
        .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name))[0];
    }

    function fillEvents(node, events, cityEvents, today, windowStart, windowEnd) {
      node.replaceChildren();
      if (!events.length) {
        node.hidden = false;
        const note = document.createElement('p');
        note.className = 'tonight-empty';
        const next = nextEventOutside(cityEvents, windowStart, windowEnd, today);
        if (!next) note.textContent = 'No events at this time.';
        else {
          note.append(document.createTextNode('No events at this time — the next one is in '));
          const link = document.createElement('a');
          link.href = '#pride/' + next.start;
          link.textContent = eventDateLabel(next.start);
          note.append(link, document.createTextNode('.'));
        }
        node.append(note);
        return;
      }
      node.hidden = false;
      const list = document.createElement('ol');
      list.className = 'tonight-list';
      events.forEach((event) => {
        const item = document.createElement('li');
        item.append(eventCard(event, today));
        list.append(item);
      });
      node.append(list);
    }

    const CAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const CAL_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const outlookCal = { key: '', day: '' };

    function addIso(iso, days) {
      const parts = iso.split('-');
      const date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + days));
      return date.toISOString().slice(0, 10);
    }

    function shiftMonth(key, delta) {
      const parts = key.split('-');
      const date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1 + delta, 1));
      return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0');
    }

    function daysBetween(fromIso, toIso) {
      return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86400000);
    }

    function weekendWindow(timeZone) {
      const today = cityToday(timeZone);
      const parts = today.split('-');
      const dow = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))).getUTCDay();
      const fridayOffset = dow === 0 ? -2 : dow === 6 ? -1 : dow === 5 ? 0 : 5 - dow;
      const fri = addIso(today, fridayOffset);
      return { today: today, fri: fri, sun: addIso(fri, 2) };
    }

    function overlaps(event, start, end) {
      return event.start <= end && event.end >= start;
    }

    function withCity(city) {
      return (city.events || []).map((event) => ({
        name: event.name,
        type: event.type,
        start: event.start,
        end: event.end,
        source: event.source,
        city: city.name,
        flag: city.flag,
      }));
    }

    function everyEvent() {
      const rows = [];
      tonight.cities.forEach((city) => rows.push.apply(rows, withCity(city)));
      return rows;
    }

    function localIso() {
      const date = new Date();
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }

    function paintCalendar(body, label, state, pool, today, lookup) {
      const nextPool = lookup || pool;
      if (!state.key) state.key = today.slice(0, 7);
      const parts = state.key.split('-');
      const year = Number(parts[0]);
      const month = Number(parts[1]);
      const monthSelect = label.querySelector('[aria-label="Month"]');
      const yearSelect = label.querySelector('[aria-label="Year"]');
      if (monthSelect && yearSelect) {
        const years = new Set([Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1, year]);
        pool.forEach((event) => {
          years.add(Number(event.start.slice(0, 4)));
          years.add(Number(event.end.slice(0, 4)));
        });
        const listed = [...yearSelect.options].map((option) => option.value).join(',');
        const next = [...years].sort((a, b) => a - b);
        if (listed !== next.join(',')) {
          yearSelect.replaceChildren();
          next.forEach((item) => {
            const option = document.createElement('option');
            option.value = String(item);
            option.textContent = String(item);
            yearSelect.append(option);
          });
        }
        monthSelect.value = String(month);
        yearSelect.value = String(year);
      } else label.textContent = CAL_MONTHS[month - 1] + ' ' + year;
      body.replaceChildren();
      const first = state.key + '-01';
      const lastDate = new Date(Date.UTC(year, month, 0));
      const last = lastDate.toISOString().slice(0, 10);
      const inMonth = pool.filter((event) => overlaps(event, first, last));
      const grid = document.createElement('div');
      grid.className = 'cal-grid';
      CAL_DOW.forEach((name) => {
        const cell = document.createElement('div');
        cell.className = 'cal-dow';
        cell.textContent = name;
        grid.append(cell);
      });
      const startDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
      const daysInMonth = lastDate.getUTCDate();
      const total = Math.ceil((startDow + daysInMonth) / 7) * 7;
      for (let index = 0; index < total; index += 1) {
        const dayNum = index - startDow + 1;
        const date = new Date(Date.UTC(year, month - 1, dayNum));
        const iso = date.toISOString().slice(0, 10);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cal-day';
        button.setAttribute('data-cal-day', iso);
        button.textContent = String(date.getUTCDate());
        if (dayNum < 1 || dayNum > daysInMonth) button.classList.add('is-out');
        else if (pool.some((event) => overlaps(event, iso, iso))) button.classList.add('has-event');
        if (state.day === iso) button.classList.add('is-on');
        button.setAttribute('aria-pressed', state.day === iso ? 'true' : 'false');
        grid.append(button);
      }
      body.append(grid);
      if (!inMonth.length) {
        const next = nextPool.filter((event) => event.start > last).sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name))[0];
        const note = document.createElement('p');
        note.className = 'cal-empty';
        note.textContent = next
          ? 'No events this month — the next one is ' + next.name + ' in ' + next.city + ' on ' + eventDateLabel(next.start) + '.'
          : 'No events this month.';
        body.append(note);
        return;
      }
      if (!state.day) return;
      const agenda = document.createElement('div');
      agenda.className = 'cal-agenda';
      const hits = pool.filter((event) => overlaps(event, state.day, state.day)).sort((a, b) => a.name.localeCompare(b.name));
      if (!hits.length) {
        const next = nextPool.filter((event) => event.start > state.day).sort((a, b) => a.start.localeCompare(b.start))[0];
        const note = document.createElement('p');
        note.className = 'cal-empty';
        note.textContent = next
          ? 'No events this day — the next one is ' + next.name + ' in ' + next.city + ' on ' + eventDateLabel(next.start) + '.'
          : 'No events this day.';
        agenda.append(note);
      } else hits.forEach((event) => agenda.append(eventCard(event, today)));
      body.append(agenda);
    }

    function paintOutlook() {
      paintCalendar(
        document.getElementById('outlook-body'),
        document.getElementById('outlook-label'),
        outlookCal,
        everyEvent(),
        localIso(),
      );
    }

    function paintLists() {
      const city = homeCity();
      const hour = activeHour(city);
      const clock = cityClock(city.tz);
      const span = weekendWindow(city.tz);
      const weekend = document.getElementById('weekend');
      weekend.hidden = clock.weekday === 5 || clock.weekday === 6;
      paintEventChips(city);
      paintGroups(document.getElementById('vibe-row'), nowGroup);
      paintGroups(document.getElementById('weekend-groups'), weekendGroup);
      document.getElementById('weekend-peak').hidden = weekendGroup === 'events';
      const events = withCity(city).sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
      const cards = events.map((event) => ({ name: event.name, start: event.start, end: event.end, source: event.source }));
      const tonightEvents = cards.filter((event) => overlaps(event, span.today, span.today));
      const weekendEvents = cards.filter((event) => overlaps(event, span.fri, span.sun));
      if (nowGroup === 'events') {
        fillEvents(document.getElementById('tonight-list'), tonightEvents, cards, span.today, span.today, span.today);
        paintClosedList(document.getElementById('closed-list'), [], 'Closed');
      } else {
        const nowShown = city.venues.filter((venue) => inGroup(venue, nowGroup));
        fillRail(document.getElementById('tonight-list'), nowShown.filter((venue) => venue.open[hour]).sort((a, b) => b.curve[hour] - a.curve[hour]), (venue) => ({
          percent: venue.curve[hour],
          note: busyNote(venue),
          line: venue.unsure
            ? 'Hours not confirmed · peaks ~' + peakText(venue.peak)
            : 'Open now · peaks ~' + peakText(venue.peak),
        }), true);
        paintClosedList(document.getElementById('closed-list'), nowShown.filter((venue) => !venue.open[hour]).sort((a, b) => a.name.localeCompare(b.name)), 'Closed');
      }
      if (weekendGroup === 'events') {
        fillEvents(document.getElementById('weekend-list'), weekendEvents, cards, span.today, span.fri, span.sun);
        paintClosedList(document.getElementById('weekend-closed'), [], 'Closed this weekend');
      } else {
        const weekendShown = city.venues.filter((venue) => inGroup(venue, weekendGroup));
        fillRail(document.getElementById('weekend-list'), weekendShown.filter((venue) => venue.weekend.percent > 0).sort((a, b) => b.weekend.percent - a.weekend.percent), (venue) => ({
          percent: venue.weekend.percent,
          note: 'weekend peak',
          line: 'Peaks ~' + peakText(venue.weekend.hour),
        }));
        paintClosedList(document.getElementById('weekend-closed'), weekendShown.filter((venue) => venue.weekend.percent === 0).sort((a, b) => a.name.localeCompare(b.name)), 'Closed this weekend');
      }
      document.getElementById('weekend-dates').textContent = city.weekend;
    }

    function paintHome() {
      const city = homeCity();
      paintNow(city);
      paintLists();
      paintForYou();
      paintOutlook();
      if (!document.getElementById('city-picker').hidden) renderPicker();
    }

    function chooseCity(id) {
      const same = id === homeCityId;
      homeCityId = id;
      nowGroup = 'dance';
      weekendGroup = 'dance';
      try { localStorage.setItem('fd-city', id); } catch (err) {}
      closePicker();
      closeSheet();
      const next = '#city/' + id;
      if (location.hash !== next) location.hash = next;
      if (same) {
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
        return;
      }
      renderHome(true);
    }

    function curveSvg(curve, hour) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 240 104');
      svg.setAttribute('class', 'curve');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Forecast across today, hour by hour');
      const poly = document.createElementNS(svg.namespaceURI, 'polyline');
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', '#ff7a18');
      poly.setAttribute('stroke-width', '2');
      poly.setAttribute('points', curve.map((value, index) => {
        const x = (index / 23) * 232 + 4;
        const y = 62 - (value / 100) * 52;
        return x + ',' + y;
      }).join(' '));
      const dot = document.createElementNS(svg.namespaceURI, 'circle');
      dot.setAttribute('cx', String((hour / 23) * 232 + 4));
      dot.setAttribute('cy', String(62 - (curve[hour] / 100) * 52));
      dot.setAttribute('r', '4');
      dot.setAttribute('fill', '#111111');
      svg.append(poly, dot);
      [0, 6, 12, 18].forEach((mark) => {
        const label = document.createElementNS(svg.namespaceURI, 'text');
        label.setAttribute('x', String((mark / 23) * 232 + 4));
        label.setAttribute('y', '96');
        label.setAttribute('text-anchor', mark === 0 ? 'start' : 'middle');
        label.setAttribute('fill', '#6b6b76');
        label.setAttribute('font-size', '11');
        label.setAttribute('font-family', 'Inter, sans-serif');
        const clock = mark % 12 || 12;
        label.textContent = clock + (mark >= 12 ? 'p' : 'a');
        svg.append(label);
      });
      return svg;
    }

    function weekSvg(scores, weekday) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 240 104');
      svg.setAttribute('class', 'week-curve');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Expected busyness Monday through Sunday. Today is marked in the labels.');
      scores.forEach((score, index) => {
        const today = WEEK_DOW[index] === weekday;
        const rect = document.createElementNS(svg.namespaceURI, 'rect');
        const height = Math.max(4, (score / 100) * 52);
        rect.setAttribute('x', String(8 + index * 34));
        rect.setAttribute('y', String(62 - height));
        rect.setAttribute('width', '18');
        rect.setAttribute('height', String(height));
        rect.setAttribute('rx', '3');
        rect.setAttribute('fill', '#ff7a18');
        const label = document.createElementNS(svg.namespaceURI, 'text');
        label.setAttribute('x', String(8 + index * 34 + 9));
        label.setAttribute('y', '96');
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('fill', today ? '#111111' : '#6b6b76');
        label.setAttribute('font-size', '11');
        label.setAttribute('font-weight', today ? '700' : '500');
        label.setAttribute('font-family', 'Inter, sans-serif');
        label.textContent = WEEK_LABELS[index];
        svg.append(rect, label);
      });
      return svg;
    }

    function openSheet(id, badgeText) {
      const city = homeCity();
      const venue = city.venues.find((item) => item.id === id);
      if (!venue) return;
      const hour = activeHour(city);
      const percent = venue.curve[hour];
      const body = document.getElementById('sheet-body');
      body.replaceChildren();
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'sheet-save';
      const saved = savedIds().indexOf(venue.id) !== -1;
      save.classList.toggle('is-on', saved);
      save.setAttribute('aria-label', saved ? 'Saved' : 'Save');
      save.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 3.3c0 4.8-7 9.2-7 9.2z"/></svg>';
      save.addEventListener('click', () => {
        if (!account.user) {
          pendingSave = { kind: 'venue', id: venue.id };
          openAccount('auth', 'in');
          return;
        }
        toggleVenue(venue.id);
        const on = account.venues.indexOf(venue.id) !== -1;
        save.classList.toggle('is-on', on);
        save.setAttribute('aria-label', on ? 'Saved' : 'Save');
      });
      const title = document.createElement('h3');
      title.id = 'sheet-title';
      title.textContent = venue.name;
      const badge = document.createElement('p');
      badge.className = 'forecast-badge';
      badge.textContent = badgeText || (percent + '%');
      const explain = document.createElement('p');
      explain.className = 'forecast-explain';
      const closedNow = !venue.open[hour];
      explain.textContent = closedNow
        ? 'Closed right now, so this is not a live crowd.'
        : (venue.conf === 'low'
          ? 'How busy it usually is at this hour. Not a live count.'
          : 'Expected busyness right now.');
      body.append(save, title, badge);
      if (!closedNow) appendLiveLine(body, venue);
      body.append(explain);
      const todayLabel = document.createElement('p');
      todayLabel.className = 'rank-note';
      todayLabel.textContent = 'Today';
      body.append(todayLabel, curveSvg(venue.curve, hour));
      const weekLabel = document.createElement('p');
      weekLabel.className = 'rank-note';
      weekLabel.textContent = 'This week';
      body.append(weekLabel, weekSvg(venue.week, city.weekday));
      const hours = document.createElement('p');
      hours.textContent = venue.hoursLines ? venue.hoursLines[hour] : venue.hoursText;
      body.append(hours);
      if (venue.verified) {
        const verified = document.createElement('p');
        verified.className = 'verified';
        verified.textContent = 'verified';
        body.append(verified);
      }
      if (venue.event) {
        const event = document.createElement('p');
        if (venue.eventUrl) {
          const link = document.createElement('a');
          link.href = venue.eventUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = venue.event;
          event.append(link);
        } else event.textContent = venue.event;
        body.append(event);
      }
      if (venue.features.length) {
        const label = document.createElement('p');
        label.className = 'reviews-label';
        label.textContent = 'From reviews';
        const list = document.createElement('ul');
        list.className = 'features';
        venue.features.slice(0, 5).forEach((feature) => {
          const item = document.createElement('li');
          item.textContent = feature;
          list.append(item);
        });
        body.append(label, list);
      }
      if (account.user) {
        const reviewLabel = document.createElement('p');
        reviewLabel.className = 'rank-note';
        reviewLabel.textContent = 'Your review';
        const reviewBox = document.createElement('textarea');
        reviewBox.maxLength = 500;
        const mine = account.reviews.filter((review) => review.venueId === venue.id);
        if (mine.length) reviewBox.value = mine[0].body;
        const reviewSave = document.createElement('button');
        reviewSave.type = 'button';
        reviewSave.className = 'btn-login';
        reviewSave.textContent = 'Save review';
        reviewSave.addEventListener('click', () => saveReview(venue.id, reviewBox.value));
        const visit = document.createElement('button');
        visit.type = 'button';
        visit.className = 'btn-signup';
        visit.textContent = 'Log a visit';
        visit.addEventListener('click', () => logVisit(venue.id));
        body.append(reviewLabel, reviewBox, reviewSave, visit);
      }
      if (venue.addr) {
        const query = encodeURIComponent(venue.name + ' ' + venue.addr);
        const maps = document.createElement('p');
        maps.className = 'maps';
        const google = document.createElement('a');
        google.href = 'https://www.google.com/maps/search/?api=1&query=' + query;
        google.target = '_blank';
        google.rel = 'noopener noreferrer';
        google.textContent = 'Google Maps';
        const apple = document.createElement('a');
        apple.href = 'https://maps.apple.com/?q=' + query;
        apple.target = '_blank';
        apple.rel = 'noopener noreferrer';
        apple.textContent = 'Apple Maps';
        maps.append(google, document.createTextNode(' '), apple);
        body.append(maps);
      }
      const back = document.getElementById('sheet-back');
      document.getElementById('venue-sheet').classList.remove('is-full');
      back.hidden = false;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) back.classList.add('is-on');
      else requestAnimationFrame(() => back.classList.add('is-on'));
    }

    function closeSheet() {
      const back = document.getElementById('sheet-back');
      if (back.hidden) return;
      back.classList.remove('is-on');
      const finish = () => { back.hidden = true; };
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
      else window.setTimeout(finish, 280);
    }

    function openPicker() {
      const picker = document.getElementById('city-picker');
      document.getElementById('now-line').setAttribute('aria-expanded', 'true');
      picker.hidden = false;
      renderPicker();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) picker.classList.add('is-on');
      else requestAnimationFrame(() => picker.classList.add('is-on'));
      const input = document.getElementById('city-picker-search');
      window.setTimeout(() => {
        if (picker.hidden) return;
        input.focus();
        input.select();
      }, 0);
    }

    function closePicker() {
      const picker = document.getElementById('city-picker');
      if (picker.hidden) return;
      document.getElementById('now-line').setAttribute('aria-expanded', 'false');
      picker.classList.remove('is-on');
      const finish = () => { picker.hidden = true; };
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
      else window.setTimeout(finish, 180);
    }

    function onVenueClick(event) {
      const row = event.target.closest('[data-venue]');
      if (!row) return;
      const badge = row.querySelector('.forecast-badge');
      openSheet(row.getAttribute('data-venue'), badge ? badge.textContent : '');
    }

    document.getElementById('tonight-list').addEventListener('click', onVenueClick);
    document.getElementById('for-you-list').addEventListener('click', onVenueClick);
    document.getElementById('closed-list').addEventListener('click', onVenueClick);
    document.getElementById('weekend-list').addEventListener('click', onVenueClick);
    document.getElementById('weekend-closed').addEventListener('click', onVenueClick);
    document.getElementById('city-rails').addEventListener('mousedown', (event) => {
      if (event.target.closest('[data-group]')) event.preventDefault();
    });
    document.getElementById('city-rails').addEventListener('click', (event) => {
      const chip = event.target.closest('[data-group]');
      if (!chip) return;
      const id = chip.getAttribute('data-group');
      const weekend = Boolean(chip.closest('#weekend-groups'));
      if (weekend) weekendGroup = id;
      else nowGroup = id;
      paintLists();
    });
    document.getElementById('now-line').addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    document.getElementById('now-line').addEventListener('click', () => {
      if (document.getElementById('city-picker').hidden) openPicker();
      else closePicker();
    });
    document.getElementById('city-picker-search').addEventListener('input', renderPicker);
    document.getElementById('city-picker-search').form.addEventListener('submit', (event) => {
      event.preventDefault();
      const button = document.querySelector('#city-picker-list button');
      if (button) button.click();
    });
    document.addEventListener('click', (event) => {
      const picker = document.getElementById('city-picker');
      if (picker.hidden) return;
      if (event.target.closest('.now-bar')) return;
      closePicker();
    });
    document.getElementById('sheet-back').addEventListener('click', (event) => {
      if (event.target.id === 'sheet-back') closeSheet();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      closeSheet();
      closePicker();
      closeAccount();
    });
    const sheetHandle = document.getElementById('sheet-handle');
    let dragY = 0;
    sheetHandle.addEventListener('pointerdown', (event) => {
      dragY = event.clientY;
      sheetHandle.setPointerCapture(event.pointerId);
    });
    sheetHandle.addEventListener('pointerup', (event) => {
      const dy = event.clientY - dragY;
      if (dy > 72) closeSheet();
      else if (dy < -36) document.getElementById('venue-sheet').classList.add('is-full');
    });

    function stepCalendar(state, delta, paint) {
      if (!state.key) state.key = localIso().slice(0, 7);
      state.key = shiftMonth(state.key, delta);
      state.day = '';
      paint();
    }
    document.getElementById('outlook-prev').addEventListener('click', () => stepCalendar(outlookCal, -1, paintOutlook));
    document.getElementById('outlook-next').addEventListener('click', () => stepCalendar(outlookCal, 1, paintOutlook));
    function jumpOutlook() {
      const month = String(document.getElementById('outlook-month').value).padStart(2, '0');
      const year = document.getElementById('outlook-year').value;
      if (!year) return;
      outlookCal.key = year + '-' + month;
      outlookCal.day = '';
      paintOutlook();
    }
    document.getElementById('outlook-month').addEventListener('change', jumpOutlook);
    document.getElementById('outlook-year').addEventListener('change', jumpOutlook);
    document.getElementById('outlook').addEventListener('click', (event) => {
      const day = event.target.closest('[data-cal-day]');
      if (!day) return;
      outlookCal.day = day.getAttribute('data-cal-day');
      paintOutlook();
    });

    /* ACCOUNT */
    renderHome(false);
    let railsEntered = false;
    const riseObserver = new IntersectionObserver((entries) => {
      if (railsEntered || !entries.some((entry) => entry.isIntersecting)) return;
      railsEntered = true;
      document.querySelectorAll('#tonight-list .tonight-row, #weekend-list .tonight-row').forEach((node, index) => {
        node.style.animationDelay = (index * 40) + 'ms';
        node.classList.add('rise');
      });
    }, { threshold: 0.15 });
    riseObserver.observe(document.getElementById('tonight'));
    let seenHour = activeHour(homeCity());
    setInterval(() => {
      const hour = activeHour(homeCity());
      if (hour === seenHour) return;
      seenHour = hour;
      renderHome();
    }, 60000);
    let hadCity = false;
    try { hadCity = Boolean(localStorage.getItem('fd-city')); } catch (err) {}
    if (!hadCity && !hashCity && navigator.geolocation) {
      const place = document.querySelector('[data-place]');
      place.textContent = 'Detecting…';
      navigator.geolocation.getCurrentPosition((pos) => {
        here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const nearest = tonight.cities.slice().sort((a, b) => distanceKm(here, a) - distanceKm(here, b))[0];
        if (nearest) chooseCity(nearest.id, false);
        else place.textContent = homeCity().name + ', ' + homeCity().country;
      }, () => {
        place.textContent = homeCity().name + ', ' + homeCity().country;
      }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
    }

    window.addEventListener('hashchange', showView);
    if (location.hash === '#home') history.replaceState(null, '', location.pathname + location.search);
    showView();
  </script>
</body>
</html>
`;

const outPath = new URL('../apps/web/index.html', import.meta.url);
const accountClient = readFileSync(new URL('./account-client.js', import.meta.url), 'utf8');
writeFileSync(outPath, html.replace('/* ACCOUNT */', accountClient));
const liveVenues = allVenues().filter((venue) => LIVE.some((city) => city.name === venue.city)).length;
console.log(`Wrote ${outPath.pathname} (${CITIES.length} cities, ${LIVE.length} live, ${liveVenues} venues on live pages)`);
