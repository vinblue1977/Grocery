import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type Snapshot } from './api';
import { Lists } from './Lists';

vi.mock('./scan', () => ({ shrinkPhoto: vi.fn().mockResolvedValue('BASE64') }));
import { useLists, type ListsState } from './useLists';

const snapshot = (): Snapshot => ({
  stores: [
    { id: 'c', name: 'Costco', order: 0 },
    { id: 'p', name: 'Patel', order: 1 },
  ],
  items: [
    { id: 'milk', storeId: 'c', name: 'Milk', note: '2 gal', checked: false, addedBy: 'Yara', updatedAt: 1 },
    { id: 'eggs', storeId: 'c', name: 'Eggs', note: '', checked: true, addedBy: 'Victor', updatedAt: 2 },
    { id: 'rice', storeId: 'p', name: 'Rice', note: '', checked: false, addedBy: 'Victor', updatedAt: 3 },
  ],
});

const session = { token: 't', householdId: 'h', deviceId: 'd', deviceName: 'Victor' };
const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

function mount(element: preact.VNode) {
  const root = document.createElement('div');
  document.body.append(root);
  act(() => {
    render(element, root); // act also runs the component's effects
  });
  return root;
}

function Harness({ api, onSignedOut, onOpenSettings = () => undefined }: { api: Api; onSignedOut: () => void; onOpenSettings?: () => void }) {
  const lists = useLists(api, onSignedOut);
  return <Lists api={api} lists={lists} session={session} onOpenSettings={onOpenSettings} />;
}

const click = (el: Element | null) =>
  act(() => {
    (el as HTMLElement).click();
  });

let api: Api;
beforeEach(() => {
  api = {
    sync: vi.fn().mockImplementation(() => Promise.resolve(snapshot())),
    addItem: vi.fn().mockResolvedValue({}),
    updateItem: vi.fn().mockResolvedValue({}),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    clearChecked: vi.fn().mockResolvedValue(undefined),
    addStore: vi.fn().mockResolvedValue({ id: 'n', name: 'New', order: 2 }),
    scan: vi.fn().mockResolvedValue([{ name: 'Tea', note: '', storeId: 'c', unsure: false }]),
    addItems: vi.fn().mockResolvedValue({ added: 1, skipped: 1 }),
  } as unknown as Api;
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
});

describe('Lists screen', () => {
  it('shows the first store split into to-buy and in-cart, with who added each item', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    expect(root.textContent).toContain('To buy · 1');
    expect(root.textContent).toContain('Milk');
    expect(root.textContent).toContain('2 gal');
    expect(root.textContent).toContain('Yara');
    expect(root.textContent).toContain('In cart · 1');
    expect(root.textContent).not.toContain('Rice');
  });

  it('switches store and remembers the choice', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(root.querySelectorAll('[role=tab]')[1] ?? null);
    expect(root.textContent).toContain('Rice');
    expect(localStorage.getItem('grocery.store')).toBe('p');
  });

  it('checks an item off at once and tells the server', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(root.querySelector('[aria-label="Check off Milk"]'));
    expect(api.updateItem).toHaveBeenCalledWith('milk', { checked: true });
  });

  it('adds an item to the selected store', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = '  Tea ';
    await act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(() => {
      (root.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(api.addItem).toHaveBeenCalledWith('c', 'Tea');
  });

  it('adds an item when the plus button is tapped', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'Tea';
    await act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(root.querySelector('[aria-label="Add item"]'));
    expect(api.addItem).toHaveBeenCalledWith('c', 'Tea');
  });

  it('focuses the field instead of adding when ＋ is tapped with nothing typed', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(root.querySelector('[aria-label="Add item"]'));
    expect(api.addItem).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(root.querySelector('input'));
  });

  it('closes the new-store box with Cancel without adding a store', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(root.querySelector('[aria-label="Add a store"]'));
    const box = root.querySelector('input[placeholder="Store name"]') as HTMLInputElement;
    expect(box).not.toBeNull();
    expect(document.activeElement).toBe(box);
    await click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Cancel') ?? null);
    expect(root.querySelector('input[placeholder="Store name"]')).toBeNull();
    expect(api.addStore).not.toHaveBeenCalled();
  });

  it('closes the new-store box with Escape or the ＋ tab and forgets what was typed', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    const plus = root.querySelector('[aria-label="Add a store"]');
    const find = () => root.querySelector('input[placeholder="Store name"]') as HTMLInputElement | null;
    const type = async (text: string) => {
      const box = find() as HTMLInputElement;
      box.value = text;
      await act(() => {
        box.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await click(plus);
    await type('Costc');
    await act(() => {
      find()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(find()).toBeNull();
    await click(plus);
    expect(find()?.value).toBe('');
    await type('Aldi');
    await click(plus); // tapping ＋ again closes it too
    expect(find()).toBeNull();
    await click(plus);
    expect(find()?.value).toBe('');
    expect(api.addStore).not.toHaveBeenCalled();
  });

  it('does not steal focus back to the new-store box when the list refreshes', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(root.querySelector('[aria-label="Add a store"]'));
    const item = root.querySelector('[aria-label^="Add item to"], input:not([placeholder="Store name"])') as HTMLInputElement;
    item.focus();
    await click(root.querySelector('[aria-label="Check off Milk"]')); // optimistic update plus refresh re-render the screen
    await flush();
    expect(document.activeElement).not.toBe(root.querySelector('input[placeholder="Store name"]'));
  });

  it('deletes an item and clears the cart', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(root.querySelector('[aria-label="Delete Milk"]'));
    expect(api.deleteItem).toHaveBeenCalledWith('milk');
    await click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Clear') ?? null);
    expect(api.clearChecked).toHaveBeenCalledWith('c');
  });

  it('opens settings from the header icon, even while loading', async () => {
    const open = vi.fn();
    api.sync = vi.fn().mockReturnValue(new Promise(() => undefined)); // never answers: still loading
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} onOpenSettings={open} />);
    await flush();
    expect(root.textContent).toContain('Loading');
    await click(root.querySelector('[aria-label="Settings"]'));
    expect(open).toHaveBeenCalled();
  });

  it('scans a photo, reviews it, adds the items and says what happened', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    const input = root.querySelector('[data-testid=photo]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'list.jpg')] });
    await act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(api.scan).toHaveBeenCalledWith('BASE64');
    expect(root.textContent).toContain('Found 1 item');
    await click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Add 1 item') ?? null);
    await flush();
    expect(api.addItems).toHaveBeenCalledWith([{ name: 'Tea', note: '', storeId: 'c' }]);
    expect(root.textContent).toContain('Added 1 item, 1 already on the list');
    expect(root.querySelector('.sheet')).toBeNull();
  });

  it('opens the photo picker from the camera button', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    const open = vi.spyOn(root.querySelector('[data-testid=photo]') as HTMLInputElement, 'click');
    await click(root.querySelector('[aria-label="Add from a photo of a paper list"]'));
    expect(open).toHaveBeenCalled();
  });

  it('puts an item back from the cart', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(root.querySelector('[aria-label="Put Eggs back"]'));
    expect(api.updateItem).toHaveBeenCalledWith('eggs', { checked: false });
  });
});

describe('useLists', () => {
  it('signs out on a 401 and reports being offline', async () => {
    const onSignedOut = vi.fn();
    api.sync = vi.fn().mockRejectedValue(new ApiError(401, 'sign in required'));
    mount(<Harness api={api} onSignedOut={onSignedOut} />);
    await flush();
    expect(onSignedOut).toHaveBeenCalled();

    document.body.replaceChildren();
    api.sync = vi.fn().mockRejectedValue(new ApiError(0, 'No connection'));
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    expect(root.textContent).toContain('Offline');
  });

  it('polls every 5 seconds while visible and skips polling during an edit', async () => {
    vi.useFakeTimers();
    let state: ListsState | undefined;
    const Probe = () => {
      state = useLists(api, vi.fn());
      return null;
    };
    mount(<Probe />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.sync).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.sync).toHaveBeenCalledTimes(2);

    let finish: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => (finish = resolve));
    const pending = state?.mutate((d) => d, () => slow);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(api.sync).toHaveBeenCalledTimes(2); // paused while the edit was in flight
    finish();
    await act(async () => {
      await pending;
    });
    expect(api.sync).toHaveBeenCalledTimes(3); // one re-sync after the edit
  });

  it('keeps the error visible after a failed edit, undoes it on screen and re-syncs', async () => {
    let state: ListsState | undefined;
    const Probe = () => {
      state = useLists(api, vi.fn());
      return (
        <p>
          {state.error}|{state.data?.items.length}
        </p>
      );
    };
    const root = mount(<Probe />);
    await flush();
    expect(root.textContent).toBe('|3');
    await act(async () => {
      await state?.mutate(
        (d) => ({ ...d, items: [] }),
        () => Promise.reject(new ApiError(500, 'boom')),
      );
    });
    expect(root.textContent).toBe('That change was not saved|3'); // edit undone, message kept
    expect(api.sync).toHaveBeenCalledTimes(2);
  });

  it('undoes an edit that failed offline even though the re-sync also fails', async () => {
    let state: ListsState | undefined;
    const Probe = () => {
      state = useLists(api, vi.fn());
      return (
        <p>
          {state.error}|{state.data?.items.length}
        </p>
      );
    };
    const root = mount(<Probe />);
    await flush();
    api.sync = vi.fn().mockRejectedValue(new ApiError(0, 'No connection'));
    await act(async () => {
      await state?.mutate(
        (d) => ({ ...d, items: [] }),
        () => Promise.reject(new ApiError(0, 'No connection')),
      );
    });
    expect(root.textContent).toBe('Offline: that change was not saved|3');
  });

  it('discards a slow sync that finished after an edit', async () => {
    let state: ListsState | undefined;
    const Probe = () => {
      state = useLists(api, vi.fn());
      return <p>{state.data?.items.length}</p>;
    };
    const root = mount(<Probe />);
    await flush();
    let release: (s: Snapshot) => void = () => undefined;
    api.sync = vi.fn().mockReturnValueOnce(new Promise<Snapshot>((resolve) => (release = resolve)));
    const slowPoll = state?.refresh();
    await act(async () => {
      await state?.mutate((d) => ({ ...d, items: [] }), () => Promise.resolve());
    });
    api.sync = vi.fn().mockResolvedValue({ ...snapshot(), items: [] });
    release(snapshot()); // the old, pre-edit snapshot arrives last
    await act(async () => {
      await slowPoll;
    });
    expect(root.textContent).not.toBe('3');
  });

  it('slows polling to every 30 seconds when the app sits idle', async () => {
    vi.useFakeTimers();
    mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 5000);
    });
    const afterActive = (api.sync as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 1000);
    });
    expect((api.sync as ReturnType<typeof vi.fn>).mock.calls.length - afterActive).toBeLessThanOrEqual(3); // ~2 polls a minute, not 12
  });
});
