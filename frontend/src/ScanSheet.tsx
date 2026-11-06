import { useEffect, useState } from 'preact/hooks';
import { ApiError, type Api, type NewItem, type Store } from './api';
import { shrinkPhoto } from './scan';

interface Row {
  key: number;
  name: string;
  note: string;
  storeId: string;
  keep: boolean;
  unsure: boolean;
}

interface Props {
  api: Api;
  file: File;
  stores: Store[];
  currentStoreId: string;
  onClose: () => void;
  onAdded: (result: { added: number; skipped: number }) => void;
}

/** Reads a photo of a paper list, then lets the person fix and confirm the items. Nothing is added until they tap Add. */
export function ScanSheet({ api, file, stores, currentStoreId, onClose, onAdded }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await api.scan(await shrinkPhoto(file));
        if (cancelled) return;
        const known = new Set(stores.map((s) => s.id));
        setRows(
          found.map((item, key) => ({
            key,
            name: item.name,
            note: item.note,
            storeId: item.storeId && known.has(item.storeId) ? item.storeId : currentStoreId,
            keep: !item.unsure,
            unsure: item.unsure,
          })),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not read that photo');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, file, stores, currentStoreId]);

  const change = (key: number, patch: Partial<Row>) => setRows((all) => all?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);
  const chosen = (rows ?? []).filter((r) => r.keep && r.name.trim());

  const add = async () => {
    setBusy(true);
    setError('');
    const items: NewItem[] = chosen.map((r) => ({ name: r.name.trim(), note: r.note, storeId: r.storeId }));
    try {
      onAdded(await api.addItems(items));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the items');
      setBusy(false);
    }
  };

  return (
    <div class="sheet" role="dialog" aria-label="Scanned list">
      {!rows && !error && (
        <div class="reading">
          <div class="spin" />
          <p>Reading your list…</p>
          <small class="muted">Usually takes a few seconds</small>
        </div>
      )}
      {error && !rows && (
        <div class="reading">
          <p class="error">{error}</p>
        </div>
      )}
      {rows && (
        <>
          <h2>{rows.length === 0 ? 'No items found' : `Found ${rows.length} item${rows.length === 1 ? '' : 's'}`}</h2>
          <p class="muted">Untick anything wrong. Fix a name if the handwriting was misread. Change the store if needed.</p>
          <div class="found">
            {rows.map((row) => (
              <div class="r" key={row.key}>
                <input type="checkbox" aria-label={`Add ${row.name}`} checked={row.keep} onChange={(e) => change(row.key, { keep: e.currentTarget.checked })} />
                <span class="n">
                  <input value={row.name} maxLength={80} aria-label="Item name" onInput={(e) => change(row.key, { name: e.currentTarget.value })} />
                  {(row.note || row.unsure) && <small class="muted">{row.unsure ? `unsure of the handwriting ${row.note}` : row.note}</small>}
                </span>
                <select aria-label={`Store for ${row.name}`} value={row.storeId} onChange={(e) => change(row.key, { storeId: e.currentTarget.value })}>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {error && <p class="error">{error}</p>}
          <button type="button" class="primary" disabled={busy || chosen.length === 0} onClick={() => void add()}>
            {busy ? 'Adding…' : `Add ${chosen.length} item${chosen.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
      <button type="button" class="ghost" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
