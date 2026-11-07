import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from './api';
import { Settings } from './Settings';
import type { ListsState } from './useLists';

const session = { token: 't', householdId: 'h', deviceId: 'd', deviceName: 'iPhone', person: 'Victor' };
const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => undefined })) as unknown as typeof matchMedia;

afterEach(() => document.body.replaceChildren());

async function setup(createRecovery = vi.fn().mockResolvedValue({ code: 'rec_secretCode123' })) {
  const api = { devices: vi.fn().mockResolvedValue([]), createRecovery } as unknown as Api;
  const root = document.createElement('div');
  document.body.append(root);
  act(() => {
    render(<Settings api={api} lists={{ data: null } as unknown as ListsState} session={session} onSignedOut={vi.fn()} onRenamed={vi.fn()} onPersonChanged={vi.fn()} onBack={vi.fn()} />, root);
  });
  await flush();
  const button = (text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
  return { api, root, button };
}

describe('recovery code card', () => {
  it('asks to confirm, then shows the code once with a copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { api, root, button } = await setup();
    expect(root.textContent).not.toContain('rec_');
    await act(() => button('Create a recovery code').click());
    expect(api.createRecovery).not.toHaveBeenCalled(); // first tap only asks
    expect(root.textContent).toContain('replaces any older code');
    await act(() => button('replaces any older code').click());
    await flush();
    expect(api.createRecovery).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.recovery')?.textContent).toBe('rec_secretCode123');
    expect(root.textContent).toContain('will not be shown again');
    await act(() => button('Copy code').click());
    await flush();
    expect(writeText).toHaveBeenCalledWith('rec_secretCode123');
    expect(root.textContent).toContain('Recovery code copied');
  });

  it('falls back to a hint when the clipboard is unavailable, and reports failures', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } });
    const { root, button } = await setup();
    await act(() => button('Create a recovery code').click());
    await act(() => button('replaces any older code').click());
    await flush();
    await act(() => button('Copy code').click());
    await flush();
    expect(root.textContent).toContain('Press and hold the code');

    const createRecovery = vi.fn().mockResolvedValueOnce({ code: 'rec_first1234' }).mockRejectedValueOnce(new Error('x'));
    const again = await setup(createRecovery);
    await act(() => again.button('Create a recovery code').click());
    await act(() => again.button('replaces any older code').click());
    await flush();
    expect(again.root.querySelector('.recovery')?.textContent).toBe('rec_first1234');
    await act(() => again.button('Create a recovery code').click());
    await act(() => again.button('replaces any older code').click());
    await flush();
    expect(again.root.querySelector('.recovery')).toBeNull(); // the possibly dead code is gone
    expect(again.root.textContent).toContain('the old code might no longer work');
  });
});

describe('invite card', () => {
  it('shows a scannable QR code with the invite link once it is created', async () => {
    const invite = vi.fn().mockResolvedValue({ code: 'Xk3F9xQ2mZ7vB1nTa8LcW5yRd0HeJ4uG', expiresAt: 1 });
    const api = { devices: vi.fn().mockResolvedValue([]), invite } as unknown as Api;
    const root = document.createElement('div');
    document.body.append(root);
    act(() => {
      render(<Settings api={api} lists={{ data: null } as unknown as ListsState} session={session} onSignedOut={vi.fn()} onRenamed={vi.fn()} onPersonChanged={vi.fn()} onBack={vi.fn()} />, root);
    });
    await flush();
    expect(root.querySelector('svg.qr')).toBeNull();
    const create = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Create invite link')) as HTMLButtonElement;
    await act(() => create.click());
    await flush();
    expect(invite).toHaveBeenCalledTimes(1);
    expect(root.querySelector('svg.qr')?.getAttribute('aria-label')).toBe('QR code for the invite link');
    expect(root.querySelector('.link')?.textContent).toContain('#join=Xk3F9xQ2mZ7vB1nTa8LcW5yRd0HeJ4uG');
  });
});
