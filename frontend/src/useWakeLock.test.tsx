import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWakeLock } from './useWakeLock';

function Probe({ active }: { active: boolean }) {
  useWakeLock(active);
  return null;
}

const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

let locks: ReturnType<typeof fakeLock>[] = [];
const first = () => locks[0] as ReturnType<typeof fakeLock>;

function fakeLock() {
  const listeners: (() => void)[] = [];
  return {
    release: vi.fn().mockImplementation(async () => listeners.forEach((l) => l())),
    addEventListener: (_: string, l: () => void) => listeners.push(l),
  };
}

describe('useWakeLock', () => {
  let root: HTMLElement;
  let request: ReturnType<typeof vi.fn>;
  const show = (active: boolean) => act(() => render(<Probe active={active} />, root));
  const setVisibility = (v: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: v });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    locks = [];
    request = vi.fn().mockImplementation(async () => {
      const l = fakeLock();
      locks.push(l);
      return l;
    });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    setVisibility('visible');
  });
  afterEach(() => {
    act(() => render(null, root));
    root.remove();
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  it('holds the screen on while active and lets go when not', async () => {
    show(true);
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    show(false);
    expect(first().release).toHaveBeenCalled();
  });

  it('does nothing while inactive', async () => {
    show(false);
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it('asks again when the page comes back, since hiding it drops the lock', async () => {
    show(true);
    await flush();
    await act(async () => {
      await first().release(); // what the browser does on hide
    });
    setVisibility('hidden');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('is fine without the API or when the browser refuses', async () => {
    request.mockRejectedValue(new Error('denied'));
    show(true);
    await flush();
    Reflect.deleteProperty(navigator, 'wakeLock');
    show(false);
    show(true);
    await flush();
  });

  it('releases a lock that arrives after the screen was left', async () => {
    show(true);
    show(false);
    await flush();
    expect(first().release).toHaveBeenCalled();
  });
});
