import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiError, type Api, type Snapshot } from './api';

const POLL_MS = 5000;

export interface ListsState {
  data: Snapshot | null;
  error: string;
  /** Applies `optimistic` to the screen at once, sends `request`, then re-syncs (which also repairs a failed edit). */
  mutate(optimistic: (data: Snapshot) => Snapshot, request: () => Promise<unknown>): Promise<void>;
  refresh(): Promise<void>;
}

/**
 * Keeps the household's lists in sync: fetches on open and every 5 s while the app is visible, and re-fetches when it
 * comes back to the foreground. Polling pauses while an edit is in flight so a poll can't undo it on screen.
 */
export function useLists(api: Api, onSignedOut: () => void): ListsState {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const inFlight = useRef(0);
  const alive = useRef(true);
  // Callers pass a fresh function every render; holding it in a ref keeps `refresh` stable so the polling effect runs once.
  const signedOut = useRef(onSignedOut);
  signedOut.current = onSignedOut;

  const refresh = useCallback(async () => {
    if (inFlight.current > 0) return;
    try {
      const next = await api.sync();
      if (alive.current && inFlight.current === 0) {
        setData(next);
        setError('');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) signedOut.current();
      else if (alive.current) setError(err instanceof ApiError && err.status === 0 ? 'Offline: showing the last list' : 'Could not sync');
    }
  }, [api]);

  const mutate = useCallback<ListsState['mutate']>(
    async (optimistic, request) => {
      setData((current) => (current ? optimistic(current) : current));
      inFlight.current += 1;
      try {
        await request();
        setError('');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) signedOut.current();
        else setError(err instanceof ApiError && err.status === 0 ? 'Offline: that change was not saved' : 'That change was not saved');
      } finally {
        inFlight.current -= 1;
      }
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    alive.current = true;
    void refresh();
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  return { data, error, mutate, refresh };
}
