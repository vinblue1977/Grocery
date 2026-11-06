import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ApiError, type Api } from './api';
import { Settings } from './Settings';
import type { ListsState } from './useLists';

const session = { token: 't', householdId: 'h', deviceId: 'd', deviceName: 'Vinod' };
const devices = [
  { deviceId: 'd', name: 'Vinod', createdAt: 1, current: true },
  { deviceId: 'e', name: 'Yaso', createdAt: 2, current: false },
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
let onRenamed: Mock<(name: string) => void>;
let onSignedOut: Mock<() => void>;

async function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  act(() => {
    render(
      <Settings
        api={api}
        lists={{ data: { stores: [], items: [] } } as unknown as ListsState}
        session={session}
        onSignedOut={onSignedOut}
        onRenamed={onRenamed}
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
  onSignedOut = vi.fn();
  api = {
    devices: vi.fn().mockResolvedValue(devices),
    renameDevice: vi.fn().mockResolvedValue({ deviceId: 'd', name: 'Vinod X' }),
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
    expect((root.querySelector('form input') as HTMLInputElement).value).toBe('Vinod');
    await typeName(root, '  Vinod X ');
    expect(api.renameDevice).toHaveBeenCalledWith('d', 'Vinod X');
    expect(onRenamed).toHaveBeenCalledWith('Vinod X');
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
    await typeName(root, 'Vinod');
    expect(api.renameDevice).toHaveBeenCalledWith('d', 'Vinod');
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
