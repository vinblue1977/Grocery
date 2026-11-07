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

export interface Store {
  id: string;
  name: string;
  order: number;
}

export interface Item {
  id: string;
  storeId: string;
  name: string;
  note: string;
  checked: boolean;
  addedBy: string;
  updatedAt: number;
}

export interface ScannedItem {
  name: string;
  note: string;
  storeId: string | null;
  unsure: boolean;
}

export interface NewItem {
  name: string;
  note: string;
  storeId: string;
}

/** A name suggested for a store: bought often (added 3+ times) or pinned. */
export interface Frequent {
  storeId: string;
  name: string;
  count: number;
  pinned: boolean;
}

export interface Snapshot {
  stores: Store[];
  items: Item[];
  frequent: Frequent[];
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
  createRecovery(): Promise<{ code: string }>;
  recover(code: string, deviceName: string): Promise<Credentials>;
  devices(): Promise<Device[]>;
  revoke(deviceId: string): Promise<void>;
  renameDevice(deviceId: string, name: string): Promise<{ deviceId: string; name: string }>;
  sync(): Promise<Snapshot>;
  addStore(name: string, id?: string): Promise<Store>;
  renameStore(id: string, name: string): Promise<Store>;
  deleteStore(id: string): Promise<void>;
  clearChecked(storeId: string): Promise<void>;
  setFrequent(storeId: string, name: string, changes: { pinned?: boolean; hidden?: boolean }): Promise<unknown>;
  addItem(storeId: string, name: string, note?: string, id?: string): Promise<Item>;
  updateItem(id: string, changes: Partial<Pick<Item, 'checked' | 'name' | 'note'>>): Promise<Item>;
  deleteItem(id: string): Promise<void>;
  scan(imageBase64: string): Promise<ScannedItem[]>;
  addItems(items: NewItem[]): Promise<{ added: number; skipped: number }>;
}

export const REQUEST_TIMEOUT_MS = 20000;

export function createApi(baseUrl: string, getToken: () => string | null, fetchImpl: typeof fetch = fetch, timeoutMs = REQUEST_TIMEOUT_MS): Api {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!baseUrl) throw new ApiError(0, 'The API address is not configured');
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    // A request that hangs (a half-dead connection on a phone) is cut off and treated like being offline.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
          method,
          headers,
          signal: controller.signal,
          ...(body !== undefined && { body: JSON.stringify(body) }),
        });
      } catch {
        throw new ApiError(0, 'No connection');
      }
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(res.status, detail.error ?? `Request failed (${res.status})`);
      }
      if (res.status === 204) return undefined as T;
      // A success status with a body that is not JSON is not our server (a Wi-Fi login page, a proxy): same as having no connection.
      return (await res.json().catch(() => {
        throw new ApiError(0, 'Unexpected response');
      })) as T;
    } catch (err) {
      if (controller.signal.aborted && !(err instanceof ApiError)) throw new ApiError(0, 'The request timed out');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    createHousehold: (deviceName) => request('POST', '/household', { deviceName }),
    join: (code, deviceName) => request('POST', '/join', { code, deviceName }),
    me: () => request('GET', '/me'),
    invite: () => request('POST', '/invites'),
    createRecovery: () => request('POST', '/recovery'),
    recover: (code, deviceName) => request('POST', '/recover', { code, deviceName }),
    devices: async () => (await request<{ devices: Device[] }>('GET', '/devices')).devices,
    revoke: (deviceId) => request('DELETE', `/devices/${encodeURIComponent(deviceId)}`),
    sync: async () => {
      const snapshot = await request<Snapshot>('GET', '/sync');
      return { ...snapshot, frequent: snapshot.frequent ?? [] }; // an older server has no suggestions yet
    },
    addStore: (name, id) => request('POST', '/stores', { name, ...(id ? { id } : {}) }),
    renameDevice: (deviceId, name) => request('PATCH', `/devices/${encodeURIComponent(deviceId)}`, { name }),
    renameStore: (id, name) => request('PATCH', `/stores/${encodeURIComponent(id)}`, { name }),
    deleteStore: (id) => request('DELETE', `/stores/${encodeURIComponent(id)}`),
    setFrequent: (storeId, name, changes) => request('PUT', '/frequent', { storeId, name, ...changes }),
    clearChecked: async (storeId) => {
      await request('POST', `/stores/${encodeURIComponent(storeId)}/clear`);
    },
    addItem: (storeId, name, note, id) => request('POST', '/items', { storeId, name, ...(note ? { note } : {}), ...(id ? { id } : {}) }),
    updateItem: (id, changes) => request('PATCH', `/items/${encodeURIComponent(id)}`, changes),
    deleteItem: (id) => request('DELETE', `/items/${encodeURIComponent(id)}`),
    scan: async (imageBase64) => (await request<{ items: ScannedItem[] }>('POST', '/scan', { image: imageBase64 })).items,
    addItems: (items) => request('POST', '/items/bulk', { items }),
  };
}

export function toSession(creds: Credentials, deviceName: string): Session {
  return { ...creds, deviceName };
}
