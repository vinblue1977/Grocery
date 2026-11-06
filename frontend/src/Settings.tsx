import { useEffect, useState } from 'preact/hooks';
import { ApiError, type Api, type Device } from './api';
import { buildInviteLink } from './invite';
import { withoutStore, withRenamedStore } from './listState';
import type { Session } from './session';
import type { ListsState } from './useLists';
import { applyTheme, loadPref, savePref, type ThemePref } from './theme';

const CHOICES: ThemePref[] = ['light', 'dark', 'auto'];

interface Props {
  api: Api;
  lists: ListsState;
  session: Session;
  onSignedOut: () => void;
  onBack: () => void;
}

export function Settings({ api, lists, session, onSignedOut, onBack }: Props) {
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pref, setPref] = useState<ThemePref>(loadPref);
  const [devices, setDevices] = useState<Device[]>([]);
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [recovery, setRecovery] = useState('');
  const [confirmingRecovery, setConfirmingRecovery] = useState(false);

  const refresh = () =>
    api.devices().then(setDevices, (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) onSignedOut(); // this device was revoked elsewhere
      else setNote('Could not load devices');
    });

  useEffect(() => {
    void refresh();
  }, []);

  const choose = (next: ThemePref) => {
    savePref(next);
    applyTheme(next);
    setPref(next);
  };

  const invite = async () => {
    setNote('');
    try {
      const { code } = await api.invite();
      const url = buildInviteLink(location.href, code);
      setLink(url);
      if (navigator.share) await navigator.share({ title: 'Join our Grocery list', url }).catch(() => undefined);
    } catch {
      setNote('Could not create an invite');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setNote('Link copied');
    } catch {
      setNote('Press and hold the link to copy it');
    }
  };

  const createRecovery = async () => {
    if (!confirmingRecovery) return setConfirmingRecovery(true);
    setConfirmingRecovery(false);
    setNote('');
    setRecovery(''); // never leave an old code on screen while a replacement may be going through
    try {
      setRecovery((await api.createRecovery()).code);
    } catch {
      setNote('Could not create a recovery code. If it may have gone through, the old code might no longer work: try again.');
    }
  };

  const copyRecovery = async () => {
    try {
      await navigator.clipboard.writeText(recovery);
      setNote('Recovery code copied');
    } catch {
      setNote('Press and hold the code to copy it');
    }
  };

  const revoke = async (device: Device) => {
    try {
      await api.revoke(device.deviceId);
      if (device.current) onSignedOut();
      else await refresh();
    } catch (err) {
      if (device.current && err instanceof ApiError && (err.status === 401 || err.status === 404)) onSignedOut(); // already gone
      else setNote(err instanceof ApiError && err.status === 409 ? err.message : 'Could not remove that device');
    }
  };

  return (
    <main class="app">
      <header class="top left">
        <button type="button" class="back" onClick={onBack}>
          ‹ Lists
        </button>
        <h1>Settings</h1>
      </header>
      <p class="muted">Signed in as {session.deviceName}</p>

      <section class="card">
        <strong>Appearance</strong>
        <div class="muted">This device only</div>
        <div class="seg">
          {CHOICES.map((choice) => (
            <button key={choice} type="button" aria-pressed={pref === choice} onClick={() => choose(choice)}>
              {choice[0]?.toUpperCase() + choice.slice(1)}
            </button>
          ))}
        </div>
      </section>

      <section class="card">
        <strong>Stores</strong>
        {lists.data?.stores.map((store) => (
          <div class="row" key={store.id}>
            {renaming?.id === store.id ? (
              <form
                class="add"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = renaming.name.trim();
                  setRenaming(null);
                  if (name) void lists.mutate((d) => withRenamedStore(d, store.id, name), { kind: 'renameStore', id: store.id, name });
                }}
              >
                <input value={renaming.name} maxLength={80} onInput={(e) => setRenaming({ id: store.id, name: e.currentTarget.value })} />
                <button type="submit">Save</button>
              </form>
            ) : (
              <>
                <span>{store.name}</span>
                <span>
                  <button type="button" onClick={() => setRenaming({ id: store.id, name: store.name })}>
                    Rename
                  </button>{' '}
                  <button
                    type="button"
                    class="danger"
                    onClick={() => {
                      if (confirming !== store.id) return setConfirming(store.id);
                      setConfirming(null);
                      void lists.mutate((d) => withoutStore(d, store.id), { kind: 'deleteStore', id: store.id });
                    }}
                  >
                    {confirming === store.id ? 'Delete it and its items?' : 'Delete'}
                  </button>
                </span>
              </>
            )}
          </div>
        ))}
      </section>

      <section class="card">
        <strong>Invite your partner</strong>
        <p class="muted">One-time link, valid for 24 hours. They open it on their iPhone and stay signed in.</p>
        <button class="primary" type="button" onClick={() => void invite()}>
          Create invite link
        </button>
        {link && (
          <>
            <p class="link">{link}</p>
            <button type="button" onClick={() => void copy()}>
              Copy link
            </button>
          </>
        )}
      </section>

      <details class="card">
        <summary>
          <strong>Recovery code</strong>
        </summary>
        <p class="muted">
          If you ever lose all your devices, this code gets you back in. Keep it somewhere safe, like a password manager. Anyone
          with it can sign in to your household. Lost or sold a phone? Remove it under Devices, then create a new code here.
        </p>
        <button type="button" class={confirmingRecovery ? 'danger' : undefined} onClick={() => void createRecovery()}>
          {confirmingRecovery ? 'This replaces any older code. Create it?' : 'Create a recovery code'}
        </button>
        {recovery && (
          <>
            <p class="link recovery">{recovery}</p>
            <button type="button" onClick={() => void copyRecovery()}>
              Copy code
            </button>
            <p class="tip">Save it now. It will not be shown again.</p>
          </>
        )}
      </details>

      <section class="card">
        <strong>Devices</strong>
        {devices.map((device) => (
          <div class="row" key={device.deviceId}>
            <span>
              {device.name}
              {device.current && <span class="muted"> (this device)</span>}
            </span>
            <button type="button" class="danger" disabled={devices.length <= 1} onClick={() => void revoke(device)}>
              {device.current ? 'Sign out' : 'Remove'}
            </button>
          </div>
        ))}
      </section>

      {note && <p class="muted">{note}</p>}
    </main>
  );
}
