// Fresh venue counters. A reading older than 15 minutes is not live.

import { summaryWithCountNote } from './assemble.js';

export const LIVE_FRESH_MS = 15 * 60 * 1000;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeHtml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

export function freshOccupancy(row, nowMs) {
  if (!row || row.kind !== 'live-occupancy') return null;
  if (typeof row.venue_id !== 'string' || row.venue_id === '') return null;
  if (typeof row.source_url !== 'string' || row.source_url === '') return null;
  if (!Number.isInteger(row.count) || row.count < 0) return null;
  const at = Date.parse(row.retrieved_at);
  if (!Number.isFinite(at) || nowMs - at < 0 || nowMs - at >= LIVE_FRESH_MS) return null;
  return {
    venueId: row.venue_id,
    count: row.count,
    retrievedAt: row.retrieved_at,
    sourceUrl: row.source_url,
  };
}

export function signalMarkup(label, live) {
  if (!live) return `<p class="signal">${escapeHtml(label)}</p>`;
  return `<p class="signal" data-live-at="${escapeHtml(live.retrievedAt)}" data-fallback="${escapeHtml(label)}"><span class="live-dot" aria-hidden="true"></span><span class="badge live">Live</span> ${live.count} inside right now</p>`;
}

function fallbackLabel(openTag, inner) {
  const attr = openTag.match(/data-fallback="([^"]*)"/);
  if (attr) return decodeHtml(attr[1]);
  const text = decodeHtml(inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  return text || 'Not enough live signal';
}

export function patchVenueSignal(html, venueId, live) {
  const id = String(venueId).replace(/[^a-z0-9-]/gi, '');
  if (!id) return html;
  const re = new RegExp(`(<article class="card" id="venue-${id}">[\\s\\S]*?)(<p class="signal"[^>]*>)([\\s\\S]*?)</p>`);
  if (!re.test(html)) return html;
  const withSignal = html.replace(re, (full, before, open, inner) => `${before}${signalMarkup(fallbackLabel(open, inner), live)}`);
  const whyRe = new RegExp(`(<article class="card" id="venue-${id}">[\\s\\S]*?)(<p class="why"([^>]*)>)([\\s\\S]*?)</p>`);
  return withSignal.replace(whyRe, (full, before, open, attrs, inner) => {
    const stored = attrs.match(/data-fallback-why="([^"]*)"/);
    const original = stored ? decodeHtml(stored[1]) : decodeHtml(inner);
    if (!live) return `${before}<p class="why">${escapeHtml(summaryWithCountNote(original, false))}</p>`;
    const shown = summaryWithCountNote(original, true);
    return `${before}<p class="why" data-fallback-why="${escapeHtml(original)}">${escapeHtml(shown)}</p>`;
  });
}
