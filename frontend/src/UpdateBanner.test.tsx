import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { announceUpdate, resetUpdate, UpdateBanner } from './UpdateBanner';

afterEach(() => {
  document.body.replaceChildren();
  resetUpdate();
});

describe('UpdateBanner', () => {
  it('is hidden until an update is announced, then offers Reload', async () => {
    const reload = vi.fn();
    const root = document.createElement('div');
    document.body.append(root);
    await act(() => {
      render(<UpdateBanner reload={reload} />, root);
    });
    expect(root.textContent).toBe('');
    await act(() => announceUpdate());
    expect(root.textContent).toContain('New version ready');
    await act(() => (root.querySelector('button') as HTMLButtonElement).click());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows at once when the update was announced before it mounted', async () => {
    announceUpdate();
    const root = document.createElement('div');
    document.body.append(root);
    await act(() => {
      render(<UpdateBanner />, root);
    });
    expect(root.querySelector('[role=status]')).not.toBeNull();
  });
});
