import type { Frequent, Item, Snapshot, Store } from './api';
import type { Op } from './queue';

/** Pure helpers: what the screen shows, and the instant (optimistic) edits applied before the server answers. */

export function forStore(items: Item[], storeId: string): { toBuy: Item[]; inCart: Item[] } {
  const mine = items.filter((item) => item.storeId === storeId);
  return { toBuy: mine.filter((item) => !item.checked), inCart: mine.filter((item) => item.checked) };
}

export function pickStore(stores: Store[], wanted: string | null): string | null {
  return stores.find((store) => store.id === wanted)?.id ?? stores[0]?.id ?? null;
}

export function withNewItem(data: Snapshot, id: string, storeId: string, name: string, addedBy: string): Snapshot {
  const item: Item = { id, storeId, name, note: '', checked: false, addedBy, updatedAt: Date.now() };
  return { ...data, items: [...data.items, item] };
}

export function withNewStore(data: Snapshot, id: string, name: string): Snapshot {
  const order = data.stores.reduce((most, s) => Math.max(most, s.order), -1) + 1;
  return { ...data, stores: [...data.stores, { id, name, order }] };
}

export function withChecked(data: Snapshot, id: string, checked: boolean): Snapshot {
  return { ...data, items: data.items.map((item) => (item.id === id ? { ...item, checked } : item)) };
}

export function withEditedItem(data: Snapshot, id: string, changes: { name?: string; note?: string; storeId?: string }): Snapshot {
  return { ...data, items: data.items.map((item) => (item.id === id ? { ...item, ...changes } : item)) };
}

export function withoutItem(data: Snapshot, id: string): Snapshot {
  return { ...data, items: data.items.filter((item) => item.id !== id) };
}

export function withoutChecked(data: Snapshot, storeId: string): Snapshot {
  return { ...data, items: data.items.filter((item) => item.storeId !== storeId || !item.checked) };
}

export function withoutStore(data: Snapshot, id: string): Snapshot {
  return {
    stores: data.stores.filter((s) => s.id !== id),
    items: data.items.filter((item) => item.storeId !== id),
    frequent: data.frequent.filter((f) => f.storeId !== id),
  };
}

export function withRenamedStore(data: Snapshot, id: string, name: string): Snapshot {
  return { ...data, stores: data.stores.map((s) => (s.id === id ? { ...s, name } : s)) };
}

/** True when `itemId` is the only thing left to buy in its store, so ticking it empties the store. */
export function isLastToBuy(items: Item[], storeId: string, itemId: string): boolean {
  const left = items.filter((i) => i.storeId === storeId && !i.checked);
  return left.length === 1 && left[0]?.id === itemId;
}

/** The store after this one in tab order (wrapping round), or null when there is no other store. */
export function nextStore(stores: Store[], storeId: string): Store | null {
  const at = stores.findIndex((s) => s.id === storeId);
  if (at < 0 || stores.length < 2) return null;
  return stores[(at + 1) % stores.length] ?? null;
}

const SUGGESTION_LIMIT = 12;

/**
 * The names to offer as chips for one store. Normally ones already on the to-buy list are left out and typing narrows the
 * row (autocomplete); `all` (Edit mode) lists every one so each can be pinned or removed.
 */
export function suggestionsFor(data: Snapshot, storeId: string, typed: string, all = false): Frequent[] {
  const onList = new Set(data.items.filter((i) => i.storeId === storeId && !i.checked).map((i) => i.name.toLowerCase()));
  const needle = typed.trim().toLowerCase();
  const mine = data.frequent.filter((f) => f.storeId === storeId);
  if (all) return mine;
  return mine.filter((f) => !onList.has(f.name.toLowerCase()) && f.name.toLowerCase().includes(needle)).slice(0, SUGGESTION_LIMIT);
}

export function withPinned(data: Snapshot, storeId: string, name: string, pinned: boolean): Snapshot {
  const same = (f: Frequent) => f.storeId === storeId && f.name.toLowerCase() === name.toLowerCase();
  return { ...data, frequent: data.frequent.map((f) => (same(f) ? { ...f, pinned } : f)) };
}

export function withoutFrequent(data: Snapshot, storeId: string, name: string): Snapshot {
  return { ...data, frequent: data.frequent.filter((f) => !(f.storeId === storeId && f.name.toLowerCase() === name.toLowerCase())) };
}

/**
 * Applies a queued edit to a snapshot, the same way the instant (optimistic) edit did. An edit whose target is gone
 * (or, for an add, already there) changes nothing, so re-applying the queue on top of a fresh server snapshot is safe.
 */
export function applyOp(data: Snapshot, op: Op): Snapshot {
  switch (op.kind) {
    case 'addItem': {
      if (data.items.some((i) => i.id === op.id) || !data.stores.some((s) => s.id === op.storeId)) return data;
      const added = withNewItem(data, op.id, op.storeId, op.name, op.addedBy ?? '');
      return op.note ? { ...added, items: added.items.map((i) => (i.id === op.id ? { ...i, note: op.note ?? '' } : i)) } : added;
    }
    case 'updateItem':
      return op.changes.name === undefined && op.changes.note === undefined && op.changes.checked !== undefined
        ? withChecked(data, op.id, op.changes.checked)
        : { ...data, items: data.items.map((i) => (i.id === op.id ? { ...i, ...op.changes } : i)) };
    case 'deleteItem':
      return withoutItem(data, op.id);
    case 'clearChecked':
      return withoutChecked(data, op.storeId);
    case 'addStore':
      return data.stores.some((s) => s.id === op.id) ? data : withNewStore(data, op.id, op.name);
    case 'renameStore':
      return withRenamedStore(data, op.id, op.name);
    case 'deleteStore':
      return withoutStore(data, op.id);
    case 'setFrequent': {
      const hidden = op.changes.hidden ? withoutFrequent(data, op.storeId, op.name) : data;
      return op.changes.pinned === undefined ? hidden : withPinned(hidden, op.storeId, op.name, op.changes.pinned);
    }
  }
}

export const applyOps = (data: Snapshot, ops: Op[]): Snapshot => ops.reduce(applyOp, data);
