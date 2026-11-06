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

  it('falls back when crypto.randomUUID is missing', () => {
    vi.stubGlobal('crypto', {});
    const id = newId();
    expect(id).toMatch(VALID);
    expect(id).toHaveLength(32);
  });
});
