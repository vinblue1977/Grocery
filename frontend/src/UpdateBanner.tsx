import { useEffect, useState } from 'preact/hooks';

let ready = false;
const listeners = new Set<() => void>();

/** A new version has downloaded and is waiting for the app to go to the background. */
export function announceUpdate(): void {
  ready = true;
  listeners.forEach((listener) => listener());
}

/** Test helper: forget an announced update. */
export function resetUpdate(): void {
  ready = false;
}

export function UpdateBanner({ reload = () => location.reload() }: { reload?: () => void }) {
  const [show, setShow] = useState(ready);
  useEffect(() => {
    const listener = () => setShow(ready);
    listeners.add(listener);
    listener(); // an update announced between the first render and now
    return () => void listeners.delete(listener);
  }, []);
  if (!show) return null;
  return (
    <div class="banner" role="status">
      <span>New version ready</span>
      <button type="button" onClick={reload}>
        Reload
      </button>
    </div>
  );
}
