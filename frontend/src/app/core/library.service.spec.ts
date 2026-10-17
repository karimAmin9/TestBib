import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { BibEngine, ConvertOptions, ConvertedBook } from '../engine/bib-engine';
import type { OrganizeOptions, OrganizeResult } from '../organize/claude';
import { CLAUDE, Claude, IMAGE_PREVIEW } from '../organize/organizer';
import { AssembledBook, Plan, emptyPlan } from '../organize/types';
import { AiSettingsService } from './ai-settings.service';
import { BookRecord, LAYOUT_VERSION, LIBRARY_DB, openDatabase } from './db';
import { ContentBlock, VerificationReport } from './models';
import {
  EXCERPT_LENGTH,
  LocalLibrary,
  UPDATED_LAYOUT_NOTE,
  buildExcerpt,
  mapProgress,
  titleFromFileName,
} from './library.service';

const block = (page: number, seq: number, b: Partial<ContentBlock>): ContentBlock => ({
  type: 'p',
  ...b,
  id: `p${page}-b${seq}`,
  page,
  seq,
  layout: { x: 50, y: 50 + 100 * seq, w: 300, h: 80, fontSize: b.type === 'h' ? 18 : 10, bold: false, italic: false },
});

/** Three pages: chapter one (with a picture on page 2), chapter two. */
const CONVERTED: ConvertedBook = {
  title: 'The Lighthouse',
  author: 'E. Keeper',
  pageCount: 3,
  pages: [
    {
      number: 1,
      width: 420,
      height: 595,
      blocks: [block(1, 0, { type: 'h', text: 'Chapter One' }), block(1, 1, { text: 'The f0g came in early.' })],
      removed: [],
    },
    {
      number: 2,
      width: 420,
      height: 595,
      blocks: [block(2, 0, { type: 'img', src: 'p2-1.jpg', w: 2, h: 2 }), block(2, 1, { text: 'It stayed all day.' })],
      removed: [{ kind: 'page-number', text: '2' }],
    },
    {
      number: 3,
      width: 420,
      height: 595,
      blocks: [block(3, 0, { type: 'h', text: 'Chapter Two' }), block(3, 1, { text: 'Night fell.' })],
      removed: [],
    },
  ],
  outline: [],
  cover: { bytes: new Uint8Array([1, 2, 3]), type: 'image/png' },
  images: new Map([['p2-1.jpg', { bytes: new Uint8Array([4, 5]), type: 'image/jpeg' as const }]]),
};

const REPORT: VerificationReport = {
  status: 'Warning',
  pageCount: 3,
  pagesPassed: 2,
  pagesWithWarnings: 1,
  pagesFailed: 0,
  notes: [],
  pages: [
    { page: 1, status: 'Pass' } as VerificationReport['pages'][number],
    { page: 2, status: 'Warning' } as VerificationReport['pages'][number],
    { page: 3, status: 'Pass' } as VerificationReport['pages'][number],
  ],
};

/** Claude's plan: its own titles and one scan fix. */
const CLAUDE_PLAN: Plan = {
  ...emptyPlan(),
  sections: [
    { start: 'p1-b0', title: 'The Fog' },
    { start: 'p3-b0', title: 'The Night' },
  ],
  fixes: [{ block: 'p1-b1', from: 'f0g', to: 'fog' }],
};

type Run = (
  pdf: Uint8Array,
  fileName: string,
  options: ConvertOptions,
) => Promise<{ book: ConvertedBook; assembled: AssembledBook; report: VerificationReport }>;

/** Stands in for the WebAssembly engine; tests swap `run` to delay, hold or fail a conversion. */
class FakeEngine {
  readonly files: string[] = [];
  /** What the library asked the engine to check. */
  readonly verified: AssembledBook[] = [];
  run: Run = async (_pdf, _name, options) => {
    options.onProgress?.({ stage: 'processing', done: 1, total: 3 });
    const assembled = await options.organize(CONVERTED);
    this.verified.push(assembled);
    options.onProgress?.({ stage: 'verifying', done: 3, total: 3 });
    return { book: CONVERTED, assembled, report: REPORT };
  };

  convert(pdf: Uint8Array, fileName: string, options: ConvertOptions) {
    this.files.push(fileName);
    return this.run(pdf, fileName, options);
  }
}

type Organize = Claude['organize'];

/** Stands in for Claude; tests swap `organize`. */
class FakeClaude implements Claude {
  readonly calls: (Omit<OrganizeOptions, 'client'> & { apiKey: string })[] = [];
  organize: Organize = async () => ({ plan: CLAUDE_PLAN, cost: 0.42, chunks: 1, failedChunks: 0 });
  checkKey = async () => undefined;
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

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function count(database: IDBDatabase, store: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const req = database.transaction(store).objectStore(store).count();
    req.onsuccess = () => resolve(req.result);
  });
}

describe('LocalLibrary', () => {
  let engine: FakeEngine;
  let claude: FakeClaude;
  let db: Promise<IDBDatabase>;
  const urls: Blob[] = [];

  function create(): LocalLibrary {
    TestBed.configureTestingModule({
      providers: [
        { provide: LIBRARY_DB, useValue: db },
        { provide: BibEngine, useValue: engine },
        { provide: CLAUDE, useValue: claude },
        { provide: IMAGE_PREVIEW, useValue: async (bytes: Uint8Array) => `preview-of-${bytes.length}-bytes` },
      ],
    });
    return TestBed.inject(LocalLibrary);
  }

  /** As if the owner had entered a key in Settings (a placeholder: Claude is a fake here). */
  const enableClaude = () => TestBed.inject(AiSettingsService).update({ apiKey: 'placeholder-key' });

  beforeEach(() => {
    localStorage.clear();
    engine = new FakeEngine();
    claude = new FakeClaude();
    const organize = claude.organize;
    claude.organize = (options) => {
      claude.calls.push(options);
      return organize(options);
    };
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

  it('adds a PDF and arranges it into chapters by the layout rules without a key', async () => {
    const library = create();

    const added = await library.add(pdf());

    expect(added.status).toBe('Processing');
    expect(added.title).toBe('my story');
    expect((await library.list()).map((b) => b.id)).toEqual([added.id]);

    const { book, chapters, pageChecks } = await ready(library, added.id);
    expect(engine.files).toEqual(['my_story.pdf']);
    expect(claude.calls).toEqual([]);
    expect(book).toMatchObject({
      title: 'The Lighthouse',
      author: 'E. Keeper',
      pageCount: 3,
      chapterCount: 2,
      status: 'Ready',
      hasCover: true,
      excerpt: 'The f0g came in early. It stayed all day. Night fell.',
      verificationStatus: 'Warnings',
      pagesWithIssues: 1,
      organizedBy: 'rules',
      organizeError: null,
      fixCount: 0,
      aiCost: null,
    });
    expect(chapters).toEqual([
      { number: 1, title: 'Chapter One', firstPage: 1, lastPage: 2, verification: 'Warning' },
      { number: 2, title: 'Chapter Two', firstPage: 3, lastPage: 3, verification: 'Pass' },
    ]);
    expect(pageChecks).toEqual({ pass: 2, warn: 1, fail: 0 });

    const one = await library.chapter(added.id, 1);
    expect(one).toMatchObject({ number: 1, total: 2, prev: null, next: 2, firstPage: 1, lastPage: 2 });
    expect(one.blocks.map((b) => b.id)).toEqual(['p1-b0', 'p1-b1', 'p2-b0', 'p2-b1']);
    expect(one.issues.map((p) => p.page)).toEqual([2]);
    expect((await library.chapter(added.id, 2)).issues).toEqual([]);
    // The engine checks what was stored, page numbers recorded as removed included.
    expect(engine.verified[0]!.removed).toEqual([{ page: 2, kind: 'page-number', text: '2' }]);
    expect(library.conversion()).toBeNull();
  });

  it('makes the book readable before the 1:1 check has finished', async () => {
    const library = create();
    const check = deferred();
    engine.run = async (_pdf, _name, options) => {
      const assembled = await options.organize(CONVERTED);
      options.onProgress?.({ stage: 'verifying', done: 1, total: 3 });
      await check.promise;
      return { book: CONVERTED, assembled, report: REPORT };
    };

    const { id } = await library.add(pdf());
    const readable = await waitFor(
      () => library.get(id),
      (d) => d.book.status === 'Ready',
    );

    expect(readable.book.verificationStatus).toBe('None');
    expect((await library.chapter(id, 1)).blocks).toHaveLength(4);
    expect(library.conversion()).toEqual({ bookId: id, stage: 'verifying', done: 1, total: 3 });

    check.resolve();
    expect((await ready(library, id)).book.verificationStatus).toBe('Warnings');
  });

  it('has Claude arrange new books when a key is set, readable by the rules meanwhile', async () => {
    const library = create();
    enableClaude();
    const answer = deferred<OrganizeResult>();
    claude.organize = (options) => {
      claude.calls.push(options);
      options.onProgress?.(1, 4);
      return answer.promise;
    };

    const { id } = await library.add(pdf());
    const meanwhile = await waitFor(
      () => library.get(id),
      (d) => d.book.status === 'Ready',
    );
    expect(meanwhile.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two']);
    await waitFor(async () => library.conversion(), (c) => c?.stage === 'organizing');
    expect(library.conversion()).toEqual({ bookId: id, stage: 'organizing', done: 1, total: 4 });

    const call = claude.calls[0]!;
    expect(call).toMatchObject({ apiKey: 'placeholder-key', model: 'claude-opus-5-5', title: 'The Lighthouse' });
    expect(call.pages).toBe(CONVERTED.pages);
    expect(call.rules.sections.map((s) => s.title)).toEqual(['Chapter One', 'Chapter Two']);
    expect(await call.preview('p2-1.jpg')).toBe('preview-of-2-bytes');
    expect(await call.preview('missing.jpg')).toBeNull();

    answer.resolve({ plan: CLAUDE_PLAN, cost: 0.42, chunks: 1, failedChunks: 0 });
    const { book, chapters } = await ready(library, id);
    expect(book).toMatchObject({ organizedBy: 'ai', organizeError: null, aiCost: 0.42, fixCount: 1, chapterCount: 2 });
    expect(chapters.map((c) => c.title)).toEqual(['The Fog', 'The Night']);
    const fixed = (await library.chapter(id, 1)).blocks[1]!;
    expect(fixed).toMatchObject({ text: 'The f0g came in early.', fixes: [{ at: 4, len: 3, to: 'fog' }] });
    // Only the final chapters are checked.
    expect(engine.verified.map((a) => a.chapters[0]!.title)).toEqual(['The Fog']);
  });

  it('keeps the rule chapters and says why when Claude cannot be used', async () => {
    const library = create();
    enableClaude();
    claude.organize = async () => {
      throw new Error('Claude did not accept the API key. Check it in Settings.');
    };

    const { id } = await library.add(pdf());
    const { book, chapters } = await ready(library, id);

    expect(book).toMatchObject({
      organizedBy: 'rules',
      organizeError: 'Claude did not accept the API key. Check it in Settings.',
      verificationStatus: 'Warnings',
    });
    expect(chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two']);
  });

  it('records the cost when Claude organized no part of the book', async () => {
    const library = create();
    enableClaude();
    claude.organize = async () => ({ plan: emptyPlan(), cost: 0.05, chunks: 2, failedChunks: 2 });

    const { id } = await library.add(pdf());
    const { book } = await ready(library, id);

    expect(book).toMatchObject({ organizedBy: 'rules', aiCost: 0.05 });
    expect(book.organizeError).toContain('could not organize');
  });

  it('notes the parts that kept the layout rules', async () => {
    const library = create();
    enableClaude();
    claude.organize = async () => ({ plan: CLAUDE_PLAN, cost: 0.3, chunks: 3, failedChunks: 1 });

    const { id } = await library.add(pdf());
    const { book } = await ready(library, id);

    expect(book.organizedBy).toBe('ai');
    expect(book.organizeError).toBe(
      'Claude could not organize 1 of 3 parts of the book; the layout rules were used there.',
    );
  });

  it('organizes a converted book with Claude on request, keeping its title and Claude’s earlier answers', async () => {
    const library = create();
    const { id } = await library.add(pdf());
    await ready(library, id);
    await library.update(id, { title: 'My Lighthouse' });

    await expect(library.organizeWithAI(id)).rejects.toThrow('API key');
    enableClaude();
    const stored = { index: 0, key: 'v1:claude-opus-5-5:abc', answer: { blocks: [] } as never, cost: 0.1 };
    claude.organize = async (options) => {
      claude.calls.push(options);
      if (claude.calls.length === 1) {
        await options.cache.put(stored);
      }
      return { plan: CLAUDE_PLAN, cost: 0.42, chunks: 1, failedChunks: 0 };
    };

    await library.organizeWithAI(id);
    await waitFor(() => library.get(id), (d) => d.book.organizedBy === 'ai' && d.book.verificationStatus !== 'None');
    await library.organizeWithAI(id);
    await waitFor(async () => claude.calls.length, (n) => n === 2);
    const { book } = await ready(library, id);

    expect(claude.calls[0]!.title).toBe('My Lighthouse');
    expect(book.title).toBe('My Lighthouse');
    expect(await claude.calls[1]!.cache.get(0)).toEqual(stored);
    expect(await claude.calls[1]!.cache.get(1)).toBeUndefined();
    expect(engine.files).toHaveLength(3); // the PDF is read again each time, for the 1:1 check
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
    enableClaude();
    const release = deferred();
    engine.run = async (_pdf, _name, options) => {
      await release.promise;
      const assembled = await options.organize(CONVERTED);
      return { book: CONVERTED, assembled, report: REPORT };
    };
    claude.organize = async (options) => {
      await options.cache.put({ index: 0, key: 'k', answer: {} as never, cost: 0 });
      return { plan: CLAUDE_PLAN, cost: 0, chunks: 1, failedChunks: 0 };
    };

    const { id } = await library.add(pdf());
    await library.delete(id);
    release.resolve();
    await new Promise((r) => setTimeout(r, 20));

    expect(await library.list()).toEqual([]);
    await expect(library.get(id)).rejects.toThrow('not found');
    const database = await db;
    for (const store of ['chapters', 'files', 'reports', 'organize']) {
      expect(await count(database, store)).toBe(0);
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

  it('validates edits and reading positions like the server, and remembers the page', async () => {
    const library = create();
    const { id } = await library.add(pdf());
    await ready(library, id);

    await expect(library.update(id, { title: '  ' })).rejects.toThrow('between 1 and 300');
    await expect(library.update(id, { author: 'x'.repeat(301) })).rejects.toThrow('at most 300');
    const updated = await library.update(id, { title: ' New title ', author: '' });
    expect(updated).toMatchObject({ title: 'New title', author: null });

    await expect(library.saveProgress(id, 3, 0)).rejects.toThrow('Invalid reading position');
    await expect(library.saveProgress(id, 1, 101)).rejects.toThrow('Invalid reading position');
    await library.saveProgress(id, 1, 60);
    expect((await library.get(id)).book.progress).toMatchObject({ chapterNumber: 1, scrollPercent: 60, page: 2 });
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

describe('library migration', () => {
  it('re-arranges books stored with one chapter per page, by the rules, keeping the reading position', async () => {
    const name = `bib-test-${crypto.randomUUID()}`;
    const v1 = await openDatabase(name, 1);
    await new Promise<void>((resolve) => {
      const tx = v1.transaction(['books', 'chapters', 'files'], 'readwrite');
      tx.objectStore('books').put({
        id: 'b1',
        title: 'Renamed by me',
        author: null,
        pageCount: 3,
        status: 'Ready',
        error: null,
        verificationStatus: 'Verified',
        pagesWithIssues: 0,
        excerpt: 'x',
        hasCover: false,
        createdAt: '2026-01-01T00:00:00Z',
        progress: { chapterNumber: 3, scrollPercent: 10, updatedAt: '2026-01-02T00:00:00Z' },
        originalFileName: 'old.pdf',
      });
      for (const n of [1, 2, 3]) {
        tx.objectStore('chapters').put({ bookId: 'b1', number: n, title: `Page ${n}`, blocks: [], removed: [] });
      }
      tx.objectStore('files').put({ bookId: 'b1', name: 'source.pdf', type: 'application/pdf', bytes: new ArrayBuffer(4) });
      tx.oncomplete = () => resolve();
    });
    v1.close();

    const engine = new FakeEngine();
    const working = engine.run;
    const release = deferred();
    engine.run = async (...args) => (await release.promise, working(...args));
    const claude = new FakeClaude();
    const called = vi.fn();
    claude.organize = async (o) => (called(), new FakeClaude().organize(o));
    TestBed.configureTestingModule({
      providers: [
        { provide: LIBRARY_DB, useValue: openDatabase(name) },
        { provide: BibEngine, useValue: engine },
        { provide: CLAUDE, useValue: claude },
      ],
    });
    localStorage.clear();
    TestBed.inject(AiSettingsService).update({ apiKey: 'placeholder-key' });
    const library = TestBed.inject(LocalLibrary);

    // Readable as before right after the update…
    const before = await library.get('b1');
    expect(before.chapters[2]).toMatchObject({ number: 3, title: 'Page 3', firstPage: 3, lastPage: 3 });
    expect(before.book).toMatchObject({ chapterCount: 3, organizedBy: null, fixCount: 0 });

    // …then arranged by the rules (never an unasked-for Claude cost), reading position on the same page.
    await library.resumed;
    release.resolve();
    const after = await waitFor(
      () => library.get('b1'),
      (d) => d.book.chapterCount === 2 && d.book.verificationStatus !== 'None',
    );
    expect(engine.files).toEqual(['old.pdf']);
    expect(called).not.toHaveBeenCalled();
    expect(after.book).toMatchObject({ title: 'Renamed by me', organizedBy: 'rules' });
    expect(after.book.progress).toMatchObject({ chapterNumber: 2, page: 3, scrollPercent: 0 });
  });
});

describe('layout updates', () => {
  it('re-arranges a book Claude had arranged by the rules only, and says how to use Claude again', async () => {
    const db = openDatabase(`bib-test-${crypto.randomUUID()}`);
    await new Promise<void>(async (resolve) => {
      const tx = (await db).transaction(['books', 'files'], 'readwrite');
      tx.objectStore('books').put({
        id: 'b1',
        title: 'The Lighthouse',
        author: null,
        pageCount: 3,
        chapterCount: 1,
        status: 'Ready',
        error: null,
        verificationStatus: 'Verified',
        pagesWithIssues: 0,
        excerpt: null,
        hasCover: false,
        createdAt: '2026-01-01T00:00:00Z',
        progress: null,
        organizedBy: 'ai',
        organizeError: null,
        fixCount: 3,
        aiCost: 1.5,
        originalFileName: 'lighthouse.pdf',
        layoutVersion: LAYOUT_VERSION - 1,
        organize: 'ai',
      } satisfies BookRecord);
      tx.objectStore('files').put({ bookId: 'b1', name: 'source.pdf', type: 'application/pdf', bytes: new ArrayBuffer(4) });
      tx.oncomplete = () => resolve();
    });
    const claude = new FakeClaude();
    const organize = vi.spyOn(claude, 'organize');
    TestBed.configureTestingModule({
      providers: [
        { provide: LIBRARY_DB, useValue: db },
        { provide: BibEngine, useValue: new FakeEngine() },
        { provide: CLAUDE, useValue: claude },
      ],
    });
    localStorage.clear();
    TestBed.inject(AiSettingsService).update({ apiKey: 'placeholder-key' });
    const library = TestBed.inject(LocalLibrary);

    await library.resumed;
    const { book } = await waitFor(
      () => library.get('b1'),
      (d) => d.book.chapterCount === 2 && d.book.verificationStatus !== 'None',
    );

    expect(organize).not.toHaveBeenCalled();
    expect(book).toMatchObject({ organizedBy: 'rules', organizeError: UPDATED_LAYOUT_NOTE, fixCount: 0 });
  });
});

describe('library helpers', () => {
  it('builds the excerpt from the running text', () => {
    const longText = Array(60).fill('lighthouse').join(' ');
    const excerpt = buildExcerpt([
      {
        blocks: [
          { type: 'h', text: 'Chapter One' },
          { type: 'p', text: 'Left: a lighthouse.', role: 'caption' },
          { type: 'p', text: 'Short start, ziem-' },
          { type: 'p', text: 'lich kurz.', cont: true },
        ],
      },
      { blocks: [{ type: 'p', text: longText }] },
    ])!;

    expect(excerpt.startsWith('Short start, ziemlich kurz. lighthouse')).toBe(true);
    expect(excerpt.endsWith('lighthouse…')).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(EXCERPT_LENGTH + 1);
    expect(buildExcerpt([{ blocks: [] }])).toBeNull();
  });

  it('moves the reading position to the chapter holding the page being read', () => {
    const chapters = [
      { number: 1, title: 'A', firstPage: 1, lastPage: 4, blocks: [] },
      { number: 2, title: 'B', firstPage: 5, lastPage: 8, blocks: [] },
    ];
    const at = (page: number | undefined, chapterNumber = 7) =>
      mapProgress({ chapterNumber, scrollPercent: 33, updatedAt: 't', page }, chapters);

    expect(at(6)).toMatchObject({ chapterNumber: 2, scrollPercent: 25, page: 6 });
    expect(at(1)).toMatchObject({ chapterNumber: 1, scrollPercent: 0 });
    expect(at(20)).toMatchObject({ chapterNumber: 2 });
    expect(at(undefined)).toMatchObject({ chapterNumber: 2, scrollPercent: 33 });
    expect(mapProgress(null, chapters)).toBeNull();
  });

  it('derives a title from the file name like the server', () => {
    expect(titleFromFileName('my_great_novel.pdf')).toBe('my great novel');
    expect(titleFromFileName('.pdf')).toBe('Untitled');
  });
});
