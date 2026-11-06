import { describe, expect, it } from 'vitest';
import type { Snapshot } from './api';
import { clearSnapshot, loadSnapshot, parseSnapshot, saveSnapshot, serialiseSnapshot } from './snapshotCache';

const snap: Snapshot = {
  stores: [{ id: 's', name: 'Costco', order: 0 }],
  items: [{ id: 'i', storeId: 's', name: 'Milk', note: '', checked: false, addedBy: 'Yaso', updatedAt: 1 }],
  frequent: [],
};

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('snapshotCache', () => {
  it('round-trips a snapshot for the same household', () => {
    expect(parseSnapshot(serialiseSnapshot('h1', snap), 'h1')).toEqual(snap);
  });
  it('never shows one household the other one’s list', () => {
    expect(parseSnapshot(serialiseSnapshot('h1', snap), 'h2')).toBeNull();
  });
  it('tolerates empty, corrupt or wrongly shaped data', () => {
    for (const raw of [null, '', '{', 'null', '42', '{"householdId":"h","snapshot":{"stores":1}}', '{"householdId":"h"}']) {
      expect(parseSnapshot(raw, 'h')).toBeNull();
    }
  });
  it('saves, loads and clears through storage', () => {
    const store = memory();
    saveSnapshot('h1', snap, store);
    expect([...store.data.keys()]).toEqual(['grocery.snapshot']);
    expect(loadSnapshot('h1', store)).toEqual(snap);
    clearSnapshot(store);
    expect(loadSnapshot('h1', store)).toBeNull();
  });
  it('swallows quota errors and a blocked store', () => {
    const boom = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => saveSnapshot('h', snap, { setItem: boom })).not.toThrow();
    expect(() => clearSnapshot({ removeItem: boom })).not.toThrow();
    expect(loadSnapshot('h', { getItem: boom })).toBeNull();
  });
});
