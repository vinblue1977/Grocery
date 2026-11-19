import { afterEach, describe, expect, it, vi } from 'vitest';
import { listen, speechSupported, splitSpoken } from './voice';

describe('splitSpoken', () => {
  it('splits on commas and "and"', () => {
    expect(splitSpoken('milk, eggs and bread')).toEqual(['milk', 'eggs', 'bread']);
  });
  it('keeps quantities with the item', () => {
    expect(splitSpoken('two apples then a loaf of bread')).toEqual(['two apples', 'a loaf of bread']);
  });
  it('drops empties and duplicates, ignoring case', () => {
    expect(splitSpoken('Milk, milk,  , MILK and eggs.')).toEqual(['Milk', 'eggs']);
  });
  it('does not split inside words like "candy" or "sandwich"', () => {
    expect(splitSpoken('candy and sandwich')).toEqual(['candy', 'sandwich']);
  });
  it('caps each name at 80 characters and the list at 20 items', () => {
    expect(splitSpoken('x'.repeat(200))[0]).toHaveLength(80);
    const many = Array.from({ length: 30 }, (_, i) => `item${i}`).join(', ');
    expect(splitSpoken(many)).toHaveLength(20);
  });
  it('keeps numbers like 1,000 together', () => {
    expect(splitSpoken('1,000 napkins, soap')).toEqual(['1,000 napkins', 'soap']);
  });
  it('returns nothing for silence', () => {
    expect(splitSpoken('  ')).toEqual([]);
  });
});

class Fake {
  static last: Fake;
  lang = '';
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  aborted = false;
  constructor() {
    Fake.last = this;
  }
  start() {}
  stop() {}
  abort() {
    this.aborted = true;
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('listen', () => {
  it('reports unsupported browsers', () => {
    const onError = vi.fn();
    expect(speechSupported()).toBe(false);
    listen(vi.fn(), onError);
    expect(onError).toHaveBeenCalledWith('unsupported');
  });

  it('delivers the transcript once', () => {
    vi.stubGlobal('webkitSpeechRecognition', Fake);
    const onText = vi.fn();
    const onError = vi.fn();
    listen(onText, onError);
    Fake.last.onresult?.({ results: [[{ transcript: 'milk' }]] });
    Fake.last.onend?.(); // the browser ends the session after a result; must not also report an error
    expect(onText).toHaveBeenCalledExactlyOnceWith('milk');
    expect(onError).not.toHaveBeenCalled();
  });

  it('maps errors, and a silent end counts as nothing heard', () => {
    vi.stubGlobal('webkitSpeechRecognition', Fake);
    const onError = vi.fn();
    listen(vi.fn(), onError);
    Fake.last.onerror?.({ error: 'not-allowed' });
    expect(onError).toHaveBeenLastCalledWith('denied');
    listen(vi.fn(), onError);
    Fake.last.onerror?.({ error: 'service-not-allowed' });
    expect(onError).toHaveBeenLastCalledWith('unsupported');
    listen(vi.fn(), onError);
    Fake.last.onend?.();
    expect(onError).toHaveBeenLastCalledWith('none');
  });

  it('ignores a result that arrives after cancel', () => {
    vi.stubGlobal('webkitSpeechRecognition', Fake);
    const onText = vi.fn();
    const handle = listen(onText, vi.fn());
    handle.cancel();
    Fake.last.onresult?.({ results: [[{ transcript: 'late' }]] });
    expect(Fake.last.aborted).toBe(true);
    expect(onText).not.toHaveBeenCalled();
  });
});
