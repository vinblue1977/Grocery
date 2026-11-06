import type { Frequent, Item, Snapshot, Store } from './api';

/** Pure helpers: what the screen shows, and the instant (optimistic) edits applied before the server answers. */

export function forStore(items: Item[], storeId: string): { toBuy: Item[]; inCart: Item[] } {
  const mine = items.filter((item) => item.storeId === storeId);
  return { toBuy: mine.filter((item) => !item.checked), inCart: mine.filter((item) => item.checked) };
}

export function pickStore(stores: Store[], wanted: string | null): string | null {
  return stores.find((store) => store.id === wanted)?.id ?? stores[0]?.id ?? null;
}

export function withNewItem(data: Snapshot, tempId: string, storeId: string, name: string, addedBy: string): Snapshot {
  const item: Item = { id: tempId, storeId, name, note: '', checked: false, addedBy, updatedAt: Date.now() };
  return { ...data, items: [...data.items, item] };
}

export function withChecked(data: Snapshot, id: string, checked: boolean): Snapshot {
  return { ...data, items: data.items.map((item) => (item.id === id ? { ...item, checked } : item)) };
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
