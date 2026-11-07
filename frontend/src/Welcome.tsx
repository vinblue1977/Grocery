import { useState } from 'preact/hooks';
import type { Api } from './api';
import { ApiError, toSession } from './api';
import { parseInviteInput } from './invite';
import { ScanQr } from './ScanQr';
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

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

/** True inside the Home Screen app. iOS gives it its own storage, separate from Safari's. */
function isHomeScreenApp(): boolean {
  return (
    (navigator as { standalone?: boolean }).standalone === true ||
    matchMedia('(display-mode: standalone)').matches
  );
}

/** Create the household (first person, dark by default) or join with an invite link (second person, light by default). */
export function Welcome({ api, joinCode, onSignedIn }: Props) {
  const [name, setName] = useState('');
  const [pasted, setPasted] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: Event) => {
    event.preventDefault();
    const deviceName = name.trim() || defaultName();
    if (recovering) {
      const recoveryInput = recoveryCode.trim();
      if (!/^rec_[\w-]{8,100}$/.test(recoveryInput)) {
        setError("That doesn't look like a recovery code");
        return;
      }
      setBusy(true);
      setError('');
      try {
        onSignedIn(
          toSession(await api.recover(recoveryInput, deviceName), deviceName),
        ); // keeps this device's theme choice
      } catch (err) {
        setError(
          err instanceof ApiError && err.status === 400
            ? "That recovery code isn't valid. Check it and try again."
            : err instanceof Error
              ? err.message
              : 'Something went wrong',
        );
        setBusy(false);
      }
      return;
    }
    const looksLikeRecovery = pasted.trim().startsWith('rec_');
    const wantsToJoin = joinCode !== null || pasted.length > 0; // any pasted text, even blanks, means "join", never "create"
    const code = joinCode ?? parseInviteInput(pasted);
    if (wantsToJoin && !code) {
      setError("That doesn't look like an invite link or code");
      return;
    }
    setBusy(true);
    setError('');
    try {
      const creds = code
        ? await api.join(code, deviceName)
        : await api.createHousehold(deviceName);
      const initialTheme = code ? 'light' : 'dark';
      savePref(initialTheme);
      applyTheme(initialTheme);
      onSignedIn(toSession(creds, deviceName));
    } catch (err) {
      setError(
        looksLikeRecovery && err instanceof ApiError && err.status === 404
          ? 'That looks like a recovery code: tap Lost access? below.'
          : err instanceof ApiError && err.status === 409
            ? 'This app is already set up. Paste an invite link or code from the other device.'
            : err instanceof Error
              ? err.message
              : 'Something went wrong',
      );
      setBusy(false);
    }
  };

  if (scanning) {
    return (
      <ScanQr
        onCode={(code) => {
          setPasted(code);
          setError('');
          setScanning(false);
        }}
        onCancel={() => setScanning(false)}
      />
    );
  }

  return (
    <main class="app">
      <h1>Grocery</h1>
      <form class="card" onSubmit={submit}>
        <strong>
          {recovering
            ? 'Get back in'
            : joinCode
              ? 'Join your household'
              : 'Set up your household'}
        </strong>
        <p class="muted">
          {recovering
            ? 'Enter the recovery code you saved and a name for this device.'
            : joinCode
              ? 'You were invited. Name this device and you stay signed in.'
              : 'You sign in once on this device. Invite your partner from Settings afterwards.'}
        </p>
        {!joinCode && !pasted && isIos() && !isHomeScreenApp() && (
          <p class="tip">
            Tip: tap Share, then Add to Home Screen, and open Grocery from there
            before signing in. The Home Screen app keeps its own sign-in,
            separate from Safari.
          </p>
        )}
        <label class="field">
          <span class="muted">Your name</span>
          <input
            value={name}
            maxLength={40}
            placeholder="e.g. Victor"
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>
        {recovering && (
          <label class="field">
            <span class="muted">Recovery code</span>
            <input
              value={recoveryCode}
              placeholder="rec_…"
              autocapitalize="off"
              autocomplete="off"
              onInput={(e) => setRecoveryCode(e.currentTarget.value)}
            />
          </label>
        )}
        {!joinCode && !recovering && (
          <label class="field">
            <span class="muted">
              Already set up? Paste an invite link or code
            </span>
            <input
              value={pasted}
              placeholder="Leave empty to create a new household"
              onInput={(e) => setPasted(e.currentTarget.value)}
            />
          </label>
        )}
        {!joinCode && !recovering && (
          <button type="button" class="wide" onClick={() => setScanning(true)}>
            Scan a QR code from your partner's phone
          </button>
        )}
        {!joinCode && !recovering && pasted && !error && (
          <p class="tip">Invite found. Tap Join.</p>
        )}
        {error && <p class="error">{error}</p>}
        <button class="primary" type="submit" disabled={busy}>
          {busy
            ? 'Please wait…'
            : recovering
              ? 'Sign in'
              : joinCode || pasted
                ? 'Join'
                : 'Create household'}
        </button>
        {!joinCode && (
          <button
            type="button"
            class="link-btn"
            onClick={() => {
              setRecovering(!recovering);
              setError('');
            }}
          >
            {recovering ? 'Back' : 'Lost access? Use a recovery code'}
          </button>
        )}
      </form>
    </main>
  );
}
