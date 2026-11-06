import { describe, expect, it, vi } from 'vitest';
import { createReloader } from './swUpdate';

describe('createReloader', () => {
  it('reloads when a new worker takes over and nothing is unsent', () => {
    const reload = vi.fn();
    createReloader(() => false, reload).onControllerChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('holds off while edits are pending, then reloads on retry', () => {
    const reload = vi.fn();
    let pending = true;
    const r = createReloader(() => pending, reload);
    r.onControllerChange();
    r.retry();
    expect(reload).not.toHaveBeenCalled();
    pending = false;
    r.retry();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('reloads at most once, and retry alone does nothing', () => {
    const reload = vi.fn();
    const r = createReloader(() => false, reload);
    r.retry();
    expect(reload).not.toHaveBeenCalled();
    r.onControllerChange();
    r.onControllerChange();
    r.retry();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
