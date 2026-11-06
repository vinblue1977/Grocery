import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiError, type Api, type Snapshot } from './api';
import { applyOp, applyOps } from './listState';
import { loadQueue, saveQueue, setPendingCount, type Op } from './queue';
import { loadSnapshot, saveSnapshot } from './snapshotCache';

const POLL_MS = 5000;
const IDLE_MS = 2 * 60 * 1000;
const IDLE_EVERY = 6; // while idle, only every 6th tick polls (30 s)

export interface ListsState {
  data: Snapshot | null;
  error: string;
  /** Edits made on this device that the server has not confirmed yet (shown on screen already, replayed in order). */
  pending: number;
  /** True while queued edits are being sent. */
  sending: boolean;
  /** True when the last request failed for lack of a connection. */
  offline: boolean;
  /** A message about edits that could not be saved, e.g. "1 change could not be saved"; stays until dismissed. */
  problem: string;
  dismissProblem(): void;
  /** Applies `optimistic` to the screen at once, queues `op` and sends the queue in order as soon as there is a connection. */
  mutate(optimistic: (data: Snapshot) => Snapshot, op: Op): Promise<void>;
  refresh(): Promise<void>;
}

const BACKOFF_START_MS = 2000;
const BACKOFF_MAX_MS = 60000;
// A server error (not 'busy') drops the edit only after this many attempts AND this long, so taps and 'online' events that skip the
// backoff can't use the budget up in seconds, and a short outage never loses an edit.
const MAX_ATTEMPTS = 10;
const GIVE_UP_MS = 15 * 60 * 1000;

function send(api: Api, op: Op): Promise<unknown> {
  switch (op.kind) {
    case 'addItem':
      return api.addItem(op.storeId, op.name, op.note, op.id);
    case 'updateItem':
      return api.updateItem(op.id, op.changes);
    case 'deleteItem':
      return api.deleteItem(op.id);
    case 'clearChecked':
      return api.clearChecked(op.storeId);
    case 'addStore':
      return api.addStore(op.name, op.id);
    case 'renameStore':
      return api.renameStore(op.id, op.name);
    case 'deleteStore':
      return api.deleteStore(op.id);
    case 'setFrequent':
      return api.setFrequent(op.storeId, op.name, op.changes);
  }
}

/** Offline, or the server is busy: the edit is fine, so keep retrying however long it takes (the backoff slows it down). */
const isBusy = (status: number) => status === 0 || status === 408 || status === 429 || status === 503;
/** A server error that may be this edit's fault (or a crash it causes): retry, but give up eventually. */
const isSuspect = (status: number) => status >= 500 && status !== 503;

/**
 * Keeps the household's lists in sync: fetches on open and every 5 s while the app is visible and in use (every 30 s when
 * idle), and re-fetches when it comes back to the foreground. Edits show at once, go into a queue saved on this device and
 * are sent strictly in order; with no signal they wait and are replayed when it returns. A fresh server list never wipes
 * queued edits: they are laid back on top of it.
 */
export function useLists(api: Api, onSignedOut: () => void, householdId?: string): ListsState {
  // The queue left from before a restart is sent first; the last list this device saw (for this household only) shows
  // at once with those edits on top, and stays if the first sync fails offline.
  const queue = useRef<Op[] | null>(null);
  if (queue.current === null) queue.current = householdId ? loadQueue(householdId) : [];
  const [cached] = useState(() => {
    const saved = householdId ? loadSnapshot(householdId) : null;
    return saved && queue.current ? applyOps(saved, queue.current) : saved;
  });
  const [data, setData] = useState<Snapshot | null>(cached);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(queue.current.length);
  const [sending, setSending] = useState(false);
  const [offline, setOffline] = useState(false);
  const [problem, setProblem] = useState('');
  const dataRef = useRef<Snapshot | null>(cached);
  const server = useRef<Snapshot | null>(householdId ? loadSnapshot(householdId) : null); // last list the server sent, without queued edits
  const inFlight = useRef(0);
  const alive = useRef(true);
  const gen = useRef(0); // bumps on unmount, so a send that resolves late can't save or send anything more
  const attempts = useRef<{ op: Op | null; count: number; since: number }>({ op: null, count: 0, since: 0 }); // failed server answers for the op at the front
  const draining = useRef(false); // one drain loop at a time, so ops are never sent twice or out of order
  const failures = useRef(0);
  const retryAt = useRef(0); // earliest time a timer-driven drain may try again after a transient failure
  const requestSeq = useRef(0); // only the newest sync may update the screen, so a slow old one can't overwrite newer data
  const editSeq = useRef(0); // bumps whenever an edit starts or ends, so a sync that began before it is discarded
  // Callers pass a fresh function every render; holding it in a ref keeps `refresh` stable so the polling effect runs once.
  const signedOut = useRef(onSignedOut);
  signedOut.current = onSignedOut;

  const show = (next: Snapshot | null) => {
    dataRef.current = next;
    setData(next);
  };

  const setQueue = (ops: Op[]) => {
    queue.current = ops;
    if (householdId && alive.current) saveQueue(householdId, ops); // never re-save after sign-out or unmount
    setPendingCount(ops.length);
    if (alive.current) setPending(ops.length);
  };

  const refresh = useCallback(async () => {
    if (inFlight.current > 0) return;
    const mine = ++requestSeq.current;
    const edits = editSeq.current;
    try {
      const next = await api.sync();
      if (alive.current && mine === requestSeq.current && edits === editSeq.current && inFlight.current === 0) {
        server.current = next;
        show(applyOps(next, queue.current ?? [])); // edits still waiting to be sent stay on screen
        if (householdId) saveSnapshot(householdId, next);
        setError('');
        setOffline(false);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) signedOut.current();
      else if (alive.current) {
        const off = err instanceof ApiError && err.status === 0;
        setOffline(off);
        setError(off ? 'Offline: showing the last list' : 'Could not sync');
      }
    }
  }, [api, householdId]);

  /** Sends the queue in order. `force` ignores the retry backoff (a tap, the connection returning, the app waking up). */
  const drain = useCallback(
    async (force = true) => {
      if (!alive.current || draining.current || !queue.current?.length || (!force && Date.now() < retryAt.current)) return;
      draining.current = true;
      inFlight.current += 1;
      editSeq.current += 1;
      setSending(true);
      const mine = gen.current;
      const stale = () => !alive.current || mine !== gen.current;
      let dropped = 0;
      let sent = 0;
      let removed = 0; // ops that left the queue for any reason
      try {
        while (queue.current.length > 0) {
          const op = queue.current[0] as Op;
          let drop = false;
          try {
            await send(api, op);
            if (stale()) break;
            sent += 1;
            if (server.current) server.current = applyOp(server.current, op); // confirmed: it belongs to the base list now
          } catch (err) {
            if (stale()) break;
            const status = err instanceof ApiError ? err.status : -1;
            if (status === 401) {
              signedOut.current(); // sign-out clears the queue; a revoked device could not send it anyway
              break;
            }
            if (isBusy(status) || isSuspect(status)) {
              if (isSuspect(status)) {
                const a = attempts.current.op === op ? attempts.current : { op, count: 0, since: Date.now() };
                attempts.current = { ...a, count: a.count + 1 };
              } else {
                attempts.current = { op: null, count: 0, since: 0 }; // busy or offline ends the run: only consecutive errors count
              }
              const a = attempts.current;
              if (a.op === op && a.count >= MAX_ATTEMPTS && Date.now() - a.since >= GIVE_UP_MS) {
                drop = true; // it keeps failing on this one edit; don't let it block the rest forever
              } else {
                failures.current += 1;
                retryAt.current = Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** (failures.current - 1));
                setOffline(status === 0);
                break;
              }
            } else {
              drop = true; // refused (a 4xx), or an error that is not a server answer at all (a bug): retrying would never help
            }
            // A 404 on anything but an add means the other person already removed the target: nothing left to do.
            if (drop && !(status === 404 && op.kind !== 'addItem')) dropped += 1;
          }
          failures.current = 0;
          retryAt.current = 0;
          attempts.current = { op: null, count: 0, since: 0 };
          if (!drop) setOffline(false);
          setQueue(queue.current.slice(1));
          removed += 1;
        }
      } finally {
        draining.current = false;
        inFlight.current -= 1;
        editSeq.current += 1;
        if (alive.current) setSending(false);
      }
      if (stale()) return;
      // Never restore an old snapshot (that would wipe edits made meanwhile): rebuild from the server's list plus what is still queued.
      if (server.current && removed > 0) {
        show(applyOps(server.current, queue.current ?? []));
        if (householdId && sent > 0) saveSnapshot(householdId, server.current);
      }
      if (dropped > 0) {
        setProblem(`${dropped} change${dropped === 1 ? '' : 's'} could not be saved`);
      }
      if (removed > 0) await refresh(); // pick up what the server really has; if offline the screen is already right
    },
    [api, refresh, householdId],
  );

  const mutate = useCallback<ListsState['mutate']>(
    async (optimistic, op) => {
      if (dataRef.current) show(optimistic(dataRef.current));
      editSeq.current += 1;
      setQueue([...(queue.current ?? []), op]);
      await drain();
    },
    [drain, householdId],
  );

  useEffect(() => {
    alive.current = true;
    setPendingCount(queue.current?.length ?? 0); // the queue restored from before a restart
    let lastActive = Date.now();
    let ticks = 0;
    void drain();
    void refresh();
    const touch = () => {
      lastActive = Date.now();
    };
    // Polls every 5 s while someone is using the app, and every 30 s once it has sat untouched for two minutes.
    const tick = () => {
      ticks += 1;
      const idle = Date.now() - lastActive > IDLE_MS;
      if (document.visibilityState === 'visible' && (!idle || ticks % IDLE_EVERY === 0)) {
        void drain(false);
        void refresh();
      }
    };
    const wake = () => {
      touch();
      if (document.visibilityState === 'visible') {
        void drain();
        void refresh();
      }
    };
    const online = () => {
      void drain();
      void refresh();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', online);
    document.addEventListener('pointerdown', touch);
    document.addEventListener('keydown', touch);
    return () => {
      alive.current = false;
      gen.current += 1;
      setPendingCount(0);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', online);
      document.removeEventListener('pointerdown', touch);
      document.removeEventListener('keydown', touch);
    };
  }, [refresh, drain]);

  const dismissProblem = useCallback(() => setProblem(''), []);

  return { data, error, pending, sending, offline, problem, dismissProblem, mutate, refresh };
}
