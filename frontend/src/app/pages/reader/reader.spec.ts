import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { LocalLibrary } from '../../core/library.service';
import { Chapter, PageVerification } from '../../core/models';
import { PROGRESS_DEBOUNCE_MS, Reader, displaySize } from './reader';

function chapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    number: 2,
    title: 'The Second Chapter',
    total: 3,
    prev: 1,
    next: 3,
    firstPage: 4,
    lastPage: 5,
    blocks: [
      { type: 'h', text: 'Chapter Two' },
      { type: 'p', text: 'First paragraph.' },
      { type: 'img', src: 'p2-1.jpg', w: 64, h: 48 },
      { type: 'p', text: 'Second paragraph.' },
    ],
    issues: [],
    ...overrides,
  };
}

function failedPage(): PageVerification {
  return {
    page: 2,
    status: 'Fail',
    missingCharacters: 'e',
    extraCharacters: '',
    missingWords: ['keeper'],
    extraWords: [],
    orderSimilarity: 1,
    sourceImages: 1,
    outputImages: 1,
    imageIssues: [],
    notes: [],
  };
}

/** Stands in for the on-device library (covered by library.service.spec.ts). */
class FakeLibrary {
  page = chapter();
  readonly get = vi.fn(async () => ({ book: { title: 'The Lighthouse' }, chapters: [] }));
  readonly chapter = vi.fn(async () => this.page);
  readonly saveProgress = vi.fn(async (_id: string, _n: number, _percent: number) => undefined);
  imageUrl = (id: string, src: string) => `blob:${id}/${src}`;
}

describe('Reader', () => {
  let library: FakeLibrary;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    window.scrollTo = vi.fn() as never;
    library = new FakeLibrary();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: LocalLibrary, useValue: library }],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => vi.useRealTimers());

  async function open(c: Chapter = chapter()): Promise<ComponentFixture<Reader>> {
    const fixture = TestBed.createComponent(Reader);
    fixture.componentRef.setInput('id', 'b1');
    fixture.componentRef.setInput('n', c.number);
    library.page = c;
    fixture.detectChanges();
    await new Promise<void>((r) => setTimeout(r, 0)); // the fake library's promises are not Angular tasks
    await fixture.whenStable();
    return fixture;
  }

  const el = (f: ComponentFixture<Reader>) => f.nativeElement as HTMLElement;
  const progressSaves = () => library.saveProgress.mock.calls;

  it('renders paragraphs and images in order', async () => {
    const f = await open();

    const blocks = Array.from(
      el(f).querySelectorAll('article > p, article > h2, article > figure'),
    );
    expect(blocks.map((b) => b.tagName)).toEqual(['H2', 'P', 'FIGURE', 'P']);
    expect(blocks[0]!.textContent).toBe('Chapter Two');
    expect(blocks[1]!.textContent).toBe('First paragraph.');
    const img = el(f).querySelector('figure img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('blob:b1/p2-1.jpg');
    expect(img.getAttribute('width')).toBe('64');
    expect(el(f).querySelector('h1')!.textContent).toContain('The Second Chapter');
    expect(el(f).querySelector('.chapter-book')!.textContent).toContain('The Lighthouse · Pages 4–5 of the PDF');
  });

  it('shows a paragraph that runs across pages as one, and images with their captions', async () => {
    const f = await open(
      chapter({
        blocks: [
          { type: 'p', text: 'Man kann ziem-', role: 'body' },
          { type: 'p', text: 'lich leicht sehen.', role: 'body', cont: true },
          { type: 'img', src: 'p4-1.jpg', figure: 'f1' },
          { type: 'p', text: 'Links: Freud, 1909.', role: 'caption', figure: 'f1' },
          { type: 'p', text: 'Oben: ein Turm.', role: 'caption' },
        ],
      }),
    );

    const paragraphs = Array.from(el(f).querySelectorAll('article > p'));
    expect(paragraphs.map((p) => p.textContent)).toEqual(['Man kann ziemlich leicht sehen.', 'Oben: ein Turm.']);
    expect(paragraphs[1]!.classList).toContain('caption');
    expect(el(f).querySelector('figure img')!.getAttribute('src')).toBe('blob:b1/p4-1.jpg');
    expect(el(f).querySelector('figure figcaption')!.textContent).toBe('Links: Freud, 1909.');
  });

  it('goes on with the paragraph after a picture placed in it', async () => {
    const f = await open(
      chapter({
        blocks: [
          { type: 'p', text: 'Der Text läuft weiter,', role: 'body' },
          { type: 'img', src: 'p4-1.jpg', figure: 'f1' },
          { type: 'p', text: 'und weiter.', role: 'body', cont: true },
        ],
      }),
    );

    const paragraphs = Array.from(el(f).querySelectorAll('article > p'));
    expect(paragraphs.map((p) => [p.textContent, p.classList.contains('continued')])).toEqual([
      ['Der Text läuft weiter,', false],
      ['und weiter.', true],
    ]);
  });

  it('marks scan fixes and shows the original on tap', async () => {
    const f = await open(
      chapter({ blocks: [{ type: 'p', text: 'das letzte W7ort.', fixes: [{ at: 11, len: 5, to: 'Wort' }] }] }),
    );

    const paragraph = el(f).querySelector('article > p')!;
    expect(paragraph.textContent).toBe('das letzte Wort.');
    const fix = paragraph.querySelector<HTMLButtonElement>('button.fix')!;
    expect(fix.title).toContain('W7ort');

    fix.click();
    await f.whenStable();
    expect(paragraph.textContent).toBe('das letzte W7ort.');
  });

  it('renders text without interpreting HTML', async () => {
    const f = await open(
      chapter({ blocks: [{ type: 'p', text: '<img src=x onerror=alert(1)>' }] }),
    );

    expect(el(f).querySelector('article img')).toBeNull();
    expect(el(f).textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('navigates with the next and previous buttons', async () => {
    const f = await open();
    const buttons = el(f).querySelectorAll<HTMLButtonElement>('.bottom-nav button');

    buttons[1]!.click();
    expect(navigate).toHaveBeenCalledWith(['/book', 'b1', 'read', 3]);
    buttons[0]!.click();
    expect(navigate).toHaveBeenCalledWith(['/book', 'b1', 'read', 1]);
  });

  it('disables previous on the first chapter', async () => {
    const f = await open(chapter({ number: 1, prev: null, next: 2 }));
    const buttons = el(f).querySelectorAll<HTMLButtonElement>('.bottom-nav button');

    expect(buttons[0]!.disabled).toBe(true);
    expect(buttons[1]!.disabled).toBe(false);
  });

  it('disables next on the last chapter', async () => {
    const f = await open(chapter({ number: 3, prev: 2, next: null }));
    const buttons = el(f).querySelectorAll<HTMLButtonElement>('.bottom-nav button');

    expect(buttons[1]!.disabled).toBe(true);
  });

  it('supports arrow keys but not while a form field has focus', async () => {
    const f = await open();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(navigate).toHaveBeenLastCalledWith(['/book', 'b1', 'read', 3]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(navigate).toHaveBeenLastCalledWith(['/book', 'b1', 'read', 1]);

    navigate.mockClear();
    const select = el(f).querySelector('select')!;
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows a dismissible note when pages of the chapter differ from the PDF', async () => {
    const f = await open(chapter({ issues: [failedPage()] }));

    const note = el(f).querySelector('.note')!;
    expect(note.textContent).toContain('does not match the PDF exactly');
    expect(note.textContent).toContain('Page 2: missing: keeper; missing characters: e');

    (note.querySelector('.close') as HTMLButtonElement).click();
    await f.whenStable();
    expect(el(f).querySelector('.note')).toBeNull();
  });

  it('does not show a note when every page was verified', async () => {
    const f = await open(chapter({ issues: [] }));

    expect(el(f).querySelector('.note')).toBeNull();
  });

  it('saves progress when a chapter opens and once after scrolling stops', async () => {
    const f = await open();
    expect(progressSaves()).toEqual([['b1', 2, 0]]);
    library.saveProgress.mockClear();

    vi.useFakeTimers();
    f.componentInstance.onScroll();
    f.componentInstance.onScroll();
    vi.advanceTimersByTime(PROGRESS_DEBOUNCE_MS - 1);
    expect(progressSaves().length).toBe(0);
    vi.advanceTimersByTime(1);

    expect(progressSaves().length).toBe(1);
  });

  it('applies the theme from the reader settings', async () => {
    localStorage.setItem('bib.reader-settings', JSON.stringify({ theme: 'sepia' }));
    const f = await open();

    expect(el(f).querySelector('.reader')!.classList).toContain('theme-sepia');
  });
});

describe('displaySize', () => {
  it('uses the pixel size for extracted images', () => {
    expect(displaySize({ type: 'img', src: 'p1-1.jpg', w: 800, h: 600 })).toEqual({
      w: 800,
      h: 600,
    });
  });

  it('halves images rendered from vector pages at 2x', () => {
    expect(
      displaySize({ type: 'img', src: 'p1-page.png', w: 1190, h: 1684, rendered: true }),
    ).toEqual({
      w: 595,
      h: 842,
    });
  });

  it('leaves the size to the browser when unknown', () => {
    expect(displaySize({ type: 'img', src: 'p1-1.png' })).toEqual({ w: null, h: null });
  });
});
