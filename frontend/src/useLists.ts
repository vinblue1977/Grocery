import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiError, type Api, type Snapshot } from './api';
import { loadSnapshot, saveSnapshot } from './snapshotCache';

const POLL_MS = 5000;
const IDLE_MS = 2 * 60 * 1000;
const IDLE_EVERY = 6; // while idle, only every 6th tick polls (30 s)

export interface ListsState {
  data: Snapshot | null;
  error: string;
  /** Applies `optimistic` to the screen at once, sends `request`, then re-syncs (which also repairs a failed edit). */
  mutate(optimistic: (data: Snapshot) => Snapshot, request: () => Promise<unknown>): Promise<void>;
  refresh(): Promise<void>;
}

/**
 * Keeps the household's lists in sync: fetches on open and every 5 s while the app is visible and in use (every 30 s when
 * idle), and re-fetches when it comes back to the foreground. A poll that overlaps an edit is discarded, and a failed
 * edit is undone on screen, so the list never shows something the server doesn't have.
 */
export function useLists(api: Api, onSignedOut: () => void, householdId?: string): ListsState {
  // The last list this device saw (for this household only) shows at once, and stays if the first sync fails offline.
  const [cached] = useState(() => (householdId ? loadSnapshot(householdId) : null));
  const [data, setData] = useState<Snapshot | null>(cached);
  const [error, setError] = useState('');
  const dataRef = useRef<Snapshot | null>(cached);
  const inFlight = useRef(0);
  const alive = useRef(true);
  const requestSeq = useRef(0); // only the newest sync may update the screen, so a slow old one can't overwrite newer data
  const editSeq = useRef(0); // bumps whenever an edit starts or ends, so a sync that began before it is discarded
  // Callers pass a fresh function every render; holding it in a ref keeps `refresh` stable so the polling effect runs once.
  const signedOut = useRef(onSignedOut);
  signedOut.current = onSignedOut;

  const show = (next: Snapshot | null) => {
    dataRef.current = next;
    setData(next);
  };

  const refresh = useCallback(async () => {
    if (inFlight.current > 0) return;
    const mine = ++requestSeq.current;
    const edits = editSeq.current;
    try {
      const next = await api.sync();
      if (alive.current && mine === requestSeq.current && edits === editSeq.current && inFlight.current === 0) {
        show(next);
        if (householdId) saveSnapshot(householdId, next);
        setError('');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) signedOut.current();
      else if (alive.current) setError(err instanceof ApiError && err.status === 0 ? 'Offline: showing the last list' : 'Could not sync');
    }
  }, [api, householdId]);

  const mutate = useCallback<ListsState['mutate']>(
    async (optimistic, request) => {
      const before = dataRef.current;
      if (before) show(optimistic(before));
      inFlight.current += 1;
      editSeq.current += 1;
      let failure = '';
      try {
        await request();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) signedOut.current();
        failure = err instanceof ApiError && err.status === 0 ? 'Offline: that change was not saved' : 'That change was not saved';
        if (before) show(before); // undo the instant edit; the sync below then restores whatever the server really has
      } finally {
        inFlight.current -= 1;
        editSeq.current += 1;
      }
      await refresh();
      if (failure && alive.current) setError(failure); // refresh clears errors on success, so say what failed afterwards
    },
    [refresh],
  );

  useEffect(() => {
    alive.current = true;
    let lastActive = Date.now();
    let ticks = 0;
    void refresh();
    const touch = () => {
      lastActive = Date.now();
    };
    // Polls every 5 s while someone is using the app, and every 30 s once it has sat untouched for two minutes.
    const tick = () => {
      ticks += 1;
      const idle = Date.now() - lastActive > IDLE_MS;
      if (document.visibilityState === 'visible' && (!idle || ticks % IDLE_EVERY === 0)) void refresh();
    };
    const wake = () => {
      touch();
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', wake);
    document.addEventListener('pointerdown', touch);
    document.addEventListener('keydown', touch);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      document.removeEventListener('pointerdown', touch);
      document.removeEventListener('keydown', touch);
    };
  }, [refresh]);

  return { data, error, mutate, refresh };
}
