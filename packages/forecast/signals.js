// Signal extractors and the starting weight table.
// Weights are starting assumptions. calibrate.js is what may replace them.
// A kind that is accepted with a nonzero x moves the posterior.
// A kind we cannot score is missing or rejected, never silently dropped.

import { readFileSync } from 'node:fs';

export const INITIAL_WEIGHTS = {
  event_tonight: 1.2,
  recurring_night: 0.5,
  trends_spike: 0.6,
  crowd_phrase: 0.3,
  rain_outdoor: -0.7,
  counter: 2.0,
  checkin: 0.8,
  // Scales the time-of-night log-odds nudge. Starting assumption, from the
  // old hour factors, not a fitted weight.
  hour_phase: 1,
};

// Log-odds nudges for the posted-hours phase. Starting assumptions.
export const PHASE_LOG_ODDS = {
  early: -0.5,
  mid: -0.15,
  peak: 0.25,
  late: -0.4,
};

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function loadWeights(fileUrl) {
  try {
    const raw = JSON.parse(readFileSync(fileUrl, 'utf8'));
    const stored = raw.weights && typeof raw.weights === 'object' ? raw.weights : raw;
    const weights = { ...INITIAL_WEIGHTS };
    for (const kind of Object.keys(INITIAL_WEIGHTS)) {
      const value = Number(stored[kind]);
      if (Number.isFinite(value)) weights[kind] = value;
    }
    return weights;
  } catch {
    return { ...INITIAL_WEIGHTS };
  }
}

export function extractSignals({ features = [], phase = 'mid', weekday = 0, weather = null, extras = {} }) {
  const signals = [];
  const missing = [];
  const rejected = [];

  const phaseX = PHASE_LOG_ODDS[phase] ?? PHASE_LOG_ODDS.mid;
  signals.push({ kind: 'hour_phase', x: phaseX });

  if (extras.eventsFile == null) {
    missing.push({ kind: 'event_tonight', reason: 'events file missing' });
  } else if (extras.eventTonight) {
    signals.push({ kind: 'event_tonight', x: 1 });
  }

  if (weeklyTonight(features, weekday)) signals.push({ kind: 'recurring_night', x: 1 });
  if (crowdPhrase(features)) signals.push({ kind: 'crowd_phrase', x: 1 });

  if (extras.trends == null) {
    missing.push({ kind: 'trends_spike', reason: 'Google Trends not pulled' });
  } else if (Number.isFinite(Number(extras.trends)) && Number(extras.trends) > 0 && Number(extras.trends) <= 1) {
    signals.push({ kind: 'trends_spike', x: Number(extras.trends) });
  } else {
    rejected.push({ kind: 'trends_spike', reason: 'trends_spike must be a 0..1 scale' });
  }

  if (!weather) {
    missing.push({ kind: 'rain_outdoor', reason: 'weather not fetched' });
  } else if (weather.raining && outdoor(features)) {
    signals.push({ kind: 'rain_outdoor', x: 1 });
  }

  if (extras.counter == null && extras.liveCount) {
    rejected.push({ kind: 'counter', reason: 'live headcount is not a 0..1 occupancy; counter stays unwired' });
  } else if (extras.counter == null) {
    missing.push({ kind: 'counter', reason: 'venue counter unwired' });
  } else if (typeof extras.counter !== 'number' || extras.counter < 0 || extras.counter > 1) {
    rejected.push({ kind: 'counter', reason: 'counter must be a 0..1 occupancy' });
  } else if (extras.counter > 0) {
    signals.push({ kind: 'counter', x: extras.counter });
  }

  if (extras.checkin == null) {
    missing.push({ kind: 'checkin', reason: 'check-ins unwired' });
  } else if (extras.checkin === 1) {
    signals.push({ kind: 'checkin', x: 1 });
  } else if (extras.checkin !== 0) {
    rejected.push({ kind: 'checkin', reason: 'checkin must be 0 or 1' });
  }

  return { signals, missing, rejected };
}

function weeklyTonight(features, weekday) {
  const day = DAY_NAMES[weekday] || '';
  const short = day.slice(0, 3);
  return features.some((feature) => {
    const text = String(feature).toLowerCase();
    if (!day) return false;
    return text.includes(day) || new RegExp(`\\b${short}s?\\b`).test(text);
  });
}

function crowdPhrase(features) {
  return features.some((feature) => /packed|lines|queue|crowded/i.test(String(feature)));
}

function outdoor(features) {
  return features.some((feature) => /patio|backyard|balcony|terrace|outdoor/i.test(String(feature)));
}
