import { useEffect, useRef, useState } from 'preact/hooks';
import type { Api, Item } from './api';
import { Celebration } from './Celebration';
import { EditSheet, type ItemChanges } from './EditSheet';
import { emojiFor } from './emoji';
import { newId } from './ids';
import { arrivalFromOthers } from './news';
import { avatarColor, firstWord, greeting, initial } from './people';
import { DAY_MS, forStore, isLastToBuy, isResting, withItemUpdate, nextStore, pickStore, suggestionsFor, withChecked, withNewItem, withNewStore, withoutChecked, withEditedItem, withoutFrequent, withoutItem, withPinned } from './listState';
import type { Session } from './session';
import { ScanSheet } from './ScanSheet';
import { SwipeRow } from './SwipeRow';
import type { ListsState } from './useLists';
import { useWakeLock } from './useWakeLock';

const repeatLabel = (days: number) => (days === 7 ? 'weekly' : days === 14 ? 'every 2 weeks' : days === 30 ? 'monthly' : '');
const dayLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

const changes = (n: number) => `${n} change${n === 1 ? '' : 's'}`;

const LAST_STORE = 'grocery.store';
const ALL = 'all'; // the consolidated tab; remembered in the same place as a store id
const TOAST_MS = 5000;
const FRESH_MS = 4000;
const CLEARED_MS = 6000;
const UNDO_MS = 6000; // a delete is only sent once this has passed without Undo

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
  const [toast, setToast] = useState<{ text: string; storeId?: string; undo?: () => void } | null>(null);
  const [undoBar, setUndoBar] = useState<{ text: string; run: () => void } | null>(null);
  const [showResting, setShowResting] = useState(false);
  const [gone, setGone] = useState<Set<string>>(new Set()); // ids deleted on screen that Undo can still bring back
  const [fresh, setFresh] = useState<string[]>([]); // ids another person just added, highlighted for a moment
  const [celebrating, setCelebrating] = useState<string | null>(null); // store whose last item was just ticked
  const [cleared, setCleared] = useState<string | null>(null); // store whose cart was just cleared
  const [popped, setPopped] = useState<Set<string>>(new Set()); // items just ticked, for the pop animation
  const seen = useRef<Item[] | null>(null); // items at the previous sync; null until the first load
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const trash = useRef<{ ids: string[]; commit: () => void; restore: () => void } | null>(null);
  const dataRef = useRef<ListsState['data']>(null);
  const trashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const freshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clearedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const popTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const picker = useRef<HTMLInputElement>(null);
  const itemInput = useRef<HTMLInputElement>(null);
  const storeInput = useRef<HTMLInputElement>(null);
  const { data, serverSnapshot, error, mutate, pending, sending, offline, problem, dismissProblem } = lists;
  const [editingId, setEditingId] = useState<string | null>(null);
  dataRef.current = data;

  // A store chosen when it was added but never created (the add was refused) must not linger as the remembered selection.
  const stores = data?.stores;
  useEffect(() => {
    if (!stores || pending > 0 || !wanted || (wanted === ALL && stores.length > 1) || stores.some((s) => s.id === wanted)) return; // 'all' only stands while there are two stores
    setWanted(null);
    try {
      localStorage.removeItem(LAST_STORE);
    } catch {
      // Nothing remembered to forget.
    }
  }, [stores, pending, wanted]);

  useEffect(() => {
    if (addingStore) storeInput.current?.focus(); // once, when the box opens; not on every refresh
  }, [addingStore]);

  const say = (text: string, storeId?: string) => {
    clearTimeout(toastTimer.current);
    setToast({ text, storeId });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  // A delete shows at once but is only sent after UNDO_MS, so Undo is just "never send it". A second delete, leaving the
  // app, or the timer ending sends the first one straight away.
  const commitTrash = () => {
    clearTimeout(trashTimer.current);
    const t = trash.current;
    trash.current = null;
    if (!t) return;
    setUndoBar(null);
    t.commit(); // takes the items out of the list for real (and puts them back if the server refuses)...
    setGone((old) => new Set([...old].filter((id) => !t.ids.includes(id)))); // ...so they no longer need hiding
  };
  const trashItems = (ids: string[], text: string, commit: () => void, restore: () => void) => {
    commitTrash();
    setGone((old) => new Set([...old, ...ids]));
    trash.current = {
      ids,
      commit,
      restore: () => {
        setGone((old) => new Set([...old].filter((id) => !ids.includes(id))));
        restore();
      },
    };
    trashTimer.current = setTimeout(commitTrash, UNDO_MS);
    setUndoBar({
      text,
      run: () => {
        clearTimeout(trashTimer.current);
        const t = trash.current;
        trash.current = null;
        setUndoBar(null);
        t?.restore();
      },
    });
  };

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden') commitTrash();
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', commitTrash);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', commitTrash);
    };
  }, []);


  useEffect(() => {
    const pops = popTimers.current;
    return () => {
      for (const t of [toastTimer, freshTimer, clearedTimer, noticeTimer, trashTimer]) clearTimeout(t.current);
      for (const t of pops.values()) clearTimeout(t);
    };
  }, []);

  // The celebration only belongs to a store that is still empty of to-buy items. A tick waiting offline still celebrates.
  useEffect(() => {
    if (celebrating && data?.items.some((i) => i.storeId === celebrating && !i.checked && !isResting(i))) setCelebrating(null);
  }, [data, celebrating]);

  // A NEW "could not be saved" message means the queue gave up on an edit (the tick is rolled back), so the card goes; an old
  // banner that is still showing must not cancel a celebration.
  useEffect(() => {
    if (problem) setCelebrating(null);
  }, [problem]);

  // News comes only from what the server sent (never the cache, never queued edits shown on top). The first such list is just
  // the baseline; every later one is compared with the one before, however old the items are.
  useEffect(() => {
    if (!serverSnapshot) return;
    const before = seen.current;
    seen.current = serverSnapshot.items;
    if (!before) return;
    const arrival = arrivalFromOthers(before, serverSnapshot.items, session.person);
    if (!arrival) return;
    const store = serverSnapshot.stores.find((s) => s.id === arrival.storeId)?.name ?? 'the list';
    const where = arrival.storeCount === 1 ? ` to ${store}` : '';
    say(`${arrival.by} added ${arrival.count} item${arrival.count === 1 ? '' : 's'}${where}`, arrival.storeId);
    setFresh((old) => [...old, ...arrival.ids]); // overlapping batches merge and share one timer
    clearTimeout(freshTimer.current);
    freshTimer.current = setTimeout(() => setFresh([]), FRESH_MS);
  }, [serverSnapshot]);

  // Shopping: a store with something on its list keeps the screen awake, so the phone stays lit while pushing the cart.
  const wakeStore = data ? pickStore(data.stores, wanted) : null;
  const wakeAll = wanted === ALL && !!data && data.stores.length > 1;
  useWakeLock(!!data && (wakeAll ? data.items.some((i) => !isResting(i)) : !!wakeStore && data.items.some((i) => i.storeId === wakeStore && !isResting(i))));

  const hi = greeting(new Date().getHours(), session.person);
  const header = (
    <header class="top">
      <div>
        <h1>Grocery</h1>
        <div class="hi">
          {hi.text} <span aria-hidden="true">{hi.emoji}</span>
        </div>
      </div>
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

  // Items hidden while Undo is possible vanish, except bought repeating ones, which already show as coming back.
  const shown = gone.size
    ? data.items.flatMap((i): Item[] => {
        if (!gone.has(i.id)) return [i];
        const days = i.repeatDays ?? 0;
        return i.checked && days > 0 && !isResting(i) ? [{ ...i, checked: false, returnsAt: Date.now() + days * DAY_MS }] : [];
      })
    : data.items;
  const view = shown === data.items ? data : { ...data, items: shown }; // what is on screen, minus deletes Undo could still bring back
  const all = wanted === ALL && data.stores.length > 1; // the consolidated view needs at least two stores to be worth it
  const storeId = all ? null : pickStore(data.stores, wanted);
  const editingItem = editingId ? shown.find((i) => i.id === editingId) : undefined; // gone if the other phone deleted it
  const { toBuy, inCart, resting } = storeId ? forStore(shown, storeId) : { toBuy: [], inCart: [], resting: [] };
  const editing = editingOften && !text.trim(); // typing means adding, so Edit mode steps aside
  const storeLabel = data.stores.find((s) => s.id === storeId)?.name ?? '';
  const next = storeId ? nextStore(data.stores, storeId) : null;
  const justCleared = cleared === storeId;
  const groups = data.stores.map((store) => ({ store, ...forStore(shown, store.id) }));
  const everything = {
    toBuy: groups.reduce((n, g) => n + g.toBuy.length, 0),
    cart: groups.flatMap((g) => g.inCart.map((item) => ({ item, store: g.store.name }))),
    resting: groups.flatMap((g) => g.resting.map((item) => ({ item, store: g.store.name }))),
  };
  const often = storeId ? suggestionsFor(view, storeId, text, editing) : [];

  const choose = (id: string) => {
    setWanted(id);
    setCelebrating(null);
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
    const id = newId();
    setCelebrating(null);
    setCleared(null);
    clearTimeout(clearedTimer.current);
    void mutate(
      (d) => withNewItem(d, id, storeId, clean, session.person),
      { kind: 'addItem', id, storeId, name: clean, addedBy: session.person },
    );
  };

  // Done shopping for one store (its tab) or for all of them (the All tab).
  const clearCarts = (storeIds: string[]) => {
    const bought = shown.filter((i) => storeIds.includes(i.storeId) && i.checked && !isResting(i));
    if (bought.length === 0) return;
    const n = bought.length;
    const ids = bought.map((i) => i.id);
    const back = bought.filter((i) => (i.repeatDays ?? 0) > 0).length;
    setCelebrating(null);
    if (storeIds.length === 1) {
      setCleared(storeIds[0] ?? null);
      clearTimeout(clearedTimer.current);
      clearedTimer.current = setTimeout(() => setCleared(null), CLEARED_MS);
    }
    trashItems(
      ids,
      `${n} item${n === 1 ? '' : 's'} bought${back ? ` · ${back} will come back` : ''}`,
      () => {
        // Only what was in the cart when Done shopping was tapped goes; an item ticked since then stays (nothing is kept as a purchase history: bought items are deleted).
        for (const sid of storeIds) {
          const mine = bought.filter((i) => i.storeId === sid);
          if (mine.length === 0) continue;
          const ticked = (dataRef.current?.items ?? []).filter((i) => i.storeId === sid && i.checked);
          if (ticked.every((i) => ids.includes(i.id))) {
            void mutate((d) => withoutChecked(d, sid), { kind: 'clearChecked', storeId: sid });
          } else {
            for (const { id } of mine) {
              const repeats = (dataRef.current?.items.find((i) => i.id === id)?.repeatDays ?? 0) > 0;
              if (repeats) void mutate((d) => withItemUpdate(d, id, { resting: true }, Date.now()), { kind: 'updateItem', id, changes: { resting: true } });
              else void mutate((d) => withoutItem(d, id), { kind: 'deleteItem', id });
            }
          }
        }
      },
      () => {
        if (storeIds.length !== 1) return; // only a single-store clear sets the 'cleared' card
        setCleared(null);
        clearTimeout(clearedTimer.current);
      },
    );
  };
  const clearCart = () => {
    if (storeId) clearCarts([storeId]);
  };

  const deleteItem = (item: Item) => {
    trashItems(
      [item.id],
      `${item.name} deleted`,
      () => void mutate((d) => withoutItem(d, item.id), { kind: 'deleteItem', id: item.id }),
      () => undefined,
    );
  };

  const toBuyRow = (item: Item) => (
    <SwipeRow key={item.id} onDelete={() => deleteItem(item)}>
      <div class={fresh.includes(item.id) ? 'it fresh' : 'it'}>
        <button
          type="button"
          class="ck"
          aria-label={`Check off ${item.name}`}
          onClick={() => {
            if (!all && isLastToBuy(shown, item.storeId, item.id)) setCelebrating(item.storeId); // the All tab has no celebration card
            setPopped((old) => new Set(old).add(item.id));
            clearTimeout(popTimers.current.get(item.id));
            popTimers.current.set(
              item.id,
              setTimeout(() => {
                popTimers.current.delete(item.id);
                setPopped((old) => {
                  const next = new Set(old);
                  next.delete(item.id);
                  return next;
                });
              }, 1000),
            );
            void mutate((d) => withChecked(d, item.id, true), { kind: 'updateItem', id: item.id, changes: { checked: true } });
          }}
        />
        <span class="em" aria-hidden="true">
          {emojiFor(item.name)}
        </span>
        <button type="button" class="nm" aria-label={`Edit ${item.name}`} onClick={() => setEditingId(item.id)}>
          {item.name}
          {(item.repeatDays ?? 0) > 0 && (
            <span class="rep" role="img" aria-label={`Repeats ${repeatLabel(item.repeatDays ?? 0)}`}>
              ↻
            </span>
          )}
          {fresh.includes(item.id) && <b class="new">New</b>}
          {item.note && <small class="muted"> {item.note}</small>}
        </button>
        <span class="av" role="img" aria-label={`Added by ${firstWord(item.addedBy)}`} title={item.addedBy} style={{ background: avatarColor(item.addedBy, data.colors) }}>
          {initial(item.addedBy)}
        </span>
        <button
          type="button"
          class="x"
          aria-label={`Delete ${item.name}`}
          onClick={() => deleteItem(item)}
        >
          ✕
        </button>
      </div>
    </SwipeRow>
  );

  const cartRow = (item: Item, tag?: string) => (
    <div class={popped.has(item.id) ? 'it done pop' : 'it done'} key={item.id}>
      <button
        type="button"
        class="ck on"
        aria-label={`Put ${item.name} back`}
        onClick={() => void mutate((d) => withChecked(d, item.id, false), { kind: 'updateItem', id: item.id, changes: { checked: false } })}
      >
        ✓
      </button>
      <span class="em" aria-hidden="true">
        {emojiFor(item.name)}
      </span>
      <span class="nm">{item.name}</span>
      {tag && <span class="store-tag">{tag}</span>}
    </div>
  );

  const restingRow = (item: Item, tag?: string) => (
    <div class="it done" key={item.id}>
      <span class="em" aria-hidden="true">
        {emojiFor(item.name)}
      </span>
      <button type="button" class="nm" aria-label={`Edit ${item.name}`} onClick={() => setEditingId(item.id)}>
        {item.name}
        <small class="muted">
          <br />
          back {dayLabel(item.returnsAt ?? 0)} · {repeatLabel(item.repeatDays ?? 0)}
            {tag ? ` · ${tag}` : ''}
        </small>
      </button>
      <button
        type="button"
        class="again"
        aria-label={`Add ${item.name} now`}
        onClick={() => void mutate((d) => withItemUpdate(d, item.id, { resting: false }, Date.now()), { kind: 'updateItem', id: item.id, changes: { resting: false } })}
      >
        Add now
      </button>
    </div>
  );

  const closeStoreForm = () => {
    setStoreName('');
    setAddingStore(false);
  };

  const addStore = async (event: Event) => {
    event.preventDefault();
    const name = storeName.trim();
    if (!name) return;
    closeStoreForm();
    const id = newId();
    choose(id);
    await mutate(
      (d) => withNewStore(d, id, name),
      { kind: 'addStore', id, name },
    );
  };

  return (
    <main class="app">
      {header}
      <div class="tabs" role="tablist">
        {data.stores.length > 1 && (
          <button type="button" role="tab" class="tab" aria-selected={all} onClick={() => choose(ALL)}>
            All
          </button>
        )}
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

      {all ? (
        <>
          <p class="hint">Pick a store to add items or scan a photo.</p>
          <section aria-label="To buy">
            <div class="sec">To buy · {everything.toBuy}</div>
            {everything.toBuy === 0 && (
              <div class="empty">
                <div class="big" aria-hidden="true">
                  🛒
                </div>
                <p class="line">Nothing to buy anywhere. Suspiciously organised.</p>
              </div>
            )}
            {groups.map(({ store, toBuy: mine }) =>
              mine.length === 0 ? null : (
                <div key={store.id} role="group" aria-label={store.name}>
                  <button type="button" class="grp" aria-label={`Open ${store.name}`} onClick={() => choose(store.id)}>
                    {store.name} · {mine.length} <span aria-hidden="true">›</span>
                  </button>
                  {mine.map(toBuyRow)}
                </div>
              ),
            )}
          </section>
          {everything.cart.length > 0 && (
            <section aria-label="In cart">
              <div class="sec">
                <span>In cart · {everything.cart.length}</span>
                <button type="button" class="link-btn" onClick={() => clearCarts(data.stores.map((s) => s.id))}>
                  Done shopping
                </button>
              </div>
              {everything.cart.map(({ item, store }) => cartRow(item, store))}
            </section>
          )}
          {everything.resting.length > 0 && (
            <section aria-label="Coming back">
              <div class="sec">
                <span>↻ Coming back · {everything.resting.length}</span>
                <button type="button" class="link-btn" aria-expanded={showResting} onClick={() => setShowResting(!showResting)}>
                  {showResting ? 'Hide ›' : 'Show ›'}
                </button>
              </div>
              {showResting && everything.resting.map(({ item, store }) => restingRow(item, store))}
            </section>
          )}
        </>
      ) : !storeId ? (
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
            <button type="button" class="camera" aria-label="Add from a photo of a paper list" disabled={offline || pending > 0} onClick={() => picker.current?.click()}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            </button>
            <button type="submit" class="plus" aria-label="Add item">
              ＋
            </button>
          </form>

          {(offline || pending > 0) && <small class="muted">{offline ? 'Photo scan needs a connection.' : 'Photo scan waits until your changes are sent.'}</small>}

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
                        onClick={() => void mutate((d) => withPinned(d, storeId, f.name, !f.pinned), { kind: 'setFrequent', storeId, name: f.name, changes: { pinned: !f.pinned } })}
                      >
                        📌
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${f.name} from suggestions`}
                        onClick={() => void mutate((d) => withoutFrequent(d, storeId, f.name), { kind: 'setFrequent', storeId, name: f.name, changes: { hidden: true } })}
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <button type="button" class="chip" key={f.name} aria-label={`Add ${f.name}`} onClick={() => add(f.name)}>
                      <span aria-hidden="true">{emojiFor(f.name)}</span> {f.name}
                    </button>
                  ),
                )}
              </div>
            </section>
          )}

          <section aria-label="To buy">
            <div class="sec">To buy · {toBuy.length}</div>
            {toBuy.length === 0 && celebrating === storeId && (
              <Celebration
                store={storeLabel}
                next={next?.name ?? null}
                onNext={() => next && choose(next.id)}
                onClear={clearCart}
                onDismiss={() => setCelebrating(null)}
              />
            )}
            {toBuy.length === 0 && celebrating !== storeId && (
              <div class="empty">
                <div class="big" aria-hidden="true">
                  {justCleared ? '🧺' : '🛒'}
                </div>
                <p class="line">{justCleared ? 'Cart cleared. See you next trip!' : 'Nothing to buy here. Suspiciously organised.'}</p>
                <p class="muted">Type above or tap the camera to add</p>
              </div>
            )}
            {toBuy.map(toBuyRow)}
          </section>

          {inCart.length > 0 && (
            <section aria-label="In cart">
              <div class="sec">
                <span>In cart · {inCart.length}</span>
                <button type="button" class="link-btn" onClick={clearCart}>
                  Done shopping
                </button>
              </div>
              {inCart.map((item) => cartRow(item))}
            </section>
          )}

          {resting.length > 0 && (
            <section aria-label="Coming back">
              <div class="sec">
                <span>↻ Coming back · {resting.length}</span>
                <button type="button" class="link-btn" aria-expanded={showResting} onClick={() => setShowResting(!showResting)}>
                  {showResting ? 'Hide ›' : 'Show ›'}
                </button>
              </div>
              {showResting &&
                resting.map((item) => restingRow(item))}
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
      {editingItem && (
        <EditSheet
          key={editingItem.id}
          item={editingItem}
          stores={data.stores}
          onClose={() => setEditingId(null)}
          onSave={(changes: ItemChanges) => {
            if (isResting(editingItem) && changes.repeatDays === 0) {
              // Stopping the repeat of something already bought leaves nothing to come back: it goes for good.
              void mutate((d) => withoutItem(d, editingItem.id), { kind: 'deleteItem', id: editingItem.id });
              say(`${editingItem.name} will not come back`);
              return;
            }
            void mutate((d) => withEditedItem(d, editingItem.id, changes), { kind: 'updateItem', id: editingItem.id, changes });
            const target = changes.storeId ? data.stores.find((s) => s.id === changes.storeId) : undefined;
            if (target) say(`${changes.name ?? editingItem.name} moved to ${target.name}`, target.id); // the toast has a View button for that store; the item itself leaves this list
          }}
        />
      )}
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
            clearTimeout(noticeTimer.current);
            noticeTimer.current = setTimeout(() => setNotice(''), 6000);
          }}
        />
      )}
      {notice && <p class="notice">{notice}</p>}
      {pending > 0 && (
        <p class="muted status" role="status">
          {sending && !offline ? `Sending ${changes(pending)}` : offline ? `Offline, ${changes(pending)} waiting` : `${changes(pending)} waiting`}
        </p>
      )}
      {error && !(pending > 0 && offline) && <p class="muted status">{error}</p>}
      {problem && (
        <p class="error">
          {problem}{' '}
          <button type="button" class="link-btn" onClick={dismissProblem}>
            Dismiss
          </button>
        </p>
      )}
      <div class="toasts" aria-live="polite">
        {undoBar && (
          <div class="toast">
            <span>{undoBar.text}</span>
            <button type="button" onClick={undoBar.run}>
              Undo
            </button>
          </div>
        )}
        {toast && (
          <div class="toast">
            <span>{toast.text}</span>
            {toast.storeId && (
              <button
                type="button"
                onClick={() => {
                  if (toast.storeId) choose(toast.storeId);
                  setToast(null);
                }}
              >
                View
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
