import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from './api';
import { Welcome } from './Welcome';

const creds = { householdId: 'h', deviceId: 'd', token: 't' };

// jsdom has no matchMedia, which the theme code uses.
window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => undefined })) as unknown as typeof matchMedia;

function setup(joinCode: string | null = null, overrides: Partial<Api> = {}) {
  const api = {
    createHousehold: vi.fn().mockResolvedValue(creds),
    join: vi.fn().mockResolvedValue(creds),
    ...overrides,
  } as unknown as Api;
  const onSignedIn = vi.fn();
  const root = document.createElement('div');
  document.body.append(root);
  render(<Welcome api={api} joinCode={joinCode} onSignedIn={onSignedIn} />, root);
  return { api, onSignedIn, root };
}

async function type(root: HTMLElement, index: number, value: string) {
  const input = root.querySelectorAll('input')[index] as HTMLInputElement;
  input.value = value;
  await act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(root: HTMLElement) {
  await act(async () => {
    (root.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the async submit handler settle
  });
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe('Welcome', () => {
  it('creates a household by default and starts that device in dark', async () => {
    const { api, onSignedIn, root } = setup();
    await type(root, 0, 'Victor');
    await submit(root);
    expect(api.createHousehold).toHaveBeenCalledWith('Victor');
    expect(onSignedIn).toHaveBeenCalledWith({ ...creds, deviceName: 'Victor' });
    expect(localStorage.getItem('grocery.theme')).toBe('dark');
  });

  it('joins with a pasted link and starts that device in light', async () => {
    const { api, root } = setup();
    await type(root, 0, 'Yara');
    await type(root, 1, 'https://u.github.io/Grocery/#join=abc_DEF-1234567');
    await submit(root);
    expect(api.join).toHaveBeenCalledWith('abc_DEF-1234567', 'Yara');
    expect(api.createHousehold).not.toHaveBeenCalled();
    expect(localStorage.getItem('grocery.theme')).toBe('light');
  });

  it('never creates a household when the paste box has anything in it, even blanks', async () => {
    const { api, onSignedIn, root } = setup();
    await type(root, 1, '   ');
    await submit(root);
    expect(api.createHousehold).not.toHaveBeenCalled();
    expect(api.join).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(root.querySelector('.error')?.textContent).toContain("doesn't look like an invite");
  });

  it('uses the invite code from the link and shows no paste box', async () => {
    const { api, root } = setup('abc_DEF-1234567');
    expect(root.querySelectorAll('input')).toHaveLength(1);
    await submit(root);
    expect(api.join).toHaveBeenCalledWith('abc_DEF-1234567', 'iPhone');
  });

  it('explains a 409 and lets the user try again', async () => {
    const { root, onSignedIn } = setup(null, { createHousehold: vi.fn().mockRejectedValue(new ApiError(409, 'x')) });
    await submit(root);
    expect(root.querySelector('.error')?.textContent).toContain('already set up');
    expect(onSignedIn).not.toHaveBeenCalled();
    expect((root.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(false);
  });
});
