import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BookSummary } from '../../core/models';
import { Library, MAX_UPLOAD_BYTES, POLL_INTERVAL_MS } from './library';

function book(overrides: Partial<BookSummary> = {}): BookSummary {
  return {
    id: 'b1',
    title: 'The Lighthouse',
    author: 'A. Keeper',
    pageCount: 12,
    status: 'Ready',
    error: null,
    verificationStatus: 'Verified',
    pagesWithIssues: 0,
    excerpt: 'The fog came in early that autumn.',
    hasCover: false,
    createdAt: '2026-10-12T08:00:00Z',
    progress: null,
    ...overrides,
  };
}

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

describe('Library', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function create() {
    const fixture = TestBed.createComponent(Library);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a card per book with progress and verification', async () => {
    const fixture = create();
    http
      .expectOne('/api/books')
      .flush([book({ progress: { chapterNumber: 5, scrollPercent: 10, updatedAt: '' } })]);
    await flushPromises();
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('app-book-card').length).toBe(1);
    expect(el.textContent).toContain('The Lighthouse');
    expect(el.textContent).toContain('Continue: Page 5');
    expect(el.textContent).toContain('Verified 1:1');
  });

  it('polls while a book is processing and stops when it is ready', async () => {
    vi.useFakeTimers();
    const fixture = create();

    http.expectOne('/api/books').flush([book({ status: 'Processing' })]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    http.expectOne('/api/books').flush([book({ status: 'Ready' })]);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

    http.expectNone('/api/books');
    fixture.destroy();
  });

  it('stops polling when the page is left', async () => {
    vi.useFakeTimers();
    const fixture = create();
    http.expectOne('/api/books').flush([book({ status: 'Processing' })]);
    await vi.advanceTimersByTimeAsync(0);

    fixture.destroy();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

    http.expectNone('/api/books');
  });

  it('rejects non-PDF and oversized files before uploading', async () => {
    const fixture = create();
    http.expectOne('/api/books').flush([]);
    await flushPromises();
    const library = fixture.componentInstance;

    library.start(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Only PDF files');

    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: MAX_UPLOAD_BYTES + 1 });
    library.start(big);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('larger than 100 MB');

    http.expectNone('/api/books');
  });

  it('uploads a PDF and shows it as processing', async () => {
    const fixture = create();
    http.expectOne('/api/books').flush([]);
    await flushPromises();

    fixture.componentInstance.start(
      new File(['%PDF-1.7'], 'story.pdf', { type: 'application/pdf' }),
    );
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/books');
    expect(req.request.body instanceof FormData).toBe(true);
    req.flush(book({ id: 'new', title: 'story', status: 'Processing' }), {
      status: 202,
      statusText: 'Accepted',
    });
    await flushPromises();

    http.expectOne('/api/books').flush([book({ id: 'new', title: 'story', status: 'Processing' })]);
    await flushPromises();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Converting…');
    fixture.destroy();
  });
});
