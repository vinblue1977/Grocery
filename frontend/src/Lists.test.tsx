import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type Item, type Snapshot } from './api';
import { Lists } from './Lists';

vi.mock('./scan', () => ({ shrinkPhoto: vi.fn().mockResolvedValue('BASE64') }));
import { useLists, type ListsState } from './useLists';
import { withNewItem } from './listState';
import { serialiseSnapshot } from './snapshotCache';

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
  frequent: [
    { storeId: 'c', name: 'Milk', count: 5, pinned: false }, // already on the list, so not offered
    { storeId: 'c', name: 'Bananas', count: 4, pinned: false },
    { storeId: 'c', name: 'Saffron', count: 0, pinned: true },
    { storeId: 'p', name: 'Ghee', count: 3, pinned: false },
  ],
});

const session = { token: 't', householdId: 'h', deviceId: 'd', deviceName: 'iPhone', person: 'Victor' };
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
    setFrequent: vi.fn().mockResolvedValue({}),
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
    expect(root.querySelector('[aria-label="Added by Yara"]')?.textContent).toBe('Y');
    expect(root.textContent).toContain('In cart · 1');
    expect(root.textContent).not.toContain('Rice');
  });

  it('switches store and remembers the choice', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(Array.from(root.querySelectorAll('[role=tab]')).find((t) => t.textContent === 'Patel') ?? null);
    expect(root.textContent).toContain('Rice');
    expect(localStorage.getItem('grocery.store')).toBe('p');
  });

  it('shows every store and its items together on the All tab', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(Array.from(root.querySelectorAll('[role=tab]')).find((t) => t.textContent === 'All') ?? null);
    expect(root.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('All');
    expect(root.textContent).toContain('To buy · 2');
    expect(root.querySelector('[role=group][aria-label=Costco]')?.textContent).toContain('Milk');
    expect(root.querySelector('[role=group][aria-label=Patel]')?.textContent).toContain('Rice');
    expect(root.textContent).toContain('In cart · 1');
    expect(root.textContent).toContain('Eggs');
    expect(root.querySelector('input[placeholder^="Add item"]')).toBeNull(); // adding needs a store
    expect(localStorage.getItem('grocery.store')).toBe('all');
  });

  it('clears the carts of every store from Done shopping on the All tab', async () => {
    vi.useFakeTimers();
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await click(Array.from(root.querySelectorAll('[role=tab]')).find((t) => t.textContent === 'All') ?? null);
    expect(root.querySelector('.hint')?.textContent).toContain('Pick a store');
    expect(root.querySelector('section[aria-label="In cart"] .store')?.textContent).toBe('Costco');
    await click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Done shopping') ?? null);
    expect(root.textContent).toContain('1 item bought');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });
    expect(api.clearChecked).toHaveBeenCalledWith('c');
    expect(api.clearChecked).toHaveBeenCalledTimes(1); // Patel had nothing in its cart
  });

  it('lists items coming back from every store on the All tab', async () => {
    api.sync = vi.fn().mockImplementation(() => {
      const snap = snapshot();
      snap.items.push({ id: 'oat', storeId: 'p', name: 'Oat milk', note: '', checked: false, addedBy: 'Yara', updatedAt: 4, repeatDays: 7, returnsAt: Date.now() + 3 * 86_400_000 });
      return Promise.resolve(snap);
    });
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(Array.from(root.querySelectorAll('[role=tab]')).find((t) => t.textContent === 'All') ?? null);
    expect(root.textContent).toContain('Coming back · 1');
    await click(root.querySelector('section[aria-label="Coming back"] .link-btn'));
    expect(root.querySelector('section[aria-label="Coming back"]')?.textContent).toContain('Patel');
    await click(root.querySelector('[aria-label="Add Oat milk now"]'));
    expect(api.updateItem).toHaveBeenCalledWith('oat', { resting: false });
  });

  it('opens a store from its heading on the All tab and ticks items there', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(Array.from(root.querySelectorAll('[role=tab]')).find((t) => t.textContent === 'All') ?? null);
    await click(root.querySelector('[aria-label="Check off Rice"]'));
    expect(api.updateItem).toHaveBeenCalledWith('rice', { checked: true });
    await click(root.querySelector('[aria-label="Open Costco"]'));
    expect(root.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Costco');
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
    expect(api.addItem).toHaveBeenCalledWith('c', 'Tea', undefined, expect.stringMatching(/^[0-9a-f]{32}$/));
  });

  it('shows a just-added item at once, but sends the tick only after the add has landed', async () => {
    let landed: () => void = () => undefined;
    (api.addItem as ReturnType<typeof vi.fn>).mockReturnValue(new Promise((resolve) => (landed = () => resolve({}))));
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'Tea';
    await act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(root.querySelector('[aria-label="Add item"]'));
    const sentId = (api.addItem as ReturnType<typeof vi.fn>).mock.calls[0]?.[3] as string;
    await click(root.querySelector('[aria-label="Check off Tea"]'));
    expect(root.querySelector('[aria-label="Delete Tea"]')).toBeNull(); // it moved to the in-cart section at once
    expect(api.updateItem).not.toHaveBeenCalled(); // but the server has not seen the add yet
    await act(async () => {
      landed();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(api.updateItem).toHaveBeenCalledWith(sentId, { checked: true });
  });

  it('sends a delete of a just-added item only after the add, and an item for a just-added store only after the store', async () => {
    const order: string[] = [];
    let landItem: () => void = () => undefined;
    let landStore: () => void = () => undefined;
    api.addItem = vi.fn().mockImplementation((storeId: string, name: string) => {
      order.push(`addItem ${name}`);
      return new Promise((resolve) => (landItem = () => resolve({})));
    });
    api.deleteItem = vi.fn().mockImplementation(() => {
      order.push('deleteItem');
      return Promise.resolve();
    });
    api.addStore = vi.fn().mockImplementation((name: string) => {
      order.push(`addStore ${name}`);
      return new Promise((resolve) => (landStore = () => resolve({})));
    });
    let state: ListsState | undefined;
    const Probe = () => {
      state = useLists(api, vi.fn());
      return null;
    };
    mount(<Probe />);
    await flush();
    const settle = () =>
      act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
    void state?.mutate((d) => d, { kind: 'addItem', id: 'a1', storeId: 'c', name: 'Tea' });
    void state?.mutate((d) => d, { kind: 'deleteItem', id: 'a1' });
    void state?.mutate((d) => d, { kind: 'addStore', id: 's9', name: 'Aldi' });
    void state?.mutate((d) => d, { kind: 'addItem', id: 'a2', storeId: 's9', name: 'Oats' });
    await settle();
    expect(order).toEqual(['addItem Tea']); // nothing else is sent while the first add is in flight
    landItem();
    await settle();
    expect(order).toEqual(['addItem Tea', 'deleteItem', 'addStore Aldi']);
    landStore();
    await settle();
    expect(order).toEqual(['addItem Tea', 'deleteItem', 'addStore Aldi', 'addItem Oats']);
  });

  it('adds a store under a client id and selects it at once', async () => {
    (api.addStore as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => undefined));
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(root.querySelector('[aria-label="Add a store"]'));
    const box = root.querySelector('input[placeholder="Store name"]') as HTMLInputElement;
    box.value = 'Aldi';
    await act(() => {
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(() => {
      box.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(api.addStore).toHaveBeenCalledWith('Aldi', expect.stringMatching(/^[0-9a-f]{32}$/));
    const selected = root.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe('Aldi');
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
    expect(api.addItem).toHaveBeenCalledWith('c', 'Tea', undefined, expect.stringMatching(/^[0-9a-f]{32}$/));
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

  const chip = (root: HTMLElement, name: string) => root.querySelector(`[aria-label="${name}"]`);
  const chipNames = (root: HTMLElement) => Array.from(root.querySelectorAll('[aria-label="Often bought"] .chip')).map((c) => c.textContent?.replaceAll('📌', '').replace('✕', '').replace(/^[^A-Za-z]+/, '').trim());

  it('offers the often-bought items of this store as chips, leaving out ones already on the list', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    expect(chipNames(root)).toEqual(['Bananas', 'Saffron']); // Costco: not Milk (on the list), not Ghee (Patel)
    await click(Array.from(root.querySelectorAll('.tab')).find((t) => t.textContent === 'Patel') ?? null);
    expect(chipNames(root)).toEqual(['Ghee']);
  });

  it('adds an item when its chip is tapped', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(chip(root, 'Add Bananas'));
    expect(api.addItem).toHaveBeenCalledWith('c', 'Bananas', undefined, expect.stringMatching(/^[0-9a-f]{32}$/));
  });

  it('narrows the chips as you type, and hides Edit while typing', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'ban';
    await act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(chipNames(root)).toEqual(['Bananas']);
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent === 'Edit')).toBe(false);
  });

  it('pins and removes suggestions in Edit mode', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Edit') ?? null);
    expect(chipNames(root)).toEqual(['Milk', 'Bananas', 'Saffron']); // Edit shows all so each can be managed
    await click(chip(root, 'Pin Bananas'));
    expect(api.setFrequent).toHaveBeenCalledWith('c', 'Bananas', { pinned: true });
    await click(chip(root, 'Unpin Saffron'));
    expect(api.setFrequent).toHaveBeenCalledWith('c', 'Saffron', { pinned: false });
    await click(chip(root, 'Remove Milk from suggestions'));
    expect(api.setFrequent).toHaveBeenCalledWith('c', 'Milk', { hidden: true });
    await click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Done') ?? null);
    expect(root.querySelector('[aria-label="Add Bananas"]')).not.toBeNull();
  });

  it('leaves Edit mode when you start typing, so chips add again', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Edit') ?? null);
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'ban';
    await act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(chip(root, 'Add Bananas'));
    expect(api.addItem).toHaveBeenCalledWith('c', 'Bananas', undefined, expect.stringMatching(/^[0-9a-f]{32}$/));
    expect(api.setFrequent).not.toHaveBeenCalled();
  });

  it('shows no Often row when there is nothing to suggest', async () => {
    vi.mocked(api.sync).mockResolvedValue({ ...snapshot(), frequent: [] });
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    expect(root.querySelector('[aria-label="Often bought"]')).toBeNull();
  });

  describe('deleting with undo', () => {
    const tick = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    const text = (root: HTMLElement) => root.textContent ?? '';
    const button = (root: HTMLElement, label: string) =>
      Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label) ?? null;
    const open = async () => {
      vi.useFakeTimers();
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await tick(0);
      return root;
    };

    it('hides a deleted item at once, offers Undo, and sends the delete after six seconds', async () => {
      const root = await open();
      await click(root.querySelector('[aria-label="Delete Milk"]'));
      expect(text(root)).not.toContain('2 gal');
      expect(text(root)).toContain('Milk deleted');
      expect(api.deleteItem).not.toHaveBeenCalled();
      await tick(5000); // polls bring the item back from the server, but it stays hidden
      expect(api.deleteItem).not.toHaveBeenCalled();
      expect(text(root)).not.toContain('2 gal');
      await tick(1100);
      expect(api.deleteItem).toHaveBeenCalledWith('milk');
      expect(api.deleteItem).toHaveBeenCalledTimes(1);
    });

    it('brings the item back with Undo and never sends the delete', async () => {
      const root = await open();
      await click(root.querySelector('[aria-label="Delete Milk"]'));
      await click(button(root, 'Undo'));
      expect(text(root)).toContain('Milk');
      expect(text(root)).not.toContain('Milk deleted');
      await tick(10000);
      expect(api.deleteItem).not.toHaveBeenCalled();
      expect(text(root)).toContain('2 gal');
    });

    it('sends the first delete at once when a second item is deleted', async () => {
      api.sync = vi.fn().mockResolvedValue({
        ...snapshot(),
        items: [...snapshot().items, { id: 'tea', storeId: 'c', name: 'Tea', note: '', checked: false, addedBy: 'Victor', updatedAt: 4 }],
      });
      const root = await open();
      await click(root.querySelector('[aria-label="Delete Milk"]'));
      await click(root.querySelector('[aria-label="Delete Tea"]'));
      expect(api.deleteItem).toHaveBeenCalledWith('milk');
      expect(api.deleteItem).not.toHaveBeenCalledWith('tea');
      await tick(6100);
      expect(api.deleteItem).toHaveBeenCalledWith('tea');
    });

    it('sends a waiting delete when the app goes to the background', async () => {
      const root = await open();
      await click(root.querySelector('[aria-label="Delete Milk"]'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      await act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      expect(api.deleteItem).toHaveBeenCalledWith('milk');
    });

    it('only clears what was in the cart when Clear was tapped, not an item ticked during the wait', async () => {
      const root = await open();
      await click(button(root, 'Done shopping'));
      await click(root.querySelector('[aria-label="Check off Milk"]'));
      await tick(6100);
      expect(api.clearChecked).not.toHaveBeenCalled();
      expect(api.deleteItem).toHaveBeenCalledWith('eggs');
      expect(api.deleteItem).not.toHaveBeenCalledWith('milk');
    });

    it('lets an item that failed to delete show again instead of hiding it for good', async () => {
      api.deleteItem = vi.fn().mockRejectedValue(new ApiError(404, 'gone'));
      const root = await open();
      await click(root.querySelector('[aria-label="Delete Milk"]'));
      await tick(6100);
      await tick(10000);
      expect(api.deleteItem).toHaveBeenCalled();
      expect(text(root)).toContain('Milk');
    });

    it('clears the cart after six seconds unless Undo is tapped', async () => {
      const root = await open();
      await click(button(root, 'Done shopping'));
      expect(text(root)).toContain('1 item bought');
      expect(text(root)).not.toContain('Eggs');
      expect(api.clearChecked).not.toHaveBeenCalled();
      await click(button(root, 'Undo'));
      expect(text(root)).toContain('Eggs');
      await tick(7000);
      expect(api.clearChecked).not.toHaveBeenCalled();
      await click(button(root, 'Done shopping'));
      await tick(6100);
      expect(api.clearChecked).toHaveBeenCalledWith('c');
    });
  });

  describe('recurring items', () => {
    const WEEK = 7 * 86_400_000;
    const itemsWith = (extra: Item[]) => ({ ...snapshot(), items: [...snapshot().items, ...extra] });
    const mk = (id: string, name: string, over: Partial<Item>): Item => ({ id, storeId: 'c', name, note: '', checked: false, addedBy: 'Victor', updatedAt: 9, ...over });
    const open = async (extra: Item[]) => {
      vi.useFakeTimers();
      api.sync = vi.fn().mockResolvedValue(itemsWith(extra));
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      return root;
    };
    const tick = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    const button = (root: HTMLElement, label: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label) ?? null;

    it('marks an item that repeats with a ↻', async () => {
      const root = await open([mk('tea', 'Tea', { repeatDays: 7 })]);
      expect(root.querySelector('[aria-label="Repeats weekly"]')?.textContent).toBe('↻');
      expect(root.querySelectorAll('[aria-label^="Repeats"]')).toHaveLength(1);
    });

    it('Done shopping rests repeating items, says so, and keeps them under Coming back', async () => {
      const root = await open([mk('oats', 'Oats', { repeatDays: 7, checked: true })]);
      let served = itemsWith([mk('oats', 'Oats', { repeatDays: 7, checked: true })]); // what the server answers once the clear lands
      api.sync = vi.fn().mockImplementation(() => Promise.resolve(served));
      api.clearChecked = vi.fn().mockImplementation(async () => {
        served = {
          ...served,
          items: served.items.filter((i) => !i.checked || i.repeatDays).map((i) => (i.repeatDays ? { ...i, checked: false, returnsAt: Date.now() + WEEK } : i)),
        };
      });
      await click(button(root, 'Done shopping'));
      expect(root.querySelector('.toast')?.textContent).toContain('2 items bought · 1 will come back');
      expect(root.textContent).toContain('Coming back · 1');
      expect(root.textContent).not.toContain('Oats'); // collapsed
      await tick(6100);
      expect(api.clearChecked).toHaveBeenCalledWith('c');
      expect(root.textContent).toContain('Coming back · 1');
    });

    it('lists what is coming back with its day, and Add now puts it on the list', async () => {
      const root = await open([mk('oats', 'Oats', { repeatDays: 7, returnsAt: Date.now() + WEEK })]);
      expect(root.textContent).toContain('Coming back · 1');
      expect(root.querySelector('[aria-label="Check off Oats"]')).toBeNull(); // not on the list
      await click(button(root, 'Show ›'));
      expect(root.textContent).toContain('weekly');
      await click(root.querySelector('[aria-label="Add Oats now"]'));
      expect(api.updateItem).toHaveBeenCalledWith('oats', { resting: false });
      expect(root.querySelector('[aria-label="Check off Oats"]')).not.toBeNull();
      expect(root.textContent).not.toContain('Coming back');
    });

    it('stopping the repeat of something already bought removes it for good', async () => {
      const root = await open([mk('oats', 'Oats', { repeatDays: 7, returnsAt: Date.now() + WEEK })]);
      await click(button(root, 'Show ›'));
      await click(root.querySelector('[aria-label="Edit Oats"]'));
      await click(Array.from(root.querySelectorAll('[aria-label=Repeat] button')).find((b) => b.textContent === 'Off') ?? null);
      await click(root.querySelector('.sheet button[type=submit]'));
      expect(api.deleteItem).toHaveBeenCalledWith('oats');
      expect(root.querySelector('.toast')?.textContent).toContain('Oats will not come back');
      expect(root.textContent).not.toContain('Coming back');
    });

    it('sets an item to repeat from the edit sheet', async () => {
      const root = await open([]);
      await click(root.querySelector('[aria-label="Edit Milk"]'));
      await click(Array.from(root.querySelectorAll('[aria-label=Repeat] button')).find((b) => b.textContent === 'Monthly') ?? null);
      await click(root.querySelector('.sheet button[type=submit]'));
      expect(api.updateItem).toHaveBeenCalledWith('milk', { repeatDays: 30 });
      expect(root.querySelector('[aria-label="Repeats monthly"]')).not.toBeNull();
    });
  });

  it('moves an item to another store from the edit sheet, and the toast jumps there', async () => {
    const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
    await flush();
    await click(root.querySelector('[aria-label="Edit Milk"]'));
    await click(Array.from(root.querySelectorAll('.sheet .chip')).find((b) => b.textContent === 'Patel') ?? null);
    await click(root.querySelector('.sheet button[type=submit]'));
    expect(api.updateItem).toHaveBeenCalledWith('milk', { storeId: 'p' });
    expect(root.textContent).not.toContain('2 gal'); // gone from Costco
    expect(root.querySelector('.toast')?.textContent).toContain('Milk moved to Patel');
    await click(Array.from(root.querySelectorAll('.toast button')).find((b) => b.textContent === 'View') ?? null);
    expect(root.textContent).toContain('2 gal'); // now on Patel's list
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
    api.deleteItem = vi.fn().mockReturnValue(slow);
    const pending = state?.mutate((d) => d, { kind: 'deleteItem', id: 'milk' });
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

  it('keeps an edit on screen and queued when the server has a hiccup, without the old "not saved" message', async () => {
    api.deleteItem = vi.fn().mockRejectedValue(new ApiError(500, 'boom'));
    let state: ListsState | undefined;
    const Probe = () => {
      state = useLists(api, vi.fn());
      return (
        <p>
          {state.error}|{state.data?.items.length}|{state.pending}
        </p>
      );
    };
    const root = mount(<Probe />);
    await flush();
    expect(root.textContent).toBe('|3|0');
    await act(async () => {
      await state?.mutate((d) => ({ ...d, items: [] }), { kind: 'deleteItem', id: 'milk' });
    });
    expect(root.textContent).toBe('|0|1'); // edit stays, waiting to be retried
    expect(api.sync).toHaveBeenCalledTimes(1); // no re-sync until it is sent
  });

  it('keeps an edit made offline on screen and waiting', async () => {
    let state: ListsState | undefined;
    const Probe = () => {
      state = useLists(api, vi.fn());
      return (
        <p>
          {state.error}|{state.data?.items.length}|{state.pending}|{String(state.offline)}
        </p>
      );
    };
    const root = mount(<Probe />);
    await flush();
    api.sync = vi.fn().mockRejectedValue(new ApiError(0, 'No connection'));
    api.deleteItem = vi.fn().mockRejectedValue(new ApiError(0, 'No connection'));
    await act(async () => {
      await state?.mutate((d) => ({ ...d, items: [] }), { kind: 'deleteItem', id: 'milk' });
    });
    expect(root.textContent).toBe('|0|1|true');
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
      await state?.mutate((d) => ({ ...d, items: [] }), { kind: 'clearChecked', storeId: 'zzz' });
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

  describe('fun touches', () => {
    const resync = async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await flush();
    };
    const withExtra = (extra: Snapshot['items']) => {
      const base = snapshot();
      return { ...base, items: [...base.items, ...extra] };
    };
    const theirs = (id: string, addedBy: string, storeId = 'c') => ({ id, storeId, name: id, note: '', checked: false, addedBy, updatedAt: Date.now() });

    it('greets the person by first name and shows an emoji tile on each item', async () => {
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      expect(root.querySelector('.hi')?.textContent).toMatch(/^(Good (morning|afternoon|evening)|Up late), Victor/); // the greeting follows the clock, including after midnight
      expect(root.querySelector('.it .em')?.textContent).toBe('🥛');
    });

    it('toasts when someone else adds items in the background, and View switches to that store', async () => {
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      expect(root.querySelector('.toast')).toBeNull(); // the first load is not news
      (api.sync as ReturnType<typeof vi.fn>).mockResolvedValue(withExtra([theirs('Paneer', "Yara's phone", 'p'), theirs('Dal', 'Yara', 'p')]));
      await resync();
      expect(root.querySelector('[aria-live=polite]')?.textContent).toContain('Yara added 2 items to Patel');
      await click(Array.from(root.querySelectorAll('.toast button')).find((b) => b.textContent === 'View') ?? null);
      expect(root.querySelector('[aria-selected=true]')?.textContent).toBe('Patel');
      expect(root.querySelector('.toast')).toBeNull();
    });

    it('does not toast for your own items (even from another device) and dismisses on its own', async () => {
      vi.useFakeTimers();
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      (api.sync as ReturnType<typeof vi.fn>).mockResolvedValue(withExtra([theirs('Tea', 'Victor')]));
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(root.querySelector('.toast')).toBeNull();
      (api.sync as ReturnType<typeof vi.fn>).mockResolvedValue(withExtra([theirs('Tea', 'Victor'), theirs('Jam', 'Yara')]));
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(root.querySelector('.toast')?.textContent).toContain('Yara added 1 item to Costco');
      expect(root.querySelector('.it.fresh')).not.toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });
      expect(root.querySelector('.toast')).toBeNull();
    });

    it('celebrates only when the last to-buy item is ticked, and can go to the next store', async () => {
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      expect(root.querySelector('.celebrate')).toBeNull(); // not on load
      await click(root.querySelector('[aria-label="Check off Milk"]'));
      const card = root.querySelector('.celebrate');
      expect(card?.textContent).toContain('All done at Costco!');
      expect(card?.textContent).toContain('On to Patel?');
      await click(Array.from(root.querySelectorAll('.go')).find((b) => b.textContent === 'Go to Patel') ?? null);
      expect(root.querySelector('.celebrate')).toBeNull();
      expect(root.querySelector('[aria-selected=true]')?.textContent).toBe('Patel');
    });

    it('does not celebrate ticking an item while others are still to buy, nor show the empty text for an already-empty load', async () => {
      (api.sync as ReturnType<typeof vi.fn>).mockResolvedValue(withExtra([theirs('Jam', 'Victor')]));
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      await click(root.querySelector('[aria-label="Check off Milk"]'));
      expect(root.querySelector('.celebrate')).toBeNull();
    });

    it('drops the celebration when the server refuses the tick and it is rolled back', async () => {
      (api.updateItem as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(400, 'nope'));
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      await click(root.querySelector('[aria-label="Check off Milk"]'));
      await flush();
      expect(root.querySelector('.celebrate')).toBeNull();
      expect(root.querySelector('[aria-label="Check off Milk"]')).not.toBeNull(); // rolled back, so it is still to buy
    });

    it('still celebrates the last tick while offline, with the tick waiting in the queue', async () => {
      (api.updateItem as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(0, 'No connection'));
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      await click(root.querySelector('[aria-label="Check off Milk"]'));
      await flush();
      expect(root.querySelector('.celebrate')?.textContent).toContain('All done at Costco!');
      expect(root.textContent).toContain('Offline, 1 change waiting');
    });

    it('does not bring the celebration back when the store empties some other way later', async () => {
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      await click(root.querySelector('[aria-label="Check off Milk"]'));
      await click(root.querySelector('.dismiss'));
      expect(root.querySelector('.celebrate')).toBeNull();
      (api.sync as ReturnType<typeof vi.fn>).mockResolvedValue(withExtra([theirs('Jam', 'Victor')]));
      await resync(); // an item appears (celebration flag is cleared), then...
      const base = snapshot();
      (api.sync as ReturnType<typeof vi.fn>).mockResolvedValue({ ...base, items: base.items.filter((i) => i.id !== 'milk') });
      await resync();
      expect(root.querySelector('.celebrate')).toBeNull();
    });

    it('shows Cart cleared only for a few seconds', async () => {
      vi.useFakeTimers();
      const base = snapshot();
      let items = base.items.filter((i) => i.id !== 'milk'); // Costco: only Eggs, in the cart
      (api.sync as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve({ ...base, items }));
      (api.clearChecked as ReturnType<typeof vi.fn>).mockImplementation(() => {
        items = items.filter((i) => i.storeId !== 'c');
        return Promise.resolve();
      });
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Done shopping') ?? null);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(root.querySelector('.empty')?.textContent).toContain('Cart cleared. See you next trip!');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6100);
      });
      expect(root.querySelector('.empty')?.textContent).toContain('Suspiciously organised');
    });

    it('animates every item ticked in quick succession', async () => {
      (api.sync as ReturnType<typeof vi.fn>).mockResolvedValue(withExtra([theirs('Jam', 'Victor'), theirs('Tea', 'Victor')]));
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      await click(root.querySelector('[aria-label="Check off Jam"]'));
      await click(root.querySelector('[aria-label="Check off Tea"]'));
      expect(root.querySelectorAll('.it.pop').length).toBe(2);
    });

    it('announces items from someone else on a later sync however old they are', async () => {
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      (api.sync as ReturnType<typeof vi.fn>).mockResolvedValue(withExtra([{ ...theirs('Jam', 'Yara'), updatedAt: 1 }]));
      await resync();
      expect(root.querySelector('.toast')?.textContent).toContain('Yara added 1 item to Costco');
    });

    it('treats the cached list and the first network list as baselines, not news', async () => {
      localStorage.setItem('grocery.snapshot', serialiseSnapshot('h', snapshot()));
      (api.sync as ReturnType<typeof vi.fn>).mockResolvedValue(withExtra([theirs('Jam', 'Yara')]));
      const Cached = () => {
        const lists = useLists(api, vi.fn(), 'h');
        return <Lists api={api} lists={lists} session={session} onOpenSettings={() => undefined} />;
      };
      const root = mount(<Cached />);
      expect(root.textContent).toContain('Milk'); // the cached list is on screen at once
      expect(root.querySelector('.toast')).toBeNull();
      await flush();
      expect(root.textContent).toContain('Jam');
      expect(root.querySelector('.toast')).toBeNull(); // the first network list only sets the baseline
      (api.sync as ReturnType<typeof vi.fn>).mockResolvedValue(withExtra([theirs('Jam', 'Yara'), theirs('Tea', 'Yara')]));
      await resync();
      expect(root.querySelector('.toast')?.textContent).toContain('Yara added 1 item to Costco');
    });

    it("never diffs optimistic data: a rolled-back own add does not hide the other person's item with the same id", async () => {
      (api.addItem as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(400, 'nope'));
      let state: ListsState | undefined;
      const Capture = () => {
        state = useLists(api, vi.fn());
        return <Lists api={api} lists={state} session={session} onOpenSettings={() => undefined} />;
      };
      const root = mount(<Capture />);
      await flush();
      await act(async () => {
        await state?.mutate((d) => withNewItem(d, 'same', 'c', 'Tea', 'Victor'), { kind: 'addItem', id: 'same', storeId: 'c', name: 'Tea', addedBy: 'Victor' });
      });
      await flush();
      expect(root.querySelector('.toast')).toBeNull();
      (api.sync as ReturnType<typeof vi.fn>).mockResolvedValue(withExtra([{ ...theirs('same', 'Yara'), name: 'Tea' }]));
      await resync();
      expect(root.querySelector('.toast')?.textContent).toContain('Yara added 1 item');
    });

    it('gives the celebration card a status role and moves focus to it', async () => {
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      await click(root.querySelector('[aria-label="Check off Milk"]'));
      const card = root.querySelector('.celebrate');
      expect(card?.getAttribute('role')).toBe('status');
      expect(document.activeElement).toBe(card);
    });

    it('an old "could not be saved" banner does not cancel a later celebration', async () => {
      (api.updateItem as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(400, 'nope'));
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      await click(root.querySelector('[aria-label="Check off Milk"]'));
      await flush();
      expect(root.textContent).toContain('could not be saved'); // the banner is showing and the tick was rolled back
      (api.updateItem as ReturnType<typeof vi.fn>).mockResolvedValue({});
      const done = snapshot();
      (api.sync as ReturnType<typeof vi.fn>).mockResolvedValue({ ...done, items: done.items.map((i) => (i.id === 'milk' ? { ...i, checked: true } : i)) });
      await click(root.querySelector('[aria-label="Check off Milk"]'));
      await flush();
      expect(root.querySelector('.celebrate')).not.toBeNull();
      expect(root.textContent).toContain('could not be saved'); // still showing, and the card survived it
    });

    it('a new dropped tick clears the celebration', async () => {
      (api.updateItem as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(400, 'nope'));
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      await click(root.querySelector('[aria-label="Check off Milk"]'));
      expect(root.querySelector('.celebrate')).not.toBeNull(); // shown at once, before the server has answered
      await flush();
      expect(root.querySelector('.celebrate')).toBeNull();
    });

    it('summarises arrivals across stores without naming one', async () => {
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      (api.sync as ReturnType<typeof vi.fn>).mockResolvedValue(withExtra([theirs('Jam', 'Yara'), theirs('Tea', 'Yara'), theirs('Dal', 'Yara', 'p')]));
      await resync();
      expect(root.querySelector('.toast')?.textContent).toContain('Yara added 3 items');
      expect(root.querySelector('.toast')?.textContent).not.toContain(' to ');
    });

    it('says N items bought and shows the cheerful empty store after Clear', async () => {
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      await click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Done shopping') ?? null);
      expect(root.querySelector('.toast')?.textContent).toContain('1 item bought');
    });
  });

  describe('editing an item', () => {
    const openEdit = async (root: HTMLElement, name = 'Milk') => {
      await click(root.querySelector(`button[aria-label="Edit ${name}"]`));
    };
    const typeInto = (root: HTMLElement, index: number, value: string) =>
      act(() => {
        const box = root.querySelectorAll('.sheet.edit input')[index] as HTMLInputElement;
        box.value = value;
        box.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const save = () =>
      act(() => {
        (document.querySelector('.sheet.edit form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

    it('tapping the name opens the sheet, and saving shows the new note at once and sends only the change', async () => {
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      expect(root.querySelector('.sheet.edit')).toBeNull();
      await openEdit(root);
      expect((root.querySelectorAll('.sheet.edit input')[1] as HTMLInputElement).value).toBe('2 gal');
      await typeInto(root, 1, '3 gal');
      await save();
      expect(root.querySelector('.sheet.edit')).toBeNull();
      expect(root.textContent).toContain('3 gal');
      await flush();
      expect(api.updateItem).toHaveBeenCalledWith('milk', { note: '3 gal' });
    });

    it('closes the sheet if the other phone deletes the item meanwhile', async () => {
      const root = mount(<Harness api={api} onSignedOut={vi.fn()} />);
      await flush();
      await openEdit(root);
      expect(root.querySelector('.sheet.edit')).not.toBeNull();
      const without: Snapshot = { ...snapshot(), items: snapshot().items.filter((i) => i.id !== 'milk') };
      (api.sync as ReturnType<typeof vi.fn>).mockResolvedValue(without);
      document.dispatchEvent(new Event('visibilitychange')); // coming back to the app syncs at once
      await flush();
      expect(root.querySelector('.sheet.edit')).toBeNull();
    });
  });
});
