import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ApiError, type Api } from './api';
import { Settings } from './Settings';
import type { ListsState } from './useLists';

const session = { token: 't', householdId: 'h', deviceId: 'd', deviceName: 'iPhone', person: 'Victor' };
const devices = [
  { deviceId: 'd', name: 'iPhone', person: 'Victor', createdAt: 1, current: true },
  { deviceId: 'e', name: 'Yara\'s iPad', person: 'Yara', createdAt: 2, current: false },
];
const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
const click = (el: Element | null | undefined) =>
  act(() => {
    (el as HTMLElement).click();
  });
const buttons = (root: Element, text: string) => Array.from(root.querySelectorAll('button')).filter((b) => b.textContent === text);

let api: Api;
let refresh: Mock<() => Promise<void>>;
let onRenamed: Mock<(name: string) => void>;
let onPersonChanged: Mock<(person: string) => void>;
let onSignedOut: Mock<() => void>;

async function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  act(() => {
    render(
      <Settings
        api={api}
        lists={{ data: { stores: [], items: [], colors: { victor: '#7bd389' } }, refresh } as unknown as ListsState}
        session={session}
        onSignedOut={onSignedOut}
        onRenamed={onRenamed}
        onPersonChanged={onPersonChanged}
        onBack={vi.fn()}
      />,
      root,
    );
  });
  await flush();
  return root;
}

async function typeName(root: Element, value: string) {
  const box = root.querySelector('form input') as HTMLInputElement;
  box.value = value;
  await act(() => {
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(() => {
    root.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

beforeEach(() => {
  onRenamed = vi.fn();
  refresh = vi.fn().mockResolvedValue(undefined);
  onPersonChanged = vi.fn();
  onSignedOut = vi.fn();
  api = {
    devices: vi.fn().mockResolvedValue(devices),
    renameDevice: vi.fn().mockResolvedValue({ deviceId: 'd', name: 'Victor X' }),
    setPerson: vi.fn(async (name: string) => ({ person: name })),
    setColor: vi.fn(async (color: string) => ({ color })),
  } as unknown as Api;
});
afterEach(() => document.body.replaceChildren());

describe('renaming this device', () => {
  it('offers Rename on the current device only', async () => {
    const root = await mount();
    expect(buttons(root, 'Rename')).toHaveLength(1); // there are no stores, so this is the device one
    expect(buttons(root, 'Remove')).toHaveLength(1);
  });

  it('saves the trimmed name and tells the app', async () => {
    const root = await mount();
    await click(buttons(root, 'Rename')[0]);
    expect((root.querySelector('form input') as HTMLInputElement).value).toBe('iPhone');
    await typeName(root, '  Victor X ');
    expect(api.renameDevice).toHaveBeenCalledWith('d', 'Victor X');
    expect(onRenamed).toHaveBeenCalledWith('Victor X');
    expect(root.querySelector('form')).toBeNull();
  });

  it('does not send a blank name, and disables Save for one', async () => {
    const root = await mount();
    await click(buttons(root, 'Rename')[0]);
    await typeName(root, '   ');
    expect(api.renameDevice).not.toHaveBeenCalled();
    expect(buttons(root, 'Save')[0]?.disabled).toBe(true);
    expect(root.querySelector('form')).not.toBeNull(); // still open: nothing to lose
  });

  it('sends the name even if it matches the cached one, so the server copy can be corrected', async () => {
    const root = await mount();
    await click(buttons(root, 'Rename')[0]);
    await typeName(root, 'iPhone');
    expect(api.renameDevice).toHaveBeenCalledWith('d', 'iPhone');
  });

  it('keeps the form and what was typed when saving fails, and signs out if this device was revoked', async () => {
    api.renameDevice = vi.fn().mockRejectedValue(new ApiError(500, 'boom'));
    const root = await mount();
    await click(buttons(root, 'Rename')[0]);
    await typeName(root, 'New');
    expect(root.textContent).toContain('Could not rename this device');
    expect((root.querySelector('form input') as HTMLInputElement).value).toBe('New'); // nothing lost, retry is one tap
    expect(onRenamed).not.toHaveBeenCalled();

    api.renameDevice = vi.fn().mockRejectedValue(new ApiError(401, 'sign in required'));
    await typeName(root, 'Newer');
    expect(onSignedOut).toHaveBeenCalled();
  });

  it('focuses the box on open, and Cancel or Escape closes it without saving', async () => {
    const root = await mount();
    await click(buttons(root, 'Rename')[0]);
    const box = root.querySelector('form input') as HTMLInputElement;
    expect(document.activeElement).toBe(box);
    await click(buttons(root, 'Cancel')[0]);
    expect(root.querySelector('form')).toBeNull();
    await click(buttons(root, 'Rename')[0]);
    await act(() => {
      (root.querySelector('form input') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(root.querySelector('form')).toBeNull();
    expect(api.renameDevice).not.toHaveBeenCalled();
  });
});

describe('people', () => {
  it('shows the person under each device name', async () => {
    const root = await mount();
    expect(root.textContent).toContain('Signed in as Victor');
    const rows = Array.from(root.querySelectorAll('.row')).map((r) => r.textContent);
    expect(rows.some((r) => r?.includes('iPhone') && r.includes('(this device)') && r.includes('Victor'))).toBe(true);
    expect(rows.some((r) => r?.includes("Yara's iPad") && r.includes('Yara'))).toBe(true);
  });

  it('changes your name, trimmed, and tells the app', async () => {
    const root = await mount();
    await click(buttons(root, 'Change name')[0]);
    expect((root.querySelector('form input') as HTMLInputElement).value).toBe('Victor');
    await typeName(root, '  Vic ');
    expect(api.setPerson).toHaveBeenCalledWith('Vic');
    expect(onPersonChanged).toHaveBeenCalledWith('Vic');
    expect(root.querySelector('form')).toBeNull();
  });

  it('keeps the form when changing the name fails, and signs out if this device was removed', async () => {
    api.setPerson = vi.fn().mockRejectedValue(new ApiError(500, 'boom'));
    const root = await mount();
    await click(buttons(root, 'Change name')[0]);
    await typeName(root, 'Vic');
    expect(root.textContent).toContain('Could not change your name');
    expect((root.querySelector('form input') as HTMLInputElement).value).toBe('Vic');
    expect(onPersonChanged).not.toHaveBeenCalled();
    api.setPerson = vi.fn().mockRejectedValue(new ApiError(401, 'sign in required'));
    await typeName(root, 'Vic');
    expect(onSignedOut).toHaveBeenCalled();
  });
});

describe('avatar color', () => {
  const swatches = (root: Element) => Array.from(root.querySelectorAll('.swatches button')) as HTMLButtonElement[];

  it('offers eight colors with the saved one selected', async () => {
    const root = await mount();
    expect(swatches(root)).toHaveLength(8);
    expect(swatches(root).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('aria-label'))).toEqual(['Green']);
  });

  it('saves a pick, shows it at once and asks the lists to refresh', async () => {
    const root = await mount();
    await click(swatches(root).find((b) => b.getAttribute('aria-label') === 'Orange'));
    await flush();
    expect(api.setColor).toHaveBeenCalledWith('#ff9f6b');
    expect(refresh).toHaveBeenCalled();
    expect(swatches(root).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('aria-label'))).toEqual(['Orange']);
  });

  it('goes back to the saved color and says so when saving fails, and signs out if removed', async () => {
    api.setColor = vi.fn().mockRejectedValue(new ApiError(500, 'boom'));
    const root = await mount();
    await click(swatches(root).find((b) => b.getAttribute('aria-label') === 'Orange'));
    await flush();
    expect(root.textContent).toContain('Could not save that color');
    expect(swatches(root).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('aria-label'))).toEqual(['Green']);
    api.setColor = vi.fn().mockRejectedValue(new ApiError(401, 'sign in required'));
    await click(swatches(root).find((b) => b.getAttribute('aria-label') === 'Orange'));
    await flush();
    expect(onSignedOut).toHaveBeenCalled();
  });
});
