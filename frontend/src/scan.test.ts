import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shrinkPhoto } from './scan';

let size: { width: number; height: number };
let drawn: { w: number; h: number } | null;
let blobSizes: number[];
let fail: 'none' | 'image';
let filled: { w: number; h: number } | null;

beforeEach(() => {
  size = { width: 3200, height: 2400 };
  drawn = null;
  filled = null;
  blobSizes = [500];
  fail = 'none';
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
  vi.stubGlobal(
    'Image',
    class {
      onload: () => void = () => undefined;
      onerror: () => void = () => undefined;
      naturalWidth = size.width;
      naturalHeight = size.height;
      set src(_value: string) {
        queueMicrotask(() => (fail === 'image' ? this.onerror() : this.onload()));
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    fillRect: (_x: number, _y: number, w: number, h: number) => {
      filled = { w, h };
    },
    drawImage: (_i: unknown, _x: number, _y: number, w: number, h: number) => {
      drawn = { w, h };
    },
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
    const next = blobSizes.shift() ?? 500;
    cb(new Blob(['a'.repeat(next)], { type: 'image/jpeg' }));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shrinkPhoto', () => {
  it('scales a big photo down to 1600 px on the long side and returns base64 JPEG data', async () => {
    const result = await shrinkPhoto(new File(['x'], 'p.jpg'));
    expect(drawn).toEqual({ w: 1600, h: 1200 });
    expect(atob(result)).toBe('a'.repeat(500));
  });

  it('does not enlarge a small photo', async () => {
    size = { width: 800, height: 600 };
    await shrinkPhoto(new File(['x'], 'p.jpg'));
    expect(drawn).toEqual({ w: 800, h: 600 });
  });

  it('lowers the quality until the photo is small enough', async () => {
    blobSizes = [2_000_000, 1_500_000, 900_000];
    const result = await shrinkPhoto(new File(['x'], 'p.jpg'));
    expect(atob(result)).toHaveLength(900_000);
  });

  it('gives up shrinking at the lowest quality and sends what it has', async () => {
    blobSizes = [2_000_000, 2_000_000, 2_000_000, 1_200_000];
    expect(atob(await shrinkPhoto(new File(['x'], 'p.jpg')))).toHaveLength(1_200_000);
  });

  it('paints the canvas white first so a transparent PNG does not turn black', async () => {
    await shrinkPhoto(new File(['x'], 'p.png'));
    expect(filled).toEqual({ w: 1600, h: 1200 });
  });

  it('says so when the browser cannot give a drawing surface', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(shrinkPhoto(new File(['x'], 'p.jpg'))).rejects.toThrow('could not prepare');
  });

  it('reports a photo that cannot be opened', async () => {
    fail = 'image';
    await expect(shrinkPhoto(new File(['x'], 'p.jpg'))).rejects.toThrow('could not be opened');
  });
});
