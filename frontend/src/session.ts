export interface Session {
  token: string;
  householdId: string;
  deviceId: string;
  deviceName: string;
  /** Who uses this device, shown on the items it adds. Empty until they pick it after signing in. */
  person: string;
}

const KEY = 'grocery.session';

export function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return ['token', 'householdId', 'deviceId', 'deviceName'].every((k) => typeof v[k] === 'string' && v[k] !== '') && typeof v['person'] === 'string';
}

/** The sign-in lives on this device only; there is no password, the token is the login. */
export function loadSession(storage: Pick<Storage, 'getItem'> = localStorage): Session | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? 'null');
    // A sign-in saved before people existed used the device name as the person.
    if (typeof parsed === 'object' && parsed !== null && !('person' in parsed)) {
      const old = parsed as Record<string, unknown>;
      return isSession({ ...old, person: old['deviceName'] }) ? ({ ...old, person: old['deviceName'] } as Session) : null;
    }
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
