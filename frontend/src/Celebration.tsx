import { useEffect, useRef } from 'preact/hooks';

interface Props {
  store: string;
  next: string | null;
  onNext: () => void;
  onClear: () => void;
  onDismiss: () => void;
}

const COLORS = ['#4cc380', '#ffd23f', '#ff8fb1', '#6aa9ff'];
// Fixed pieces, spread over the card; they sit behind the text (z-index) and inside it (overflow hidden).
const CONFETTI = Array.from({ length: 24 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  top: (i * 23 + 5) % 60,
  turn: (i * 53) % 180,
  delay: (i % 6) * 0.12,
  color: COLORS[i % COLORS.length],
  round: i % 3 === 0,
}));

/** Shown in place of the to-buy list when the last item of a store is ticked. */
export function Celebration({ store, next, onNext, onClear, onDismiss }: Props) {
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    card.current?.focus(); // the ticked checkbox just left the list, so keyboard and screen-reader focus moves here
  }, []);
  return (
    <section class="celebrate" role="status" aria-label="Store finished" tabIndex={-1} ref={card}>
      <div class="confetti" aria-hidden="true">
        {CONFETTI.map((c, i) => (
          <i
            key={i}
            class={c.round ? 'round' : ''}
            style={{ left: `${c.left}%`, top: `${c.top}%`, background: c.color, transform: `rotate(${c.turn}deg)`, animationDelay: `${c.delay}s` }}
          />
        ))}
      </div>
      <button type="button" class="dismiss" aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
      <div class="cbody">
        <div class="big" aria-hidden="true">
          🎉
        </div>
        <h2>All done at {store}!</h2>
        <p>Nice work, team.{next ? ` On to ${next}?` : ''}</p>
        {next && (
          <button type="button" class="go" onClick={onNext}>
            Go to {next}
          </button>
        )}
        <button type="button" class="quiet" onClick={onClear}>
          Done shopping
        </button>
      </div>
    </section>
  );
}
