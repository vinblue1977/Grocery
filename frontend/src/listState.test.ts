import { describe, expect, it } from 'vitest';
import type { Item, Snapshot } from './api';
import {
  forStore,
  pickStore,
  suggestionsFor,
  withChecked,
  withNewItem,
  withoutChecked,
  withoutFrequent,
  withoutItem,
  withoutStore,
  withPinned,
  withRenamedStore,
} from './listState';

const item = (id: string, storeId: string, checked = false): Item => ({ id, storeId, name: id, note: '', checked, addedBy: 'V', updatedAt: 1 });
const data: Snapshot = {
  frequent: [],
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
    expect(withoutStore(data, 'c')).toEqual({ stores: [data.stores[1]], items: [data.items[2]], frequent: [] });
    expect(withRenamedStore(data, 'p', 'Patel Brothers').stores[1]?.name).toBe('Patel Brothers');
    expect(data.items).toHaveLength(3);
  });
});

describe('suggestions', () => {
  const withFreq: Snapshot = {
    ...data,
    frequent: [
      { storeId: 'c', name: 'Milk', count: 5, pinned: false },
      { storeId: 'c', name: 'Bananas', count: 4, pinned: false },
      { storeId: 'p', name: 'Ghee', count: 3, pinned: true },
    ],
  };

  it('are per store, skip what is already to buy (any case), and narrow by what was typed', () => {
    const milkOnList = { ...withFreq, items: [{ ...item('x', 'c'), name: 'milk' }] };
    expect(suggestionsFor(milkOnList, 'c', '').map((f) => f.name)).toEqual(['Bananas']);
    expect(suggestionsFor(withFreq, 'c', 'BAN').map((f) => f.name)).toEqual(['Bananas']);
    expect(suggestionsFor(withFreq, 'c', 'zzz')).toEqual([]);
  });

  it('offers a name again once it is checked off, and lists everything for editing', () => {
    const inCart = { ...withFreq, items: [{ ...item('x', 'c', true), name: 'Milk' }] };
    expect(suggestionsFor(inCart, 'c', '').map((f) => f.name)).toContain('Milk');
    expect(suggestionsFor(withFreq, 'c', 'ban', true).map((f) => f.name)).toEqual(['Milk', 'Bananas']);
  });

  it('pin and remove update the row at once, matching any case', () => {
    expect(withPinned(withFreq, 'c', 'bananas', true).frequent[1]?.pinned).toBe(true);
    expect(withoutFrequent(withFreq, 'c', 'MILK').frequent.map((f) => f.name)).toEqual(['Bananas', 'Ghee']);
  });
});
