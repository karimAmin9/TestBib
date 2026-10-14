import { Injectable, inject, signal } from '@angular/core';
import { BibEngine, ConvertedBook, EngineFile, EngineProgress, verificationSummary } from '../engine/bib-engine';
import {
  BookRecord,
  ChapterRecord,
  FileRecord,
  LIBRARY_DB,
  ReportRecord,
  bookKeys,
  request,
  transaction,
} from './db';
import { BookDetail, BookSummary, Chapter, ContentBlock } from './models';

export const MAX_BOOK_BYTES = 100 * 1024 * 1024;

/**
 * A transparent 1×1 image for `src` while an object URL loads. Never bind null: Angular turns it into `src=""`,
 * which fires an error event (and the cover would give up and show its placeholder).
 */
export const LOADING_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export const EXCERPT_LENGTH = 420;
const SOURCE = 'source.pdf';
const COVER = 'cover.png';

export class BookNotFoundError extends Error {
  constructor() {
    super('This book was not found. It may have been deleted.');
  }
}

/** The conversion that is running right now. */
export interface Conversion extends EngineProgress {
  bookId: string;
}

/** A readable message for anything the library or the engine throws. */
export function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'There is not enough free storage on this device for this book.';
  }
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.';
}

/**
 * The library, stored on this device (IndexedDB). Like the server's worker, it keeps the original PDF, converts in
 * the background one book at a time, and picks up conversions that were interrupted when the app was closed.
 */
@Injectable({ providedIn: 'root' })
export class LocalLibrary {
  private readonly db = inject(LIBRARY_DB);
  private readonly engine = inject(BibEngine);
  private readonly fileUrls = signal<ReadonlyMap<string, string | null>>(new Map());
  private readonly loadingFiles = new Set<string>();
  private imageBookId: string | null = null;

  /** Bumped after every change, so pages know to read again. */
  readonly version = signal(0);
  /** Progress of the conversion that is running, if any. */
  readonly conversion = signal<Conversion | null>(null);
  /** Resolves once unfinished conversions from the last session are queued again. */
  readonly resumed: Promise<void>;

  constructor() {
    this.resumed = this.resumeUnfinished();
  }

  async list(): Promise<BookSummary[]> {
    const books = await this.read(['books'], (tx) => request<BookRecord[]>(tx.objectStore('books').getAll()));
    return books.map(toSummary).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<BookDetail> {
    const [book, chapters, report] = await this.read(['books', 'chapters', 'reports'], async (tx) => [
      await request<BookRecord | undefined>(tx.objectStore('books').get(id)),
      await request<ChapterRecord[]>(tx.objectStore('chapters').getAll(bookKeys(id))),
      await request<ReportRecord | undefined>(tx.objectStore('reports').get(id)),
    ] as const);
    if (!book) {
      throw new BookNotFoundError();
    }
    const pageStatus = new Map(report?.report.pages.map((p) => [p.page, p.status]));
    return {
      book: toSummary(book),
      chapters: chapters.map((c) => ({ number: c.number, title: c.title, verification: pageStatus.get(c.number) ?? null })),
    };
  }

  /** Stores the PDF and converts it in the background; the book shows up right away as "Converting". */
  async add(file: File): Promise<BookSummary> {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      throw new Error('Only PDF files can be added.');
    }
    if (file.size === 0) {
      throw new Error('Please choose a PDF file.');
    }
    if (file.size > MAX_BOOK_BYTES) {
      throw new Error(`The file is larger than ${MAX_BOOK_BYTES / 1024 / 1024} MB.`);
    }
    const bytes = await file.arrayBuffer();
    if (!isPdf(bytes)) {
      throw new Error('The file is not a PDF.');
    }

    const fileName = file.name.slice(0, 300);
    const book: BookRecord = {
      id: crypto.randomUUID(),
      title: titleFromFileName(fileName),
      author: null,
      pageCount: 0,
      status: 'Processing',
      error: null,
      verificationStatus: 'None',
      pagesWithIssues: 0,
      excerpt: null,
      hasCover: false,
      createdAt: new Date().toISOString(),
      progress: null,
      originalFileName: fileName,
    };
    await this.write(['books', 'files'], async (tx) => {
      tx.objectStore('books').add(book);
      tx.objectStore('files').put({ bookId: book.id, name: SOURCE, type: 'application/pdf', bytes } satisfies FileRecord);
    });
    // Ask the browser never to evict the library (Chrome grants this to installed apps).
    void navigator.storage?.persist?.().catch(() => undefined);
    this.queue(book.id);
    return toSummary(book);
  }

  /** Converts a failed book again from its stored PDF. */
  async retry(id: string): Promise<void> {
    await this.write(['books'], async (tx) => {
      const store = tx.objectStore('books');
      const book = await request<BookRecord | undefined>(store.get(id));
      if (!book) {
        throw new BookNotFoundError();
      }
      store.put({ ...book, status: 'Processing', error: null } satisfies BookRecord);
    });
    this.queue(id);
  }

  async update(id: string, changes: { title?: string; author?: string }): Promise<BookSummary> {
    const title = changes.title?.trim();
    const author = changes.author?.trim();
    if (title !== undefined && (title.length === 0 || title.length > 300)) {
      throw new Error('The title must be between 1 and 300 characters.');
    }
    if (author !== undefined && author.length > 300) {
      throw new Error('The author must be at most 300 characters.');
    }
    const updated = await this.write(['books'], async (tx) => {
      const store = tx.objectStore('books');
      const book = await request<BookRecord | undefined>(store.get(id));
      if (!book) {
        throw new BookNotFoundError();
      }
      const next: BookRecord = {
        ...book,
        title: title ?? book.title,
        author: author === undefined ? book.author : author || null,
      };
      store.put(next);
      return next;
    });
    return toSummary(updated);
  }

  async delete(id: string): Promise<void> {
    await this.write(['books', 'chapters', 'files', 'reports'], async (tx) => {
      const books = tx.objectStore('books');
      if ((await request(books.getKey(id))) === undefined) {
        throw new BookNotFoundError();
      }
      books.delete(id);
      tx.objectStore('chapters').delete(bookKeys(id));
      tx.objectStore('files').delete(bookKeys(id));
      tx.objectStore('reports').delete(id);
    });
    this.forgetFiles(id);
  }

  async chapter(id: string, number: number): Promise<Chapter> {
    const [book, chapter, report] = await this.read(['books', 'chapters', 'reports'], async (tx) => [
      await request<BookRecord | undefined>(tx.objectStore('books').get(id)),
      await request<ChapterRecord | undefined>(tx.objectStore('chapters').get([id, number])),
      await request<ReportRecord | undefined>(tx.objectStore('reports').get(id)),
    ] as const);
    if (!book || book.status !== 'Ready') {
      throw new BookNotFoundError();
    }
    if (!chapter) {
      throw new Error(`This book has no page ${number}.`);
    }
    return {
      number,
      title: chapter.title,
      total: book.pageCount,
      prev: number > 1 ? number - 1 : null,
      next: number < book.pageCount ? number + 1 : null,
      blocks: chapter.blocks,
      verification: report?.report.pages.find((p) => p.page === number) ?? null,
    };
  }

  async saveProgress(id: string, chapterNumber: number, scrollPercent: number): Promise<void> {
    await this.write(['books'], async (tx) => {
      const store = tx.objectStore('books');
      const book = await request<BookRecord | undefined>(store.get(id));
      if (!book) {
        throw new BookNotFoundError();
      }
      if (
        !Number.isInteger(chapterNumber) ||
        chapterNumber < 1 ||
        chapterNumber > book.pageCount ||
        !Number.isFinite(scrollPercent) ||
        scrollPercent < 0 ||
        scrollPercent > 100
      ) {
        throw new Error('Invalid reading position.');
      }
      store.put({ ...book, progress: { chapterNumber, scrollPercent, updatedAt: new Date().toISOString() } });
    });
  }

  /** Object URL of the cover; null while it loads (templates re-render when it arrives). */
  coverUrl(id: string): string | null {
    return this.fileUrl(id, COVER);
  }

  /** Object URL of an image block's file; null while it loads. */
  imageUrl(id: string, src: string): string | null {
    return this.fileUrl(id, src);
  }

  private queue(id: string): void {
    void this.convert(id);
  }

  private async convert(id: string): Promise<void> {
    try {
      const [book, source] = await this.read(['books', 'files'], async (tx) => [
        await request<BookRecord | undefined>(tx.objectStore('books').get(id)),
        await request<FileRecord | undefined>(tx.objectStore('files').get([id, SOURCE])),
      ] as const);
      if (!book) {
        return; // deleted before its turn
      }
      if (!source) {
        throw new Error('The original PDF of this book is missing.');
      }
      const { report } = await this.engine.convert(new Uint8Array(source.bytes), book.originalFileName, {
        onProgress: (p) => this.conversion.set({ bookId: id, ...p }),
        onConverted: (converted) => this.storeConverted(id, converted),
      });
      const { status, pagesWithIssues } = verificationSummary(report);
      await this.write(['books', 'reports'], async (tx) => {
        const books = tx.objectStore('books');
        const current = await request<BookRecord | undefined>(books.get(id));
        if (current) {
          tx.objectStore('reports').put({ bookId: id, report } satisfies ReportRecord);
          books.put({ ...current, verificationStatus: status, pagesWithIssues });
        }
      });
    } catch (e) {
      await this.markFailed(id, errorMessage(e)).catch(() => undefined);
    } finally {
      if (this.conversion()?.bookId === id) {
        this.conversion.set(null);
      }
    }
  }

  /** Stores a converted book; it is readable from here on, while the 1:1 check still runs. */
  private async storeConverted(id: string, converted: ConvertedBook): Promise<void> {
    // Everything is prepared up front: a transaction must not wait for anything but its own requests.
    const chapters: ChapterRecord[] = converted.chapters.map((c) => ({ bookId: id, ...c }));
    const files = [...converted.images].map(([name, file]) => fileRecord(id, name, file));
    if (converted.cover) {
      files.push(fileRecord(id, COVER, converted.cover));
    }
    const excerpt = buildExcerpt(converted.chapters);

    await this.write(['books', 'chapters', 'files', 'reports'], async (tx) => {
      const books = tx.objectStore('books');
      const current = await request<BookRecord | undefined>(books.get(id));
      if (!current) {
        return; // deleted during the conversion
      }
      // A re-conversion starts from scratch; only the source PDF is kept.
      const fileStore = tx.objectStore('files');
      const oldFiles = (await request(fileStore.getAllKeys(bookKeys(id)))) as [string, string][];
      oldFiles.filter(([, name]) => name !== SOURCE).forEach((key) => fileStore.delete(key));
      tx.objectStore('chapters').delete(bookKeys(id));
      tx.objectStore('reports').delete(id);

      chapters.forEach((c) => tx.objectStore('chapters').put(c));
      files.forEach((f) => fileStore.put(f));
      books.put({
        ...current,
        title: converted.title,
        author: current.author ?? converted.author,
        pageCount: converted.pageCount,
        hasCover: converted.cover !== null,
        excerpt,
        status: 'Ready',
        error: null,
        verificationStatus: 'None',
        pagesWithIssues: 0,
      } satisfies BookRecord);
    });
    this.forgetFiles(id);
  }

  private async markFailed(id: string, message: string): Promise<void> {
    await this.write(['books'], async (tx) => {
      const store = tx.objectStore('books');
      const book = await request<BookRecord | undefined>(store.get(id));
      if (book) {
        store.put({ ...book, status: 'Failed', error: message } satisfies BookRecord);
      }
    });
  }

  /** Books still converting, or converted but never proof-read, when the app was closed. */
  private async resumeUnfinished(): Promise<void> {
    try {
      const books = await this.list();
      books
        .filter((b) => b.status === 'Processing' || (b.status === 'Ready' && b.verificationStatus === 'None'))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .forEach((b) => this.queue(b.id));
    } catch {
      // Storage problems surface on the pages that read the library.
    }
  }

  private fileUrl(bookId: string, name: string): string | null {
    const key = `${bookId}/${name}`;
    const urls = this.fileUrls();
    if (!urls.has(key) && !this.loadingFiles.has(key)) {
      this.loadingFiles.add(key);
      void this.loadFile(bookId, name, key);
    }
    return urls.get(key) ?? null;
  }

  private async loadFile(bookId: string, name: string, key: string): Promise<void> {
    let url: string | null = null;
    try {
      const file = await this.read(['files'], (tx) =>
        request<FileRecord | undefined>(tx.objectStore('files').get([bookId, name])),
      );
      url = file ? URL.createObjectURL(new Blob([file.bytes], { type: file.type })) : null;
    } catch {
      // shown as a missing image
    }
    const next = new Map(this.fileUrls());
    if (name !== COVER && this.imageBookId !== bookId) {
      // Keep every cover, but the images of one book only.
      for (const [k, u] of next) {
        if (!k.endsWith(`/${COVER}`) && !k.startsWith(`${bookId}/`)) {
          if (u) URL.revokeObjectURL(u);
          next.delete(k);
        }
      }
      this.imageBookId = bookId;
    }
    this.fileUrls.set(next.set(key, url));
    this.loadingFiles.delete(key);
  }

  /** Drops cached URLs of a book whose files changed or were deleted. */
  private forgetFiles(bookId: string): void {
    const next = new Map(this.fileUrls());
    for (const [k, u] of next) {
      if (k.startsWith(`${bookId}/`)) {
        if (u) URL.revokeObjectURL(u);
        next.delete(k);
      }
    }
    this.fileUrls.set(next);
  }

  private async read<T>(stores: Parameters<typeof transaction>[1], work: (tx: IDBTransaction) => Promise<T>) {
    return transaction(await this.db, stores, 'readonly', work);
  }

  private async write<T>(stores: Parameters<typeof transaction>[1], work: (tx: IDBTransaction) => Promise<T>) {
    const result = await transaction(await this.db, stores, 'readwrite', work);
    this.version.update((v) => v + 1);
    return result;
  }
}

/** The first paragraphs of the book (headings skipped), cut at a word boundary; like the server's BuildExcerpt. */
export function buildExcerpt(chapters: { blocks: ContentBlock[] }[]): string | null {
  let text = '';
  for (const block of chapters.flatMap((c) => c.blocks)) {
    if (block.type !== 'p') {
      continue;
    }
    if (text.length > 0) {
      text += ' ';
    }
    text += block.text ?? '';
    if (text.length >= EXCERPT_LENGTH) {
      break;
    }
  }
  if (text.length === 0) {
    return null;
  }
  if (text.length <= EXCERPT_LENGTH) {
    return text;
  }
  const cut = text.slice(0, EXCERPT_LENGTH);
  const space = cut.lastIndexOf(' ');
  return (space > EXCERPT_LENGTH / 2 ? cut.slice(0, space) : cut).replace(/[,;: ]+$/, '') + '…';
}

/** "my_novel.pdf" → "my novel", like the server. */
export function titleFromFileName(fileName: string): string {
  const title = fileName.replace(/\.[^.]*$/, '').replaceAll('_', ' ').trim();
  return title || 'Untitled';
}

function isPdf(bytes: ArrayBuffer): boolean {
  const header = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
  return String.fromCharCode(...header) === '%PDF-';
}

function toSummary({ originalFileName: _, ...summary }: BookRecord): BookSummary {
  return summary;
}

function fileRecord(bookId: string, name: string, file: EngineFile): FileRecord {
  return { bookId, name, type: file.type, bytes: file.bytes.slice().buffer };
}
