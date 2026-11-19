import { useEffect, useRef, useState } from 'preact/hooks';
import { ApiError, type Api, type NewItem, type Store } from './api';
import { listen, splitSpoken, type Listening, type VoiceError } from './voice';

interface Row {
  key: number;
  name: string;
  storeId: string;
  keep: boolean;
}

interface Props {
  api: Api;
  stores: Store[];
  currentStoreId: string | null;
  onClose: () => void;
  onAdded: (result: { added: number; skipped: number }) => void;
}

const MESSAGES: Record<VoiceError, string> = {
  denied: 'Microphone access is off. Allow it in your browser settings, or use the keyboard microphone.',
  none: "I didn't catch that.",
  unsupported: 'This browser cannot listen. Use the keyboard microphone instead.',
  failed: 'Could not understand that.',
};

/** Listens for a spoken list, then lets the person fix and confirm the items. Nothing is added until they tap Add. */
export function VoiceSheet({ api, stores, currentStoreId, onClose, onAdded }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<VoiceError | ''>('');
  const [addError, setAddError] = useState('');
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0); // bumped by Try again to listen once more
  const latest = useRef({ stores, currentStoreId });
  latest.current = { stores, currentStoreId };
  const listening = useRef<Listening | null>(null);

  useEffect(() => {
    setError('');
    setRows(null);
    listening.current = listen(
      (text) => {
        const { stores: all, currentStoreId: current } = latest.current;
        const fallback = (all.some((s) => s.id === current) && current) || all[0]?.id || '';
        const names = splitSpoken(text);
        if (names.length === 0) setError('none');
        else setRows(names.map((name, key) => ({ key, name, storeId: fallback, keep: true })));
      },
      (why) => setError(why),
    );
    return () => listening.current?.cancel();
  }, [round]);

  const change = (key: number, patch: Partial<Row>) => setRows((all) => all?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);
  // A store deleted on another phone while this is open: its rows move to the first store left, as the select shows.
  const storeOf = (row: Row) => (stores.some((s) => s.id === row.storeId) ? row.storeId : (stores[0]?.id ?? ''));
  const chosen = (rows ?? []).filter((r) => r.keep && r.name.trim());

  const add = async () => {
    setBusy(true);
    setAddError('');
    const items: NewItem[] = chosen.map((r) => ({ name: r.name.trim(), note: '', storeId: storeOf(r) }));
    try {
      onAdded(await api.addItems(items));
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : 'Could not add the items');
      setBusy(false);
    }
  };

  return (
    <div class="sheet" role="dialog" aria-label="Voice list">
      {!rows && !error && (
        <div class="reading">
          <div class="mic-pulse" aria-hidden="true">
            🎤
          </div>
          <p>Listening…</p>
          <small class="muted">Say everything in one go: “milk, eggs and bread”</small>
          <button type="button" class="primary" onClick={() => listening.current?.stop()}>
            Stop
          </button>
        </div>
      )}
      {error && !rows && (
        <div class="reading">
          <p class="error">{MESSAGES[error]}</p>
          {error !== 'unsupported' && error !== 'denied' && (
            <button type="button" class="primary" onClick={() => setRound(round + 1)}>
              Try again
            </button>
          )}
        </div>
      )}
      {rows && (
        <>
          <h2>{`Heard ${rows.length} item${rows.length === 1 ? '' : 's'}`}</h2>
          <p class="muted">Untick anything wrong. Fix a name if it was misheard. Change the store if needed.</p>
          <div class="found">
            {rows.map((row) => (
              <div class="r" key={row.key}>
                <input type="checkbox" aria-label={`Add ${row.name}`} checked={row.keep} onChange={(e) => change(row.key, { keep: e.currentTarget.checked })} />
                <span class="n">
                  <input value={row.name} maxLength={80} aria-label="Item name" onInput={(e) => change(row.key, { name: e.currentTarget.value })} />
                </span>
                <select aria-label={`Store for ${row.name}`} value={storeOf(row)} onChange={(e) => change(row.key, { storeId: e.currentTarget.value })}>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {addError && <p class="error">{addError}</p>}
          <button type="button" class="primary" disabled={busy || chosen.length === 0} onClick={() => void add()}>
            {busy ? 'Adding…' : `Add ${chosen.length} item${chosen.length === 1 ? '' : 's'}`}
          </button>
          <button type="button" class="ghost" disabled={busy} onClick={() => setRound(round + 1)}>
            Try again
          </button>
        </>
      )}
      <button type="button" class="ghost" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
