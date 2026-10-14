import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { BibEngine, ConvertOptions, ConvertedBook } from '../engine/bib-engine';
import { LIBRARY_DB, openDatabase } from './db';
import { VerificationReport } from './models';
import { EXCERPT_LENGTH, LocalLibrary, buildExcerpt, titleFromFileName } from './library.service';

const CONVERTED: ConvertedBook = {
  title: 'The Lighthouse',
  author: 'E. Keeper',
  pageCount: 2,
  chapters: [
    {
      number: 1,
      title: 'Page 1',
      blocks: [
        { type: 'h', text: 'Chapter One' },
        { type: 'p', text: 'The fog came in early.' },
      ],
      removed: [],
    },
    {
      number: 2,
      title: 'Page 2',
      blocks: [{ type: 'img', src: 'p2-1.jpg', w: 2, h: 2 }],
      removed: [{ kind: 'page-number', text: '2' }],
    },
  ],
  cover: { bytes: new Uint8Array([1, 2, 3]), type: 'image/png' },
  images: new Map([['p2-1.jpg', { bytes: new Uint8Array([4, 5]), type: 'image/jpeg' as const }]]),
};

const REPORT: VerificationReport = {
  status: 'Warning',
  pageCount: 2,
  pagesPassed: 1,
  pagesWithWarnings: 1,
  pagesFailed: 0,
  notes: [],
  pages: [
    { page: 1, status: 'Pass' } as VerificationReport['pages'][number],
    { page: 2, status: 'Warning' } as VerificationReport['pages'][number],
  ],
};

type Run = (pdf: Uint8Array, fileName: string, options: ConvertOptions) => Promise<{ book: ConvertedBook; report: VerificationReport }>;

/** Stands in for the WebAssembly engine; tests swap `run` to delay, hold or fail a conversion. */
class FakeEngine {
  readonly files: string[] = [];
  run: Run = async (_pdf, _name, options) => {
    options.onProgress?.({ stage: 'processing', done: 1, total: 2 });
    await options.onConverted?.(CONVERTED);
    options.onProgress?.({ stage: 'verifying', done: 2, total: 2 });
    return { book: CONVERTED, report: REPORT };
  };

  convert(pdf: Uint8Array, fileName: string, options: ConvertOptions = {}) {
    this.files.push(fileName);
    return this.run(pdf, fileName, options);
  }
}

function pdf(name = 'my_story.pdf', content = '%PDF-1.7 a tiny test file'): File {
  return new File([new TextEncoder().encode(content)], name, { type: 'application/pdf' });
}

/** Polls until `done` holds: conversions run in the background. */
async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (done(value)) {
      return value;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('Timed out waiting for the library.');
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('LocalLibrary', () => {
  let engine: FakeEngine;
  let db: Promise<IDBDatabase>;
  const urls: Blob[] = [];

  function create(): LocalLibrary {
    TestBed.configureTestingModule({
      providers: [
        { provide: LIBRARY_DB, useValue: db },
        { provide: BibEngine, useValue: engine },
      ],
    });
    return TestBed.inject(LocalLibrary);
  }

  beforeEach(() => {
    engine = new FakeEngine();
    db = openDatabase(`bib-test-${crypto.randomUUID()}`);
    urls.length = 0;
    URL.createObjectURL = (blob: Blob) => `blob:test/${urls.push(blob)}`;
    URL.revokeObjectURL = () => undefined;
  });

  const ready = (library: LocalLibrary, id: string) =>
    waitFor(
      () => library.get(id),
      (d) => d.book.status !== 'Processing' && d.book.verificationStatus !== 'None',
    );

  it('adds a PDF and converts it in the background', async () => {
    const library = create();

    const added = await library.add(pdf());

    expect(added.status).toBe('Processing');
    expect(added.title).toBe('my story');
    expect((await library.list()).map((b) => b.id)).toEqual([added.id]);

    const { book, chapters } = await ready(library, added.id);
    expect(engine.files).toEqual(['my_story.pdf']);
    expect(book).toMatchObject({
      title: 'The Lighthouse',
      author: 'E. Keeper',
      pageCount: 2,
      status: 'Ready',
      hasCover: true,
      excerpt: 'The fog came in early.',
      verificationStatus: 'Warnings',
      pagesWithIssues: 1,
    });
    expect(chapters).toEqual([
      { number: 1, title: 'Page 1', verification: 'Pass' },
      { number: 2, title: 'Page 2', verification: 'Warning' },
    ]);

    const page2 = await library.chapter(added.id, 2);
    expect(page2).toMatchObject({ number: 2, total: 2, prev: 1, next: null, blocks: CONVERTED.chapters[1]!.blocks });
    expect(page2.verification?.status).toBe('Warning');
    expect(library.conversion()).toBeNull();
  });

  it('makes the book readable before the 1:1 check has finished', async () => {
    const library = create();
    const check = deferred();
    engine.run = async (_pdf, _name, options) => {
      await options.onConverted?.(CONVERTED);
      options.onProgress?.({ stage: 'verifying', done: 1, total: 2 });
      await check.promise;
      return { book: CONVERTED, report: REPORT };
    };

    const { id } = await library.add(pdf());
    const readable = await waitFor(
      () => library.get(id),
      (d) => d.book.status === 'Ready',
    );

    expect(readable.book.verificationStatus).toBe('None');
    expect((await library.chapter(id, 1)).blocks).toHaveLength(2);
    expect(library.conversion()).toEqual({ bookId: id, stage: 'verifying', done: 1, total: 2 });

    check.resolve();
    expect((await ready(library, id)).book.verificationStatus).toBe('Warnings');
  });

  it('serves the cover and images as object URLs', async () => {
    const library = create();
    const { id } = await library.add(pdf());
    await ready(library, id);

    expect(library.coverUrl(id)).toBeNull(); // loads in the background, the template re-renders
    const cover = await waitFor(async () => library.coverUrl(id), (url) => url !== null);
    const image = await waitFor(async () => library.imageUrl(id, 'p2-1.jpg'), (url) => url !== null);

    expect(cover).toMatch(/^blob:/);
    expect(image).toMatch(/^blob:/);
    expect(urls.map((b) => b.type)).toEqual(['image/png', 'image/jpeg']);
    expect([...new Uint8Array(await urls[1]!.arrayBuffer())]).toEqual([4, 5]);
    expect(await waitFor(async () => library.imageUrl(id, 'p9-9.png'), () => true)).toBeNull();
  });

  it('records a failed conversion and converts it again on retry', async () => {
    const library = create();
    const working = engine.run;
    engine.run = async () => {
      throw new Error('This PDF is password protected and cannot be converted.');
    };

    const { id } = await library.add(pdf('locked.pdf'));
    const failed = await waitFor(
      () => library.get(id),
      (d) => d.book.status === 'Failed',
    );
    expect(failed.book.error).toBe('This PDF is password protected and cannot be converted.');

    engine.run = working;
    await library.retry(id);
    expect((await ready(library, id)).book.status).toBe('Ready');
  });

  it('deletes everything of a book, even while it is being converted', async () => {
    const library = create();
    const release = deferred();
    engine.run = async (_pdf, _name, options) => {
      await release.promise;
      await options.onConverted?.(CONVERTED);
      return { book: CONVERTED, report: REPORT };
    };

    const { id } = await library.add(pdf());
    await library.delete(id);
    release.resolve();
    await new Promise((r) => setTimeout(r, 20));

    expect(await library.list()).toEqual([]);
    await expect(library.get(id)).rejects.toThrow('not found');
    const database = await db;
    for (const store of ['chapters', 'files', 'reports']) {
      const count = await new Promise<number>((resolve) => {
        const req = database.transaction(store).objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
      });
      expect(count).toBe(0);
    }
  });

  it('resumes conversions that were interrupted when the app closed', async () => {
    engine.run = () => new Promise(() => undefined); // the app is closed mid-conversion
    const { id } = await create().add(pdf());

    TestBed.resetTestingModule();
    engine = new FakeEngine();
    const reopened = create();
    await reopened.resumed;

    expect((await ready(reopened, id)).book.status).toBe('Ready');
    expect(engine.files).toEqual(['my_story.pdf']);
  });

  it('validates edits and reading positions like the server', async () => {
    const library = create();
    const { id } = await library.add(pdf());
    await ready(library, id);

    await expect(library.update(id, { title: '  ' })).rejects.toThrow('between 1 and 300');
    await expect(library.update(id, { author: 'x'.repeat(301) })).rejects.toThrow('at most 300');
    const updated = await library.update(id, { title: ' New title ', author: '' });
    expect(updated).toMatchObject({ title: 'New title', author: null });

    await expect(library.saveProgress(id, 3, 0)).rejects.toThrow('Invalid reading position');
    await expect(library.saveProgress(id, 1, 101)).rejects.toThrow('Invalid reading position');
    await library.saveProgress(id, 2, 42.5);
    expect((await library.get(id)).book.progress).toMatchObject({ chapterNumber: 2, scrollPercent: 42.5 });
  });

  it('only accepts PDF files', async () => {
    const library = create();

    await expect(library.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }))).rejects.toThrow(
      'Only PDF files',
    );
    await expect(library.add(pdf('fake.pdf', 'hello'))).rejects.toThrow('not a PDF');
    await expect(library.add(new File([], 'empty.pdf'))).rejects.toThrow('choose a PDF');
    expect(await library.list()).toEqual([]);
  });
});

describe('library helpers', () => {
  it('builds the excerpt like the server', () => {
    const longText = Array(60).fill('lighthouse').join(' ');
    const excerpt = buildExcerpt([
      { blocks: [{ type: 'h', text: 'Chapter One' }, { type: 'p', text: 'Short start.' }] },
      { blocks: [{ type: 'p', text: longText }] },
    ])!;

    expect(excerpt.startsWith('Short start. lighthouse')).toBe(true);
    expect(excerpt.endsWith('lighthouse…')).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(EXCERPT_LENGTH + 1);
    expect(buildExcerpt([{ blocks: [] }])).toBeNull();
  });

  it('derives a title from the file name like the server', () => {
    expect(titleFromFileName('my_great_novel.pdf')).toBe('my great novel');
    expect(titleFromFileName('.pdf')).toBe('Untitled');
  });
});
