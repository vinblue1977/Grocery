import type { Snapshot } from './api';

const KEY = 'grocery.snapshot';
const VERSION = 1; // bump when the Snapshot shape changes, so an old cache is dropped instead of crashing the screen

interface Stored {
  version: number;
  householdId: string;
  savedAt: number;
  snapshot: Snapshot;
}

const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

/** Cheap shape check: the cache is only for showing the last list, so corrupt or foreign data is simply dropped. */
function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isArray(v.stores) &&
    v.stores.every((s) => hasStrings(s, ['id', 'name'])) &&
    isArray(v.items) &&
    v.items.every((i) => hasStrings(i, ['id', 'storeId', 'name', 'addedBy'])) &&
    isArray(v.frequent) &&
    v.frequent.every((f) => hasStrings(f, ['storeId', 'name']))
  );
}

function hasStrings(value: unknown, keys: string[]): boolean {
  return typeof value === 'object' && value !== null && keys.every((k) => typeof (value as Record<string, unknown>)[k] === 'string');
}

export function serialiseSnapshot(householdId: string, snapshot: Snapshot, now = Date.now()): string {
  const stored: Stored = { version: VERSION, householdId, savedAt: now, snapshot };
  return JSON.stringify(stored);
}

/** Returns the saved snapshot only if it parses, looks right and belongs to this household. */
export function parseSnapshot(raw: string | null, householdId: string): Snapshot | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (p.version !== VERSION || p.householdId !== householdId || !isSnapshot(p.snapshot)) return null;
    return p.snapshot;
  } catch {
    return null;
  }
}

export function loadSnapshot(householdId: string, storage: Pick<Storage, 'getItem'> = localStorage): Snapshot | null {
  try {
    return parseSnapshot(storage.getItem(KEY), householdId);
  } catch {
    return null; // storage blocked or missing
  }
}

let lastSaved = ''; // what was last written, so the 5-second poll doesn't rewrite storage when nothing changed

export function saveSnapshot(householdId: string, snapshot: Snapshot, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    const content = JSON.stringify({ version: VERSION, householdId, snapshot });
    if (content === lastSaved) return;
    storage.setItem(KEY, serialiseSnapshot(householdId, snapshot));
    lastSaved = content;
  } catch {
    // Storage is full or blocked: the list just won't be available offline next time.
  }
}

export function clearSnapshot(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    storage.removeItem(KEY);
    lastSaved = '';
  } catch {
    // Nothing stored or storage unavailable.
  }
}
