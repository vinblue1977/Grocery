import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const decode = vi.fn();
vi.mock('jsqr', () => ({ default: (...args: unknown[]) => decode(...args) }));

import { SCAN_INTERVAL_MS, ScanQr } from './ScanQr';

const track = { stop: vi.fn() };
const stream = { getTracks: () => [track] } as unknown as MediaStream;

function setup(getUserMedia = vi.fn().mockResolvedValue(stream)) {
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  const onCode = vi.fn();
  const onCancel = vi.fn();
  const root = document.createElement('div');
  document.body.append(root);
  act(() => {
    render(<ScanQr onCode={onCode} onCancel={onCancel} />, root);
  });
  return { root, onCode, onCancel, getUserMedia };
}

/** Lets the camera and decoder load, then runs `ticks` scan intervals. */
async function run(ticks: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS * ticks);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  decode.mockReset();
  track.stop.mockReset();
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { value: 640, configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { value: 480, configurable: true });
  HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4), width: 480, height: 360 }),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('ScanQr', () => {
  it('hands over the invite code from a QR link and turns the camera off', async () => {
    decode.mockReturnValue({ data: 'https://vinblue1977.github.io/Grocery/#join=Xk3F9xQ2mZ7vB1nTa8LcW5yRd0HeJ4uG' });
    const { onCode } = setup();
    await run(2);
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(onCode).toHaveBeenCalledWith('Xk3F9xQ2mZ7vB1nTa8LcW5yRd0HeJ4uG');
    expect(track.stop).toHaveBeenCalled();
  });

  it('keeps looking, and says so, when the QR code is not an invite', async () => {
    decode.mockReturnValue({ data: 'https://example.com/menu' });
    const { root, onCode } = setup();
    await run(2);
    expect(onCode).not.toHaveBeenCalled();
    expect(root.querySelector('.error')?.textContent).toContain("isn't a Grocery invite");
    decode.mockReturnValue({ data: 'join=abcdefgh12345678' });
    await run(1);
    expect(onCode).toHaveBeenCalledWith('abcdefgh12345678');
  });

  it('explains a refused camera and still offers Back', async () => {
    const { root, onCancel } = setup(vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')));
    await run(0);
    expect(root.querySelector('.error')?.textContent).toContain("camera isn't available");
    await act(() => (root.querySelector('button') as HTMLButtonElement).click());
    expect(onCancel).toHaveBeenCalled();
  });

  it('falls back and turns the camera off when a frame cannot be read', async () => {
    decode.mockImplementation(() => {
      throw new Error('cannot read frame');
    });
    const { root } = setup();
    await run(2);
    expect(root.querySelector('.error')?.textContent).toContain("camera isn't available");
    expect(track.stop).toHaveBeenCalled();
    const calls = decode.mock.calls.length;
    await run(3);
    expect(decode.mock.calls.length).toBe(calls); // the loop stopped; nothing keeps throwing every interval
  });

  it('turns the camera off when the person leaves, even if it came up late', async () => {
    let resolve: (s: MediaStream) => void = () => undefined;
    const slow = vi.fn().mockReturnValue(new Promise<MediaStream>((r) => (resolve = r)));
    const { root } = setup(slow);
    act(() => {
      render(null, root); // leaves the screen before the camera is ready
    });
    await act(async () => {
      resolve(stream);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(track.stop).toHaveBeenCalled();
  });

  it('turns the camera off on Back', async () => {
    const { root } = setup();
    await run(0);
    act(() => {
      render(null, root);
    });
    expect(track.stop).toHaveBeenCalled();
  });
});
