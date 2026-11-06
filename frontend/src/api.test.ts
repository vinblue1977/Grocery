import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from './api';
import { buildInviteLink, parseInviteInput, parseJoinCode } from './invite';
import { clearSession, isSession, loadSession, saveSession } from './session';

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('api', () => {
  it('sends the bearer token and JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ householdId: 'h', deviceId: 'd', token: 't' }, 201));
    const api = createApi('https://x.test/', () => 'tok', fetchMock);
    await api.join('CODE1234', 'Yaso');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://x.test/join');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok', 'content-type': 'application/json' });
    expect(init.body).toBe(JSON.stringify({ code: 'CODE1234', deviceName: 'Yaso' }));
  });

  it('cuts off a request that hangs and reports it as offline (status 0)', async () => {
    vi.useFakeTimers();
    const hang = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const api = createApi('https://x.test', () => 'tok', hang, 20000);
    const result = api.sync().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(19999);
    expect(hang).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    const err = await result;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    vi.useRealTimers();
  });

  it('sends a client-chosen id with a new item or store, and treats a 200 replay as success', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(ok({ id: 'abc123abc123', name: 'Tea' }, 200)));
    const api = createApi('https://x.test', () => 'tok', fetchMock);
    await expect(api.addItem('c', 'Tea', undefined, 'abc123abc123')).resolves.toMatchObject({ id: 'abc123abc123' });
    await expect(api.addStore('Aldi', 'def456def456')).resolves.toBeDefined();
    const bodies = fetchMock.mock.calls.map((c) => (c[1] as RequestInit).body);
    expect(bodies[0]).toBe(JSON.stringify({ storeId: 'c', name: 'Tea', id: 'abc123abc123' }));
    expect(bodies[1]).toBe(JSON.stringify({ name: 'Aldi', id: 'def456def456' }));
  });

  it('turns error responses and network failures into ApiError', async () => {
    const bad = createApi('https://x.test', () => null, vi.fn().mockResolvedValue(ok({ error: 'sign in required' }, 401)));
    await expect(bad.me()).rejects.toMatchObject({ status: 401, message: 'sign in required' });
    const down = createApi('https://x.test', () => null, vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(down.me()).rejects.toBeInstanceOf(ApiError);
    const unset = createApi('', () => null, vi.fn());
    await expect(unset.me()).rejects.toMatchObject({ status: 0 });
  });

  it('handles 204 and list responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(ok({ devices: [{ deviceId: 'a', name: 'n', createdAt: 1, current: true }] }));
    const api = createApi('https://x.test', () => 't', fetchMock);
    await expect(api.revoke('a/b')).resolves.toBeUndefined();
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://x.test/devices/a%2Fb');
    expect(await api.devices()).toHaveLength(1);
  });
});

describe('invite links', () => {
  it('round-trips a code', () => {
    const link = buildInviteLink('https://u.github.io/Grocery/#old', 'abc_DEF-1234567');
    expect(link).toBe('https://u.github.io/Grocery/#join=abc_DEF-1234567');
    expect(parseJoinCode(new URL(link).hash)).toBe('abc_DEF-1234567');
  });

  it('rejects junk', () => {
    expect(parseJoinCode('')).toBeNull();
    expect(parseJoinCode('#other=1')).toBeNull();
    expect(parseJoinCode('#join=short')).toBeNull();
    expect(parseJoinCode('#join=<script>alert(1)</script>')).toBeNull();
    expect(parseJoinCode('#join=%E0%A4%A')).toBeNull(); // malformed escape must not throw
  });
});

describe('pasted invites', () => {
  it('accepts a full link or a bare code', () => {
    expect(parseInviteInput(' https://u.github.io/Grocery/#join=abc_DEF-1234567 ')).toBe('abc_DEF-1234567');
    expect(parseInviteInput('abc_DEF-1234567')).toBe('abc_DEF-1234567');
    expect(parseInviteInput('join=abc_DEF-1234567')).toBe('abc_DEF-1234567');
    expect(parseInviteInput('Join us: https://u.github.io/Grocery/?x=1#join=abc_DEF-1234567.')).toBe('abc_DEF-1234567');
  });

  it('rejects anything else', () => {
    expect(parseInviteInput('')).toBeNull();
    expect(parseInviteInput('hello world')).toBeNull();
    expect(parseInviteInput('https://u.github.io/Grocery/')).toBeNull();
  });
});

describe('session storage', () => {
  const session = { token: 't', householdId: 'h', deviceId: 'd', deviceName: 'n' };

  it('saves, loads and clears', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    saveSession(session, storage);
    expect(loadSession(storage)).toEqual(session);
    clearSession(storage);
    expect(loadSession(storage)).toBeNull();
  });

  it('keeps going when storage refuses the write', () => {
    expect(() =>
      saveSession(session, {
        setItem: () => {
          throw new Error('quota');
        },
      }),
    ).not.toThrow();
  });

  it('ignores corrupt data', () => {
    expect(loadSession({ getItem: () => '{not json' })).toBeNull();
    expect(loadSession({ getItem: () => '{"token":"t"}' })).toBeNull();
    expect(isSession(null)).toBe(false);
    expect(() =>
      clearSession({
        removeItem: () => {
          throw new Error('x');
        },
      }),
    ).not.toThrow();
  });
});
