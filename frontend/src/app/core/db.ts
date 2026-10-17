import { InjectionToken } from '@angular/core';
import type { CachedChunk } from '../organize/claude';
import { BookSummary, ContentBlock, VerificationReport } from './models';

/**
 * On-device storage (IndexedDB). Every schema change bumps DB_VERSION and adds a step to `upgrade`, so books stored by
 * an older version of the app are migrated when the app updates.
 */
export const DB_NAME = 'bib';
export const DB_VERSION = 2;

/**
 * How books are arranged into chapters. Books stored with an older layout are converted again (with the layout
 * rules only: never an unasked-for Claude cost). 1 = one chapter per PDF page, 2 = chapters of the book's sections,
 * 3 = paragraphs also split where books mark them by an indent or a short last line.
 */
export const LAYOUT_VERSION = 3;

export type StoreName = 'books' | 'chapters' | 'files' | 'reports' | 'organize';

export interface BookRecord extends BookSummary {
  originalFileName: string;
  layoutVersion: number;
  /** How the book should be organized: by Claude (when a key is set) or by the layout rules only. */
  organize: 'ai' | 'rules';
}

export interface ChapterRecord {
  bookId: string;
  number: number;
  title: string;
  firstPage: number;
  lastPage: number;
  blocks: ContentBlock[];
}

/** The source PDF, the cover and the extracted images. Stored as bytes: Blobs don't survive every structured clone. */
export interface FileRecord {
  bookId: string;
  name: string;
  type: string;
  bytes: ArrayBuffer;
}

export interface ReportRecord {
  bookId: string;
  report: VerificationReport;
}

/** Claude's answer for one chunk of pages. */
export interface OrganizeRecord extends CachedChunk {
  bookId: string;
}

function upgrade(db: IDBDatabase, oldVersion: number, newVersion: number, tx: IDBTransaction): void {
  if (oldVersion < 1) {
    db.createObjectStore('books', { keyPath: 'id' });
    db.createObjectStore('chapters', { keyPath: ['bookId', 'number'] });
    db.createObjectStore('files', { keyPath: ['bookId', 'name'] });
    db.createObjectStore('reports', { keyPath: 'bookId' });
  }
  if (oldVersion < 2 && newVersion >= 2) {
    db.createObjectStore('organize', { keyPath: ['bookId', 'index'] });
    if (oldVersion >= 1) {
      // Chapters were PDF pages: the reading position is a page. The books are re-organized on the next start.
      const books = tx.objectStore('books');
      books.openCursor().onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          cursor.update(fromVersion1(cursor.value as BookRecord));
          cursor.continue();
        }
      };
      const chapters = tx.objectStore('chapters');
      chapters.openCursor().onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          const { removed: _, ...chapter } = cursor.value as ChapterRecord & { removed?: unknown };
          cursor.update({ ...chapter, firstPage: chapter.number, lastPage: chapter.number } satisfies ChapterRecord);
          cursor.continue();
        }
      };
    }
  }
}

function fromVersion1(book: BookRecord): BookRecord {
  return {
    ...book,
    chapterCount: book.pageCount,
    organizedBy: null,
    organizeError: null,
    fixCount: 0,
    aiCost: null,
    progress: book.progress ? { ...book.progress, page: book.progress.chapterNumber } : null,
    layoutVersion: 1,
    organize: 'rules',
  };
}

export function openDatabase(name = DB_NAME, version = DB_VERSION): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, version);
    open.onupgradeneeded = (e) => upgrade(open.result, e.oldVersion, e.newVersion ?? version, open.transaction!);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('Close Bib in your other tabs, then try again.'));
  });
}

/** The database the library uses; tests provide a fresh one. */
export const LIBRARY_DB = new InjectionToken<Promise<IDBDatabase>>('LIBRARY_DB', {
  providedIn: 'root',
  factory: () => openDatabase(),
});

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Runs `work` in one transaction and resolves when it has committed. Inside `work`, only await IndexedDB requests:
 * awaiting anything else lets the transaction auto-commit early.
 */
export async function transaction<T>(
  db: IDBDatabase,
  stores: StoreName[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(stores, mode);
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('The change was not saved.'));
  });
  try {
    const result = await work(tx);
    await committed;
    return result;
  } catch (e) {
    if (!tx.error) {
      try {
        tx.abort();
      } catch {
        // already finished
      }
    }
    committed.catch(() => undefined);
    throw e;
  }
}

/** All keys of one book in the stores keyed [bookId, …]. */
export function bookKeys(bookId: string): IDBKeyRange {
  return IDBKeyRange.bound([bookId], [bookId, []]);
}
