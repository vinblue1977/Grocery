import { useMemo, useState } from 'preact/hooks';
import { createApi } from './api';
import { parseJoinCode } from './invite';
import { clearSession, loadSession, saveSession, type Session } from './session';
import { Settings } from './Settings';
import { Welcome } from './Welcome';

const API_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const api = useMemo(() => createApi(API_URL, () => loadSession()?.token ?? null), []);

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

  return (
    <Settings
      api={api}
      session={session}
      onSignedOut={() => {
        clearSession();
        setSession(null);
      }}
    />
  );
}
