import { describe, expect, it } from 'vitest';
import type { Item } from './api';
import { arrivalFromOthers } from './news';
import { isLastToBuy, nextStore } from './listState';

const item = (id: string, addedBy: string, storeId = 'p', checked = false): Item => ({ id, storeId, name: id, note: '', checked, addedBy, updatedAt: NOW - 1000 });
const NOW = 1_000_000_000;

describe('arrivalFromOthers', () => {
  const before = [item('a', 'Vinod')];
  it('reports the batch another person added', () => {
    const after = [...before, item('b', 'Yaso'), item('c', "Yaso's phone"), item('d', 'Yaso', 'c')];
    expect(arrivalFromOthers(before, after, 'Vinod', NOW)).toEqual({ by: 'Yaso', storeId: 'p', storeCount: 2, count: 3, ids: ['b', 'c', 'd'] });
    expect(arrivalFromOthers(before, after.slice(0, 3), 'Vinod', NOW)).toMatchObject({ storeCount: 1, count: 2 });
  });
  it('ignores your own items, including from another device, and unsaved placeholders', () => {
    const after = [...before, item('b', "Vinod's iPad"), item('tmp-1', 'Yaso')];
    expect(arrivalFromOthers(before, after, 'Vinod', NOW)).toBeNull();
    expect(arrivalFromOthers(before, [item('z', '')], 'Vinod', NOW)).not.toBeNull(); // an unnamed adder is someone else
  });
  it('reports nothing when nothing is new', () => {
    expect(arrivalFromOthers(before, before, 'Yaso', NOW)).toBeNull();
  });
  it('ignores items that are old, as a stale cached snapshot catching up would bring', () => {
    const old = { ...item('b', 'Yaso'), updatedAt: NOW - 5 * 60 * 1000 };
    expect(arrivalFromOthers(before, [...before, old], 'Vinod', NOW)).toBeNull();
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
