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

const API_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const api = useMemo(() => createApi(API_URL, () => loadSession()?.token ?? null), []);
  const signOut = () => {
    clearSession();
    clearSnapshot();
    clearQueue();
    setSession(null);
  };

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

  return <Signed api={api} session={session} onSignedOut={signOut} />;
}

export function Signed({ api, session, onSignedOut }: { api: Api; session: Session; onSignedOut: () => void }) {
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
      {tab === 'settings' && <Settings api={api} lists={lists} session={session} onSignedOut={onSignedOut} onBack={() => history.back()} />}
    </>
  );
}
