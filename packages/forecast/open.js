// Local clock for a city, and whether a venue is open at that minute.
// Hours use 24h "HH:MM". A close of "00:00" means midnight, the end of that day.
// An earlier close such as "02:00" runs past midnight into the next morning.

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function zonedNow(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const bag = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  const minute = Number(bag.minute);
  const weekday = SHORT_DAYS.indexOf(bag.weekday);
  return {
    weekday,
    hour,
    minute,
    minutes: hour * 60 + minute,
    dateLabel: `${DAY_NAMES[weekday]}, ${bag.month} ${Number(bag.day)}, ${bag.year}`,
    timeLabel: formatClock(hour * 60 + minute),
  };
}

// 9pm–11:59pm is tonight. After midnight, through late, it is morning.
export function periodLabel(hour) {
  if (hour < 12) return 'This morning';
  if (hour < 17) return 'This afternoon';
  if (hour < 21) return 'This evening';
  return 'Tonight';
}

export function placeStatus(hours, when) {
  if (hours == null) {
    return {
      open: true,
      unconfirmed: true,
      text: 'Hours not confirmed',
      patternDay: when.weekday,
      minutesLeft: null,
      phase: clockPhase(when.hour, null),
    };
  }

  if (hours === '24h') {
    return {
      open: true,
      text: 'Open 24 hours',
      patternDay: when.weekday,
      minutesLeft: null,
      phase: clockPhase(when.hour, null),
    };
  }

  const schedule = hours && typeof hours === 'object' ? hours : {};
  const yesterday = (when.weekday + 6) % 7;
  const spill = windowFor(schedule[DAY_KEYS[yesterday]]);
  if (spill && spill.overnight && when.minutes < spill.end) {
    const minutesLeft = spill.end - when.minutes;
    return {
      open: true,
      text: `Open now · Closes at ${formatClock(spill.end)}`,
      patternDay: yesterday,
      minutesLeft,
      phase: clockPhase(when.hour, minutesLeft),
    };
  }

  const today = windowFor(schedule[DAY_KEYS[when.weekday]]);
  if (today && coversToday(today, when.minutes)) {
    const endAbs = today.overnight ? today.end + 24 * 60 : today.end;
    const minutesLeft = endAbs - when.minutes;
    return {
      open: true,
      text: `Open now · Closes at ${formatClock(today.end)}`,
      patternDay: when.weekday,
      minutesLeft,
      phase: clockPhase(when.hour, minutesLeft),
    };
  }

  if (today && when.minutes < today.start) {
      return {
        open: false,
        text: `Closed now · Opens at ${formatClock(today.start)}`,
        patternDay: when.weekday,
        minutesLeft: null,
        phase: 'closed',
      };
  }

  for (let step = 1; step <= 7; step++) {
    const day = (when.weekday + step) % 7;
    const next = windowFor(schedule[DAY_KEYS[day]]);
    if (next) {
      return {
        open: false,
        text: `Closed now · Opens ${DAY_NAMES[day]} at ${formatClock(next.start)}`,
        patternDay: when.weekday,
        minutesLeft: null,
        phase: 'closed',
      };
    }
  }

  return { open: false, text: 'Closed now', patternDay: when.weekday, minutesLeft: null, phase: 'closed' };
}

// Nightlife peaks from 8pm until 2am. The last 75 minutes before close taper off.
function clockPhase(hour, minutesLeft) {
  if (minutesLeft != null && minutesLeft <= 75) return 'late';
  if (hour >= 20 || hour < 2) return 'peak';
  if (hour >= 17) return 'mid';
  return 'early';
}

function coversToday(win, minutes) {
  if (win.overnight) return minutes >= win.start;
  return minutes >= win.start && minutes < win.end;
}

function windowFor(span) {
  if (!Array.isArray(span) || span.length < 2) return null;
  const start = clockMinutes(span[0]);
  const end = span[1] === '00:00' ? 24 * 60 : clockMinutes(span[1]);
  return { start, end, overnight: end <= start };
}

function clockMinutes(value) {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

function formatClock(total) {
  const mins = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour24 = Math.floor(mins / 60);
  const minute = mins % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  const mm = String(minute).padStart(2, '0');
  return `${hour12}:${mm} ${suffix}`;
}
