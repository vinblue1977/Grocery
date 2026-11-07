import qrcode from 'qrcode-generator';

const QUIET = 4; // the blank border a scanner needs, in modules

/** The dark modules of a QR code for `text`, as rows of booleans. Error correction M survives a smudge or a glare. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M'); // type 0: the smallest version that fits
  qr.addData(text, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col)));
}

/** A QR code drawn as one SVG path. Always dark on white, in both themes, because scanners need the contrast. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const matrix = qrMatrix(text);
  const size = matrix.length + QUIET * 2;
  let path = '';
  matrix.forEach((cells, row) =>
    cells.forEach((dark, col) => {
      if (dark) path += `M${col + QUIET} ${row + QUIET}h1v1h-1z`;
    }),
  );
  return (
    <svg class="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shape-rendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#14181a" />
    </svg>
  );
}
