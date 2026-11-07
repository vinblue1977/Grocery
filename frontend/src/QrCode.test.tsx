import { render } from 'preact';
import decode from 'jsqr';
import { afterEach, describe, expect, it } from 'vitest';
import { buildInviteLink } from './invite';
import { QrCode, qrMatrix } from './QrCode';

afterEach(() => document.body.replaceChildren());

/** Rasterizes the matrix like a camera frame would see it: dark modules on a white quiet zone. */
function frame(matrix: boolean[][], moduleSize = 6, quiet = 4) {
  const side = (matrix.length + quiet * 2) * moduleSize;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  matrix.forEach((cells, row) =>
    cells.forEach((dark, col) => {
      if (!dark) return;
      for (let y = 0; y < moduleSize; y++)
        for (let x = 0; x < moduleSize; x++) {
          const at = (((row + quiet) * moduleSize + y) * side + (col + quiet) * moduleSize + x) * 4;
          data.fill(0, at, at + 3);
        }
    }),
  );
  return { data, side };
}

describe('QR code', () => {
  it('decodes back to the invite link it was made from', () => {
    const link = buildInviteLink('https://vinblue1977.github.io/Grocery/', 'Xk3F9xQ2mZ7vB1nTa8LcW5yRd0HeJ4uG');
    const { data, side } = frame(qrMatrix(link));
    expect(decode(data, side, side)?.data).toBe(link);
  });

  it('draws one accessible SVG, dark on white', () => {
    const root = document.createElement('div');
    document.body.append(root);
    render(<QrCode text="https://example.com/#join=abcdefgh" label="QR code for the invite link" />, root);
    const svg = root.querySelector('svg.qr');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('QR code for the invite link');
    expect(svg?.querySelector('rect')?.getAttribute('fill')).toBe('#fff');
    expect(svg?.querySelector('path')?.getAttribute('d')?.length).toBeGreaterThan(100);
    const side = qrMatrix('https://example.com/#join=abcdefgh').length + 8;
    expect(svg?.getAttribute('viewBox')).toBe(`0 0 ${side} ${side}`);
  });
});
