import { useEffect, useRef, useState } from 'preact/hooks';
import { parseInviteInput } from './invite';

export const SCAN_INTERVAL_MS = 250;
const MAX_FRAME_WIDTH = 480; // decoding a small copy of the frame is plenty and keeps older phones quick

interface Props {
  /** Called once with the invite code from a QR code; the camera is already off. */
  onCode: (code: string) => void;
  onCancel: () => void;
}

/**
 * Reads an invite QR code with the camera, inside the app (the iPhone Camera app would open the link in Safari, which
 * has its own sign-in separate from the Home Screen app). Frames are decoded on the phone and never stored or sent.
 * The decoder is loaded only when this screen opens, so it costs nothing at launch.
 */
export function ScanQr({ onCode, onCancel }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const callbacks = useRef({ onCode });
  callbacks.current = { onCode };

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera API');
        const opened = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped) {
          opened.getTracks().forEach((track) => track.stop()); // the person left before the camera came up
          return;
        }
        stream = opened;
        const { default: decode } = await import('jsqr');
        const el = video.current;
        if (stopped || !el) return;
        el.srcObject = opened;
        await el.play().catch(() => undefined);
        const canvas = document.createElement('canvas');
        timer = setInterval(() => {
          if (stopped || el.videoWidth === 0) return;
          try {
            const scale = Math.min(1, MAX_FRAME_WIDTH / el.videoWidth);
            canvas.width = Math.round(el.videoWidth * scale);
            canvas.height = Math.round(el.videoHeight * scale);
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) return;
            context.drawImage(el, 0, 0, canvas.width, canvas.height);
            const frame = context.getImageData(0, 0, canvas.width, canvas.height);
            const found = decode(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
            if (!found) return;
            const code = parseInviteInput(found.data);
            if (code) {
              stop();
              callbacks.current.onCode(code);
            } else {
              setMessage("That QR code isn't a Grocery invite. Ask for a new one.");
            }
          } catch {
            stop(); // a frame that can't be read (or decoded) means this camera won't work here
            setFailed(true);
          }
        }, SCAN_INTERVAL_MS);
      } catch {
        stop();
        setFailed(true);
      }
    })();

    return stop;
  }, []);

  return (
    <main class="app scan">
      <h1>Scan the QR code</h1>
      {failed ? (
        <p class="error">The camera isn't available. Allow camera access for Grocery in Settings, or paste the invite link instead.</p>
      ) : (
        <>
          <video ref={video} playsInline muted aria-label="Camera view" />
          <p class="muted">Point the camera at the QR code under Settings, Invite your partner, on the other phone.</p>
          {message && <p class="error">{message}</p>}
        </>
      )}
      <button type="button" class="link-btn" onClick={onCancel}>
        Back
      </button>
    </main>
  );
}
