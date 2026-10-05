// Turn the sources we actually have into one score and a sentence.
// Closed is still a hard zero. Nothing here is a live headcount.

import { labelFor, scoreForecast } from './score.js';
import { placeStatus } from './open.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const PRIORS = {
  bar: { weekend: 0.66, weeknight: 0.38, name: 'bar' },
  cruise: { weekend: 0.68, weeknight: 0.4, name: 'cruising bar' },
  sex: { weekend: 0.58, weeknight: 0.4, name: 'sex club' },
  sauna: { weekend: 0.84, weeknight: 0.5, name: 'bathhouse' },
};

const HOUR_FACTOR = { early: 0.62, mid: 0.86, peak: 1.08, late: 0.72 };
const PHASE_WORDS = {
  early: 'early in its posted hours',
  mid: 'building through the evening',
  peak: 'in the busy part of the night',
  late: 'near closing',
};

const MISSING = [
  { name: 'Check-ins', kind: 'missing', detail: 'No live check-ins' },
  { name: 'Venue counter', kind: 'missing', detail: 'No staff count' },
  { name: 'Popular Times', kind: 'missing', detail: 'Google does not offer this API' },
  { name: 'Google Trends', kind: 'missing', detail: 'Not pulled' },
  { name: 'Event calendar', kind: 'missing', detail: 'Not pulled' },
];

export function isShutdown(venue) {
  const flag = String(venue.status || '').toLowerCase();
  return flag === 'closed' || flag === 'out_of_business' || flag === 'shutdown' || venue.out_of_business === true;
}

export function dayScore(venue, dow) {
  if (!openOnDow(venue.hours, dow)) return 0;
  const p = dayPrior(venue.category, dow);
  return Math.round(p * 10 * 10) / 10;
}

export function assembleForecast(venue, when, extras = {}) {
  const status = placeStatus(venue.hours, when);
  const weekend = status.patternDay === 0 || status.patternDay === 5 || status.patternDay === 6;
  const cat = PRIORS[venue.category] ?? PRIORS.bar;
  const features = venue.review_features || [];
  const sources = [
    { name: 'Posted hours', kind: 'gate', detail: status.text },
  ];

  if (!status.open) {
    const scored = scoreForecast(
      { p_busy: 0, n_obs: 12, drivers: ['Closed now'] },
      [{ kind: 'closed', value: 1 }],
    );
    const { label } = labelFor(scored.score, scored.confidence, { closed: true });
    return {
      ...scored,
      label,
      status,
      summary: 'Closed right now, so expected busyness is 0.',
      sources: sources.concat(MISSING),
    };
  }

  const dayWord = weekend ? 'Weekend' : 'Weeknight';
  let p = weekend ? cat.weekend : cat.weeknight;
  sources.push({
    name: 'Category prior',
    kind: 'prior',
    detail: `${dayWord.toLowerCase()} ${cat.name}`,
  });

  const phase = status.phase || 'mid';
  p *= HOUR_FACTOR[phase] ?? 1;
  sources.push({
    name: 'Hour prior',
    kind: 'prior',
    detail: PHASE_WORDS[phase] || phase,
  });

  const crowd = features.filter((feature) => /packed|lines|loud dance|dance floor/i.test(feature));
  if (crowd.length && weekend && phase === 'peak') {
    p += 0.08;
    sources.push({ name: 'Recurring reviews', kind: 'prior', detail: crowd.join(', ') });
  } else if (features.length) {
    sources.push({ name: 'Recurring reviews', kind: 'context', detail: features.slice(0, 3).join(', ') });
  } else {
    sources.push({ name: 'Recurring reviews', kind: 'missing', detail: 'None noted' });
  }

  const weather = extras.weather;
  if (weather) {
    const outdoor = features.some((feature) => /patio|backyard|balcony/i.test(feature));
    if (weather.raining) p *= outdoor ? 0.72 : 0.94;
    sources.push({
      name: 'Weather',
      kind: weather.raining ? 'live' : 'context',
      detail: `${weather.source} · ${weather.summary}`,
    });
  } else {
    sources.push({ name: 'Weather', kind: 'missing', detail: 'Not fetched' });
  }

  p = Math.min(0.92, Math.max(0.05, p));
  const drivers = [PHASE_WORDS[phase], crowd[0] || `${dayWord} ${cat.name}`].filter(Boolean);
  const scored = scoreForecast({ p_busy: p, n_obs: 12, drivers }, []);
  const { label } = labelFor(scored.score, scored.confidence);
  const where = venue.neighborhood ? `${venue.neighborhood} ${cat.name}` : cat.name;
  const reviewBit = crowd.length && phase === 'peak' ? ` Reviews mention ${crowd[0].toLowerCase()}.` : '';
  const rainBit = weather?.raining ? ` Rain is in the weather reading.` : '';
  const summary = `${dayWord} pattern for a ${where}, ${PHASE_WORDS[phase]}.${reviewBit}${rainBit} No live count.`;

  return {
    ...scored,
    label,
    status,
    summary,
    sources: sources.concat(MISSING),
  };
}

export const SOURCE_NOTES = [
  ['Posted hours', 'Venue sites where we have them, otherwise public listings. A closed door scores 0.'],
  ['Category prior', 'Hand-set weekend and weeknight odds for bars, cruising bars, sex clubs, and bathhouses.'],
  ['Hour prior', '8pm–2am is the busy stretch. The last 75 minutes before close taper off.'],
  ['Recurring reviews', 'Phrases noted on the venue. Crowd phrases nudge a weekend peak. Not a headcount.'],
  ['Weather', 'Open-Meteo, current conditions. Rain nudges patios down. Not a crowd count.'],
  ['Not used yet', 'Check-ins, venue counters, Popular Times, Google Trends, event calendar.'],
];

function dayPrior(category, dow) {
  const weekend = dow === 0 || dow === 5 || dow === 6;
  const cat = PRIORS[category] ?? PRIORS.bar;
  return weekend ? cat.weekend : cat.weeknight;
}

function openOnDow(hours, dow) {
  if (hours === '24h') return true;
  if (!hours || typeof hours !== 'object') return true;
  return Boolean(hours[DAY_KEYS[dow]]);
}
