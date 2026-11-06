import { useState } from 'preact/hooks';
import type { Api } from './api';
import { toSession } from './api';
import { parseInviteInput } from './invite';
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

/** True inside the Home Screen app. iOS gives it its own storage, separate from Safari's. */
function isHomeScreenApp(): boolean {
  return (navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
}

/** Create the household (first person, dark by default) or join with an invite link (second person, light by default). */
export function Welcome({ api, joinCode, onSignedIn }: Props) {
  const [name, setName] = useState('');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: Event) => {
    event.preventDefault();
    const deviceName = name.trim() || defaultName();
    const code = joinCode ?? (pasted.trim() ? parseInviteInput(pasted) : null);
    if (pasted.trim() && !code) {
      setError("That doesn't look like an invite link or code");
      return;
    }
    setBusy(true);
    setError('');
    try {
      const creds = code ? await api.join(code, deviceName) : await api.createHousehold(deviceName);
      const initialTheme = code ? 'light' : 'dark';
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
        {!joinCode && !isHomeScreenApp() && (
          <p class="tip">
            Tip: tap Share, then Add to Home Screen, and open Grocery from there before signing in. The Home Screen app keeps its
            own sign-in, separate from Safari.
          </p>
        )}
        <label class="field">
          <span class="muted">Your name</span>
          <input value={name} maxLength={40} placeholder={defaultName()} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        {!joinCode && (
          <label class="field">
            <span class="muted">Already set up? Paste an invite link or code</span>
            <input value={pasted} placeholder="Leave empty to create a new household" onInput={(e) => setPasted(e.currentTarget.value)} />
          </label>
        )}
        {error && <p class="error">{error}</p>}
        <button class="primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : joinCode || pasted.trim() ? 'Join' : 'Create household'}
        </button>
      </form>
    </main>
  );
}
