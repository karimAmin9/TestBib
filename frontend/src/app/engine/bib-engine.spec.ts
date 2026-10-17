import { TestBed } from '@angular/core/testing';
import {
  BibEngine,
  ConvertedBook,
  ENGINE_PAGES,
  ENGINE_WORKER,
  EngineProgress,
  imageNames,
  verificationSummary,
} from './bib-engine';
import { AssembledBook } from '../organize/types';
import { rgbaToBgra } from './pdf-pages';

const BOOK = {
  title: 'The Lighthouse',
  author: null,
  pageCount: 2,
  hasCover: true,
  pages: [
    {
      number: 1,
      width: 420,
      height: 595,
      blocks: [
        { type: 'p', text: 'Fog.', id: 'p1-b0', page: 1, seq: 0 },
        { type: 'img', src: 'p1-1.jpg', w: 2, h: 2, id: 'p1-b1', page: 1, seq: 1 },
      ],
      removed: [],
    },
    {
      number: 2,
      width: 420,
      height: 595,
      blocks: [
        { type: 'img', src: 'p2-page.png', w: 4, h: 4, rendered: true, id: 'p2-b0', page: 2, seq: 0 },
        { type: 'img', src: 'p1-1.jpg', w: 2, h: 2, id: 'p2-b1', page: 2, seq: 1 },
      ],
      removed: [{ kind: 'page-number', text: '2' }],
    },
  ],
  outline: [{ title: 'Fog', page: 1, level: 0 }],
};

/** What the app makes of the pages: one chapter, page 2's number recorded as removed. */
const ASSEMBLED: AssembledBook = {
  chapters: [
    {
      number: 1,
      title: 'Fog',
      firstPage: 1,
      lastPage: 2,
      blocks: [...BOOK.pages[0]!.blocks, ...BOOK.pages[1]!.blocks] as AssembledBook['chapters'][number]['blocks'],
    },
  ],
  removed: [{ page: 2, kind: 'page-number', text: '2' }],
  fixCount: 0,
};
const organize = async () => ASSEMBLED;

const REPORT = { status: 'Pass', pageCount: 2, pagesPassed: 2, pagesWithWarnings: 0, pagesFailed: 0, notes: [], pages: [] };

/** Plays the worker's side of the protocol (engine-worker.js + the .NET EngineApi). */
class FakeEngineWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  readonly received: { type: string; [key: string]: unknown }[] = [];
  private renderReplied?: () => void;

  constructor(private readonly processError?: string) {
    this.emit({ type: 'ready' });
  }

  postMessage(data: { type: string; id?: number }): void {
    this.received.push(data);
    switch (data.type) {
      case 'process':
        this.emit({ type: 'progress', stage: 'processing', done: 1, total: 2 });
        this.emit({ type: 'render', renderId: 7, pageIndex: 0, scale: 0.5 });
        // Like the real engine, processing only finishes once the page was rendered.
        this.renderReplied = () => {
          this.emit({ type: 'progress', stage: 'processing', done: 2, total: 2 });
          this.emit(
            this.processError
              ? { id: data.id, type: 'error', message: this.processError }
              : { id: data.id, type: 'result', value: JSON.stringify(BOOK) },
          );
        };
        break;
      case 'rendered':
      case 'renderFailed':
        this.renderReplied?.();
        break;
      case 'cover':
        this.emit({ id: data.id, type: 'result', value: new Uint8Array([1]) });
        break;
      case 'image':
        this.emit({ id: data.id, type: 'result', value: new Uint8Array([2, 3]) });
        break;
      case 'verify':
        this.emit({ type: 'progress', stage: 'verifying', done: 2, total: 2 });
        this.emit({ id: data.id, type: 'result', value: JSON.stringify(REPORT) });
        break;
      case 'reset':
        this.emit({ id: data.id, type: 'result', value: undefined });
        break;
    }
  }

  private emit(data: object): void {
    queueMicrotask(() => this.onmessage?.({ data } as MessageEvent));
  }
}

describe('BibEngine', () => {
  let worker: FakeEngineWorker;
  let renders: [number, number][];
  let destroyed: number;

  function create(processError?: string): BibEngine {
    renders = [];
    destroyed = 0;
    TestBed.configureTestingModule({
      providers: [
        // Created when the engine starts it, like a real worker (whose 'ready' arrives after onmessage is set).
        { provide: ENGINE_WORKER, useValue: () => (worker = new FakeEngineWorker(processError)) as unknown as Worker },
        {
          provide: ENGINE_PAGES,
          useValue: async () => ({
            render: async (pageIndex: number, scale: number) => {
              renders.push([pageIndex, scale]);
              return { width: 1, height: 1, bgra: new Uint8Array([9, 9, 9, 9]) };
            },
            destroy: () => destroyed++,
          }),
        },
      ],
    });
    return TestBed.inject(BibEngine);
  }

  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

  it('converts, renders requested pages, lets the app organize, then proof-reads what it made', async () => {
    const engine = create();
    const progress: EngineProgress[] = [];
    let readable: ConvertedBook | null = null;
    let verifyRequestedBeforeReadable = false;

    const { book, assembled, report } = await engine.convert(pdf, 'lighthouse.pdf', {
      onProgress: (p) => progress.push(p),
      organize: async (b) => {
        readable = b;
        verifyRequestedBeforeReadable = worker.received.some((m) => m.type === 'verify');
        return ASSEMBLED;
      },
    });

    expect(book.title).toBe('The Lighthouse');
    expect(book.pages.map((p) => p.blocks.length)).toEqual([2, 2]);
    expect(book.outline).toEqual([{ title: 'Fog', page: 1, level: 0 }]);
    expect(assembled).toBe(ASSEMBLED);
    expect('hasCover' in book).toBe(false);
    expect(book.cover?.type).toBe('image/png');
    expect([...book.images.keys()]).toEqual(['p1-1.jpg', 'p2-page.png']);
    expect(book.images.get('p1-1.jpg')?.type).toBe('image/jpeg');
    expect(report.status).toBe('Pass');

    expect(readable).toBe(book);
    expect(verifyRequestedBeforeReadable).toBe(false);
    expect(renders).toEqual([[0, 0.5]]);
    expect(worker.received.find((m) => m.type === 'rendered')).toMatchObject({ renderId: 7, width: 1, height: 1 });
    expect(progress).toEqual([
      { stage: 'processing', done: 1, total: 2 },
      { stage: 'processing', done: 2, total: 2 },
      { stage: 'verifying', done: 2, total: 2 },
    ]);
    expect(worker.received.map((m) => m.type)).toEqual(['process', 'rendered', 'cover', 'image', 'image', 'verify', 'reset']);
    // The engine checks the chapters' blocks (it regroups them by page) and every removal.
    expect(JSON.parse(worker.received.find((m) => m.type === 'verify')!['book'] as string)).toEqual({
      pageCount: 2,
      chapters: [ASSEMBLED.chapters[0]!.blocks],
      removed: [{ page: 2, kind: 'page-number', text: '2' }],
    });
    expect(destroyed).toBe(1);
  });

  it('does not proof-read when organizing fails', async () => {
    const engine = create();

    await expect(
      engine.convert(pdf, 'lighthouse.pdf', { organize: () => Promise.reject(new Error('full disk')) }),
    ).rejects.toThrow('full disk');

    expect(worker.received.map((m) => m.type)).not.toContain('verify');
    expect(worker.received.at(-1)?.type).toBe('reset');
  });

  it('passes engine errors on and still releases the book', async () => {
    const engine = create('This PDF is password protected and cannot be converted.');

    await expect(engine.convert(pdf, 'locked.pdf', { organize })).rejects.toThrow('password protected');

    expect(worker.received.at(-1)?.type).toBe('reset');
    expect(destroyed).toBe(1);
  });

  it('runs conversions one after another', async () => {
    const engine = create();

    await Promise.all([engine.convert(pdf, 'a.pdf', { organize }), engine.convert(pdf, 'b.pdf', { organize })]);

    const types = worker.received.map((m) => m.type);
    expect(types.indexOf('process', 1)).toBeGreaterThan(types.indexOf('reset'));
  });

  it('gives the engine and pdf.js their own copies of the PDF', async () => {
    const engine = create();
    const original = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    await engine.convert(original, 'copy.pdf', { organize });

    expect(original.byteLength).toBe(4);
    expect([...original]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });
});

describe('engine helpers', () => {
  it('summarizes the report like the server', () => {
    const report = (status: string, pagesFailed: number, pagesWithWarnings: number) =>
      ({ ...REPORT, status, pagesFailed, pagesWithWarnings }) as never;

    expect(verificationSummary(report('Pass', 0, 0))).toEqual({ status: 'Verified', pagesWithIssues: 0 });
    expect(verificationSummary(report('Warning', 0, 2))).toEqual({ status: 'Warnings', pagesWithIssues: 2 });
    expect(verificationSummary(report('Fail', 1, 2))).toEqual({ status: 'Differences', pagesWithIssues: 3 });
  });

  it('lists every image file once', () => {
    expect(imageNames(BOOK.pages as never)).toEqual(['p1-1.jpg', 'p2-page.png']);
  });

  it('swaps canvas RGBA into the engine’s BGRA', () => {
    const pixels = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...rgbaToBgra(pixels)]).toEqual([3, 2, 1, 4, 7, 6, 5, 8]);
  });
});
