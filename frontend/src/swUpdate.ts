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
    /** Call when pending edits may have cleared (e.g. the page came back to the foreground). */
    retry: attempt,
  };
}

/** Registers the worker, checks for a new one whenever the app returns to the foreground, and reloads onto updates. */
export function setupServiceWorker(hasPendingEdits: () => boolean = () => false): void {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  // A first install also fires controllerchange (clients.claim); only an upgrade of an existing worker needs a reload.
  const hadController = sw.controller !== null;
  const reloader = createReloader(hasPendingEdits, () => location.reload());
  if (hadController) sw.addEventListener('controllerchange', reloader.onControllerChange);
  void sw.register('./sw.js').then((registration) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      reloader.retry();
      void registration.update().catch(() => undefined); // offline or the server is down: try again next time
    });
  });
}
