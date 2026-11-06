import { useState } from 'preact/hooks';
import type { Api } from './api';
import { forStore, pickStore, withChecked, withNewItem, withoutChecked, withoutItem } from './listState';
import type { Session } from './session';
import type { ListsState } from './useLists';

const LAST_STORE = 'grocery.store';

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
}

export function Lists({ api, lists, session }: Props) {
  const [wanted, setWanted] = useState<string | null>(remembered);
  const [text, setText] = useState('');
  const [addingStore, setAddingStore] = useState(false);
  const [storeName, setStoreName] = useState('');
  const { data, error, mutate } = lists;

  if (!data) return <main class="app">{error ? <p class="error">{error}</p> : <p class="muted">Loading…</p>}</main>;

  const storeId = pickStore(data.stores, wanted);
  const { toBuy, inCart } = storeId ? forStore(data.items, storeId) : { toBuy: [], inCart: [] };

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
      (d) => withNewItem(d, `tmp-${Date.now()}`, storeId, clean, session.deviceName),
      () => api.addItem(storeId, clean),
    );
  };

  const addStore = async (event: Event) => {
    event.preventDefault();
    const name = storeName.trim();
    if (!name) return;
    setStoreName('');
    setAddingStore(false);
    await mutate(
      (d) => d,
      async () => choose((await api.addStore(name)).id),
    );
  };

  return (
    <main class="app">
      <h1>Grocery</h1>
      <div class="tabs" role="tablist">
        {data.stores.map((store) => (
          <button key={store.id} type="button" role="tab" class="tab" aria-selected={store.id === storeId} onClick={() => choose(store.id)}>
            {store.name}
          </button>
        ))}
        <button type="button" class="tab" aria-label="Add a store" onClick={() => setAddingStore(!addingStore)}>
          ＋
        </button>
      </div>
      {addingStore && (
        <form class="add" onSubmit={(e) => void addStore(e)}>
          <input value={storeName} maxLength={80} placeholder="Store name" onInput={(e) => setStoreName(e.currentTarget.value)} />
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
              add(text);
            }}
          >
            <input
              value={text}
              maxLength={80}
              enterkeyhint="done"
              placeholder={`Add item to ${data.stores.find((s) => s.id === storeId)?.name ?? ''}…`}
              onInput={(e) => setText(e.currentTarget.value)}
            />
            <button type="submit" class="plus" aria-label="Add item">
              ＋
            </button>
          </form>

          <section aria-label="To buy">
            <div class="sec">To buy · {toBuy.length}</div>
            {toBuy.length === 0 && <p class="muted">Nothing to buy here.</p>}
            {toBuy.map((item) => (
              <div class="it" key={item.id}>
                <button
                  type="button"
                  class="ck"
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
      {error && <p class="muted status">{error}</p>}
    </main>
  );
}
