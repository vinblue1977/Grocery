import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type Snapshot } from './api';
import { loadSnapshot, saveSnapshot } from './snapshotCache';
import { useLists, type ListsState } from './useLists';

const snap = (name: string): Snapshot => ({
  stores: [{ id: 's', name: 'Costco', order: 0 }],
  items: [{ id: 'i', storeId: 's', name, note: '', checked: false, addedBy: 'Yaso', updatedAt: 1 }],
  frequent: [],
});
const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

let latest: ListsState | undefined;
function Probe({ api, household }: { api: Api; household: string }) {
  latest = useLists(api, () => undefined, household);
  return <p>{latest.data?.items[0]?.name ?? 'none'}</p>;
}
function mount(api: Api, household = 'h1') {
  const root = document.createElement('div');
  document.body.append(root);
  act(() => {
    render(<Probe api={api} household={household} />, root);
  });
  return root;
}
const apiWith = (sync: () => Promise<Snapshot>) => ({ sync }) as unknown as Api;

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe('useLists snapshot cache', () => {
  it('shows the cached list at once, and keeps it with the offline message when the sync fails', async () => {
    saveSnapshot('h1', snap('Cached milk'));
    const root = mount(apiWith(() => Promise.reject(new ApiError(0, 'offline'))));
    expect(root.textContent).toBe('Cached milk'); // before any sync finishes
    await flush();
    expect(root.textContent).toBe('Cached milk');
    expect(latest?.error).toBe('Offline: showing the last list');
  });

  it('replaces the cached list with the server result and saves it', async () => {
    saveSnapshot('h1', snap('Old'));
    const root = mount(apiWith(() => Promise.resolve(snap('Fresh'))));
    await flush();
    expect(root.textContent).toBe('Fresh');
    expect(loadSnapshot('h1')?.items[0]?.name).toBe('Fresh');
  });

  it('does not show another household its cached list', async () => {
    saveSnapshot('other', snap('Not yours'));
    const root = mount(apiWith(() => new Promise<Snapshot>(() => undefined)));
    expect(root.textContent).toBe('none');
    await flush();
  });

  it('keeps the cache untouched when the sync fails', async () => {
    saveSnapshot('h1', snap('Kept'));
    mount(apiWith(vi.fn().mockRejectedValue(new ApiError(500, 'boom'))));
    await flush();
    expect(loadSnapshot('h1')?.items[0]?.name).toBe('Kept');
  });
});
