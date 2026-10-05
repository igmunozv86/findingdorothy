// scripts/build-web.mjs
// Phase 0: score every seed venue for tonight and write a standalone page.
// Run: node scripts/build-web.mjs
// Home is the header, hero, and footer. Browse the world opens a city accordion here.
// San Francisco is a separate page. The same city layout is what the next cities will use.
// Priors match scripts/forecast-tonight.mjs. Phase 2 replaces them with mined data.

import { readFileSync, writeFileSync } from 'node:fs';
import { periodLabel, placeStatus, zonedNow } from '../packages/forecast/open.js';
import { assembleForecast, dayScore, isShutdown } from '../packages/forecast/assemble.js';
import { fetchWeather } from '../packages/forecast/weather.js';

const seed = JSON.parse(readFileSync(new URL('../data/seed-venues.json', import.meta.url)));

const CITIES = [
  { id: 'san-francisco', name: 'San Francisco', country: 'USA', lat: 37.7749, lon: -122.4194, tz: 'America/Los_Angeles' },
  { id: 'madrid', name: 'Madrid', country: 'Spain', lat: 40.4168, lon: -3.7038, tz: 'Europe/Madrid' },
  { id: 'paris', name: 'Paris', country: 'France', lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris' },
  { id: 'cologne', name: 'Cologne', country: 'Germany', lat: 50.9375, lon: 6.9603, tz: 'Europe/Berlin' },
  { id: 'santiago', name: 'Santiago', country: 'Chile', lat: -33.4489, lon: -70.6693, tz: 'America/Santiago' },
  { id: 'sao-paulo', name: 'São Paulo', country: 'Brazil', lat: -23.5505, lon: -46.6333, tz: 'America/Sao_Paulo' },
];
const NEAR_CITY_KM = 150;

const GROUPS = [
  { id: 'dance', title: 'Drinks and Dance', categories: ['bar'], icon: 'music' },
  { id: 'sauna', title: 'Saunas and Bathhouses', categories: ['sauna'], icon: 'sauna' },
  { id: 'fun', title: 'Fun Fun', categories: ['sex', 'cruise'], icon: 'fire' },
];

const LIVE = new Set(['san-francisco', 'santiago', 'sao-paulo']);
const weatherByCity = {};

const RAIN_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.4 15h11.3a3.5 3.5 0 0 0 .4-7 5.1 5.1 0 0 0-9.9-1.2A4 4 0 0 0 6.4 15z"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M8.2 17.2v2.3M12 17.2v3.1M15.8 17.2v2.3"/></svg>`;

function placeLabel(city) {
  return `${city.name}, ${city.country}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function scoreVenue(v, when) {
  return assembleForecast(v, when, { weather: weatherByCity[v.city] || null });
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
  return dayScore(v, day);
}

function weekHtml(v, when, shut) {
  const days = WEEK.map((day) => ({ ...day, score: scoreForDow(v, day.dow) }));
  const peak = Math.max(...days.map((day) => day.score));
  const cols = days.map((day) => {
    const height = Math.max(8, Math.min(100, (day.score / 10) * 100));
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

function cardHtml(v, when, basic) {
  const { score, confidence, label, summary, sources, status } = scoreVenue(v, when);
  const sourceLine = sources.filter((source) => source.kind !== 'missing').map((source) => source.name).join(' · ');
  const width = Math.max(0, Math.min(100, (score / 10) * 100));
  const scoreText = `${score.toFixed(1)}/10`;
  const closingSoon = !basic && status.minutesLeft != null && status.minutesLeft <= 60;
  const quiet = basic || closingSoon;
  const hot = !quiet && score >= 8 ? `<span class="hot">Hot</span>` : '';
  const tag = basic
    ? `<span class="badge closed">Closed</span>`
    : closingSoon
      ? `<span class="badge closing">Closing Soon</span>`
      : `<span class="badge ${escapeHtml(confidence)}">${escapeHtml(confidence)}</span>`;
  const features = (v.review_features || []).map((d) => `<li>${escapeHtml(d)}</li>`).join('');
  const reviews = features
    ? `          <p class="reviews-label">From reviews</p>
          <ul class="features">${features}</ul>`
    : '';
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
            <p class="signal">${escapeHtml(label)}</p>
            <p class="why">${escapeHtml(summary)}</p>
            <p class="sources">${escapeHtml(sourceLine)}</p>
          </div>`;

  return `        <article class="card" id="venue-${escapeHtml(v.id)}">
          <div class="card-top">
            <h4>${escapeHtml(v.name)}</h4>
            <span class="card-pills">${hot}${tag}</span>
          </div>
          <p class="neighborhood">${escapeHtml(v.neighborhood)}</p>
${mapLinks(v, when)}${meter}
${weekHtml(v, when, basic || closingSoon)}
${reviews}
        </article>`;
}

function groupHtml(group, venues, when, cityId) {
  const operating = venues.filter((venue) => !isShutdown(venue));
  const scored = operating.map((venue) => ({ venue, forecast: scoreVenue(venue, when) }));
  const ranked = scored
    .filter(({ forecast }) => forecast.status.open)
    .sort((a, b) => b.forecast.score - a.forecast.score || a.venue.name.localeCompare(b.venue.name));
  const shut = scored
    .filter(({ forecast }) => !forecast.status.open)
    .sort((a, b) => a.venue.name.localeCompare(b.venue.name));
  const gone = venues.filter((venue) => isShutdown(venue));
  const cards = [
    ...ranked.map(({ venue }) => cardHtml(venue, when, false)),
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

function sectionMenu(cityId) {
  const items = GROUPS.map((group) => `        <button type="button" data-jump="group-${escapeHtml(cityId)}-${escapeHtml(group.id)}">${groupIcon(group)}<span>${escapeHtml(group.title)}</span></button>`).join('\n');
  return `      <nav class="jump-menu" id="jump-menu-${escapeHtml(cityId)}" aria-label="Jump to a section">
${items}
      </nav>`;
}

function cityPageHtml(city) {
  const when = zonedNow(new Date(), city.tz);
  const venues = seed.venues.filter((v) => v.city === city.name);
  const groups = GROUPS.map((group) => {
    const inGroup = venues.filter((v) => group.categories.includes(v.category));
    return groupHtml(group, inGroup, when, city.id);
  }).join('\n');
  const report = weatherByCity[city.name];
  const temp = report && Number.isFinite(report.tempC) ? `${Math.round(report.tempC)}°C` : '';
  const rainLabel = report?.raining ? 'Raining' : 'Rain likely';

  return `  <main class="view" id="${escapeHtml(city.id)}" hidden>
    <section class="city-hero block">
      <p class="back"><a href="#home">Home</a></p>
      <p class="eyebrow" data-period>${escapeHtml(periodLabel(when.hour))}</p>
      <h1>${escapeHtml(placeLabel(city))}</h1>
      <p class="lede" data-date>${escapeHtml(when.dateLabel)}</p>
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

const worldList = CITIES.map((city) => {
  if (LIVE.has(city.id)) {
    return `            <li class="acc-item"><a class="acc-link" href="#${escapeHtml(city.id)}">${escapeHtml(placeLabel(city))}<span>Open</span></a></li>`;
  }
  return `            <li class="acc-item">
              <button type="button" class="acc-toggle" data-city="${escapeHtml(city.id)}" aria-expanded="false">${escapeHtml(placeLabel(city))}<span class="chev" aria-hidden="true"></span></button>
              <div class="acc-panel"><div class="acc-panel-clip"><p>Next. This city will use the same page.</p></div></div>
            </li>`;
}).join('\n');

const footerCities = CITIES.map((city) => {
  if (LIVE.has(city.id)) {
    return `            <li><a href="#${escapeHtml(city.id)}">${escapeHtml(placeLabel(city))}</a></li>`;
  }
  return `            <li><a href="#home" data-open-world data-city="${escapeHtml(city.id)}">${escapeHtml(placeLabel(city))}</a></li>`;
}).join('\n');

const cityLookup = JSON.stringify(CITIES.map(({ id, name, country, lat, lon }) => ({ id, name, country, lat, lon })));

for (const city of CITIES) {
  if (!LIVE.has(city.id)) continue;
  try {
    weatherByCity[city.name] = await fetchWeather(city.lat, city.lon, city.tz);
  } catch (err) {
    console.error(`${city.name} weather unavailable: ${err.message}`);
  }
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
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
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
    .site-header {
      position: sticky;
      top: 0;
      z-index: 30;
      display: flex;
      align-items: center;
      gap: 1.25rem;
      min-height: 68px;
      padding: 0.65rem 1.25rem;
      background: #fff;
      border-bottom: 1px solid var(--line);
    }
    .logo {
      display: block;
      flex: none;
      width: 170px;
      height: 38px;
      overflow: hidden;
    }
    .logo img {
      display: block;
      width: 186.9px;
      height: 186.9px;
      max-width: none;
      margin: -70.8px 0 0 -7px;
    }
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
    .app-pill {
      display: inline-flex;
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
      margin-left: auto;
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
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(220px, 0.85fr);
      align-items: center;
      gap: 2rem;
      width: min(1120px, calc(100% - 2.5rem));
      margin: 0 auto;
      padding: 4.2rem 0 2.5rem;
    }
    .hero h1 {
      margin: 0;
      font-size: 64px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.05;
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
    .world.is-open .acc-item:nth-child(1) { transition-delay: 40ms; }
    .world.is-open .acc-item:nth-child(2) { transition-delay: 80ms; }
    .world.is-open .acc-item:nth-child(3) { transition-delay: 120ms; }
    .world.is-open .acc-item:nth-child(4) { transition-delay: 160ms; }
    .world.is-open .acc-item:nth-child(5) { transition-delay: 200ms; }
    .world.is-open .acc-item:nth-child(6) { transition-delay: 240ms; }
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
      margin: 1rem 0 0;
      max-width: 34rem;
      color: var(--muted);
      font-size: 16px;
      font-weight: 400;
    }
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
    .hero-art {
      width: min(100%, 420px);
      height: auto;
      justify-self: center;
    }
    .block {
      width: min(1120px, calc(100% - 2.5rem));
      margin: 0 auto;
      padding: 2.6rem 0;
      scroll-margin-top: 84px;
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
      margin: 0.45rem 0 0;
      color: var(--muted);
    }
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
    .group { margin-top: 1.6rem; scroll-margin-top: 5.5rem; }
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
    .badge.closing { color: #111; border-color: #ff7a18; }
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
      color: #111;
      font-size: 16px;
      font-weight: 500;
      text-decoration: underline;
      text-underline-offset: 2px;
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
    .why {
      margin: 0.35rem 0 0;
      font-size: 16px;
    }
    .sources {
      margin: 0.3rem 0 0;
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
    }
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
    .why-grid p, .pride p, .venues-band p {
      margin: 0.45rem 0 0;
      color: var(--muted);
    }
    .venues-band {
      background: #111;
      color: #fff;
      scroll-margin-top: 84px;
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
      margin: 96px auto 0;
    }
    .venue-invite-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.75rem;
      padding: 48px;
      border: 1px solid var(--line);
      border-radius: 22px;
      background:
        linear-gradient(var(--grad), var(--grad)) top / 100% 4px no-repeat,
        #fff;
    }
    .venue-invite-copy {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      min-width: 0;
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
      margin: 0;
      max-width: 16em;
      font-size: 36px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.1;
    }
    .venue-invite p {
      margin: 0.5rem 0 0;
      max-width: 36rem;
      color: var(--muted);
      font-size: 16px;
    }
    .venue-invite .btn { flex: none; }
    .get-app { display: none; }
    .site-footer {
      background: #111;
      color: #fff;
      scroll-margin-top: 84px;
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
      .nav-toggle { display: inline-block; }
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
      .app-pill { width: 100%; margin-top: 0.7rem; }
      .hero, .cards, .why-grid, .foot-cols { grid-template-columns: minmax(0, 1fr); }
      .hero { padding-top: 2.2rem; padding-bottom: 0; }
      .hero h1, .soon h1, .city-hero h1 { font-size: 42px; }
      .block h2, .why h2, .pride h2, .venues-band h2, .venue-invite h2 { font-size: 28px; }
      .venue-invite-card { flex-direction: column; align-items: flex-start; }
      .venue-invite-copy { flex-direction: column; align-items: center; width: 100%; }
      .venue-invite-copy > div { width: 100%; }
      .venue-invite .btn { width: 100%; }
      .get-app {
        display: block;
        width: min(1120px, calc(100% - 2.5rem));
        margin: 8px auto 0;
        background: #fff;
        text-align: center;
      }
      .get-app h2 {
        margin: 0;
        font-size: 28px;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .get-app-badges {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.35rem;
        margin-top: 0.85rem;
      }
      .get-app-badges img { display: block; height: 44px; width: auto; }
      .get-app-badges .play { height: 66px; margin: -11px 0; }
      .hero-art { width: 148px; margin-bottom: -28px; }
      .hero-cta { flex-direction: column; }
      .hero-cta .btn, .venues-band .btn { width: 100%; }
      .meter-head { flex-direction: column; align-items: flex-start; gap: 0.15rem; }
      .jump-menu {
        display: grid;
        gap: 0.45rem;
        margin-top: 1.35rem;
      }
      .jump-menu button {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        width: 100%;
        min-height: 48px;
        padding: 0.7rem 0.9rem;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: #fff;
        color: #111;
        font: inherit;
        font-size: 16px;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
      }
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
  </style>
</head>
<body>
  <!-- Sauna icon: Freepik via SVG Repo, CC BY 3.0. Flame icon: UXWing. -->
  <header class="site-header">
    <a class="logo" href="#home" aria-label="FindingDorothy">
      <img src="assets/logo-v4-warm.jpg" alt="FindingDorothy">
    </a>
    <button type="button" class="nav-toggle" aria-label="Open menu" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
    <div class="nav-panel">
      <nav class="site-nav" aria-label="Primary">
        <a href="#home" data-open-world>Cities</a>
        <a href="#forecast">Scene Forecast</a>
        <a href="#pride">Pride Calendar</a>
        <a href="#venues">For Venues</a>
      </nav>
      <span class="app-pill">Get the App</span>
    </div>
  </header>
  <main class="view" id="home">
    <section class="hero">
      <div>
        <h1>Know where the <span class="fun">fun</span> is going.</h1>
        <p class="subhead">Gay Guys travel intel, powered by real data.</p>
        <div class="hero-cta">
          <button type="button" class="btn solid" id="share-location">See tonight's forecast where you are</button>
          <button type="button" class="btn ghost" id="browse-world" aria-expanded="false" aria-controls="world">Browse the world</button>
        </div>
        <p class="loc-note" id="loc-status" role="status"></p>
        <div class="world" id="world" aria-hidden="true" inert>
          <div class="world-clip">
            <ul class="acc">
${worldList}
            </ul>
          </div>
        </div>
      </div>
      <img class="hero-art" src="assets/icon-mark.jpg" alt="">
    </section>
    <section class="get-app" aria-label="Get the app">
      <h2>Get the app!</h2>
      <div class="get-app-badges">
        <img class="app-store" src="assets/app-store-badge.svg" alt="Download on the App Store">
        <img class="play" src="assets/google-play-badge.png" alt="Get it on Google Play">
      </div>
    </section>
    <section class="venue-invite" aria-label="For venues">
      <div class="venue-invite-card">
        <div class="venue-invite-copy">
          <span class="venue-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path fill="currentColor" d="M6.4 12.6h19.2c-.55 2.2-2.3 4.2-5.4 5.4-1.5.6-2.7.9-4.2.9s-2.7-.3-4.2-.9c-3.1-1.2-4.85-3.2-5.4-5.4z"/>
              <path stroke="currentColor" stroke-width="2.1" stroke-linecap="round" d="M5.2 11.5h21.6"/>
              <path stroke="currentColor" stroke-width="2.1" stroke-linecap="round" d="M16 18.8V25"/>
              <path stroke="currentColor" stroke-width="2.1" stroke-linecap="round" d="M11 26.2h10"/>
              <circle cx="22.8" cy="10.2" r="1.65" fill="currentColor"/>
            </svg>
          </span>
          <div>
            <p class="eyebrow">For venues</p>
            <h2>Bring <span class="fun">more guys</span> through the door.</h2>
            <p>Share how busy you are, and tell us about your events. Travelers looking for the night see it here.</p>
          </div>
        </div>
        <a class="btn solid" href="#venues">Contact us!</a>
      </div>
    </section>
  </main>
${CITIES.filter((city) => LIVE.has(city.id)).map((city) => cityPageHtml(city)).join('\n')}
${[['forecast', 'Scene Forecast'], ['pride', 'Pride Calendar'], ['venues', 'For Venues']].map(([id, title]) => `  <main class="view" id="${id}" hidden>
    <section class="block soon">
      <h1>${escapeHtml(title)}</h1>
      <p>coming soon</p>
    </section>
  </main>`).join('\n')}
  <footer class="site-footer">
    <div class="foot-inner">
      <div class="foot-cols">
        <div>
          <h3>Product</h3>
          <ul class="foot-list">
            <li><a href="#forecast">Scene Forecast</a></li>
            <li><a href="#home" data-open-world>Cities</a></li>
            <li><a href="#pride">Pride Calendar</a></li>
            <li><span>Get the App</span></li>
          </ul>
        </div>
        <div>
          <h3>Cities</h3>
          <ul class="foot-list">
${footerCities}
          </ul>
        </div>
        <div>
          <h3>For Venues</h3>
          <ul class="foot-list">
            <li><a href="#venues">Live counter</a></li>
            <li><a href="#venues">Why FindingDorothy</a></li>
          </ul>
        </div>
      </div>
      <div class="legal">
        <p>© 2026 FindingDorothy</p>
        <p>Expected busyness from historical patterns — not live counts.</p>
      </div>
    </div>
  </footer>
  <script>
    const cities = ${cityLookup};
    const nearKm = ${NEAR_CITY_KM};
    const pages = new Set(${JSON.stringify([...LIVE])});
    const header = document.querySelector('.site-header');
    const toggle = document.querySelector('.nav-toggle');
    const world = document.getElementById('world');
    const browse = document.getElementById('browse-world');
    const status = document.getElementById('loc-status');
    const share = document.getElementById('share-location');

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

    function setPanels(cityId) {
      document.querySelectorAll('.acc-toggle').forEach((button) => {
        const open = Boolean(cityId) && button.dataset.city === cityId;
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        button.nextElementSibling.classList.toggle('is-open', open);
      });
    }

    function setWorld(open, cityId) {
      world.classList.toggle('is-open', open);
      world.inert = !open;
      world.setAttribute('aria-hidden', open ? 'false' : 'true');
      browse.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) setPanels('');
      else if (cityId) setPanels(cityId);
    }

    function closeWorld() {
      setWorld(false);
    }

    document.querySelector('.logo').addEventListener('click', closeWorld);

    function paintClock() {
      const now = new Date();
      document.querySelectorAll('[data-clock]').forEach((clock) => {
        const fmt = new Intl.DateTimeFormat('en-US', {
          timeZone: clock.dataset.tz,
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hourCycle: 'h23',
        });
        const bag = {};
        for (const part of fmt.formatToParts(now)) bag[part.type] = part.value;
        let hour = Number(bag.hour);
        if (hour === 24) hour = 0;
        const minute = String(bag.minute).padStart(2, '0');
        const suffix = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        const hero = clock.closest('.city-hero');
        hero.querySelector('[data-date]').textContent = bag.weekday + ', ' + bag.month + ' ' + Number(bag.day) + ', ' + bag.year;
        clock.textContent = hour12 + ':' + minute + ' ' + suffix;
        const period = hour < 12 ? 'This morning' : hour < 17 ? 'This afternoon' : hour < 21 ? 'This evening' : 'Tonight';
        hero.querySelector('[data-period]').textContent = period;
      });
    }
    paintClock();
    setInterval(paintClock, 30000);

    function applyWeather(node, report) {
      const temp = node.querySelector('[data-temp]');
      const rain = node.querySelector('[data-rain]');
      if (temp && Number.isFinite(report.tempC)) temp.textContent = Math.round(report.tempC) + '°C';
      if (!rain) return;
      const raining = report.precipMm >= 0.3 || isRainCode(report.code);
      const likely = raining || (Number.isFinite(report.probability) && report.probability >= 60);
      rain.hidden = !likely;
      rain.setAttribute('aria-label', raining ? 'Raining' : 'Rain likely');
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

    function showView() {
      const id = location.hash.replace('#', '');
      const current = !id || id === 'home' ? 'home' : id;
      document.querySelectorAll('main.view').forEach((view) => {
        view.hidden = view.id !== current;
      });
      window.scrollTo(0, 0);
    }

    function openWorld(cityId) {
      if (location.hash && location.hash !== '#home') location.hash = 'home';
      setWorld(true, cityId || '');
      window.scrollTo(0, 0);
    }

    browse.addEventListener('click', () => {
      setWorld(!world.classList.contains('is-open'));
    });

    document.querySelectorAll('.acc-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        const open = button.getAttribute('aria-expanded') !== 'true';
        setPanels(open ? button.dataset.city : '');
      });
    });

    document.querySelectorAll('[data-open-world]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        openWorld(link.dataset.city || '');
      });
    });

    function distanceKm(a, b) {
      const toRad = (deg) => deg * Math.PI / 180;
      const dLat = toRad(b.lat - a.lat);
      const dLon = toRad(b.lon - a.lon);
      const lat1 = toRad(a.lat);
      const lat2 = toRad(b.lat);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    share.addEventListener('click', () => {
      if (!navigator.geolocation) {
        status.textContent = 'Location is unavailable here. Pick a city below.';
        openWorld();
        return;
      }
      share.disabled = true;
      status.textContent = 'Finding the nearest city…';
      navigator.geolocation.getCurrentPosition((pos) => {
        share.disabled = false;
        let best = null;
        const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        for (const city of cities) {
          const distance = distanceKm(here, city);
          if (!best || distance < best.distance) best = { city, distance };
        }
        if (!best || best.distance > nearKm) {
          status.textContent = 'No covered city is close enough. Pick one below.';
          openWorld();
          return;
        }
        if (!pages.has(best.city.id)) {
          status.textContent = best.city.name + ', ' + best.city.country + ' is the nearest city. That page is next.';
          openWorld(best.city.id);
          return;
        }
        status.textContent = '';
        location.hash = best.city.id;
      }, () => {
        share.disabled = false;
        status.textContent = 'Location was not shared. Pick a city below.';
        openWorld();
      }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
    });

    window.addEventListener('hashchange', showView);
    if (location.hash === '#home') history.replaceState(null, '', location.pathname + location.search);
    showView();
  </script>
</body>
</html>
`;

const outPath = new URL('../apps/web/index.html', import.meta.url);
writeFileSync(outPath, html);
const sfCount = seed.venues.filter((v) => v.city === 'San Francisco').length;
console.log(`Wrote ${outPath.pathname} (${CITIES.length} cities, ${sfCount} San Francisco venues)`);
