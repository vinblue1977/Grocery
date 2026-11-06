import { describe, expect, it } from 'vitest';
import { applyTheme, isThemePref, loadPref, resolveTheme, savePref } from './theme';

describe('theme', () => {
  it('resolves auto from the system and passes explicit choices through', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('validates stored values', () => {
    expect(isThemePref('dark')).toBe(true);
    expect(isThemePref('blue')).toBe(false);
    expect(loadPref({ getItem: () => 'blue' })).toBe('auto');
    expect(loadPref({ getItem: () => 'light' })).toBe('light');
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadPref(broken)).toBe('auto');
    expect(() => savePref('dark', broken)).not.toThrow();
  });

  it('saves the choice', () => {
    const store = new Map<string, string>();
    savePref('dark', { setItem: (k, v) => void store.set(k, v) });
    expect(loadPref({ getItem: (k) => store.get(k) ?? null })).toBe('dark');
  });

  it('sets the page theme and the status bar colour', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#fff';
    document.head.append(meta);
    expect(applyTheme('dark', document, false)).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#14181a');
  });
});
