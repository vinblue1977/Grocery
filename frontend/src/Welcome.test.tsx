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
    recover: vi.fn().mockResolvedValue(creds),
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

  it('signs in with a recovery code from the dedicated form, without touching the theme', async () => {
    const { api, onSignedIn, root } = setup();
    await act(() => {
      (root.querySelector('.link-btn') as HTMLElement).click();
    });
    expect(root.textContent).toContain('Get back in');
    await type(root, 0, 'New phone');
    await type(root, 1, ' rec_abcDEF-123456789 ');
    await submit(root);
    expect(api.recover).toHaveBeenCalledWith('rec_abcDEF-123456789', 'New phone');
    expect(api.createHousehold).not.toHaveBeenCalled();
    expect(onSignedIn).toHaveBeenCalledWith({ ...creds, deviceName: 'New phone' });
    expect(localStorage.getItem('grocery.theme')).toBeNull();
  });

  it('does not treat a recovery code in the invite box as a recovery, and hints where to go', async () => {
    const { api, root } = setup(null, { join: vi.fn().mockRejectedValue(new ApiError(404, 'invite is invalid or expired')) });
    await type(root, 1, 'rec_abcDEF-123456789');
    await submit(root);
    expect(api.recover).not.toHaveBeenCalled();
    expect(root.querySelector('.error')?.textContent).toContain('tap Lost access?');
  });

  it('keeps the real error when joining with a recovery-looking code fails for another reason', async () => {
    const { root } = setup(null, { join: vi.fn().mockRejectedValue(new ApiError(503, 'try again soon')) });
    await type(root, 1, 'rec_abcDEF-123456789');
    await submit(root);
    expect(root.querySelector('.error')?.textContent).toContain('try again soon');
  });

  it('rejects a malformed recovery code locally and explains a refused one', async () => {
    const recover = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(400, 'invalid recovery code'));
    const { api, root, onSignedIn } = setup(null, { recover });
    await act(() => {
      (root.querySelector('.link-btn') as HTMLElement).click();
    });
    await type(root, 1, 'nope');
    await submit(root);
    expect(root.querySelector('.error')?.textContent).toContain("doesn't look like a recovery code");
    expect(api.recover).not.toHaveBeenCalled();
    await type(root, 1, 'rec_abcDEF-123456789');
    await submit(root);
    expect(root.querySelector('.error')?.textContent).toContain("isn't valid");
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});
