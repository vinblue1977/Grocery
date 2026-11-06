import type { Item, Snapshot, Store } from './api';

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
  return { stores: data.stores.filter((s) => s.id !== id), items: data.items.filter((item) => item.storeId !== id) };
}

export function withRenamedStore(data: Snapshot, id: string, name: string): Snapshot {
  return { ...data, stores: data.stores.map((s) => (s.id === id ? { ...s, name } : s)) };
}
