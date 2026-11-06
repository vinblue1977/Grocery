import { useEffect, useRef, useState } from 'preact/hooks';
import type { Api } from './api';
import { forStore, pickStore, suggestionsFor, withChecked, withNewItem, withoutChecked, withoutFrequent, withoutItem, withPinned } from './listState';
import type { Session } from './session';
import { ScanSheet } from './ScanSheet';
import type { ListsState } from './useLists';

const LAST_STORE = 'grocery.store';
let tempCount = 0; // gives each not-yet-saved item a unique placeholder id

function remembered(): string | null {
  try {
    return localStorage.getItem(LAST_STORE);
  } catch {
    return null;
  }
}

interface Props {
  api: Api;
  lists: ListsState;
  session: Session;
  onOpenSettings: () => void;
}

export function Lists({ api, lists, session, onOpenSettings }: Props) {
  const [wanted, setWanted] = useState<string | null>(remembered);
  const [text, setText] = useState('');
  const [addingStore, setAddingStore] = useState(false);
  const [editingOften, setEditingOften] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [notice, setNotice] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const itemInput = useRef<HTMLInputElement>(null);
  const storeInput = useRef<HTMLInputElement>(null);
  const { data, error, mutate } = lists;

  useEffect(() => {
    if (addingStore) storeInput.current?.focus(); // once, when the box opens; not on every refresh
  }, [addingStore]);

  const header = (
    <header class="top">
      <h1>Grocery</h1>
      <button type="button" class="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="8" cy="17" r="2" />
        </svg>
      </button>
    </header>
  );

  if (!data) {
    return (
      <main class="app">
        {header}
        {error ? <p class="error">{error}</p> : <p class="muted">Loading…</p>}
      </main>
    );
  }

  const storeId = pickStore(data.stores, wanted);
  const { toBuy, inCart } = storeId ? forStore(data.items, storeId) : { toBuy: [], inCart: [] };
  const editing = editingOften && !text.trim(); // typing means adding, so Edit mode steps aside
  const often = storeId ? suggestionsFor(data, storeId, text, editing) : [];

  const choose = (id: string) => {
    setWanted(id);
    try {
      localStorage.setItem(LAST_STORE, id);
    } catch {
      // Not remembering the last store is fine.
    }
  };

  const add = (name: string) => {
    const clean = name.trim();
    if (!clean || !storeId) return;
    setText('');
    void mutate(
      (d) => withNewItem(d, `tmp-${++tempCount}`, storeId, clean, session.deviceName),
      () => api.addItem(storeId, clean),
    );
  };

  const closeStoreForm = () => {
    setStoreName('');
    setAddingStore(false);
  };

  const addStore = async (event: Event) => {
    event.preventDefault();
    const name = storeName.trim();
    if (!name) return;
    closeStoreForm();
    await mutate(
      (d) => d,
      async () => choose((await api.addStore(name)).id),
    );
  };

  return (
    <main class="app">
      {header}
      <div class="tabs" role="tablist">
        {data.stores.map((store) => (
          <button key={store.id} type="button" role="tab" class="tab" aria-selected={store.id === storeId} onClick={() => choose(store.id)}>
            {store.name}
          </button>
        ))}
        <button type="button" class="tab" aria-label="Add a store" onClick={() => (addingStore ? closeStoreForm() : setAddingStore(true))}>
          ＋
        </button>
      </div>
      {addingStore && (
        <form class="add" onSubmit={(e) => void addStore(e)} onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.isComposing) closeStoreForm();
        }}>
          <input
            ref={storeInput}
            value={storeName}
            maxLength={80}
            placeholder="Store name"
            onInput={(e) => setStoreName(e.currentTarget.value)}
          />
          <button type="button" onClick={closeStoreForm}>
            Cancel
          </button>
          <button type="submit">Add</button>
        </form>
      )}

      {!storeId ? (
        <p class="muted">No stores yet. Tap ＋ to add one.</p>
      ) : (
        <>
          <form
            class="add"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) add(text);
              else itemInput.current?.focus(); // nothing typed: bring up the keyboard instead of doing nothing
            }}
          >
            <input
              ref={itemInput}
              value={text}
              maxLength={80}
              enterkeyhint="done"
              placeholder={`Add item to ${data.stores.find((s) => s.id === storeId)?.name ?? ''}…`}
              onInput={(e) => setText(e.currentTarget.value)}
            />
            <button type="button" class="camera" aria-label="Add from a photo of a paper list" onClick={() => picker.current?.click()}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            </button>
            <button type="submit" class="plus" aria-label="Add item">
              ＋
            </button>
          </form>

          {(often.length > 0 || editing) && (
            <section aria-label="Often bought">
              <div class="oh">
                <span>Often</span>
                {!text.trim() && (
                  <button type="button" class="link-btn" onClick={() => setEditingOften(!editing)}>
                    {editing ? 'Done' : 'Edit'}
                  </button>
                )}
              </div>
              <div class={editing ? 'chips wrap' : 'chips'}>
                {often.length === 0 && <span class="muted">Nothing yet: items you add 3 times show up here.</span>}
                {often.map((f) =>
                  editing ? (
                    <span class={f.pinned ? 'chip pin' : 'chip'} key={f.name}>
                      {f.name}
                      <button
                        type="button"
                        class={f.pinned ? 'pinbtn on' : 'pinbtn'}
                        aria-label={`${f.pinned ? 'Unpin' : 'Pin'} ${f.name}`}
                        onClick={() => void mutate((d) => withPinned(d, storeId, f.name, !f.pinned), () => api.setFrequent(storeId, f.name, { pinned: !f.pinned }))}
                      >
                        📌
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${f.name} from suggestions`}
                        onClick={() => void mutate((d) => withoutFrequent(d, storeId, f.name), () => api.setFrequent(storeId, f.name, { hidden: true }))}
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <button type="button" class="chip" key={f.name} aria-label={`Add ${f.name}`} onClick={() => add(f.name)}>
                      {f.name}
                    </button>
                  ),
                )}
              </div>
            </section>
          )}

          <section aria-label="To buy">
            <div class="sec">To buy · {toBuy.length}</div>
            {toBuy.length === 0 && <p class="muted">Nothing to buy here.</p>}
            {toBuy.map((item) => (
              <div class="it" key={item.id}>
                <button
                  type="button"
                  class="ck"
                  disabled={item.id.startsWith('tmp-')}
                  aria-label={`Check off ${item.name}`}
                  onClick={() => void mutate((d) => withChecked(d, item.id, true), () => api.updateItem(item.id, { checked: true }))}
                />
                <span class="nm">
                  {item.name}
                  {item.note && <small class="muted"> {item.note}</small>}
                </span>
                <small class="by">{item.addedBy}</small>
                <button
                  type="button"
                  class="x"
                  disabled={item.id.startsWith('tmp-')}
                  aria-label={`Delete ${item.name}`}
                  onClick={() => void mutate((d) => withoutItem(d, item.id), () => api.deleteItem(item.id))}
                >
                  ✕
                </button>
              </div>
            ))}
          </section>

          {inCart.length > 0 && (
            <section aria-label="In cart">
              <div class="sec">
                <span>In cart · {inCart.length}</span>
                <button type="button" class="link-btn" onClick={() => void mutate((d) => withoutChecked(d, storeId), () => api.clearChecked(storeId))}>
                  Clear
                </button>
              </div>
              {inCart.map((item) => (
                <div class="it done" key={item.id}>
                  <button
                    type="button"
                    class="ck on"
                    aria-label={`Put ${item.name} back`}
                    onClick={() => void mutate((d) => withChecked(d, item.id, false), () => api.updateItem(item.id, { checked: false }))}
                  >
                    ✓
                  </button>
                  <span class="nm">{item.name}</span>
                </div>
              ))}
            </section>
          )}
        </>
      )}
      <input
        ref={picker}
        type="file"
        accept="image/*"
        hidden
        data-testid="photo"
        onChange={(e) => {
          setNotice('');
          setPhoto(e.currentTarget.files?.[0] ?? null);
          e.currentTarget.value = ''; // so choosing the same photo again still fires
        }}
      />
      {photo && (
        <ScanSheet
          api={api}
          file={photo}
          stores={data.stores}
          currentStoreId={storeId}
          onClose={() => setPhoto(null)}
          onAdded={({ added, skipped }) => {
            setPhoto(null);
            setNotice(`Added ${added} item${added === 1 ? '' : 's'}${skipped ? `, ${skipped} already on the list` : ''}`);
            void lists.refresh();
            setTimeout(() => setNotice(''), 6000);
          }}
        />
      )}
      {notice && <p class="notice">{notice}</p>}
      {error && <p class="muted status">{error}</p>}
    </main>
  );
}
