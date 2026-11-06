import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type ScannedItem } from './api';
import { ScanSheet } from './ScanSheet';

vi.mock('./scan', () => ({ shrinkPhoto: vi.fn().mockResolvedValue('BASE64') }));

const stores = [
  { id: 'c', name: 'Costco', order: 0 },
  { id: 'p', name: 'Patel', order: 1 },
];
const found: ScannedItem[] = [
  { name: 'Milk', note: '2 gal', storeId: 'c', unsure: false },
  { name: 'Toor dal', note: '1 kg', storeId: 'p', unsure: false },
  { name: 'Cinnamon?', note: '', storeId: null, unsure: true },
  { name: 'Ghost', note: '', storeId: 'deleted-store', unsure: false },
];
const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

let api: Api;
let photo: File;
const onClose = vi.fn();
const onAdded = vi.fn();

async function open(scanResult: Promise<ScannedItem[]> = Promise.resolve(found), shown = stores, current: string | null = 'p') {
  api = { scan: vi.fn().mockReturnValue(scanResult), addItems: vi.fn().mockResolvedValue({ added: 3, skipped: 0 }) } as unknown as Api;
  photo = new File(['x'], 'list.jpg');
  const root = document.createElement('div');
  document.body.append(root);
  act(() => {
    render(<ScanSheet api={api} file={photo} stores={shown} currentStoreId={current} onClose={onClose} onAdded={onAdded} />, root);
  });
  await flush();
  return root;
}

const click = (el: Element | null) =>
  act(() => {
    (el as HTMLElement).click();
  });

beforeEach(() => {
  onClose.mockClear();
  onAdded.mockClear();
});
afterEach(() => document.body.replaceChildren());

describe('ScanSheet', () => {
  it('shows a reading state while Claude works', async () => {
    const root = await open(new Promise(() => undefined));
    expect(root.textContent).toContain('Reading your list');
  });

  it('lists what was found: unsure items unticked, unknown stores fall back to the current one', async () => {
    const root = await open();
    expect(root.textContent).toContain('Found 4 items');
    const boxes = Array.from(root.querySelectorAll<HTMLInputElement>('input[type=checkbox]'));
    expect(boxes.map((b) => b.checked)).toEqual([true, true, false, true]);
    const stores_ = Array.from(root.querySelectorAll('select')).map((s) => s.value);
    expect(stores_).toEqual(['c', 'p', 'p', 'p']);
    expect(root.textContent).toContain('unsure of the handwriting');
    expect(root.textContent).toContain('Add 3 items');
  });

  it('adds only the ticked rows, with the fixed names and chosen stores', async () => {
    const root = await open();
    const names = root.querySelectorAll<HTMLInputElement>('input[aria-label="Item name"]');
    const first = names[0] as HTMLInputElement;
    first.value = 'Whole milk';
    await act(() => {
      first.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const select = root.querySelectorAll('select')[1] as HTMLSelectElement;
    select.value = 'c';
    await act(() => {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const ghost = root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[3] as HTMLInputElement;
    await act(() => {
      ghost.click();
    });
    await click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Add 2 items') ?? null);
    expect(api.addItems).toHaveBeenCalledWith([
      { name: 'Whole milk', note: '2 gal', storeId: 'c' },
      { name: 'Toor dal', note: '1 kg', storeId: 'c' },
    ]);
    expect(onAdded).toHaveBeenCalledWith({ added: 3, skipped: 0 });
  });

  it('says so when nothing was found and cannot add', async () => {
    const root = await open(Promise.resolve([]));
    expect(root.textContent).toContain('No items found');
    expect((root.querySelector('.primary') as HTMLButtonElement).disabled).toBe(true);
  });

  it('scans once per photo even when the list refreshes underneath it, and keeps the person\'s edits', async () => {
    const root = await open();
    const name = root.querySelector('input[aria-label="Item name"]') as HTMLInputElement;
    name.value = 'Fixed name';
    await act(() => {
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Every poll hands the sheet a new `stores` array (same content, new identity).
    for (let poll = 0; poll < 3; poll += 1) {
      act(() => {
        render(<ScanSheet api={api} file={photo} stores={[...stores]} currentStoreId="p" onClose={onClose} onAdded={onAdded} />, root);
      });
      await flush();
    }
    expect(api.scan).toHaveBeenCalledTimes(1);
    expect((root.querySelector('input[aria-label="Item name"]') as HTMLInputElement).value).toBe('Fixed name');
  });

  it('does not scan (and spend) when there is no store to add to', async () => {
    const root = await open(Promise.resolve(found), [], null);
    expect(root.textContent).toContain('Add a store first');
    expect(api.scan).not.toHaveBeenCalled();
  });

  it('shows the error when the photo cannot be read, and Cancel closes', async () => {
    const root = await open(Promise.reject(new ApiError(502, 'Could not read that photo.')));
    expect(root.textContent).toContain('Could not read that photo.');
    await click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Cancel') ?? null);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the review open with a message when adding fails', async () => {
    const root = await open();
    (api.addItems as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(400, 'at most 500 items'));
    await click(root.querySelector('.primary'));
    await flush(); // the add request settles
    expect(root.textContent).toContain('at most 500 items');
    expect(onAdded).not.toHaveBeenCalled();
    expect((root.querySelector('.primary') as HTMLButtonElement).disabled).toBe(false);
  });
});
