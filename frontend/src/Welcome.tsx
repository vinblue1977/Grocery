import { useState } from 'preact/hooks';
import type { Api } from './api';
import { toSession } from './api';
import { applyTheme, savePref } from './theme';
import type { Session } from './session';

interface Props {
  api: Api;
  joinCode: string | null;
  onSignedIn: (session: Session) => void;
}

function defaultName(): string {
  return /iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone';
}

/** Create the household (first person, dark by default) or join with an invite link (second person, light by default). */
export function Welcome({ api, joinCode, onSignedIn }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: Event) => {
    event.preventDefault();
    const deviceName = name.trim() || defaultName();
    setBusy(true);
    setError('');
    try {
      const creds = joinCode ? await api.join(joinCode, deviceName) : await api.createHousehold(deviceName);
      const initialTheme = joinCode ? 'light' : 'dark';
      savePref(initialTheme);
      applyTheme(initialTheme);
      onSignedIn(toSession(creds, deviceName));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <main class="app">
      <h1>Grocery</h1>
      <form class="card" onSubmit={submit}>
        <strong>{joinCode ? 'Join your household' : 'Set up your household'}</strong>
        <p class="muted">
          {joinCode
            ? 'You were invited. Name this device and you stay signed in.'
            : 'You sign in once on this device. Invite your partner from Settings afterwards.'}
        </p>
        <label class="field">
          <span class="muted">This device's name</span>
          <input value={name} maxLength={40} placeholder={defaultName()} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        {error && <p class="error">{error}</p>}
        <button class="primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : joinCode ? 'Join' : 'Create household'}
        </button>
      </form>
    </main>
  );
}
