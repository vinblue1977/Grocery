import { describe, expect, it } from 'vitest';
import type { Item } from './api';
import { arrivalFromOthers } from './news';
import { isLastToBuy, nextStore } from './listState';

const item = (id: string, addedBy: string, storeId = 'p', checked = false): Item => ({ id, storeId, name: id, note: '', checked, addedBy, updatedAt: 1 });

describe('arrivalFromOthers', () => {
  const before = [item('a', 'Victor')];
  it('reports the batch another person added', () => {
    const after = [...before, item('b', 'Yara'), item('c', "Yara's phone"), item('d', 'Yara', 'c')];
    expect(arrivalFromOthers(before, after, 'Victor')).toEqual({ by: 'Yara', storeId: 'p', storeCount: 2, count: 3, ids: ['b', 'c', 'd'] });
    expect(arrivalFromOthers(before, after.slice(0, 3), 'Victor')).toMatchObject({ storeCount: 1, count: 2 });
  });
  it('ignores your own items, including from another device, and nothing else', () => {
    const after = [...before, item('b', "Victor's iPad"), item('b2', "Victor's iPad")];
    expect(arrivalFromOthers(before, after, 'Victor')).toBeNull();
    expect(arrivalFromOthers(before, [item('z', '')], 'Victor')).not.toBeNull(); // an unnamed adder is someone else
  });
  it('reports nothing when nothing is new', () => {
    expect(arrivalFromOthers(before, before, 'Yara')).toBeNull();
  });
  it('announces items from someone else however old they are', () => {
    const old = { ...item('b', 'Yara'), updatedAt: 1 };
    expect(arrivalFromOthers(before, [...before, old], 'Victor')).toMatchObject({ by: 'Yara', count: 1 });
  });
});

describe('store helpers', () => {
  it('knows when an item is the last one to buy', () => {
    const items = [item('a', 'x'), item('b', 'x'), item('c', 'x', 'p', true)];
    expect(isLastToBuy(items, 'p', 'a')).toBe(false);
    expect(isLastToBuy([item('a', 'x'), item('c', 'x', 'p', true)], 'p', 'a')).toBe(true);
    expect(isLastToBuy([item('a', 'x')], 'p', 'zzz')).toBe(false);
  });
  it('finds the next store, wrapping, or none when alone', () => {
    const stores = [
      { id: '1', name: 'A', order: 0 },
      { id: '2', name: 'B', order: 1 },
    ];
    expect(nextStore(stores, '1')?.name).toBe('B');
    expect(nextStore(stores, '2')?.name).toBe('A');
    expect(nextStore(stores.slice(0, 1), '1')).toBeNull();
  });
});
