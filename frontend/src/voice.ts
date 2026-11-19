const MAX_NAME = 80; // same cap as the item text box
const MAX_ITEMS = 20;

interface Recognizer {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognizerCtor = new () => Recognizer;

function ctor(): RecognizerCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** True where the browser can turn speech into text (not every phone browser can, notably some home-screen apps). */
export const speechSupported = (): boolean => !!ctor();

/** "milk, eggs and bread" becomes three items. The transcript is untrusted text: trimmed, length-capped, de-duplicated. */
export function splitSpoken(transcript: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of transcript.split(/(?<!\d),|,(?!\d)|;|\n|\b(?:and then|and also|and|then|also|plus)\b/i)) {
    const name = part.replace(/\s+/g, ' ').trim().replace(/^[.\s]+|[.\s]+$/g, '').slice(0, MAX_NAME).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length === MAX_ITEMS) break;
  }
  return out;
}

export type VoiceError = 'denied' | 'none' | 'unsupported' | 'failed';

export interface Listening {
  stop: () => void; // finish now and deliver what was heard
  cancel: () => void; // drop it
}

/** Starts listening once. Exactly one of onText / onError is called, unless cancelled. */
export function listen(onText: (text: string) => void, onError: (why: VoiceError) => void): Listening {
  const Recognition = ctor();
  if (!Recognition) {
    onError('unsupported');
    return { stop: () => undefined, cancel: () => undefined };
  }
  const rec = new Recognition();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = false;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let done = false;
  const finish = (fn: () => void) => {
    if (done) return;
    done = true;
    fn();
  };
  rec.onresult = (event) => {
    const text = Array.from(event.results)
      .map((r) => r[0]?.transcript ?? '')
      .join(' ')
      .trim();
    finish(() => (text ? onText(text) : onError('none')));
  };
  rec.onerror = (event) => {
    // 'service-not-allowed' is how iOS home-screen apps refuse speech: nothing the person can switch on, so not "denied".
    const why = event.error === 'not-allowed' ? 'denied' : event.error === 'service-not-allowed' ? 'unsupported' : event.error === 'no-speech' || event.error === 'aborted' ? 'none' : 'failed';
    finish(() => onError(why));
  };
  rec.onend = () => finish(() => onError('none'));
  try {
    rec.start();
  } catch {
    finish(() => onError('failed'));
  }
  return {
    stop: () => {
      try {
        rec.stop(); // ends listening; what was heard so far still arrives
      } catch {
        // Already stopped.
      }
    },
    cancel: () => {
      done = true; // whatever arrives after this is ignored
      try {
        rec.abort();
      } catch {
        // Already stopped.
      }
    },
  };
}
