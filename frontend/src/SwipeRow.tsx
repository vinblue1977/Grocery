import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';

const REVEAL = 84; // width of the Delete button, in px
const SNAP = 40; // drag past this and the button stays open
const FAR = 0.6; // drag past this share of the row and it deletes straight away
const START = 8; // movement before it counts as a swipe rather than a tap or a scroll

interface Props {
  onDelete: () => void;
  children: ComponentChildren;
  class?: string;
}

/** A row that swipes left to show a Delete button; a long swipe deletes. Taps and vertical scrolling pass through. */
export function SwipeRow({ onDelete, children, class: className = '' }: Props) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; from: number; swiping: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const down = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('.del')) return;
    start.current = { x: e.clientX, y: e.clientY, from: x, swiping: false };
  };
  const move = (e: PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!s.swiping) {
      if (Math.abs(dx) < START || Math.abs(dx) < Math.abs(e.clientY - s.y)) return; // not horizontal (yet)
      s.swiping = true;
      setDragging(true);
      box.current?.setPointerCapture?.(e.pointerId);
    }
    const width = box.current?.offsetWidth || 300;
    setX(Math.max(-width, Math.min(0, s.from + dx)));
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    if (!s?.swiping) return;
    setDragging(false);
    const width = box.current?.offsetWidth || 300;
    if (-x > width * FAR) onDelete();
    else setX(-x > SNAP ? -REVEAL : 0);
  };
  // A tap on an open row closes it instead of opening the editor underneath.
  const tapClose = (e: MouseEvent) => {
    if (x === 0) return;
    e.stopPropagation();
    e.preventDefault();
    setX(0);
  };

  return (
    <div
      ref={box}
      class={`swipe ${dragging ? 'drag' : ''} ${className}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <button type="button" class="del" tabIndex={-1} aria-hidden="true" onClick={onDelete}>
        Delete
      </button>
      <div class="swiper" style={{ transform: `translateX(${x}px)` }} onClickCapture={tapClose}>
        {children}
      </div>
    </div>
  );
}
