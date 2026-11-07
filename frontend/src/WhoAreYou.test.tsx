import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from './api';
import { WhoAreYou } from './WhoAreYou';

async function setup(overrides: Partial<Api> = {}) {
  const api = {
    people: vi.fn().mockResolvedValue(['Victor', 'Yara']),
    setPerson: vi.fn(async (name: string) => ({ person: name })),
    ...overrides,
  } as unknown as Api;
  const onPicked = vi.fn();
  const onSignedOut = vi.fn();
  const root = document.createElement('div');
  document.body.append(root);
  await act(() => {
    render(<WhoAreYou api={api} onPicked={onPicked} onSignedOut={onSignedOut} />, root);
  });
  return { api, onPicked, onSignedOut, root };
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const buttons = (root: HTMLElement) => [...root.querySelectorAll('button')];
const byText = (root: HTMLElement, text: string) => buttons(root).find((b) => b.textContent?.includes(text));

afterEach(() => document.body.replaceChildren());

describe('WhoAreYou', () => {
  it('lists the household people and saves the one picked', async () => {
    const { api, onPicked, root } = await setup();
    await settle();
    expect(buttons(root).map((b) => b.textContent)).toEqual(['VVictor', 'YYara', "+ I'm someone new"]);
    await act(() => byText(root, 'Yara')?.click());
    await settle();
    expect(api.setPerson).toHaveBeenCalledWith('Yara');
    expect(onPicked).toHaveBeenCalledWith('Yara');
  });

  it('lets someone new type a name', async () => {
    const { api, onPicked, root } = await setup();
    await settle();
    await act(() => byText(root, 'someone new')?.click());
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = '  Maya ';
    await act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (root.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(api.setPerson).toHaveBeenCalledWith('Maya');
    expect(onPicked).toHaveBeenCalledWith('Maya');
  });

  it('goes straight to typing when nobody is listed or the list cannot be loaded', async () => {
    const empty = await setup({ people: vi.fn().mockResolvedValue([]) });
    await settle();
    expect(empty.root.querySelector('input')).not.toBeNull();
    document.body.replaceChildren();
    const failing = await setup({ people: vi.fn().mockRejectedValue(new ApiError(0, 'No connection')) });
    await settle();
    expect(failing.root.querySelector('input')).not.toBeNull();
  });

  it('signs out when this device was removed, and keeps the screen on a failed save', async () => {
    const gone = await setup({ people: vi.fn().mockRejectedValue(new ApiError(401, 'sign in required')) });
    await settle();
    expect(gone.onSignedOut).toHaveBeenCalled();
    document.body.replaceChildren();
    const failing = await setup({ setPerson: vi.fn().mockRejectedValue(new ApiError(0, 'No connection')) });
    await settle();
    await act(() => byText(failing.root, 'Victor')?.click());
    await settle();
    expect(failing.onPicked).not.toHaveBeenCalled();
    expect(failing.root.querySelector('.error')?.textContent).toContain('Could not save');
    expect((byText(failing.root, 'Victor') as HTMLButtonElement).disabled).toBe(false);
  });
});
