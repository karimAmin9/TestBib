import { Component, computed, inject, input, signal } from '@angular/core';
import { LOADING_IMAGE, LocalLibrary } from '../core/library.service';
import { BookSummary } from '../core/models';

/** Book cover image, or a generated placeholder while there is none. */
@Component({
  selector: 'app-book-cover',
  template: `
    @if (book().hasCover && !failed()) {
      <img
        [src]="library.coverUrl(book().id) ?? loadingImage"
        [alt]="alt() ? 'Cover of ' + book().title : ''"
        loading="lazy"
        (error)="failed.set(true)"
      />
    } @else {
      <span class="placeholder" [style.background]="gradient()">{{ initials() }}</span>
    }
  `,
  styles: `
    :host {
      display: block;
      overflow: hidden;
      border-radius: inherit;
      background: var(--surface-2);
    }
    img,
    .placeholder {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top;
    }
    img {
      background: #fff;
    }
    .placeholder {
      display: grid;
      place-items: center;
      color: rgba(255, 255, 255, 0.85);
      font-weight: 700;
      font-size: 1.6em;
    }
  `,
})
export class BookCover {
  protected readonly library = inject(LocalLibrary);
  protected readonly loadingImage = LOADING_IMAGE;
  readonly book = input.required<Pick<BookSummary, 'id' | 'title' | 'hasCover'>>();
  /** Decorative covers (next to a visible title) get an empty alt text. */
  readonly alt = input(false);
  protected readonly failed = signal(false);

  protected readonly initials = computed(() =>
    this.book()
      .title.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join(''),
  );

  protected readonly gradient = computed(() => {
    let hash = 0;
    for (const ch of this.book().title) {
      hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    return `linear-gradient(160deg, hsl(${hue} 30% 38%), hsl(${(hue + 40) % 360} 35% 20%))`;
  });
}
