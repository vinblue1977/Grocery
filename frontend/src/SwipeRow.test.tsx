import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SwipeRow } from './SwipeRow';

function mount(onDelete = vi.fn(), onTap = vi.fn()) {
  const root = document.createElement('div');
  document.body.append(root);
  act(() => {
    render(
      <SwipeRow onDelete={onDelete}>
        <button type="button" class="nm" onClick={onTap}>
          Milk
        </button>
      </SwipeRow>,
      root,
    );
  });
  const box = root.querySelector('.swipe') as HTMLElement;
  Object.defineProperty(box, 'offsetWidth', { configurable: true, value: 300 });
  const pointer = (type: string, x: number, y = 0) =>
    act(() => {
      box.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    });
  const offset = () => (root.querySelector('.swiper') as HTMLElement).style.transform;
  return { root, pointer, offset, onDelete, onTap };
}

afterEach(() => document.body.replaceChildren());

describe('SwipeRow', () => {
  it('stays open on the Delete button after a short swipe, and Delete deletes', async () => {
    const { root, pointer, offset, onDelete } = mount();
    await pointer('pointerdown', 200);
    await pointer('pointermove', 140);
    await pointer('pointerup', 140);
    expect(offset()).toBe('translateX(-84px)');
    await act(() => (root.querySelector('.del') as HTMLElement).click());
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('springs back after a tiny swipe', async () => {
    const { pointer, offset, onDelete } = mount();
    await pointer('pointerdown', 200);
    await pointer('pointermove', 180);
    await pointer('pointerup', 180);
    expect(offset()).toBe('translateX(0px)');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('deletes straight away on a long swipe', async () => {
    const { pointer, onDelete } = mount();
    await pointer('pointerdown', 280);
    await pointer('pointermove', 60);
    await pointer('pointerup', 60);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('ignores vertical movement and right swipes', async () => {
    const { pointer, offset } = mount();
    await pointer('pointerdown', 200, 0);
    await pointer('pointermove', 190, 60);
    await pointer('pointerup', 190, 60);
    expect(offset()).toBe('translateX(0px)');
    await pointer('pointerdown', 100);
    await pointer('pointermove', 200);
    await pointer('pointerup', 200);
    expect(offset()).toBe('translateX(0px)'); // never drifts right of its place
  });

  it('lets a tap through when closed, and a tap on an open row only closes it', async () => {
    const { root, pointer, offset, onTap } = mount();
    await act(() => (root.querySelector('.nm') as HTMLElement).click());
    expect(onTap).toHaveBeenCalledTimes(1);
    await pointer('pointerdown', 200);
    await pointer('pointermove', 120);
    await pointer('pointerup', 120);
    await act(() => (root.querySelector('.nm') as HTMLElement).click());
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(offset()).toBe('translateX(0px)');
  });

  it('swallows the click that follows a small swipe, and reads the live position on a fast flick', async () => {
    const { root, pointer, onDelete, onTap } = mount();
    await pointer('pointerdown', 200);
    await pointer('pointermove', 175);
    await pointer('pointerup', 175);
    await act(() => (root.querySelector('.nm') as HTMLElement).click());
    expect(onTap).not.toHaveBeenCalled();
    // down, move and up all land before the next render
    await act(() => {
      const box = root.querySelector('.swipe') as HTMLElement;
      for (const [type, x] of [['pointerdown', 290], ['pointermove', 40], ['pointerup', 40]] as const) {
        box.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 0 }));
      }
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
