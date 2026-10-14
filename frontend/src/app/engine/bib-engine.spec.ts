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
import { rgbaToBgra } from './pdf-pages';

const BOOK = {
  title: 'The Lighthouse',
  author: null,
  pageCount: 2,
  hasCover: true,
  chapters: [
    {
      number: 1,
      title: 'Page 1',
      blocks: [
        { type: 'p', text: 'Fog.' },
        { type: 'img', src: 'p1-1.jpg', w: 2, h: 2 },
      ],
      removed: [],
    },
    {
      number: 2,
      title: 'Page 2',
      blocks: [
        { type: 'img', src: 'p2-page.png', w: 4, h: 4, rendered: true },
        { type: 'img', src: 'p1-1.jpg', w: 2, h: 2 },
      ],
      removed: [{ kind: 'page-number', text: '2' }],
    },
  ],
};

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

  it('converts, renders requested pages, then proof-reads', async () => {
    const engine = create();
    const progress: EngineProgress[] = [];
    let readable: ConvertedBook | null = null;
    let verifyRequestedBeforeReadable = false;

    const { book, report } = await engine.convert(pdf, 'lighthouse.pdf', {
      onProgress: (p) => progress.push(p),
      onConverted: (b) => {
        readable = b;
        verifyRequestedBeforeReadable = worker.received.some((m) => m.type === 'verify');
      },
    });

    expect(book.title).toBe('The Lighthouse');
    expect(book.chapters.map((c) => c.title)).toEqual(['Page 1', 'Page 2']);
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
    expect(destroyed).toBe(1);
  });

  it('passes engine errors on and still releases the book', async () => {
    const engine = create('This PDF is password protected and cannot be converted.');

    await expect(engine.convert(pdf, 'locked.pdf')).rejects.toThrow('password protected');

    expect(worker.received.at(-1)?.type).toBe('reset');
    expect(destroyed).toBe(1);
  });

  it('runs conversions one after another', async () => {
    const engine = create();

    await Promise.all([engine.convert(pdf, 'a.pdf'), engine.convert(pdf, 'b.pdf')]);

    const types = worker.received.map((m) => m.type);
    expect(types.indexOf('process', 1)).toBeGreaterThan(types.indexOf('reset'));
  });

  it('gives the engine and pdf.js their own copies of the PDF', async () => {
    const engine = create();
    const original = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    await engine.convert(original, 'copy.pdf');

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
    expect(imageNames(BOOK.chapters as never)).toEqual(['p1-1.jpg', 'p2-page.png']);
  });

  it('swaps canvas RGBA into the engine’s BGRA', () => {
    const pixels = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...rgbaToBgra(pixels)]).toEqual([3, 2, 1, 4, 7, 6, 5, 8]);
  });
});
