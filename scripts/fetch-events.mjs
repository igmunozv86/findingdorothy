// Fetch venue events pages and record an event dated today.
// Missing page or no date match: that venue is absent, not a fake "no".
// Run: node scripts/fetch-events.mjs

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const citiesDir = new URL('../data/cities/', import.meta.url);
const outDir = new URL('../data/events/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const byDate = new Map();
let checked = 0;
let hits = 0;

for (const name of readdirSync(citiesDir).filter((file) => file.endsWith('.json')).sort()) {
  const city = JSON.parse(readFileSync(new URL(name, citiesDir), 'utf8'));
  const dateKey = localDateKey(new Date(), city.meta.tz);
  for (const venue of city.venues || []) {
    if (!venue.events_url) continue;
    checked += 1;
    let html = '';
    try {
      const res = await fetch(venue.events_url, {
        headers: { 'user-agent': 'FindingDorothy/0.1 (event calendar)' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });
      if (!res.ok) {
        console.error(`${venue.id}: ${venue.events_url} → ${res.status}`);
        continue;
      }
      html = await res.text();
    } catch (err) {
      console.error(`${venue.id}: ${err.message}`);
      continue;
    }
    const eventName = eventOnPage(html, dateKey);
    if (!eventName) continue;
    if (!byDate.has(dateKey)) byDate.set(dateKey, {});
    byDate.get(dateKey)[venue.id] = { event_tonight: true, event_name: eventName };
    hits += 1;
    console.log(`${venue.id}: ${eventName} (${dateKey})`);
  }
}

for (const [dateKey, events] of byDate) {
  const file = new URL(`${dateKey}.json`, outDir);
  writeFileSync(file, `${JSON.stringify(events, null, 2)}\n`);
  console.log(`wrote ${file.pathname}`);
}

console.log(`checked ${checked} events pages, ${hits} events tonight`);

function localDateKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function eventOnPage(html, dateKey) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const [year, month, day] = dateKey.split('-');
  const monthName = MONTHS[Number(month) - 1];
  const dayNum = String(Number(day));
  const dated = [
    dateKey,
    `${dayNum} ${monthName} ${year}`,
    `${monthName} ${dayNum}, ${year}`,
    `${monthName} ${dayNum} ${year}`,
  ].some((pattern) => text.toLowerCase().includes(pattern));
  const tonight = /tonight/i.test(text) && /event|party|show|dj|live/i.test(text);
  if (!dated && !tonight) return null;
  const title = text.match(/(?:event|party|show)\s*[:\-–]\s*([^.]{3,80})/i);
  return (title ? title[1].trim() : 'Tonight').slice(0, 80);
}
