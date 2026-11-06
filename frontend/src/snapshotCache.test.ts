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

  it('drops a cache from another version, or whose items are missing fields', () => {
    const old = JSON.stringify({ householdId: 'h1', savedAt: 1, snapshot: snap }); // no version
    expect(parseSnapshot(old, 'h1')).toBeNull();
    const broken = { ...snap, items: [{ id: 'i' }] }; // would crash the screen if rendered
    expect(parseSnapshot(JSON.stringify({ version: 1, householdId: 'h1', savedAt: 1, snapshot: broken }), 'h1')).toBeNull();
  });

  it('does not rewrite storage when the list has not changed since the last save', () => {
    const store = memory();
    clearSnapshot(store); // forget what earlier tests saved
    let writes = 0;
    const counting = { setItem: (k: string, v: string) => (writes += 1, store.setItem(k, v)) };
    saveSnapshot('h1', snap, counting);
    saveSnapshot('h1', snap, counting);
    saveSnapshot('h1', { ...snap, items: [] }, counting);
    expect(writes).toBe(2);
  });
});
