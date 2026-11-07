import { useEffect, useMemo, useState } from 'preact/hooks';
import { createApi, type Api } from './api';
import { parseJoinCode } from './invite';
import { clearQueue } from './queue';
import { clearSnapshot } from './snapshotCache';
import { clearSession, loadSession, saveSession, type Session } from './session';
import { Lists } from './Lists';
import { Settings } from './Settings';
import { useLists } from './useLists';
import { Welcome } from './Welcome';
import { WhoAreYou } from './WhoAreYou';

const API_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';

export function App({ api: injected }: { api?: Api } = {}) {
  const [session, setSession] = useState<Session | null>(loadSession);
  const api = useMemo(() => injected ?? createApi(API_URL, () => loadSession()?.token ?? null), []);
  const signOut = () => {
    clearSession();
    clearSnapshot();
    clearQueue();
    setSession(null);
  };

  // Another device of the same person may have changed the name since this one last looked.
  const known = session?.person ?? '';
  useEffect(() => {
    if (!known) return;
    api.me().then(
      ({ person }) => {
        const current = loadSession();
        if (person && current && person !== current.person) {
          const next = { ...current, person };
          saveSession(next);
          setSession(next);
        }
      },
      () => undefined, // offline or signed out elsewhere: the lists handle that
    );
  }, [known]);

  if (!session) {
    const joinCode = parseJoinCode(location.hash);
    return (
      <Welcome
        api={api}
        joinCode={joinCode}
        onSignedIn={(next) => {
          saveSession(next);
          history.replaceState(null, '', location.pathname + location.search); // the invite code is spent: drop it from the URL
          setSession(next);
        }}
      />
    );
  }

  const update = (changes: Partial<Session>) => {
    const next = { ...session, ...changes };
    saveSession(next);
    setSession(next); // new items carry the new name straight away
  };

  // A device that signed in with an invite or recovery code says who it is before it can add anything.
  if (session.person === '') return <WhoAreYou api={api} onPicked={(person) => update({ person })} onSignedOut={signOut} />;

  return (
    <Signed
      api={api}
      session={session}
      onSignedOut={signOut}
      onRenamed={(deviceName) => update({ deviceName })}
      onPersonChanged={(person) => update({ person })}
    />
  );
}

export function Signed({
  api,
  session,
  onSignedOut,
  onRenamed = () => undefined,
  onPersonChanged = () => undefined,
}: {
  api: Api;
  session: Session;
  onSignedOut: () => void;
  onRenamed?: (name: string) => void;
  onPersonChanged?: (person: string) => void;
}) {
  const [tab, setTab] = useState<'lists' | 'settings'>('lists');
  const lists = useLists(api, onSignedOut, session.householdId);

  // Settings gets a history entry, so the iOS edge-swipe and the Android back button return to the list instead of leaving.
  useEffect(() => {
    const back = () => setTab('lists');
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  const openSettings = () => {
    history.pushState({ tab: 'settings' }, '');
    setTab('settings');
  };

  return (
    <>
      {/* Kept mounted while Settings is open, so a half-typed item survives a trip to Settings. */}
      <div hidden={tab !== 'lists'}>
        <Lists api={api} lists={lists} session={session} onOpenSettings={openSettings} />
      </div>
      {tab === 'settings' && (
        <Settings api={api} lists={lists} session={session} onSignedOut={onSignedOut} onRenamed={onRenamed} onPersonChanged={onPersonChanged} onBack={() => history.back()} />
      )}
    </>
  );
}
