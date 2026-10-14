import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LOADING_IMAGE, LocalLibrary } from '../core/library.service';
import { BookCover } from './book-cover';

describe('BookCover', () => {
  const url = signal<string | null>(null);

  function render(hasCover: boolean) {
    TestBed.configureTestingModule({
      providers: [{ provide: LocalLibrary, useValue: { coverUrl: () => url() } }],
    });
    const fixture = TestBed.createComponent(BookCover);
    fixture.componentRef.setInput('book', { id: 'b1', title: 'The Lighthouse Keeper', hasCover });
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => url.set(null));

  it('never renders an empty src while the cover loads', async () => {
    // An empty src fires an error event, after which the cover would stay a placeholder for good.
    const fixture = render(true);
    const img = () => (fixture.nativeElement as HTMLElement).querySelector('img')!;
    expect(img().getAttribute('src')).toBe(LOADING_IMAGE);

    url.set('blob:cover');
    await fixture.whenStable();
    expect(img().getAttribute('src')).toBe('blob:cover');
  });

  it('shows the initials of the title when there is no cover', () => {
    const el = render(false).nativeElement as HTMLElement;

    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.placeholder')?.textContent).toBe('TL');
  });
});
