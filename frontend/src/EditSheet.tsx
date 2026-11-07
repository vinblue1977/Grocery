import { useEffect, useRef, useState } from 'preact/hooks';
import type { Item, Store } from './api';

export const QUICK_NOTES = ['1', '2', '3', '1 lb', '2 lb', 'dozen'];
const MAX_NAME = 80; // the same limits as the server
const MAX_NOTE = 120;

export interface ItemChanges {
  name?: string;
  note?: string;
  storeId?: string;
}

interface Props {
  item: Item;
  stores: Store[];
  /** Only the fields that changed; the sheet closes itself. */
  onSave: (changes: ItemChanges) => void;
  onClose: () => void;
}

/** Edit an item's name, its quantity or note (for example "2 gal") and which store it is on. Quantity is just text in the note. */
export function EditSheet({ item, stores, onSave, onClose }: Props) {
  const [name, setName] = useState(item.name);
  const [note, setNote] = useState(item.note);
  const [storeId, setStoreId] = useState(item.storeId);
  const noteBox = useRef<HTMLInputElement>(null);

  useEffect(() => noteBox.current?.focus(), []); // the quantity is what you usually come to change

  const trimmedName = name.trim();
  const trimmedNote = note.trim();
  const changes: ItemChanges = {
    ...(trimmedName !== item.name ? { name: trimmedName } : {}),
    ...(trimmedNote !== item.note ? { note: trimmedNote } : {}),
    ...(storeId !== item.storeId ? { storeId } : {}),
  };
  const canSave = trimmedName !== '' && Object.keys(changes).length > 0;

  const save = (event: Event) => {
    event.preventDefault();
    if (!canSave) return;
    onSave(changes);
    onClose();
  };

  return (
    <>
      <div class="scrim" onClick={onClose} />
      <div
        class="sheet edit"
        role="dialog"
        aria-label={`Edit ${item.name}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.isComposing) onClose();
        }}
      >
        <form class="stack" onSubmit={save}>
          <h2>Edit item</h2>
          <label class="field">
            <span class="muted">Name</span>
            <input value={name} maxLength={MAX_NAME} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span class="muted">Quantity or note</span>
            <input
              ref={noteBox}
              value={note}
              maxLength={MAX_NOTE}
              placeholder="e.g. 2 gal, ripe ones"
              onInput={(e) => setNote(e.currentTarget.value)}
            />
          </label>
          <div class="chips wrap" aria-label="Quick quantities">
            {QUICK_NOTES.map((quick) => (
              <button type="button" class="chip" key={quick} onClick={() => setNote(quick)}>
                {quick}
              </button>
            ))}
          </div>
          {stores.length > 1 && (
            <div class="field">
              <span class="muted">Store</span>
              <div class="chips wrap" role="group" aria-label="Store">
                {stores.map((store) => (
                  <button
                    type="button"
                    class={store.id === storeId ? 'chip on' : 'chip'}
                    key={store.id}
                    aria-pressed={store.id === storeId}
                    onClick={() => setStoreId(store.id)}
                  >
                    {store.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div class="row">
            <button type="button" class="ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" class="primary" disabled={!canSave}>
              Save
            </button>
          </div>
          <small class="muted">Saves for both phones, and works offline.</small>
        </form>
      </div>
    </>
  );
}
