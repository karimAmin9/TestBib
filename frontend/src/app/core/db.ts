import { InjectionToken } from '@angular/core';
import { BookSummary, ContentBlock, VerificationReport } from './models';

/**
 * On-device storage (IndexedDB). Every schema change bumps DB_VERSION and adds a step to `upgrade`, so books stored by
 * an older version of the app are migrated when the app updates.
 */
export const DB_NAME = 'bib';
export const DB_VERSION = 1;

export type StoreName = 'books' | 'chapters' | 'files' | 'reports';

export interface BookRecord extends BookSummary {
  originalFileName: string;
}

export interface ChapterRecord {
  bookId: string;
  number: number;
  title: string;
  blocks: ContentBlock[];
  removed: { kind: string; text: string }[];
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

function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore('books', { keyPath: 'id' });
    db.createObjectStore('chapters', { keyPath: ['bookId', 'number'] });
    db.createObjectStore('files', { keyPath: ['bookId', 'name'] });
    db.createObjectStore('reports', { keyPath: 'bookId' });
  }
}

export function openDatabase(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, DB_VERSION);
    open.onupgradeneeded = (e) => upgrade(open.result, e.oldVersion);
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
