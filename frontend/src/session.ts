export interface Session {
  token: string;
  householdId: string;
  deviceId: string;
  deviceName: string;
}

const KEY = 'grocery.session';

export function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return ['token', 'householdId', 'deviceId', 'deviceName'].every((k) => typeof v[k] === 'string' && v[k] !== '');
}

/** The sign-in lives on this device only; there is no password, the token is the login. */
export function loadSession(storage: Pick<Storage, 'getItem'> = localStorage): Session | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? 'null');
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Storage is full or blocked: the app keeps the session in memory, but the next launch will ask to sign in again.
  }
}

export function clearSession(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    storage.removeItem(KEY);
  } catch {
    // Nothing stored or storage unavailable: already signed out.
  }
}
