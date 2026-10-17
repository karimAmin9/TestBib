/** Longest side of the image previews sent to Claude: enough to see what a picture shows, cheap in tokens. */
export const PREVIEW_SIZE = 384;

/** A small JPEG of an image file, base64; null when the browser cannot decode it. */
export async function jpegPreview(bytes: Uint8Array, type: string, size = PREVIEW_SIZE): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes.slice()], { type }));
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff'; // transparent PNGs
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    return base64(new Uint8Array(await jpeg.arrayBuffer()));
  } catch {
    return null;
  }
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
