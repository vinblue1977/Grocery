import type { Session } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Device {
  deviceId: string;
  name: string;
  createdAt: number;
  current: boolean;
}

interface Credentials {
  householdId: string;
  deviceId: string;
  token: string;
}

export interface Api {
  createHousehold(deviceName: string): Promise<Credentials>;
  join(code: string, deviceName: string): Promise<Credentials>;
  me(): Promise<{ householdId: string; deviceId: string; deviceName: string }>;
  invite(): Promise<{ code: string; expiresAt: number }>;
  devices(): Promise<Device[]>;
  revoke(deviceId: string): Promise<void>;
}

export function createApi(baseUrl: string, getToken: () => string | null, fetchImpl: typeof fetch = fetch): Api {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!baseUrl) throw new ApiError(0, 'The API address is not configured');
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, 'No connection');
    }
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, detail.error ?? `Request failed (${res.status})`);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  return {
    createHousehold: (deviceName) => request('POST', '/household', { deviceName }),
    join: (code, deviceName) => request('POST', '/join', { code, deviceName }),
    me: () => request('GET', '/me'),
    invite: () => request('POST', '/invites'),
    devices: async () => (await request<{ devices: Device[] }>('GET', '/devices')).devices,
    revoke: (deviceId) => request('DELETE', `/devices/${encodeURIComponent(deviceId)}`),
  };
}

export function toSession(creds: Credentials, deviceName: string): Session {
  return { ...creds, deviceName };
}
