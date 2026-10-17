import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Conversion, LocalLibrary } from '../../core/library.service';
import { BookSummary } from '../../core/models';
import { Library } from './library';

function book(overrides: Partial<BookSummary> = {}): BookSummary {
  return {
    id: 'b1',
    title: 'The Lighthouse',
    author: 'A. Keeper',
    pageCount: 12,
    chapterCount: 6,
    status: 'Ready',
    error: null,
    verificationStatus: 'Verified',
    pagesWithIssues: 0,
    excerpt: 'The fog came in early that autumn.',
    hasCover: false,
    createdAt: '2026-10-12T08:00:00Z',
    progress: null,
    organizedBy: 'rules',
    organizeError: null,
    fixCount: 0,
    aiCost: null,
    ...overrides,
  };
}

/** Stands in for the on-device library (covered by library.service.spec.ts). */
class FakeLibrary {
  books: BookSummary[] = [];
  readonly version = signal(0);
  readonly conversion = signal<Conversion | null>(null);
  readonly list = vi.fn(async () => this.books);
  readonly add = vi.fn(async (_file: File): Promise<BookSummary> => book());
  coverUrl = () => null;

  /** What LocalLibrary does after every write. */
  changed(books: BookSummary[]): void {
    this.books = books;
    this.version.update((v) => v + 1);
  }
}

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

describe('Library', () => {
  let library: FakeLibrary;

  beforeEach(() => {
    library = new FakeLibrary();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: LocalLibrary, useValue: library }],
    });
  });

  async function create() {
    const fixture = TestBed.createComponent(Library);
    fixture.detectChanges();
    await flushPromises();
    await fixture.whenStable();
    return fixture;
  }

  const text = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement.textContent ?? '';

  it('renders a card per book with progress and verification', async () => {
    library.books = [book({ progress: { chapterNumber: 5, scrollPercent: 10, updatedAt: '' } })];
    const fixture = await create();

    expect(fixture.nativeElement.querySelectorAll('app-book-card').length).toBe(1);
    expect(text(fixture)).toContain('The Lighthouse');
    expect(text(fixture)).toContain('Continue: Chapter 5');
    expect(text(fixture)).toContain('6 chapters · 12 pages');
    expect(text(fixture)).toContain('Verified 1:1');
  });

  it('reads the library again whenever it changes', async () => {
    library.books = [book({ status: 'Processing', verificationStatus: 'None' })];
    const fixture = await create();
    expect(text(fixture)).toContain('Converting…');

    library.changed([book()]);
    await flushPromises();
    await fixture.whenStable();

    expect(library.list).toHaveBeenCalledTimes(2);
    expect(text(fixture)).toContain('Verified 1:1');
  });

  it('shows the live conversion progress and the 1:1 check on the cards', async () => {
    library.books = [
      book({ id: 'a', status: 'Processing', verificationStatus: 'None' }),
      book({ id: 'b', title: 'Second', verificationStatus: 'None' }),
    ];
    const fixture = await create();

    library.conversion.set({ bookId: 'a', stage: 'processing', done: 45, total: 270 });
    await fixture.whenStable();

    expect(text(fixture)).toContain('Converting 45/270');
    expect(text(fixture)).toContain('Checking 1:1…');

    library.conversion.set({ bookId: 'b', stage: 'organizing', done: 3, total: 27 });
    await fixture.whenStable();
    expect(text(fixture)).toContain('Claude 3/27');
  });

  it('marks books arranged by Claude', async () => {
    library.books = [book({ organizedBy: 'ai' })];
    const fixture = await create();

    expect(fixture.nativeElement.querySelector('.meta')!.textContent).toContain('Claude');
  });

  it('adds a PDF to the library', async () => {
    const fixture = await create();
    const file = new File(['%PDF-1.7'], 'story.pdf', { type: 'application/pdf' });

    await fixture.componentInstance.start(file);
    library.changed([book({ id: 'new', title: 'story', status: 'Processing', verificationStatus: 'None' })]);
    await flushPromises();
    await fixture.whenStable();

    expect(library.add).toHaveBeenCalledWith(file);
    expect(text(fixture)).toContain('story');
    expect(text(fixture)).toContain('Converting…');
  });

  it('explains why a file could not be added', async () => {
    library.add.mockRejectedValueOnce(new Error('Only PDF files can be added.'));
    const fixture = await create();

    await fixture.componentInstance.start(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    await fixture.whenStable();

    expect(text(fixture)).toContain('Only PDF files can be added.');
  });
});
