/**
 * Decides when to reload after a new service worker takes over. Reloading is skipped while the page holds edits that
 * have not reached the server (`hasPendingEdits`, to be wired to the write queue once it exists), and happens at most
 * once per page load so a flapping worker can't cause a reload loop. A skipped reload is retried by `retry()`.
 */
export function createReloader(hasPendingEdits: () => boolean, reload: () => void) {
  let reloaded = false;
  let wanted = false;
  const attempt = () => {
    if (!wanted || reloaded || hasPendingEdits()) return;
    reloaded = true;
    reload();
  };
  return {
    /** A new worker took control. */
    onControllerChange() {
      wanted = true;
      attempt();
    },
    /** Call when the reload may now be allowed (the app went to the background, or pending edits cleared). */
    retry: attempt,
  };
}

/**
 * Registers the worker, checks for a new one whenever the app returns to the foreground, and reloads onto updates.
 * A reload would cancel a tap or typing in progress, so after an upgrade it waits until the app goes to the background.
 */
export function setupServiceWorker(
  hasPendingEdits: () => boolean = () => false,
  reload: () => void = () => location.reload(),
  onUpdate: () => void = () => undefined,
): void {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  let hadController = sw.controller !== null;
  const reloader = createReloader(() => hasPendingEdits() || document.visibilityState === 'visible', reload);
  sw.addEventListener('controllerchange', () => {
    // The first worker claiming a page that had none is an install, not an upgrade: nothing to reload onto.
    if (!hadController) hadController = true;
    else {
      reloader.onControllerChange();
      onUpdate(); // the page stays open (it waits for the background), so offer a reload now
    }
  });
  let registration: ServiceWorkerRegistration | undefined;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') reloader.retry();
    else void registration?.update().catch(() => undefined); // offline or the server is down: try again next time
  });
  void sw
    .register('./sw.js')
    .then((r) => {
      registration = r;
    })
    .catch(() => undefined); // blocked or failed install: the app simply works without offline support
}
