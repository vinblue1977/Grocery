export type ThemePref = 'light' | 'dark' | 'auto';
export type Theme = 'light' | 'dark';

const KEY = 'grocery.theme';
// theme-color per theme (Safari toolbar); the Home Screen app's translucent status bar shows the page colour itself.
const BAR: Record<Theme, string> = { light: '#f4f5f2', dark: '#14181a' };

export function isThemePref(value: unknown): value is ThemePref {
  return value === 'light' || value === 'dark' || value === 'auto';
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === 'auto') return systemDark ? 'dark' : 'light';
  return pref;
}

/** Theme is per device, never shared: one person can use dark while the other uses light. */
export function loadPref(storage: Pick<Storage, 'getItem'> = localStorage): ThemePref {
  try {
    const saved = storage.getItem(KEY);
    return isThemePref(saved) ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

export function savePref(pref: ThemePref, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(KEY, pref);
  } catch {
    // Private mode or full storage: the choice just won't persist.
  }
}

export function applyTheme(pref: ThemePref, doc: Document = document, systemDark?: boolean): Theme {
  const dark = systemDark ?? window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = resolveTheme(pref, dark);
  doc.documentElement.dataset['theme'] = theme;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme]);
  return theme;
}

/** Re-resolves "auto" when the system switches (e.g. iOS going dark at sunset) while the app stays open. */
export function watchSystem(getPref: () => ThemePref): void {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getPref()));
}
