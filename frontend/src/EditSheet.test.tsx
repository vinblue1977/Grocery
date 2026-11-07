import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Item, Store } from './api';
import { EditSheet, QUICK_NOTES } from './EditSheet';

const item: Item = { id: 'milk', storeId: 'c', name: 'Milk', note: '2 gal', checked: false, addedBy: 'Yara', updatedAt: 1 };

const STORES: Store[] = [
  { id: 'c', name: 'Costco', order: 0 },
  { id: 'p', name: 'Patel', order: 1 },
];

afterEach(() => document.body.replaceChildren());

function setup(stores: Store[] = STORES) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const root = document.createElement('div');
  document.body.append(root);
  act(() => {
    render(<EditSheet item={item} stores={stores} onSave={onSave} onClose={onClose} />, root);
  });
  const inputs = () => [...root.querySelectorAll('input')] as HTMLInputElement[];
  const type = (index: number, value: string) =>
    act(() => {
      const box = inputs()[index] as HTMLInputElement;
      box.value = value;
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const button = (text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;
  const submit = () =>
    act(() => {
      (root.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  return { root, onSave, onClose, inputs, type, button, submit };
}

describe('EditSheet', () => {
  it('starts with the current name and note, the note box focused, and Save off until something changes', () => {
    const { inputs, button, root } = setup();
    expect(inputs().map((i) => i.value)).toEqual(['Milk', '2 gal']);
    expect(document.activeElement).toBe(inputs()[1]);
    expect(button('Save').disabled).toBe(true);
    expect(root.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Edit Milk');
  });

  it('saves only what changed, trimmed, and closes', async () => {
    const { type, button, submit, onSave, onClose } = setup();
    await type(1, '  3 gal ');
    expect(button('Save').disabled).toBe(false);
    await submit();
    expect(onSave).toHaveBeenCalledWith({ note: '3 gal' });
    expect(onClose).toHaveBeenCalled();
  });

  it('can rename, and can clear the note', async () => {
    const { type, submit, onSave } = setup();
    await type(0, 'Whole milk');
    await type(1, '');
    await submit();
    expect(onSave).toHaveBeenCalledWith({ name: 'Whole milk', note: '' });
  });

  it('does not save a blank name', async () => {
    const { type, button, submit, onSave } = setup();
    await type(0, '   ');
    expect(button('Save').disabled).toBe(true);
    await submit();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('fills the note from a quick button', async () => {
    const { button, inputs, submit, onSave } = setup();
    expect(QUICK_NOTES).toContain('2 lb');
    await act(() => button('2 lb').click());
    expect(inputs()[1]?.value).toBe('2 lb');
    await submit();
    expect(onSave).toHaveBeenCalledWith({ note: '2 lb' });
  });

  it('closes on Cancel, on Escape and on a tap outside, without saving', async () => {
    const { button, root, onSave, onClose } = setup();
    await act(() => button('Cancel').click());
    await act(() => {
      root.querySelector('[role=dialog]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await act(() => (root.querySelector('.scrim') as HTMLElement).click());
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('moving an item to another store', () => {
  it('shows the stores with the current one selected, and saves only the new store', async () => {
    const { button, submit, onSave, root } = setup();
    expect(root.querySelector('[aria-pressed=true]')?.textContent).toBe('Costco');
    expect((root.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true); // nothing changed yet
    await act(() => button('Patel').click());
    expect(root.querySelector('[aria-pressed=true]')?.textContent).toBe('Patel');
    await submit();
    expect(onSave).toHaveBeenCalledWith({ storeId: 'p' });
  });

  it('can be undone before saving, and is hidden when there is only one store', async () => {
    const { button, root } = setup();
    await act(() => button('Patel').click());
    await act(() => button('Costco').click());
    expect((root.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
    document.body.replaceChildren();
    const single = setup([STORES[0] as Store]);
    expect(single.root.querySelector('[aria-label=Store]')).toBeNull();
  });
});
