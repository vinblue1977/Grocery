import { useState } from 'preact/hooks';
import { applyTheme, loadPref, savePref, type ThemePref } from './theme';

const CHOICES: ThemePref[] = ['light', 'dark', 'auto'];

export function App() {
  const [pref, setPref] = useState<ThemePref>(loadPref);

  const choose = (next: ThemePref) => {
    savePref(next);
    applyTheme(next);
    setPref(next);
  };

  return (
    <main class="app">
      <h1>Grocery</h1>
      <section class="card">
        <strong>Appearance</strong>
        <div class="muted">This device only</div>
        <div class="seg">
          {CHOICES.map((choice) => (
            <button key={choice} type="button" aria-pressed={pref === choice} onClick={() => choose(choice)}>
              {choice[0]?.toUpperCase() + choice.slice(1)}
            </button>
          ))}
        </div>
      </section>
      <p class="muted">Store lists are coming next.</p>
    </main>
  );
}
