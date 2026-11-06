import { useMemo, useState } from 'preact/hooks';
import { createApi, type Api } from './api';
import { parseJoinCode } from './invite';
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

function Signed({ api, session, onSignedOut }: { api: Api; session: Session; onSignedOut: () => void }) {
  const [tab, setTab] = useState<'lists' | 'settings'>('lists');
  const lists = useLists(api, onSignedOut);
  return (
    <>
      {tab === 'lists' ? (
        <Lists api={api} lists={lists} session={session} />
      ) : (
        <Settings api={api} lists={lists} session={session} onSignedOut={onSignedOut} />
      )}
      <nav class="nav">
        <button type="button" aria-current={tab === 'lists'} onClick={() => setTab('lists')}>
          🛒<span>Lists</span>
        </button>
        <button type="button" aria-current={tab === 'settings'} onClick={() => setTab('settings')}>
          ⚙️<span>Settings</span>
        </button>
      </nav>
    </>
  );
}
