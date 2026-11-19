import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from './api';
import { VoiceSheet } from './VoiceSheet';

const stores = [
  { id: 'c', name: 'Costco', order: 0 },
  { id: 'p', name: 'Patel', order: 1 },
];
const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
const click = (el: Element | null) =>
  act(() => {
    (el as HTMLElement).click();
  });
const button = (root: Element, text: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) ?? null;

class Fake {
  static all: Fake[] = [];
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  stopped = false;
  constructor() {
    Fake.all.push(this);
  }
  start() {}
  stop() {
    this.stopped = true;
  }
  abort() {}
  say(text: string) {
    act(() => this.onresult?.({ results: [[{ transcript: text }]] }));
  }
}
const current = () => Fake.all[Fake.all.length - 1] as Fake;

let api: Api;
const onClose = vi.fn();
const onAdded = vi.fn();

function open(current: string | null = 'p') {
  api = { addItems: vi.fn().mockResolvedValue({ added: 2, skipped: 0 }) } as unknown as Api;
  const root = document.createElement('div');
  document.body.append(root);
  act(() => {
    render(<VoiceSheet api={api} stores={stores} currentStoreId={current} onClose={onClose} onAdded={onAdded} />, root);
  });
  return root;
}

beforeEach(() => {
  Fake.all = [];
  onClose.mockClear();
  onAdded.mockClear();
  vi.stubGlobal('webkitSpeechRecognition', Fake);
});
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('VoiceSheet', () => {
  it('listens first, and Stop finishes the recording instead of discarding it', () => {
    const root = open();
    expect(root.textContent).toContain('Listening');
    click(button(root, 'Stop'));
    expect(current().stopped).toBe(true);
  });

  it('shows what was heard for the current store; unticked and edited rows are respected', async () => {
    const root = open('p');
    current().say('milk, eggs and bread');
    expect(root.textContent).toContain('Heard 3 items');
    expect((root.querySelector('select') as HTMLSelectElement).value).toBe('p');
    await click(root.querySelector('[aria-label="Add bread"]'));
    const name = root.querySelectorAll<HTMLInputElement>('[aria-label="Item name"]')[0] as HTMLInputElement;
    act(() => {
      name.value = 'oat milk';
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button(root, 'Add 2 items'));
    await flush();
    expect(api.addItems).toHaveBeenCalledWith([
      { name: 'oat milk', note: '', storeId: 'p' },
      { name: 'eggs', note: '', storeId: 'p' },
    ]);
    expect(onAdded).toHaveBeenCalledWith({ added: 2, skipped: 0 });
  });

  it('explains a denied microphone without offering a retry', () => {
    const root = open();
    act(() => current().onerror?.({ error: 'not-allowed' }));
    expect(root.textContent).toContain('Microphone access is off');
    expect(button(root, 'Try again')).toBeNull();
  });

  it('listens again after nothing was heard', () => {
    const root = open();
    act(() => current().onend?.());
    expect(root.textContent).toContain("didn't catch");
    click(button(root, 'Try again'));
    expect(Fake.all).toHaveLength(2);
    expect(root.textContent).toContain('Listening');
  });

  it('keeps the rows and shows the message when adding fails', async () => {
    const root = open();
    current().say('milk');
    (api.addItems as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(429, 'Too many'));
    await click(button(root, 'Add 1 item'));
    await flush();
    expect(root.textContent).toContain('Too many');
    expect(onAdded).not.toHaveBeenCalled();
    expect(button(root, 'Add 1 item')).not.toBeNull();
  });

  it('cancels', async () => {
    const root = open();
    await click(button(root, 'Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
