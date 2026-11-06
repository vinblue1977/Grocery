const MAX_SIDE = 1600; // enough to read handwriting, small enough to send quickly
const MAX_BYTES = 1_000_000; // the server accepts up to 1.5 MB

function load(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That photo could not be opened'));
    };
    image.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('That photo could not be prepared'))), 'image/jpeg', quality),
  );
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('That photo could not be read'));
    reader.readAsDataURL(blob);
  });
}

/** Shrinks a photo to a JPEG of at most about 1 MB and returns it as base64. The original never leaves the phone. */
export async function shrinkPhoto(file: File): Promise<string> {
  const image = await load(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await toBlob(canvas, quality);
    if (blob.size <= MAX_BYTES || quality === 0.4) return toBase64(blob);
  }
  throw new Error('unreachable');
}
