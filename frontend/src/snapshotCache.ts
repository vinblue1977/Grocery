import type { Snapshot } from './api';

const KEY = 'grocery.snapshot';

interface Stored {
  householdId: string;
  savedAt: number;
  snapshot: Snapshot;
}

const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

/** Cheap shape check: the cache is only for showing the last list, so corrupt or foreign data is simply dropped. */
function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isArray(v.stores) && isArray(v.items) && isArray(v.frequent);
}

export function serialiseSnapshot(householdId: string, snapshot: Snapshot, now = Date.now()): string {
  const stored: Stored = { householdId, savedAt: now, snapshot };
  return JSON.stringify(stored);
}

/** Returns the saved snapshot only if it parses, looks right and belongs to this household. */
export function parseSnapshot(raw: string | null, householdId: string): Snapshot | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (p.householdId !== householdId || !isSnapshot(p.snapshot)) return null;
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

export function saveSnapshot(householdId: string, snapshot: Snapshot, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(KEY, serialiseSnapshot(householdId, snapshot));
  } catch {
    // Storage is full or blocked: the list just won't be available offline next time.
  }
}

export function clearSnapshot(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    storage.removeItem(KEY);
  } catch {
    // Nothing stored or storage unavailable.
  }
}
