import { useEffect } from 'preact/hooks';

// Keeps the screen on while `active`, so the phone doesn't go dark in the middle of the aisle. The browser drops the lock whenever
// the page is hidden, so it is asked for again when the page comes back. Browsers without the API, or that refuse, just sleep as usual.
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !navigator.wakeLock) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      if (stopped || document.visibilityState !== 'visible' || lock) return;
      try {
        const got = await navigator.wakeLock.request('screen');
        if (stopped) return void got.release().catch(() => {});
        lock = got;
        got.addEventListener('release', () => {
          if (lock === got) lock = null;
        });
      } catch {
        // refused (low battery, power saver): not worth telling anyone
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
