import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type Snapshot } from './api';
import { Lists } from './Lists';
import { loadQueue, saveQueue } from './queue';
import { clearSnapshot, saveSnapshot } from './snapshotCache';
import { useLists, type ListsState } from './useLists';

const snap = (): Snapshot => ({
  stores: [{ id: 'c', name: 'Costco', order: 0 }],
  items: [{ id: 'milk', storeId: 'c', name: 'Milk', note: '', checked: false, addedBy: 'Yaso', updatedAt: 1 }],
  frequent: [],
});
const session = { token: 't', householdId: 'h1', deviceId: 'd', deviceName: 'Vinod' };
const settle = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

let state: ListsState;
let onSignedOut = vi.fn();
function Probe({ api, household }: { api: Api; household?: string }) {
  state = useLists(api, onSignedOut, household);
  return (
    <p>
      {state.data?.items.map((i) => `${i.name}${i.checked ? '*' : ''}`).join(',') ?? 'none'}|{state.pending}|{state.problem}
    </p>
  );
}
function mount(api: Api, household: string | undefined = 'h1') {
  const root = document.createElement('div');
  document.body.append(root);
  act(() => {
    render(<Probe api={api} household={household} />, root);
  });
  return root;
}
const fake = (over: Partial<Record<keyof Api, unknown>> = {}) =>
  ({
    sync: vi.fn().mockImplementation(() => Promise.resolve(snap())),
    addItem: vi.fn().mockResolvedValue({}),
    updateItem: vi.fn().mockResolvedValue({}),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    addStore: vi.fn().mockResolvedValue({}),
    ...over,
  }) as unknown as Api;
const offlineError = () => new ApiError(0, 'No connection');
const goOnline = () =>
  act(() => {
    window.dispatchEvent(new Event('online'));
  });
const add = (id: string, name: string) =>
  state.mutate(
    (d) => ({ ...d, items: [...d.items, { id, storeId: 'c', name, note: '', checked: false, addedBy: 'V', updatedAt: 1 }] }),
    { kind: 'addItem', id, storeId: 'c', name },
  );

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  onSignedOut = vi.fn();
  vi.useRealTimers();
});

describe('edit queue in useLists', () => {
  it('replays edits made offline in order with the same ids once the connection returns', async () => {
    const calls: string[] = [];
    const api = fake({
      addItem: vi.fn().mockRejectedValue(offlineError()),
      updateItem: vi.fn().mockRejectedValue(offlineError()),
    });
    const root = mount(api);
    await settle();
    await act(async () => {
      await add('i1', 'Tea');
      await state.mutate((d) => ({ ...d, items: d.items.map((i) => (i.id === 'i1' ? { ...i, checked: true } : i)) }), {
        kind: 'updateItem',
        id: 'i1',
        changes: { checked: true },
      });
    });
    expect(root.textContent).toBe('Milk,Tea*|2|'); // shown at once, waiting
    expect(state.offline).toBe(true);
    api.addItem = vi.fn().mockImplementation(() => (calls.push('add'), Promise.resolve({})));
    api.updateItem = vi.fn().mockImplementation(() => (calls.push('update'), Promise.resolve({})));
    api.sync = vi.fn().mockResolvedValue({
      ...snap(),
      items: [...snap().items, { id: 'i1', storeId: 'c', name: 'Tea', note: '', checked: true, addedBy: 'V', updatedAt: 2 }],
    });
    goOnline();
    await settle();
    expect(calls).toEqual(['add', 'update']);
    expect(api.addItem).toHaveBeenCalledWith('c', 'Tea', undefined, 'i1');
    expect(api.updateItem).toHaveBeenCalledWith('i1', { checked: true });
    expect(root.textContent).toBe('Milk,Tea*|0|');
    expect(loadQueue('h1')).toEqual([]);
  });

  it('keeps queued edits when a poll brings a server list without them', async () => {
    const api = fake({ addItem: vi.fn().mockRejectedValue(offlineError()) });
    const root = mount(api);
    await settle();
    await act(async () => {
      await add('i1', 'Tea');
    });
    await act(async () => {
      await state.refresh(); // the server (still) has no Tea
    });
    expect(root.textContent).toBe('Milk,Tea|1|');
  });

  it('drops a 404 on delete silently', async () => {
    const api = fake({ deleteItem: vi.fn().mockRejectedValue(new ApiError(404, 'gone')) });
    const root = mount(api);
    await settle();
    await act(async () => {
      await state.mutate((d) => ({ ...d, items: [] }), { kind: 'deleteItem', id: 'milk' });
    });
    expect(root.textContent).toBe('Milk|0|'); // queue empty, no message, screen follows the server
  });

  it('drops a refused add, shows a one-shot message and rebuilds from the server list plus what is still queued', async () => {
    const api = fake({
      addItem: vi.fn().mockImplementation((_s: string, name: string) => (name === 'Bad' ? Promise.reject(new ApiError(404, 'no store')) : Promise.resolve({}))),
    });
    const root = mount(api);
    await settle();
    vi.useFakeTimers();
    await act(async () => {
      await add('i1', 'Bad');
    });
    expect(root.textContent).toBe('Milk|0|1 change could not be saved');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(root.textContent).toBe('Milk|0|');
  });

  it('keeps the queue and signs out on 401', async () => {
    const api = fake({ addItem: vi.fn().mockRejectedValue(new ApiError(401, 'no')) });
    const root = mount(api);
    await settle();
    await act(async () => {
      await add('i1', 'Tea');
    });
    expect(onSignedOut).toHaveBeenCalled();
    expect(root.textContent).toBe('Milk,Tea|1|');
    expect(loadQueue('h1')).toHaveLength(1);
  });

  it('retries after a 5xx or 429 on the next trigger, without dropping the edit', async () => {
    const addItem = vi.fn().mockRejectedValueOnce(new ApiError(503, 'busy')).mockRejectedValueOnce(new ApiError(429, 'slow')).mockResolvedValue({});
    const api = fake({ addItem });
    const root = mount(api);
    await settle();
    await act(async () => {
      await add('i1', 'Tea');
    });
    expect(root.textContent).toBe('Milk,Tea|1|');
    goOnline();
    await settle();
    expect(state.pending).toBe(1);
    goOnline();
    await settle();
    expect(addItem).toHaveBeenCalledTimes(3);
    expect(state.pending).toBe(0);
  });

  it('retries on the poll tick once the backoff has passed', async () => {
    const addItem = vi.fn().mockRejectedValueOnce(offlineError()).mockResolvedValue({});
    const api = fake({ addItem });
    vi.useFakeTimers();
    mount(api);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await add('i1', 'Tea');
    });
    expect(state.pending).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(addItem).toHaveBeenCalledTimes(2);
    expect(state.pending).toBe(0);
  });

  it('restores the persisted queue after a restart and sends it', async () => {
    clearSnapshot(); // forget what an earlier test saved
    saveSnapshot('h1', snap());
    saveQueue('h1', [{ kind: 'addItem', id: 'i9', storeId: 'c', name: 'Tea' }]);
    const api = fake({ sync: vi.fn().mockRejectedValue(offlineError()), addItem: vi.fn().mockRejectedValue(offlineError()) });
    const root = mount(api);
    expect(root.textContent).toBe('Milk,Tea|1|'); // before anything is sent
    await settle();
    expect(root.textContent).toBe('Milk,Tea|1|');
    api.addItem = vi.fn().mockResolvedValue({});
    api.sync = vi.fn().mockResolvedValue(snap());
    goOnline();
    await settle();
    expect(api.addItem).toHaveBeenCalledWith('c', 'Tea', undefined, 'i9');
    expect(loadQueue('h1')).toEqual([]);
  });
});

describe('Lists status line', () => {
  const screen = (api: Api) => {
    const root = document.createElement('div');
    document.body.append(root);
    const Screen = () => {
      const lists = useLists(api, vi.fn(), 'h1');
      return <Lists api={api} lists={lists} session={session} onOpenSettings={() => undefined} />;
    };
    act(() => {
      render(<Screen />, root);
    });
    return root;
  };

  it('says "Offline, N changes waiting" and disables the camera, and hides itself when all is sent', async () => {
    const api = fake({ addItem: vi.fn().mockRejectedValue(offlineError()) });
    const root = screen(api);
    await settle();
    expect(root.querySelector('[role="status"]')).toBeNull();
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'Tea';
    await act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    (api.sync as ReturnType<typeof vi.fn>).mockRejectedValue(offlineError());
    await act(async () => {
      (root.querySelector('[aria-label="Add item"]') as HTMLElement).click();
    });
    await settle();
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Offline, 1 change waiting');
    expect((root.querySelector('.camera') as HTMLButtonElement).disabled).toBe(true);
    expect(root.textContent).toContain('Photo scan needs a connection');
    api.addItem = vi.fn().mockResolvedValue({});
    api.sync = vi.fn().mockResolvedValue(snap());
    goOnline();
    await settle();
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect((root.querySelector('.camera') as HTMLButtonElement).disabled).toBe(false);
  });

  it('forgets a remembered new store whose creation was refused', async () => {
    const api = fake({ addStore: vi.fn().mockRejectedValue(new ApiError(400, 'id reused')) });
    const root = screen(api);
    await settle();
    await act(() => {
      (root.querySelector('[aria-label="Add a store"]') as HTMLElement).click();
    });
    const box = root.querySelector('input') as HTMLInputElement;
    box.value = 'Aldi';
    await act(() => {
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (root.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(localStorage.getItem('grocery.store')).toBeNull();
    expect(root.textContent).toContain('1 change could not be saved');
    expect(root.querySelector('[aria-selected="true"]')?.textContent).toBe('Costco');
  });
});
