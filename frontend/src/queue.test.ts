import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearQueue, loadQueue, parseQueue, pendingCount, saveQueue, setPendingCount, type Op } from './queue';

const ops: Op[] = [
  { kind: 'addStore', id: 's1', name: 'Aldi' },
  { kind: 'addItem', id: 'i1', storeId: 's1', name: 'Tea', note: 'green' },
  { kind: 'updateItem', id: 'i1', changes: { checked: true } },
  { kind: 'updateItem', id: 'i1', changes: { storeId: 's2', note: '2' } }, // a move to another store
  { kind: 'updateItem', id: 'i1', changes: { repeatDays: 7, resting: true } }, // a repeating item bought
  { kind: 'setFrequent', storeId: 's1', name: 'Tea', changes: { pinned: true } },
];
const blocked = () => {
  throw new Error('blocked');
};

afterEach(() => localStorage.clear());

describe('queue storage', () => {
  it('keeps edits in first-in-first-out order across a reload', () => {
    saveQueue('h1', ops);
    expect(loadQueue('h1')).toEqual(ops);
  });

  it('removes the entry when the queue empties', () => {
    saveQueue('h1', ops);
    saveQueue('h1', []);
    expect(localStorage.getItem('grocery.queue')).toBeNull();
  });

  it('does not hand one household the queue of another', () => {
    saveQueue('h1', ops);
    expect(loadQueue('h2')).toEqual([]);
  });

  it('ignores corrupt JSON, the wrong version, and ops of an unknown shape', () => {
    expect(parseQueue('{nope', 'h1')).toEqual([]);
    expect(parseQueue(null, 'h1')).toEqual([]);
    expect(parseQueue(JSON.stringify({ version: 99, householdId: 'h1', ops }), 'h1')).toEqual([]);
    expect(parseQueue(JSON.stringify({ version: 1, householdId: 'h1', ops: [{ kind: 'deleteItem' }] }), 'h1')).toEqual([]);
    expect(parseQueue(JSON.stringify({ version: 1, householdId: 'h1', ops: [{ kind: 'bogus' }] }), 'h1')).toEqual([]);
    expect(parseQueue(JSON.stringify({ version: 1, householdId: 'h1', ops: 'x' }), 'h1')).toEqual([]);
  });

  it('survives a full or missing store', () => {
    expect(() => saveQueue('h1', ops, { setItem: vi.fn(blocked), removeItem: vi.fn() })).not.toThrow();
    expect(loadQueue('h1', { getItem: blocked })).toEqual([]);
    expect(() => clearQueue({ removeItem: blocked })).not.toThrow();
  });

  it('is cleared on sign-out', () => {
    saveQueue('h1', ops);
    clearQueue();
    expect(loadQueue('h1')).toEqual([]);
  });

  it('exposes the waiting count for the service-worker updater', () => {
    setPendingCount(3);
    expect(pendingCount()).toBe(3);
    setPendingCount(0);
  });
});
