// Current conditions from Open-Meteo. No key. Failure is a missing source, not a guess.

export async function fetchWeather(lat, lon, timeZone) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'temperature_2m,precipitation,weather_code');
  url.searchParams.set('hourly', 'precipitation_probability');
  url.searchParams.set('forecast_hours', '6');
  url.searchParams.set('timezone', timeZone);
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
  const current = data.current || {};
  const tempC = current.temperature_2m;
  const precipMm = current.precipitation ?? 0;
  const code = current.weather_code;
  const probability = probabilityNow(data.hourly, current.time);
  const snowing = isSnowCode(code);
  const raining = !snowing && (precipMm >= 0.3 || isRainCode(code));
  return {
    tempC,
    precipMm,
    code,
    probability,
    observedAt: current.time,
    summary: weatherSummary(code, tempC, precipMm, snowing),
    raining,
    snowing,
    rainLikely: raining || (probability != null && probability >= 60),
    source: 'Open-Meteo',
  };
}

function probabilityNow(hourly, observedAt) {
  const times = hourly?.time || [];
  const chances = hourly?.precipitation_probability || [];
  const key = String(observedAt || '').slice(0, 13);
  const index = times.findIndex((stamp) => String(stamp).slice(0, 13) === key);
  const chance = index >= 0 ? chances[index] : null;
  return Number.isFinite(chance) ? chance : null;
}

function isRainCode(code) {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

function isSnowCode(code) {
  return (code >= 71 && code <= 77) || code === 85 || code === 86;
}

function weatherSummary(code, tempC, precipMm, snowing) {
  const temp = Number.isFinite(tempC) ? `${Math.round(tempC)}°C` : 'unknown temp';
  if (snowing) return `snow ${precipMm} mm, ${temp}`;
  if (precipMm >= 0.3) return `rain ${precipMm} mm, ${temp}`;
  if (code === 0) return `clear, ${temp}`;
  if (code <= 3) return `cloudy, ${temp}`;
  return temp;
}
