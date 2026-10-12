import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Chapter, PageVerification } from '../../core/models';
import { PROGRESS_DEBOUNCE_MS, Reader } from './reader';

function chapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    number: 2,
    title: 'Page 2',
    total: 3,
    prev: 1,
    next: 3,
    blocks: [
      { type: 'p', text: 'First paragraph.' },
      { type: 'img', src: 'p2-1.jpg', w: 64, h: 48 },
      { type: 'p', text: 'Second paragraph.' },
    ],
    verification: null,
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

describe('Reader', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    window.scrollTo = vi.fn() as never;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => vi.useRealTimers());

  async function open(c: Chapter = chapter()): Promise<ComponentFixture<Reader>> {
    const fixture = TestBed.createComponent(Reader);
    fixture.componentRef.setInput('id', 'b1');
    fixture.componentRef.setInput('n', c.number);
    fixture.detectChanges();
    http.expectOne('/api/books/b1').flush({ book: { title: 'The Lighthouse' }, chapters: [] });
    http.expectOne(`/api/books/b1/chapters/${c.number}`).flush(c);
    await fixture.whenStable();
    return fixture;
  }

  const el = (f: ComponentFixture<Reader>) => f.nativeElement as HTMLElement;
  const progressRequests = () =>
    http.match((r) => r.method === 'PUT' && r.url === '/api/books/b1/progress');

  it('renders paragraphs and images in order', async () => {
    const f = await open();

    const blocks = Array.from(el(f).querySelectorAll('article > p, article > figure'));
    expect(blocks.map((b) => b.tagName)).toEqual(['P', 'FIGURE', 'P']);
    expect(blocks[0]!.textContent).toBe('First paragraph.');
    const img = el(f).querySelector('figure img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/books/b1/images/p2-1.jpg');
    expect(img.getAttribute('width')).toBe('64');
    expect(el(f).querySelector('h1')!.textContent).toContain('Page 2');
    expect(el(f).textContent).toContain('The Lighthouse');
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

  it('disables previous on the first page', async () => {
    const f = await open(chapter({ number: 1, prev: null, next: 2 }));
    const buttons = el(f).querySelectorAll<HTMLButtonElement>('.bottom-nav button');

    expect(buttons[0]!.disabled).toBe(true);
    expect(buttons[1]!.disabled).toBe(false);
  });

  it('disables next on the last page', async () => {
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

  it('shows a dismissible note when the page differs from the PDF', async () => {
    const f = await open(chapter({ verification: failedPage() }));

    const note = el(f).querySelector('.note')!;
    expect(note.textContent).toContain('does not match the PDF exactly');
    expect(note.textContent).toContain('Missing: keeper');

    (note.querySelector('.close') as HTMLButtonElement).click();
    await f.whenStable();
    expect(el(f).querySelector('.note')).toBeNull();
  });

  it('does not show a note for verified pages', async () => {
    const f = await open(chapter({ verification: { ...failedPage(), status: 'Pass' } }));

    expect(el(f).querySelector('.note')).toBeNull();
  });

  it('saves progress when a page opens and once after scrolling stops', async () => {
    const f = await open();
    const opened = progressRequests();
    expect(opened.length).toBe(1);
    expect(opened[0]!.request.body).toEqual({ chapterNumber: 2, scrollPercent: 0 });

    vi.useFakeTimers();
    f.componentInstance.onScroll();
    f.componentInstance.onScroll();
    vi.advanceTimersByTime(PROGRESS_DEBOUNCE_MS - 1);
    expect(progressRequests().length).toBe(0);
    vi.advanceTimersByTime(1);

    expect(progressRequests().length).toBe(1);
  });

  it('applies the theme from the reader settings', async () => {
    localStorage.setItem('bib.reader-settings', JSON.stringify({ theme: 'sepia' }));
    const f = await open();

    expect(el(f).querySelector('.reader')!.classList).toContain('theme-sepia');
  });
});
