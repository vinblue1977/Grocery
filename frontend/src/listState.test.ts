import { describe, expect, it } from 'vitest';
import type { Item, Snapshot } from './api';
import { forStore, pickStore, withChecked, withNewItem, withoutChecked, withoutItem, withoutStore, withRenamedStore } from './listState';

const item = (id: string, storeId: string, checked = false): Item => ({ id, storeId, name: id, note: '', checked, addedBy: 'V', updatedAt: 1 });
const data: Snapshot = {
  stores: [
    { id: 'c', name: 'Costco', order: 0 },
    { id: 'p', name: 'Patel', order: 1 },
  ],
  items: [item('milk', 'c'), item('eggs', 'c', true), item('rice', 'p', true)],
};

describe('list state', () => {
  it('splits a store into to-buy and in-cart', () => {
    const { toBuy, inCart } = forStore(data.items, 'c');
    expect(toBuy.map((i) => i.id)).toEqual(['milk']);
    expect(inCart.map((i) => i.id)).toEqual(['eggs']);
  });

  it('falls back to the first store when the remembered one is gone', () => {
    expect(pickStore(data.stores, 'p')).toBe('p');
    expect(pickStore(data.stores, 'gone')).toBe('c');
    expect(pickStore(data.stores, null)).toBe('c');
    expect(pickStore([], 'c')).toBeNull();
  });

  it('applies instant edits without touching the original', () => {
    expect(withNewItem(data, 'tmp', 'c', 'Tea', 'Yaso').items.at(-1)).toMatchObject({ id: 'tmp', name: 'Tea', addedBy: 'Yaso', checked: false });
    expect(withChecked(data, 'milk', true).items[0]?.checked).toBe(true);
    expect(withoutItem(data, 'milk').items.map((i) => i.id)).toEqual(['eggs', 'rice']);
    expect(withoutChecked(data, 'c').items.map((i) => i.id)).toEqual(['milk', 'rice']);
    expect(withoutStore(data, 'c')).toEqual({ stores: [data.stores[1]], items: [data.items[2]] });
    expect(withRenamedStore(data, 'p', 'Patel Brothers').stores[1]?.name).toBe('Patel Brothers');
    expect(data.items).toHaveLength(3);
  });
});
