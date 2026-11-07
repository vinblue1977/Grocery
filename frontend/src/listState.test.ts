import { describe, expect, it } from 'vitest';
import type { Item, Snapshot } from './api';
import {
  applyOp,
  forStore,
  pickStore,
  suggestionsFor,
  withChecked,
  withEditedItem,
  withNewItem,
  withNewStore,
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
  it('edits only the given fields of one item, leaving the rest untouched', () => {
    const edited = withEditedItem(data, 'milk', { note: '2 gal' });
    expect(edited.items[0]).toMatchObject({ name: 'milk', note: '2 gal', checked: false });
    expect(edited.items.slice(1)).toEqual(data.items.slice(1));
    expect(withEditedItem(data, 'nope', { name: 'x' })).toEqual(data); // an item that is gone changes nothing
    expect(data.items[0]?.note).toBe(''); // the original is not mutated
  });

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
    expect(withNewItem(data, 'abc123abc123', 'c', 'Tea', 'Yara').items.at(-1)).toMatchObject({ id: 'abc123abc123', name: 'Tea', addedBy: 'Yara', checked: false });
    expect(withNewStore(data, 'abc123abc123', 'Aldi').stores.at(-1)).toEqual({ id: 'abc123abc123', name: 'Aldi', order: 2 });
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

describe('applyOp', () => {
  const base: Snapshot = {
    stores: [{ id: 's', name: 'Costco', order: 0 }],
    items: [item('a', 's'), item('b', 's', true)],
    frequent: [{ storeId: 's', name: 'Milk', count: 3, pinned: false }],
  };

  it('adds an item with its own id, once, and only to a store that exists', () => {
    const op = { kind: 'addItem', id: 'n', storeId: 's', name: 'Tea', note: 'green', addedBy: 'Yara' } as const;
    const once = applyOp(base, op);
    expect(once.items.at(-1)).toMatchObject({ id: 'n', name: 'Tea', note: 'green', addedBy: 'Yara', checked: false });
    expect(applyOp(once, op).items).toHaveLength(3);
    expect(applyOp(base, { ...op, storeId: 'gone' })).toBe(base);
  });

  it('updates, deletes and clears', () => {
    expect(applyOp(base, { kind: 'updateItem', id: 'a', changes: { checked: true } }).items[0]?.checked).toBe(true);
    expect(applyOp(base, { kind: 'updateItem', id: 'a', changes: { name: 'Z', note: 'n' } }).items[0]).toMatchObject({ name: 'Z', note: 'n' });
    expect(applyOp(base, { kind: 'deleteItem', id: 'a' }).items.map((i) => i.id)).toEqual(['b']);
    expect(applyOp(base, { kind: 'clearChecked', storeId: 's' }).items.map((i) => i.id)).toEqual(['a']);
  });

  it('adds, renames and deletes stores', () => {
    const added = applyOp(base, { kind: 'addStore', id: 't', name: 'Aldi' });
    expect(added.stores.map((s) => s.id)).toEqual(['s', 't']);
    expect(applyOp(added, { kind: 'addStore', id: 't', name: 'Aldi' }).stores).toHaveLength(2);
    expect(applyOp(base, { kind: 'renameStore', id: 's', name: 'BJs' }).stores[0]?.name).toBe('BJs');
    expect(applyOp(base, { kind: 'deleteStore', id: 's' })).toEqual({ stores: [], items: [], frequent: [] });
  });

  it('pins and hides suggestions', () => {
    expect(applyOp(base, { kind: 'setFrequent', storeId: 's', name: 'milk', changes: { pinned: true } }).frequent[0]?.pinned).toBe(true);
    expect(applyOp(base, { kind: 'setFrequent', storeId: 's', name: 'Milk', changes: { hidden: true } }).frequent).toEqual([]);
  });

  it('does nothing when the target is gone', () => {
    for (const op of [
      { kind: 'updateItem', id: 'zz', changes: { checked: true } },
      { kind: 'deleteItem', id: 'zz' },
      { kind: 'renameStore', id: 'zz', name: 'x' },
      { kind: 'deleteStore', id: 'zz' },
      { kind: 'clearChecked', storeId: 'zz' },
      { kind: 'setFrequent', storeId: 'zz', name: 'x', changes: { pinned: true } },
    ] as const) {
      expect(applyOp(base, op)).toEqual(base);
    }
  });
});
