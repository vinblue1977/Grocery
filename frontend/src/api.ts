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

export interface Snapshot {
  stores: Store[];
  items: Item[];
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
  sync(): Promise<Snapshot>;
  addStore(name: string): Promise<Store>;
  renameStore(id: string, name: string): Promise<Store>;
  deleteStore(id: string): Promise<void>;
  clearChecked(storeId: string): Promise<void>;
  addItem(storeId: string, name: string, note?: string): Promise<Item>;
  updateItem(id: string, changes: Partial<Pick<Item, 'checked' | 'name' | 'note'>>): Promise<Item>;
  deleteItem(id: string): Promise<void>;
  scan(imageBase64: string): Promise<ScannedItem[]>;
  addItems(items: NewItem[]): Promise<{ added: number; skipped: number }>;
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
    sync: () => request('GET', '/sync'),
    addStore: (name) => request('POST', '/stores', { name }),
    renameStore: (id, name) => request('PATCH', `/stores/${encodeURIComponent(id)}`, { name }),
    deleteStore: (id) => request('DELETE', `/stores/${encodeURIComponent(id)}`),
    clearChecked: async (storeId) => {
      await request('POST', `/stores/${encodeURIComponent(storeId)}/clear`);
    },
    addItem: (storeId, name, note) => request('POST', '/items', { storeId, name, ...(note ? { note } : {}) }),
    updateItem: (id, changes) => request('PATCH', `/items/${encodeURIComponent(id)}`, changes),
    deleteItem: (id) => request('DELETE', `/items/${encodeURIComponent(id)}`),
    scan: async (imageBase64) => (await request<{ items: ScannedItem[] }>('POST', '/scan', { image: imageBase64 })).items,
    addItems: (items) => request('POST', '/items/bulk', { items }),
  };
}

export function toSession(creds: Credentials, deviceName: string): Session {
  return { ...creds, deviceName };
}
