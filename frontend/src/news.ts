import type { Item } from './api';
import { firstWord, samePerson } from './people';

export interface Arrival {
  by: string;
  /** The store to open on View: the one that got the most items from `by`. */
  storeId: string;
  /** How many stores received items; the toast names the store only when this is 1. */
  storeCount: number;
  count: number;
  ids: string[];
}

/**
 * What another person added since the previous server list, for the toast, whatever the age of the items. Items you added
 * yourself (compared by first name) are ignored. The person with the most new items is reported, across all stores.
 */
export function arrivalFromOthers(before: Item[], after: Item[], me: string): Arrival | null {
  const known = new Set(before.map((i) => i.id));
  const people = new Map<string, { by: string; perStore: Map<string, number>; ids: string[] }>();
  for (const item of after) {
    if (known.has(item.id) || samePerson(item.addedBy, me)) continue;
    const by = firstWord(item.addedBy) || 'Someone';
    const person = people.get(by.toLowerCase()) ?? { by, perStore: new Map<string, number>(), ids: [] as string[] };
    person.perStore.set(item.storeId, (person.perStore.get(item.storeId) ?? 0) + 1);
    person.ids.push(item.id);
    people.set(by.toLowerCase(), person);
  }
  const top = [...people.values()].sort((a, b) => b.ids.length - a.ids.length)[0];
  if (!top) return null;
  const [storeId = ''] = [...top.perStore.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return { by: top.by, storeId, storeCount: top.perStore.size, count: top.ids.length, ids: top.ids };
}
