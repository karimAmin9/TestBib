import type { PDFDocumentProxy } from 'pdfjs-dist';

/** Pixels in the layout the engine expects (BGRA, as PDFium produces them on the server). */
export interface RenderedPage {
  width: number;
  height: number;
  bgra: Uint8Array;
}

/** A PDF opened for rendering pages on request of the conversion engine. */
export interface PageSource {
  render(pageIndex: number, scale: number): Promise<RenderedPage>;
  destroy(): void;
}

/** Opens a PDF with pdf.js (loaded on first use; its files are copied to /pdfjs by angular.json). */
export async function openWithPdfJs(data: Uint8Array): Promise<PageSource> {
  const pdfjs = await import('pdfjs-dist');
  const asset = (path: string) => new URL(`pdfjs/${path}`, document.baseURI).href;
  pdfjs.GlobalWorkerOptions.workerSrc = asset('pdf.worker.min.mjs');
  const doc: PDFDocumentProxy = await pdfjs.getDocument({
    data,
    cMapUrl: asset('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts/'),
    wasmUrl: asset('wasm/'),
    iccUrl: asset('iccs/'),
  }).promise;

  return {
    async render(pageIndex, scale) {
      const page = await doc.getPage(pageIndex + 1);
      try {
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        // 'print': display rendering is paced by requestAnimationFrame, which browsers pause for hidden pages, so a
        // conversion would stall whenever the app is in the background (phone screen off, another app open).
        await page.render({ canvas, viewport, intent: 'print' }).promise;
        const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        return { width: canvas.width, height: canvas.height, bgra: rgbaToBgra(rgba) };
      } finally {
        page.cleanup();
      }
    },
    destroy: () => void doc.loadingTask.destroy(),
  };
}

/** Canvases give RGBA; the engine works with BGRA. Swaps red and blue in place. */
export function rgbaToBgra(pixels: Uint8ClampedArray): Uint8Array {
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i];
    pixels[i] = pixels[i + 2];
    pixels[i + 2] = red;
  }
  return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
}
