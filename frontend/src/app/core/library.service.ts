import { Injectable, inject, signal } from '@angular/core';
import { BibEngine, ConvertedBook, EngineFile, EngineProgress, verificationSummary } from '../engine/bib-engine';
import { assemble } from '../organize/assemble';
import type { ChunkCache } from '../organize/claude';
import { CLAUDE, IMAGE_PREVIEW } from '../organize/organizer';
import { rulePlan } from '../organize/rules';
import { joinContinued } from '../organize/text';
import { AssembledBook, AssembledChapter } from '../organize/types';
import { validatePlan } from '../organize/validate';
import { AiSettings, AiSettingsService } from './ai-settings.service';
import {
  BookRecord,
  ChapterRecord,
  FileRecord,
  LAYOUT_VERSION,
  LIBRARY_DB,
  OrganizeRecord,
  ReportRecord,
  bookKeys,
  request,
  transaction,
} from './db';
import { BookDetail, BookSummary, Chapter, ContentBlock, PageStatus, Progress, VerificationReport } from './models';

export const MAX_BOOK_BYTES = 100 * 1024 * 1024;

/**
 * A transparent 1×1 image for `src` while an object URL loads. Never bind null: Angular turns it into `src=""`,
 * which fires an error event (and the cover would give up and show its placeholder).
 */
export const LOADING_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export const EXCERPT_LENGTH = 420;
const SOURCE = 'source.pdf';
/** Shown on a book Claude had arranged, after an app update re-arranged it by the rules. */
export const UPDATED_LAYOUT_NOTE =
  'This book was re-arranged by the layout rules after an app update. Organize it with Claude again to use Claude.';
const COVER = 'cover.png';

export class BookNotFoundError extends Error {
  constructor() {
    super('This book was not found. It may have been deleted.');
  }
}

/** The conversion that is running right now. */
export interface Conversion {
  bookId: string;
  stage: EngineProgress['stage'] | 'organizing';
  done: number;
  total: number;
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
 *
 * A conversion: the engine reads the PDF's pages → the layout rules arrange them into chapters (the book is readable
 * from here on) → Claude arranges them, if a key is set → the engine checks the final chapters 1:1 against the PDF.
 */
@Injectable({ providedIn: 'root' })
export class LocalLibrary {
  private readonly db = inject(LIBRARY_DB);
  private readonly engine = inject(BibEngine);
  private readonly ai = inject(AiSettingsService);
  private readonly claude = inject(CLAUDE);
  private readonly preview = inject(IMAGE_PREVIEW);
  private readonly fileUrls = signal<ReadonlyMap<string, string | null>>(new Map());
  private readonly loadingFiles = new Set<string>();
  private readonly queued = new Set<string>();
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
    const pages = report?.report.pages ?? [];
    return {
      book: toSummary(book),
      chapters: chapters.map((c) => ({
        number: c.number,
        title: c.title,
        firstPage: c.firstPage,
        lastPage: c.lastPage,
        verification: report ? worst(pages.filter((p) => p.page >= c.firstPage && p.page <= c.lastPage)) : null,
      })),
      pageChecks: {
        pass: pages.filter((p) => p.status === 'Pass').length,
        warn: pages.filter((p) => p.status === 'Warning').length,
        fail: pages.filter((p) => p.status === 'Fail').length,
      },
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
      chapterCount: 0,
      status: 'Processing',
      error: null,
      verificationStatus: 'None',
      pagesWithIssues: 0,
      excerpt: null,
      hasCover: false,
      createdAt: new Date().toISOString(),
      progress: null,
      organizedBy: null,
      organizeError: null,
      fixCount: 0,
      aiCost: null,
      originalFileName: fileName,
      layoutVersion: LAYOUT_VERSION,
      organize: this.ai.enabled() ? 'ai' : 'rules',
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

  /**
   * Arranges a converted book with Claude (again). The book stays readable meanwhile; the PDF is read again, so the
   * new chapters can be checked 1:1. Parts Claude already answered for are not asked (or paid) again.
   */
  async organizeWithAI(id: string): Promise<void> {
    if (!this.ai.enabled()) {
      throw new Error('Add your Claude API key in Settings first.');
    }
    if (this.queued.has(id)) {
      throw new Error('This book is being converted right now. Try again when it is done.');
    }
    await this.write(['books'], async (tx) => {
      const store = tx.objectStore('books');
      const book = await request<BookRecord | undefined>(store.get(id));
      if (!book) {
        throw new BookNotFoundError();
      }
      if (book.status !== 'Ready') {
        throw new Error('This book has not been converted yet.');
      }
      store.put({ ...book, organize: 'ai', organizeError: null } satisfies BookRecord);
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
    await this.write(['books', 'chapters', 'files', 'reports', 'organize'], async (tx) => {
      const books = tx.objectStore('books');
      if ((await request(books.getKey(id))) === undefined) {
        throw new BookNotFoundError();
      }
      books.delete(id);
      tx.objectStore('chapters').delete(bookKeys(id));
      tx.objectStore('files').delete(bookKeys(id));
      tx.objectStore('reports').delete(id);
      tx.objectStore('organize').delete(bookKeys(id));
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
      throw new Error(`This book has no chapter ${number}.`);
    }
    return {
      number,
      title: chapter.title,
      total: book.chapterCount,
      prev: number > 1 ? number - 1 : null,
      next: number < book.chapterCount ? number + 1 : null,
      firstPage: chapter.firstPage,
      lastPage: chapter.lastPage,
      blocks: chapter.blocks,
      issues: (report?.report.pages ?? []).filter(
        (p) => p.page >= chapter.firstPage && p.page <= chapter.lastPage && p.status !== 'Pass',
      ),
    };
  }

  async saveProgress(id: string, chapterNumber: number, scrollPercent: number): Promise<void> {
    await this.write(['books', 'chapters'], async (tx) => {
      const store = tx.objectStore('books');
      const book = await request<BookRecord | undefined>(store.get(id));
      if (!book) {
        throw new BookNotFoundError();
      }
      if (
        !Number.isInteger(chapterNumber) ||
        chapterNumber < 1 ||
        chapterNumber > book.chapterCount ||
        !Number.isFinite(scrollPercent) ||
        scrollPercent < 0 ||
        scrollPercent > 100
      ) {
        throw new Error('Invalid reading position.');
      }
      const chapter = await request<ChapterRecord | undefined>(tx.objectStore('chapters').get([id, chapterNumber]));
      const progress: Progress = { chapterNumber, scrollPercent, updatedAt: new Date().toISOString() };
      if (chapter) {
        const span = chapter.lastPage - chapter.firstPage + 1;
        progress.page = Math.min(chapter.lastPage, chapter.firstPage + Math.floor((scrollPercent / 100) * span));
      }
      store.put({ ...book, progress });
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

  /** `allowClaude` is false for re-conversions after an app update: those never cost anything unasked. */
  private queue(id: string, allowClaude = true): void {
    if (this.queued.has(id)) {
      return;
    }
    this.queued.add(id);
    void this.convert(id, allowClaude);
  }

  private async convert(id: string, allowClaude: boolean): Promise<void> {
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
      // The key and model at the start count: changing them in Settings affects the next book.
      const ai = allowClaude && book.organize === 'ai' && this.ai.enabled() ? this.ai.settings() : null;
      const note = !allowClaude && book.organizedBy === 'ai' ? UPDATED_LAYOUT_NOTE : null;
      const { report } = await this.engine.convert(new Uint8Array(source.bytes), book.originalFileName, {
        onProgress: (p) => this.conversion.set({ bookId: id, ...p }),
        organize: (converted) => this.organize(id, converted, ai, note),
      });
      await this.storeReport(id, report);
    } catch (e) {
      await this.markFailed(id, errorMessage(e)).catch(() => undefined);
    } finally {
      this.queued.delete(id);
      if (this.conversion()?.bookId === id) {
        this.conversion.set(null);
      }
    }
  }

  /** Chapters by the layout rules first (readable right away), then by Claude when it is to be used. */
  private async organize(
    id: string,
    converted: ConvertedBook,
    ai: AiSettings | null,
    note: string | null,
  ): Promise<AssembledBook> {
    const book = await this.read(['books'], (tx) => request<BookRecord | undefined>(tx.objectStore('books').get(id)));
    // A book converted before keeps its title (the owner may have changed it); the first chapter carries it.
    const title = book && book.pageCount > 0 ? book.title : converted.title;
    const rules = rulePlan(converted.pages, converted.outline);
    let assembled = assemble(converted.pages, validatePlan(rules, converted.pages).plan, title);
    await this.storeConverted(id, converted, assembled, title, note);
    if (!ai) {
      return assembled;
    }

    this.conversion.set({ bookId: id, stage: 'organizing', done: 0, total: 0 });
    try {
      const result = await this.claude.organize({
        apiKey: ai.apiKey,
        model: ai.model,
        title,
        pages: converted.pages,
        rules,
        preview: async (src) => {
          const file = converted.images.get(src);
          return file ? this.preview(file.bytes, file.type) : null;
        },
        cache: this.chunkCache(id),
        onProgress: (done, total) => this.conversion.set({ bookId: id, stage: 'organizing', done, total }),
      });
      if (result.failedChunks === result.chunks) {
        await this.updateBook(id, {
          organizeError: 'Claude could not organize this book; the layout rules were used.',
          aiCost: result.cost,
        });
        return assembled;
      }
      assembled = assemble(converted.pages, validatePlan(result.plan, converted.pages).plan, title);
      await this.storeChapters(id, assembled, {
        organizedBy: 'ai',
        organizeError:
          result.failedChunks > 0
            ? `Claude could not organize ${result.failedChunks} of ${result.chunks} parts of the book; the layout rules were used there.`
            : null,
        aiCost: result.cost,
      });
    } catch (e) {
      await this.updateBook(id, { organizeError: errorMessage(e) });
    }
    return assembled;
  }

  /** Stores a converted book; it is readable from here on, while organizing and the 1:1 check still run. */
  private async storeConverted(
    id: string,
    converted: ConvertedBook,
    assembled: AssembledBook,
    title: string,
    note: string | null,
  ) {
    // Everything is prepared up front: a transaction must not wait for anything but its own requests.
    const chapters = chapterRecords(id, assembled.chapters);
    const files = [...converted.images].map(([name, file]) => fileRecord(id, name, file));
    if (converted.cover) {
      files.push(fileRecord(id, COVER, converted.cover));
    }
    const excerpt = buildExcerpt(assembled.chapters);

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
        title,
        author: current.author ?? converted.author,
        pageCount: converted.pageCount,
        chapterCount: chapters.length,
        hasCover: converted.cover !== null,
        excerpt,
        status: 'Ready',
        error: null,
        verificationStatus: 'None',
        pagesWithIssues: 0,
        progress: mapProgress(current.progress, assembled.chapters),
        organizedBy: 'rules',
        organizeError: note,
        fixCount: 0,
        aiCost: null,
        layoutVersion: LAYOUT_VERSION,
      } satisfies BookRecord);
    });
    this.forgetFiles(id);
  }

  /** Replaces the chapters of a stored book (its files stay). */
  private async storeChapters(
    id: string,
    assembled: AssembledBook,
    changes: Pick<BookRecord, 'organizedBy' | 'organizeError' | 'aiCost'>,
  ): Promise<void> {
    const chapters = chapterRecords(id, assembled.chapters);
    const excerpt = buildExcerpt(assembled.chapters);
    await this.write(['books', 'chapters'], async (tx) => {
      const books = tx.objectStore('books');
      const current = await request<BookRecord | undefined>(books.get(id));
      if (!current) {
        return;
      }
      tx.objectStore('chapters').delete(bookKeys(id));
      chapters.forEach((c) => tx.objectStore('chapters').put(c));
      books.put({
        ...current,
        ...changes,
        chapterCount: chapters.length,
        excerpt,
        fixCount: assembled.fixCount,
        progress: mapProgress(current.progress, assembled.chapters),
      } satisfies BookRecord);
    });
  }

  private async storeReport(id: string, report: VerificationReport): Promise<void> {
    const { status, pagesWithIssues } = verificationSummary(report);
    await this.write(['books', 'reports'], async (tx) => {
      const books = tx.objectStore('books');
      const current = await request<BookRecord | undefined>(books.get(id));
      if (current) {
        tx.objectStore('reports').put({ bookId: id, report } satisfies ReportRecord);
        books.put({ ...current, verificationStatus: status, pagesWithIssues });
      }
    });
  }

  private async updateBook(id: string, changes: Partial<BookRecord>): Promise<void> {
    await this.write(['books'], async (tx) => {
      const store = tx.objectStore('books');
      const book = await request<BookRecord | undefined>(store.get(id));
      if (book) {
        store.put({ ...book, ...changes } satisfies BookRecord);
      }
    });
  }

  private async markFailed(id: string, message: string): Promise<void> {
    await this.updateBook(id, { status: 'Failed', error: message });
  }

  /** Claude's answers per chunk of pages, kept with the book (written quietly: pages need not re-read). */
  private chunkCache(bookId: string): ChunkCache {
    return {
      get: async (index) => {
        const record = await this.read(['organize'], (tx) =>
          request<OrganizeRecord | undefined>(tx.objectStore('organize').get([bookId, index])),
        );
        return record && { index: record.index, key: record.key, answer: record.answer, cost: record.cost };
      },
      put: async (chunk) => {
        await transaction(await this.db, ['books', 'organize'], 'readwrite', async (tx) => {
          if ((await request(tx.objectStore('books').getKey(bookId))) !== undefined) {
            tx.objectStore('organize').put({ bookId, ...chunk } satisfies OrganizeRecord);
          }
        });
      },
    };
  }

  /**
   * Books still converting, converted but never proof-read, or arranged by an older version of the app (those get
   * the layout rules; Claude only runs when the owner asks for it) when the app was closed.
   */
  private async resumeUnfinished(): Promise<void> {
    try {
      const books = await this.read(['books'], (tx) => request<BookRecord[]>(tx.objectStore('books').getAll()));
      books
        .filter(
          (b) =>
            b.status === 'Processing' ||
            (b.status === 'Ready' && (b.verificationStatus === 'None' || b.layoutVersion < LAYOUT_VERSION)),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .forEach((b) => this.queue(b.id, b.layoutVersion >= LAYOUT_VERSION));
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

/** The first paragraphs of the book's running text (headings and captions skipped), cut at a word boundary. */
export function buildExcerpt(chapters: { blocks: ContentBlock[] }[]): string | null {
  let text = '';
  for (const block of chapters.flatMap((c) => c.blocks)) {
    if (block.type !== 'p' || (block.role !== undefined && block.role !== 'body')) {
      continue;
    }
    const next = block.text ?? '';
    text = text.length === 0 ? next : block.cont ? joinContinued(text, next) : `${text} ${next}`;
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

/**
 * The reading position in newly arranged chapters: the chapter holding the page that was being read, scrolled to
 * about where that page starts.
 */
export function mapProgress(progress: Progress | null, chapters: AssembledChapter[]): Progress | null {
  if (!progress || chapters.length === 0) {
    return null;
  }
  const page = progress.page;
  if (page === undefined) {
    return { ...progress, chapterNumber: Math.min(progress.chapterNumber, chapters.length) };
  }
  const chapter =
    chapters.find((c) => page >= c.firstPage && page <= c.lastPage) ??
    chapters.find((c) => c.firstPage > page) ??
    chapters.at(-1)!;
  const span = chapter.lastPage - chapter.firstPage + 1;
  const scrollPercent = Math.round(Math.min(100, Math.max(0, (100 * (page - chapter.firstPage)) / span)));
  return { ...progress, chapterNumber: chapter.number, scrollPercent, page };
}

/** The status of a chapter: the worst of its pages. */
function worst(pages: { status: PageStatus }[]): PageStatus {
  return pages.some((p) => p.status === 'Fail') ? 'Fail' : pages.some((p) => p.status === 'Warning') ? 'Warning' : 'Pass';
}

function chapterRecords(bookId: string, chapters: AssembledChapter[]): ChapterRecord[] {
  return chapters.map(({ number, title, firstPage, lastPage, blocks }) => ({
    bookId,
    number,
    title,
    firstPage,
    lastPage,
    blocks,
  }));
}

function isPdf(bytes: ArrayBuffer): boolean {
  const header = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
  return String.fromCharCode(...header) === '%PDF-';
}

function toSummary({ originalFileName: _, layoutVersion: __, organize: ___, ...summary }: BookRecord): BookSummary {
  return summary;
}

function fileRecord(bookId: string, name: string, file: EngineFile): FileRecord {
  return { bookId, name, type: file.type, bytes: file.bytes.slice().buffer };
}
