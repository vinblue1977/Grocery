import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from './api';
import { App, Signed } from './App';
import { announceUpdate, resetUpdate } from './UpdateBanner';

const session = { token: 't', householdId: 'h', deviceId: 'd', deviceName: 'iPhone', person: 'Victor' };
const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

afterEach(() => document.body.replaceChildren());

describe('navigation', () => {
  it('opens Settings from the header icon, keeps a half-typed item, and returns', async () => {
    const api = {
      sync: vi.fn().mockResolvedValue({ stores: [{ id: 'c', name: 'Costco', order: 0 }], items: [], frequent: [] }),
      devices: vi.fn().mockResolvedValue([]),
    } as unknown as Api;
    const root = document.createElement('div');
    document.body.append(root);
    act(() => {
      render(<Signed api={api} session={session} onSignedOut={vi.fn()} />, root);
    });
    await flush();

    const box = root.querySelector('input') as HTMLInputElement;
    box.value = 'Tea';
    await act(() => {
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(() => {
      (root.querySelector('[aria-label="Settings"]') as HTMLElement).click();
    });
    expect(root.textContent).toContain('Signed in as Victor');
    expect((root.querySelector('[hidden]') as HTMLElement).querySelector('input')?.value).toBe('Tea');

    await act(() => {
      window.dispatchEvent(new PopStateEvent('popstate')); // the system back gesture
    });
    expect(root.textContent).not.toContain('Signed in as');
    expect((root.querySelector('input') as HTMLInputElement).value).toBe('Tea');
  });

  it('the back link in Settings goes back through history', async () => {
    const api = {
      sync: vi.fn().mockResolvedValue({ stores: [], items: [], frequent: [] }),
      devices: vi.fn().mockResolvedValue([]),
    } as unknown as Api;
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const root = document.createElement('div');
    document.body.append(root);
    act(() => {
      render(<Signed api={api} session={session} onSignedOut={vi.fn()} />, root);
    });
    await flush();
    await act(() => {
      (root.querySelector('[aria-label="Settings"]') as HTMLElement).click();
    });
    await act(() => {
      (root.querySelector('.back') as HTMLElement).click();
    });
    expect(back).toHaveBeenCalled();
    back.mockRestore();
  });
});

describe('signing in on a new device', () => {
  it('asks who you are before showing the lists, until a person is picked', async () => {
    localStorage.setItem('grocery.session', JSON.stringify({ ...session, person: '' }));
    const root = document.createElement('div');
    document.body.append(root);
    await act(() => {
      render(<App />, root);
    });
    await flush();
    expect(root.textContent).toContain('Who are you?');
    expect(root.querySelector('[aria-label="Settings"]')).toBeNull();
    localStorage.clear();
  });
});

describe('the name of the person', () => {
  const run = async (person: string) => {
    localStorage.setItem('grocery.session', JSON.stringify(session));
    const api = {
      me: vi.fn().mockResolvedValue({ householdId: 'h', deviceId: 'd', deviceName: 'iPhone', person }),
      sync: vi.fn().mockResolvedValue({ stores: [], items: [], frequent: [] }),
    } as unknown as Api;
    const root = document.createElement('div');
    document.body.append(root);
    await act(() => {
      render(<App api={api} />, root);
    });
    await flush();
    return JSON.parse(localStorage.getItem('grocery.session') ?? '{}') as { person: string };
  };
  afterEach(() => localStorage.clear());

  it('follows a change made on another device of the same person', async () => {
    expect((await run('Vic')).person).toBe('Vic');
  });

  it('keeps the saved name when the server agrees', async () => {
    expect((await run('Victor')).person).toBe('Victor');
  });
});

describe('the update banner', () => {
  it('appears above whatever screen is showing once an update is announced', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await act(() => {
      render(<App api={{ people: vi.fn().mockResolvedValue([]) } as unknown as Api} />, root);
    });
    expect(root.querySelector('.banner')).toBeNull();
    await act(() => announceUpdate());
    expect(root.querySelector('.banner')?.textContent).toContain('New version ready');
    resetUpdate();
  });
});
