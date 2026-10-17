import { InjectionToken, Injectable, inject } from '@angular/core';
import { ContentBlock, VerificationReport, VerificationStatus } from '../core/models';
import { AssembledBook, OutlineEntry, SourcePage } from '../organize/types';
import { PageSource, openWithPdfJs } from './pdf-pages';

/** A file the engine produced (PNG or JPEG). */
export interface EngineFile {
  bytes: Uint8Array;
  type: 'image/png' | 'image/jpeg';
}

/** A converted book plus its binary files: the pages as the engine read them, before they become chapters. */
export interface ConvertedBook {
  title: string;
  author: string | null;
  pageCount: number;
  pages: SourcePage[];
  /** The PDF's bookmarks, if it has any. */
  outline: OutlineEntry[];
  cover: EngineFile | null;
  /** Image files by the name the image blocks use as `src`. */
  images: Map<string, EngineFile>;
}

export interface EngineProgress {
  stage: 'processing' | 'verifying';
  done: number;
  total: number;
}

export interface ConvertOptions {
  onProgress?: (progress: EngineProgress) => void;
  /**
   * Turns the pages into the book the app stores (chapters). The engine then proof-reads exactly that book against
   * the PDF; until then it keeps the PDF and the image files.
   */
  organize: (book: ConvertedBook) => Promise<AssembledBook>;
}

/** Starts the engine worker (engine-worker.js, built into public/engine by `npm run engine`). */
export const ENGINE_WORKER = new InjectionToken<() => Worker>('ENGINE_WORKER', {
  providedIn: 'root',
  factory: () => () => new Worker(new URL('engine/engine-worker.js', document.baseURI), { type: 'module' }),
});

/** Opens a PDF for rendering the pages the engine asks for (covers, drawings, undecodable images). */
export const ENGINE_PAGES = new InjectionToken<(pdf: Uint8Array) => Promise<PageSource>>('ENGINE_PAGES', {
  providedIn: 'root',
  factory: () => openWithPdfJs,
});

type EngineBook = Omit<ConvertedBook, 'cover' | 'images'> & { hasCover: boolean };

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'progress'; stage: EngineProgress['stage']; done: number; total: number }
  | { type: 'render'; renderId: number; pageIndex: number; scale: number }
  | { type: 'result'; id: number; value: unknown }
  | { type: 'error'; id: number; message: string };

interface Job {
  pages: Promise<PageSource>;
  onProgress?: (progress: EngineProgress) => void;
}

/** Converts PDFs into books entirely in the browser: the .NET conversion engine runs in a Web Worker. */
@Injectable({ providedIn: 'root' })
export class BibEngine {
  private readonly createWorker = inject(ENGINE_WORKER);
  private readonly openPages = inject(ENGINE_PAGES);
  private worker: Promise<Worker> | null = null;
  private readonly calls = new Map<number, { resolve: (value: unknown) => void; reject: (e: Error) => void }>();
  private nextCallId = 1;
  private job: Job | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  /** Converts, organizes (by `options.organize`) and proof-reads one PDF. Conversions run one after another. */
  convert(
    pdf: Uint8Array,
    fileName: string,
    options: ConvertOptions,
  ): Promise<{ book: ConvertedBook; assembled: AssembledBook; report: VerificationReport }> {
    const run = this.queue.then(() => this.run(pdf, fileName, options));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(pdf: Uint8Array, fileName: string, options: ConvertOptions) {
    const worker = await this.start();
    // pdf.js and the engine each get their own copy: both transfer it to a worker.
    const pages = this.openPages(pdf.slice());
    pages.catch(() => undefined); // an unreadable PDF is reported by the engine
    this.job = { pages, onProgress: options.onProgress };
    try {
      const engineCopy = pdf.slice();
      const json = await this.call<string>(worker, { type: 'process', pdf: engineCopy.buffer, fileName }, [
        engineCopy.buffer,
      ]);
      const { hasCover, ...book } = JSON.parse(json) as EngineBook;

      const cover = hasCover ? toFile(await this.call<Uint8Array>(worker, { type: 'cover' }), 'cover.png') : null;
      const images = new Map<string, EngineFile>();
      for (const name of imageNames(book.pages)) {
        images.set(name, toFile(await this.call<Uint8Array>(worker, { type: 'image', name }), name));
      }
      const converted: ConvertedBook = { ...book, cover, images };
      const assembled = await options.organize(converted);

      // The engine's AssembledBook: the chapters' blocks plus every removal by page.
      const verify = JSON.stringify({
        pageCount: book.pageCount,
        chapters: assembled.chapters.map((c) => c.blocks),
        removed: assembled.removed,
      });
      const report = JSON.parse(await this.call<string>(worker, { type: 'verify', book: verify })) as VerificationReport;
      return { book: converted, assembled, report };
    } finally {
      this.job = null;
      await this.call(worker, { type: 'reset' }).catch(() => undefined);
      (await pages.catch(() => null))?.destroy();
    }
  }

  private start(): Promise<Worker> {
    this.worker ??= new Promise<Worker>((resolve, reject) => {
      const worker = this.createWorker();
      worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
        if (data.type === 'ready') {
          resolve(worker);
        } else if (data.type === 'failed') {
          reject(new Error(data.message));
        } else {
          this.handle(worker, data);
        }
      };
      worker.onerror = (e) => reject(new Error(e.message || 'The conversion engine could not be loaded.'));
    }).catch((e: Error) => {
      this.worker = null; // allow a retry
      throw e;
    });
    return this.worker;
  }

  private handle(worker: Worker, message: WorkerMessage): void {
    switch (message.type) {
      case 'progress':
        this.job?.onProgress?.({ stage: message.stage, done: message.done, total: message.total });
        break;
      case 'render':
        void this.render(worker, message);
        break;
      case 'result':
      case 'error': {
        const call = this.calls.get(message.id);
        this.calls.delete(message.id);
        if (message.type === 'result') {
          call?.resolve(message.value);
        } else {
          call?.reject(new Error(message.message));
        }
        break;
      }
    }
  }

  private async render(worker: Worker, { renderId, pageIndex, scale }: { renderId: number; pageIndex: number; scale: number }) {
    try {
      const pages = await this.job!.pages;
      const { width, height, bgra } = await pages.render(pageIndex, scale);
      worker.postMessage({ type: 'rendered', renderId, width, height, bgra: bgra.buffer }, [bgra.buffer]);
    } catch (e) {
      worker.postMessage({ type: 'renderFailed', renderId, message: String(e) });
    }
  }

  private call<T>(worker: Worker, message: object, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextCallId++;
    return new Promise<T>((resolve, reject) => {
      this.calls.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ ...message, id }, transfer);
    });
  }
}

/** The book-level verdict, mapped from the report exactly like the server does (BookConversionService). */
export function verificationSummary(report: VerificationReport): {
  status: VerificationStatus;
  pagesWithIssues: number;
} {
  const status = report.status === 'Pass' ? 'Verified' : report.status === 'Warning' ? 'Warnings' : 'Differences';
  return { status, pagesWithIssues: report.pagesFailed + report.pagesWithWarnings };
}

/** Every image file the pages refer to, once. */
export function imageNames(pages: { blocks: ContentBlock[] }[]): string[] {
  return [...new Set(pages.flatMap((p) => p.blocks.filter((b) => b.type === 'img' && b.src).map((b) => b.src!)))];
}

function toFile(bytes: Uint8Array, name: string): EngineFile {
  return { bytes, type: name.endsWith('.jpg') ? 'image/jpeg' : 'image/png' };
}
