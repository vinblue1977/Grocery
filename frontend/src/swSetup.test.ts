import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServiceWorker } from './swUpdate';

/** A stand-in for navigator.serviceWorker that lets a test fire controllerchange by hand. */
function fakeServiceWorker(controller: object | null, register: () => Promise<unknown>) {
  const target = new EventTarget();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller, register, addEventListener: target.addEventListener.bind(target), changed: () => target.dispatchEvent(new Event('controllerchange')) },
  });
  return { changed: () => target.dispatchEvent(new Event('controllerchange')) };
}

const show = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('setupServiceWorker', () => {
  beforeEach(() => show('visible'));
  afterEach(() => Reflect.deleteProperty(navigator, 'serviceWorker'));

  it('does not reload for the first install claiming the page', async () => {
    const reload = vi.fn();
    const sw = fakeServiceWorker(null, () => Promise.resolve({ update: () => Promise.resolve() }));
    setupServiceWorker(() => false, reload);
    sw.changed();
    show('hidden');
    expect(reload).not.toHaveBeenCalled();
  });

  it('after an upgrade waits until the app is in the background, so a tap in progress is never cut off', () => {
    const reload = vi.fn();
    const sw = fakeServiceWorker({}, () => Promise.resolve({ update: () => Promise.resolve() }));
    setupServiceWorker(() => false, reload);
    sw.changed(); // still on screen
    expect(reload).not.toHaveBeenCalled();
    show('hidden');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('tells the page about an upgrade, but not about the first install', () => {
    const onUpdate = vi.fn();
    const sw = fakeServiceWorker(null, () => Promise.resolve({ update: () => Promise.resolve() }));
    setupServiceWorker(() => false, vi.fn(), onUpdate);
    sw.changed(); // install
    expect(onUpdate).not.toHaveBeenCalled();
    sw.changed(); // upgrade
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('also upgrades a page that started with no worker, after its first install', () => {
    const reload = vi.fn();
    const sw = fakeServiceWorker(null, () => Promise.resolve({ update: () => Promise.resolve() }));
    setupServiceWorker(() => false, reload);
    sw.changed(); // install: ignored
    sw.changed(); // later upgrade
    show('hidden');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload while edits are unsent, and survives a failed registration', async () => {
    const reload = vi.fn();
    const sw = fakeServiceWorker({}, () => Promise.reject(new Error('blocked')));
    expect(() => setupServiceWorker(() => true, reload)).not.toThrow();
    sw.changed();
    show('hidden');
    expect(reload).not.toHaveBeenCalled();
  });

  it('asks for a newer worker whenever the app comes back to the foreground', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    fakeServiceWorker({}, () => Promise.resolve({ update }));
    setupServiceWorker(() => false, vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    show('hidden');
    show('visible');
    expect(update).toHaveBeenCalledTimes(1);
  });
});
