// The only category list. The build imports this. Do not copy it into the page.
// Stored values stay bar | club | sauna | cruise | sex. The names are what the page shows.
// Events is not a stored venue category. It is a chip for dated events.

export const STORED_CATEGORIES = ['bar', 'club', 'sauna', 'cruise', 'sex'];

export const EVENT_TYPES = ['pride'];

export const GROUPS = [
  {
    id: 'dance',
    name: 'Dance and drinks',
    categories: ['bar', 'club'],
    icon: 'music',
    copy: 'Bars and clubs — which nights they peak, and how packed they get.',
  },
  {
    id: 'sauna',
    name: 'Saunas',
    categories: ['sauna'],
    icon: 'sauna',
    copy: 'Hours, and when the steam is up.',
  },
  {
    id: 'sexy',
    name: 'Cruisy',
    categories: ['cruise', 'sex'],
    icon: 'fire',
    copy: 'Cruise bars and sex clubs, mapped honestly.',
  },
];

// Rendered only when `when` is true for that city. today-or-weekend: an event
// overlaps today, or the coming Friday–Sunday, in the city's own timezone.
export const CONDITIONAL_GROUPS = [
  { id: 'events', name: 'Events', when: 'today-or-weekend' },
];

export const FLAGS = {
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

export function groupForCategory(category) {
  return GROUPS.find((group) => group.categories.includes(category)) || GROUPS[0];
}

// Locked busyness bands. The build and the page both use this function.
// Do not copy the thresholds anywhere else.
export function bandLabel(percent) {
  if (percent >= 75) return 'Very busy';
  if (percent >= 51) return 'Busy';
  return 'Not busy';
}
