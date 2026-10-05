// scripts/build-web.mjs
// Phase 0: score every seed venue for tonight and write a standalone page.
// Run: node scripts/build-web.mjs
// Home offers location or a city you will visit. A city view groups venues into Drinks and Dance, Saunas and Bathhouses, and Fun Fun.
// Priors match scripts/forecast-tonight.mjs. Phase 2 replaces them with mined data.

import { readFileSync, writeFileSync } from 'node:fs';
import { scoreForecast, labelFor } from '../packages/forecast/score.js';

const seed = JSON.parse(readFileSync(new URL('../data/seed-venues.json', import.meta.url)));

const CITIES = [
  { id: 'san-francisco', name: 'San Francisco', lat: 37.7749, lon: -122.4194 },
  { id: 'madrid', name: 'Madrid', lat: 40.4168, lon: -3.7038 },
  { id: 'paris', name: 'Paris', lat: 48.8566, lon: 2.3522 },
  { id: 'cologne', name: 'Cologne', lat: 50.9375, lon: 6.9603 },
  { id: 'santiago', name: 'Santiago', lat: -33.4489, lon: -70.6693 },
];
const NEAR_CITY_KM = 150;

const GROUPS = [
  { id: 'dance', title: 'Drinks and Dance', categories: ['bar'], icon: 'music' },
  { id: 'sauna', title: 'Saunas and Bathhouses', categories: ['sauna'], icon: 'sauna' },
  { id: 'fun', title: 'Fun Fun', categories: ['sex', 'cruise'], icon: 'fire' },
];

const PRIORS = {
  sauna: { weekend: { p: 0.95, drivers: ['Weekend pattern', '24h schedule'] }, weeknight: { p: 0.45, drivers: ['Weeknight pattern', '24h schedule'] } },
  bar:   { weekend: { p: 0.7,  drivers: ['Weekend pattern', 'Castro foot traffic'] }, weeknight: { p: 0.4, drivers: ['Weeknight pattern', 'Castro foot traffic'] } },
};

const now = new Date();
const dow = now.getDay(); // 0=Sunday
const isWeekend = dow === 0 || dow === 5 || dow === 6;
const dayName = now.toLocaleDateString('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function scoreVenue(v) {
  const cat = PRIORS[v.category] ?? PRIORS.bar;
  const t = isWeekend ? cat.weekend : cat.weeknight;
  const prior = { p_busy: t.p, n_obs: 12, drivers: t.drivers };
  const { score, confidence, drivers } = scoreForecast(prior, []);
  const { label } = labelFor(score, confidence);
  return { score, confidence, drivers, label };
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

function mapLinks(v) {
  if (!v.address) return '';
  const query = encodeURIComponent(`${v.name} ${v.address}`);
  const google = `https://www.google.com/maps/search/?api=1&query=${query}`;
  const apple = `https://maps.apple.com/?q=${query}`;
  return `          <p class="address">${escapeHtml(v.address)}</p>
          <p class="maps">
            <a href="${google}" target="_blank" rel="noopener noreferrer">Google Maps</a>
            <a href="${apple}" target="_blank" rel="noopener noreferrer">Apple Maps</a>
          </p>`;
}

function cardHtml(v) {
  const { score, confidence, label } = scoreVenue(v);
  const width = Math.max(0, Math.min(100, (score / 10) * 100));
  const scoreText = `${score.toFixed(1)}/10`;
  const features = (v.review_features || []).map((d) => `<li>${escapeHtml(d)}</li>`).join('');
  const reviews = features
    ? `          <p class="reviews-label">From reviews</p>
          <ul class="features">${features}</ul>`
    : '';

  return `        <article class="card" id="venue-${escapeHtml(v.id)}">
          <div class="card-top">
            <h4>${escapeHtml(v.name)}</h4>
            <span class="badge ${escapeHtml(confidence)}">${escapeHtml(confidence)}</span>
          </div>
          <p class="neighborhood">${escapeHtml(v.neighborhood)}</p>
${mapLinks(v)}
          <div class="meter">
            <div class="meter-head">
              <p class="meter-title">Expected busyness tonight</p>
              <p class="score">${escapeHtml(scoreText)}</p>
            </div>
            <div class="bar" role="img" aria-label="Expected busyness ${escapeHtml(scoreText)}, from quiet to packed">
              <span style="width:${width}%"></span>
            </div>
            <div class="meter-scale"><span>Quiet</span><span>Packed</span></div>
            <p class="signal">${escapeHtml(label)}</p>
          </div>
${reviews}
        </article>`;
}

function groupHtml(group, venues) {
  const body = venues.length
    ? `<div class="cards">\n${venues.map(cardHtml).join('\n')}\n        </div>`
    : `<p class="empty">Nothing listed here yet.</p>`;
  return `      <section class="group">
        <h3>${groupIcon(group)}${escapeHtml(group.title)}</h3>
        ${body}
      </section>`;
}

function cityHtml(city) {
  const venues = seed.venues.filter((v) => v.city === city.name);
  const groups = GROUPS.map((group) => {
    const inGroup = venues.filter((v) => group.categories.includes(v.category));
    return groupHtml(group, inGroup);
  }).join('\n');

  return `    <section class="city" id="${escapeHtml(city.id)}">
      <p class="back"><a href="#home">All cities</a></p>
      <h2 class="section-title">Tonight's Scene Forecast · ${escapeHtml(city.name)}<span class="when">${escapeHtml(dayName)}</span></h2>
${groups}
      <footer>
        <p>Expected busyness from historical patterns — not live counts. Prototype.</p>
      </footer>
    </section>`;
}

const cityPicks = CITIES.map((city) => `        <li><a class="city-pick" href="#${escapeHtml(city.id)}">${escapeHtml(city.name)}</a></li>`).join('\n');
const cityLookup = JSON.stringify(CITIES.map(({ id, lat, lon }) => ({ id, lat, lon })));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FindingDorothy — Tonight's Scene Forecast</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #101218;
      --card: #1a1d27;
      --line: rgba(255, 255, 255, 0.08);
      --text: #f3f4f7;
      --muted: #9aa1ae;
      --accent: #ff7aa2;
      --accent-2: #c084fc;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(1200px 500px at 10% -10%, rgba(192, 132, 252, 0.16), transparent 55%),
        radial-gradient(900px 420px at 100% 0%, rgba(255, 122, 162, 0.12), transparent 50%),
        var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    .wrap {
      width: min(960px, 100%);
      margin: 0 auto;
      padding: 2.25rem 1rem 3rem;
    }
    .brand {
      color: inherit;
      text-decoration: none;
    }
    header h1 {
      margin: 0;
      font-size: clamp(1.8rem, 4vw, 2.4rem);
      letter-spacing: -0.03em;
      font-weight: 700;
    }
    .tagline {
      margin: 0.4rem 0 0;
      color: var(--muted);
      font-size: 1rem;
    }
    .section-title {
      margin: 2rem 0 1rem;
      font-size: clamp(1.05rem, 2.4vw, 1.25rem);
      font-weight: 650;
      letter-spacing: -0.02em;
      text-wrap: pretty;
    }
    .share {
      appearance: none;
      display: block;
      width: min(100%, 22rem);
      margin: 2.75rem 0 0;
      border: 0;
      border-radius: 999px;
      padding: 0.95rem 1.3rem;
      background: linear-gradient(90deg, var(--accent-2), var(--accent));
      color: #1a1020;
      font: inherit;
      font-size: 1.05rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      cursor: pointer;
    }
    .share:hover { filter: brightness(1.06); }
    .share:focus-visible {
      outline: 2px solid var(--text);
      outline-offset: 3px;
    }
    .share:disabled { cursor: progress; filter: none; opacity: 0.75; }
    .loc-note {
      margin: 0.75rem 0 0;
      min-height: 1.4em;
      color: var(--muted);
      font-size: 0.92rem;
    }
    .or {
      margin: 2.25rem 0 0;
      color: var(--muted);
      font-size: 0.85rem;
    }
    .home h2 {
      margin: 0.35rem 0 0;
      font-size: 1.05rem;
      font-weight: 650;
      letter-spacing: -0.02em;
    }
    .when {
      display: block;
      margin-top: 0.25rem;
      color: var(--muted);
      font-size: 0.92rem;
      font-weight: 500;
    }
    @media (min-width: 720px) {
      .when {
        display: inline;
        margin-top: 0;
        color: inherit;
        font-size: inherit;
        font-weight: inherit;
      }
      .when::before { content: " · "; }
    }
    .city-list {
      margin: 0.35rem 0 0;
      padding: 0;
      list-style: none;
    }
    .city-pick {
      display: inline-block;
      padding: 0.45rem 0;
      color: inherit;
      font-size: 1.35rem;
      font-weight: 650;
      letter-spacing: -0.03em;
      text-decoration: none;
    }
    .city-pick:hover,
    .city-pick:focus-visible {
      color: var(--accent);
      outline: none;
    }
    .city { display: none; }
    .city:target { display: block; }
    body:has(.city:target) .home { display: none; }
    .back {
      margin: 1.75rem 0 0;
    }
    .back a {
      color: var(--muted);
      text-decoration: none;
      font-size: 0.92rem;
    }
    .back a:hover,
    .back a:focus-visible { color: var(--text); }
    .group { margin-top: 1.75rem; }
    .group h3 {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      margin: 0 0 0.85rem;
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text);
    }
    .group-icon {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 1.15rem;
      height: 1.15rem;
      color: #f3f5f8;
    }
    .group-icon.dance { color: #ff7aa2; }
    .group-icon.fun { width: 0.85rem; height: 1.2rem; }
    .group-icon svg { width: 100%; height: 100%; display: block; }
    .empty {
      margin: 0;
      padding: 1rem 1.1rem;
      border-radius: 16px;
      border: 1px dashed var(--line);
      color: var(--muted);
    }
    .cards {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 0.85rem;
      margin: 0;
      padding: 0;
    }
    @media (min-width: 720px) {
      .cards { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    }
    .card {
      min-width: 0;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 1rem 1rem 0.95rem;
    }
    .card-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .card h4 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 650;
      letter-spacing: -0.02em;
    }
    .badge {
      flex: none;
      border-radius: 999px;
      padding: 0.2rem 0.6rem;
      background: #262a33;
      color: #c9ced8;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: capitalize;
      letter-spacing: 0.02em;
    }
    .badge.medium { background: #332b1c; color: #f0d39a; }
    .badge.high { background: #1a2e24; color: #9ee0b8; }
    .neighborhood {
      margin: 0.2rem 0 0;
      color: var(--muted);
      font-size: 0.92rem;
    }
    .address {
      margin: 0.15rem 0 0;
      font-size: 0.92rem;
    }
    .maps {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem 0.9rem;
      margin: 0.3rem 0 0.95rem;
    }
    .maps a {
      color: var(--accent);
      font-size: 0.85rem;
      text-decoration: none;
    }
    .maps a:hover,
    .maps a:focus-visible { text-decoration: underline; }
    .meter { min-width: 0; }
    .meter-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
      min-width: 0;
    }
    .meter-title {
      margin: 0;
      min-width: 0;
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
    }
    @media (max-width: 719px) {
      .meter-head {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.15rem;
      }
    }
    .bar {
      height: 12px;
      margin-top: 0.45rem;
      border-radius: 999px;
      background: #2a2f3b;
      overflow: hidden;
    }
    .bar span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent-2), var(--accent));
    }
    .meter-scale {
      display: flex;
      justify-content: space-between;
      margin-top: 0.28rem;
      color: var(--muted);
      font-size: 0.75rem;
    }
    .score {
      margin: 0;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      font-size: 1rem;
    }
    .signal {
      margin: 0.45rem 0 0.85rem;
      color: var(--muted);
      font-size: 0.92rem;
      font-style: italic;
    }
    .reviews-label {
      margin: 0 0 0.4rem;
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .features {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      min-width: 0;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .features li {
      max-width: 100%;
      border-radius: 999px;
      padding: 0.22rem 0.6rem;
      background: #242833;
      color: #d5dae3;
      font-size: 0.8rem;
    }
    footer {
      margin-top: 1.75rem;
      color: var(--muted);
      font-size: 0.85rem;
    }
    footer p { margin: 0; }
  </style>
</head>
<body>
  <!-- Sauna icon: Freepik via SVG Repo, CC BY 3.0. Flame icon: UXWing. -->
  <div class="wrap">
    <header>
      <a class="brand" href="#home">
        <h1>FindingDorothy</h1>
      </a>
      <p class="tagline">Gay travel intel, powered by real reviews</p>
    </header>
    <main>
      <section class="home" id="home">
        <button type="button" class="share" id="share-location">Share your location</button>
        <p class="loc-note" id="loc-status" role="status">Opens the nearest city we cover.</p>
        <p class="or">or</p>
        <h2>Select a city you will be visiting</h2>
        <ul class="city-list">
${cityPicks}
        </ul>
      </section>
${CITIES.map(cityHtml).join('\n')}
    </main>
  </div>
  <script>
    const cities = ${cityLookup};
    const nearKm = ${NEAR_CITY_KM};
    const button = document.getElementById('share-location');
    const status = document.getElementById('loc-status');

    function distanceKm(a, b) {
      const toRad = (deg) => deg * Math.PI / 180;
      const dLat = toRad(b.lat - a.lat);
      const dLon = toRad(b.lon - a.lon);
      const lat1 = toRad(a.lat);
      const lat2 = toRad(b.lat);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    function nearestCity(here) {
      let best = null;
      for (const city of cities) {
        const distance = distanceKm(here, city);
        if (!best || distance < best.distance) best = { city, distance };
      }
      return best;
    }

    button.addEventListener('click', () => {
      if (!navigator.geolocation) {
        status.textContent = 'Location is unavailable here. Select a city below.';
        return;
      }
      button.disabled = true;
      status.textContent = 'Finding the nearest city…';
      navigator.geolocation.getCurrentPosition((pos) => {
        button.disabled = false;
        const nearest = nearestCity({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        if (!nearest || nearest.distance > nearKm) {
          status.textContent = 'No covered city is close enough. Select one below.';
          return;
        }
        location.hash = nearest.city.id;
      }, () => {
        button.disabled = false;
        status.textContent = 'Location was not shared. Select a city below.';
      }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
    });
  </script>
</body>
</html>
`;

const outPath = new URL('../apps/web/index.html', import.meta.url);
writeFileSync(outPath, html);
const sfCount = seed.venues.filter((v) => v.city === 'San Francisco').length;
console.log(`Wrote ${outPath.pathname} (${CITIES.length} cities, ${sfCount} San Francisco venues)`);
