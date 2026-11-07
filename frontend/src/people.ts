/** Who added an item: the first word of the name decides the colour, so it follows the person, not the device. */

const PALETTE = ['#f5b942', '#7bd389', '#b69cff', '#ff9f6b', '#5fd0d0', '#e57fd4'];
const KNOWN: Record<string, string> = { victor: '#6aa9ff', yara: '#ff8fb1' };

export function firstWord(name: string): string {
  return name.trim().split(/[\s'’]/)[0] ?? '';
}

export function samePerson(a: string, b: string): boolean {
  const first = firstWord(a).toLowerCase();
  return first !== '' && first === firstWord(b).toLowerCase(); // an unknown name is not "me"
}

export function initial(name: string): string {
  return firstWord(name).charAt(0).toUpperCase() || '?';
}

/** The colours a person can pick; the automatic ones below are all among them. */
export const AVATAR_COLORS = [
  { name: 'Blue', value: '#6aa9ff' },
  { name: 'Pink', value: '#ff8fb1' },
  { name: 'Yellow', value: '#f5b942' },
  { name: 'Green', value: '#7bd389' },
  { name: 'Purple', value: '#b69cff' },
  { name: 'Orange', value: '#ff9f6b' },
  { name: 'Teal', value: '#5fd0d0' },
  { name: 'Magenta', value: '#e57fd4' },
];

/** `chosen` is what the household saved (first word, lowercased, to colour); without a choice the colour is automatic. */
export function avatarColor(name: string, chosen: Record<string, string> = {}): string {
  const key = firstWord(name).toLowerCase();
  // Own properties only: a person called "constructor" must not get a built-in function as a colour.
  const picked = Object.hasOwn(chosen, key) ? chosen[key] : undefined;
  if (picked) return picked;
  const known = Object.hasOwn(KNOWN, key) ? KNOWN[key] : undefined;
  if (known) return known;
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length] ?? '#6aa9ff';
}

/** "Good morning, Victor" and its emoji, for the hour (0-23) on the device's clock. */
export function greeting(hour: number, name: string): { text: string; emoji: string } {
  const who = firstWord(name);
  if (hour < 5) return { text: `Up late${who ? `, ${who}` : ''}?`, emoji: '🌙' };
  const [part, emoji] = hour < 12 ? ['morning', '☀️'] : hour < 17 ? ['afternoon', '⛅'] : ['evening', '🌙'];
  return { text: `Good ${part}${who ? `, ${who}` : ''}`, emoji: emoji ?? '' };
}
