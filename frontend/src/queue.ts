import type { ItemUpdate } from './api';

const KEY = 'grocery.queue';
const VERSION = 1; // bump when the Op shape changes, so an old queue is dropped instead of crashing the replay

/** One edit waiting to reach the server. Plain data only, so it survives being written to storage and replayed. */
export type Op =
  | { kind: 'addItem'; id: string; storeId: string; name: string; note?: string; addedBy?: string }
  | { kind: 'updateItem'; id: string; changes: ItemUpdate }
  | { kind: 'deleteItem'; id: string }
  | { kind: 'clearChecked'; storeId: string }
  | { kind: 'addStore'; id: string; name: string }
  | { kind: 'renameStore'; id: string; name: string }
  | { kind: 'deleteStore'; id: string }
  | { kind: 'setFrequent'; storeId: string; name: string; changes: { pinned?: boolean; hidden?: boolean } };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: Record<string, unknown>, keys: string[]) => keys.every((k) => typeof v[k] === 'string');
const optional = (v: Record<string, unknown>, key: string, type: 'string' | 'boolean' | 'number') => v[key] === undefined || typeof v[key] === type;

/** Shape check for one op: a queue from another version, or hand-edited storage, is dropped rather than replayed. */
export function isOp(value: unknown): value is Op {
  if (!isObject(value)) return false;
  switch (value.kind) {
    case 'addItem':
      return strings(value, ['id', 'storeId', 'name']) && optional(value, 'note', 'string') && optional(value, 'addedBy', 'string');
    case 'updateItem': {
      const c = value.changes;
      return (
        typeof value.id === 'string' && isObject(c) && optional(c, 'checked', 'boolean') &&
        optional(c, 'name', 'string') &&
        optional(c, 'note', 'string') &&
        optional(c, 'storeId', 'string') &&
        optional(c, 'repeatDays', 'number') &&
        optional(c, 'resting', 'boolean')
      );
    }
    case 'deleteItem':
    case 'deleteStore':
      return typeof value.id === 'string';
    case 'clearChecked':
      return typeof value.storeId === 'string';
    case 'addStore':
    case 'renameStore':
      return strings(value, ['id', 'name']);
    case 'setFrequent': {
      const c = value.changes;
      return strings(value, ['storeId', 'name']) && isObject(c) && optional(c, 'pinned', 'boolean') && optional(c, 'hidden', 'boolean');
    }
    default:
      return false;
  }
}

/** Returns the saved queue only if it parses, looks right and belongs to this household. */
export function parseQueue(raw: string | null, householdId: string): Op[] {
  if (!raw) return [];
  try {
    const p: unknown = JSON.parse(raw);
    if (!isObject(p) || p.version !== VERSION || p.householdId !== householdId || !Array.isArray(p.ops)) return [];
    return p.ops.every(isOp) ? (p.ops as Op[]) : [];
  } catch {
    return [];
  }
}

export function loadQueue(householdId: string, storage: Pick<Storage, 'getItem'> = localStorage): Op[] {
  try {
    return parseQueue(storage.getItem(KEY), householdId);
  } catch {
    return []; // storage blocked or missing
  }
}

export function saveQueue(householdId: string, ops: Op[], storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): void {
  try {
    if (ops.length === 0) storage.removeItem(KEY);
    else storage.setItem(KEY, JSON.stringify({ version: VERSION, householdId, ops }));
  } catch {
    // Storage is full or blocked: the queue still works in memory, it just won't survive a restart.
  }
}

export function clearQueue(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    storage.removeItem(KEY);
  } catch {
    // Nothing stored or storage unavailable.
  }
}

let waiting = 0;
/** How many edits are queued right now; the service-worker updater reads this so it never reloads over unsent edits. */
export const pendingCount = () => waiting;
export const setPendingCount = (n: number) => {
  waiting = n;
};
