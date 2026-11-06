import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './ids';

const VALID = /^[0-9a-f]{12,32}$/;

describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is 32 lowercase hex characters and different each time', () => {
    const a = newId();
    expect(a).toMatch(VALID);
    expect(a).toHaveLength(32);
    expect(newId()).not.toBe(a);
  });

  it('falls back when crypto has neither randomUUID nor getRandomValues', () => {
    vi.stubGlobal('crypto', {});
    const id = newId();
    expect(id).toMatch(VALID);
    expect(id).toHaveLength(32);
  });

  it('uses crypto.getRandomValues (not Math.random) on browsers without randomUUID', () => {
    const random = vi.spyOn(Math, 'random');
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab) });
    expect(newId()).toBe('ab'.repeat(16));
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('still produces a valid id with no crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newId()).toMatch(VALID);
  });
});
