// Hotel Chilli live occupancy. One request at a time. Stops on HTTP 429.
//
// Dry-run fetches the JSON endpoint once and does not loop or store a count:
//   node services/ingestion/poll-chilli.mjs --dry-run
//
// The 5-minute loop runs only when CHILLI_POLL=1.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchVenueSignal } from '../../packages/forecast/live.js';

const PAGE_URL = 'https://hotelchilli.com.br/';
const ENDPOINT = 'https://hotelchilli.com.br/wp-admin/admin-ajax.php?action=atualizar_contador_chilli';
const HTML_SELECTOR = '.chilli-card-counter';
const INTERVAL_MS = 5 * 60 * 1000;
const USER_AGENT = 'FindingDorothy/phase0';
const VENUE_ID = 'sao-paulo-hotel-chilli';
const latestPath = new URL('../../data/live-occupancy.json', import.meta.url);
const logPath = new URL('../../data/live-occupancy.jsonl', import.meta.url);
const pagePath = new URL('../../apps/web/index.html', import.meta.url);

export class RateLimitStop extends Error {
  constructor(url) {
    super(`429 from ${url}; stopped`);
    this.name = 'RateLimitStop';
    this.url = url;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCount(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

function parseHtmlCount(html) {
  const match = String(html).match(/class="chilli-card-counter"[^>]*>\s*(?:<span class="chilli-card-counter">)?(\d+)/);
  return match ? parseCount(match[1]) : null;
}

export async function fetchChilliCount() {
  const response = await fetch(ENDPOINT, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (response.status === 429) throw new RateLimitStop(ENDPOINT);
  if (response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const count = parseCount(payload?.data?.contagem);
    if (payload?.success === true && count != null) {
      return {
        via: 'json',
        endpoint: ENDPOINT,
        selector: null,
        count,
        hora: typeof payload.data.hora === 'string' ? payload.data.hora : null,
        payload,
      };
    }
  }

  const page = await fetch(PAGE_URL, {
    headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
  });
  if (page.status === 429) throw new RateLimitStop(PAGE_URL);
  if (!page.ok) return null;
  const count = parseHtmlCount(await page.text());
  if (count == null) return null;
  return {
    via: 'html',
    endpoint: PAGE_URL,
    selector: HTML_SELECTOR,
    count,
    hora: null,
    payload: null,
  };
}

export function occupancySignal(reading, retrievedAt = new Date().toISOString()) {
  return {
    venue_id: VENUE_ID,
    aspect: 'crowd',
    quote: `${reading.count} inside right now`,
    source_url: PAGE_URL,
    retrieved_at: retrievedAt,
    kind: 'live-occupancy',
    count: reading.count,
    hora: reading.hora,
    via: reading.via,
  };
}

function readTable() {
  try {
    const raw = JSON.parse(readFileSync(latestPath, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  } catch {
    // A missing table means no venue has a stored reading yet.
  }
  return {};
}

function writeTable(table) {
  mkdirSync(dirname(latestPath.pathname), { recursive: true });
  writeFileSync(latestPath, JSON.stringify(table));
}

function patchPage(signal) {
  let html;
  try {
    html = readFileSync(pagePath, 'utf8');
  } catch {
    return;
  }
  const live = signal
    ? { count: signal.count, retrievedAt: signal.retrieved_at }
    : null;
  const next = patchVenueSignal(html, VENUE_ID, live);
  if (next !== html) writeFileSync(pagePath, next);
}

function storeSignal(signal) {
  const table = readTable();
  table[signal.venue_id] = signal;
  writeTable(table);
  appendFileSync(logPath, `${JSON.stringify(signal)}\n`);
  patchPage(signal);
}

function clearLatest() {
  const table = readTable();
  delete table[VENUE_ID];
  writeTable(table);
  patchPage(null);
}

export async function pollOnce() {
  const reading = await fetchChilliCount();
  if (!reading) {
    console.log('no recent data: chilli');
    clearLatest();
    return null;
  }
  const signal = occupancySignal(reading);
  storeSignal(signal);
  return signal;
}

async function runLoop() {
  if (process.env.CHILLI_POLL !== '1') {
    console.error('CHILLI_POLL is off. The loop does not start and no request is sent.');
    return;
  }
  for (;;) {
    try {
      await pollOnce();
    } catch (error) {
      if (error instanceof RateLimitStop) {
        console.log('no recent data: chilli');
        clearLatest();
        console.error(error.message);
        return;
      }
      throw error;
    }
    await sleep(INTERVAL_MS);
  }
}

async function dryRun() {
  const reading = await fetchChilliCount();
  console.log(JSON.stringify({
    dry_run: true,
    endpoint: ENDPOINT,
    html_fallback_selector: HTML_SELECTOR,
    html_fallback_used: reading?.via === 'html',
    sample: reading
      ? {
          via: reading.via,
          count: reading.count,
          hora: reading.hora,
          payload: reading.payload,
        }
      : null,
  }, null, 2));
  if (!reading) console.log('no recent data: chilli');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (process.argv.includes('--dry-run')) await dryRun();
  else await runLoop();
}
