import {
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessages } from '../../core/auth.service';
import { BooksApi } from '../../core/books.api';
import { Chapter } from '../../core/models';
import { ReaderSettingsService } from '../../core/reader-settings.service';
import { ReaderSettingsPanel } from './reader-settings-panel';

export const PROGRESS_DEBOUNCE_MS = 800;

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

@Component({
  selector: 'app-reader',
  imports: [RouterLink, ReaderSettingsPanel],
  host: {
    '(document:keydown)': 'onKey($event)',
    '(window:scroll)': 'onScroll()',
  },
  template: `
    <div
      class="reader"
      [class]="'reader theme-' + settings.settings().theme"
      [style]="settings.cssVars()"
    >
      <div class="bar">
        <a class="back" [routerLink]="['/book', id()]" [title]="bookTitle()"
          >← {{ bookTitle() || 'Back to book' }}</a
        >
        <div class="bar-nav">
          <button
            type="button"
            class="btn ghost small"
            [disabled]="!chapter()?.prev"
            (click)="go(chapter()?.prev)"
            aria-label="Previous page"
          >
            ‹
          </button>
          <label class="sr-only" for="chapter-select">Go to page</label>
          <select id="chapter-select" [value]="n()" (change)="onSelect($event)">
            @for (c of chapterNumbers(); track c) {
              <option [value]="c" [selected]="c === n()">Page {{ c }}</option>
            }
          </select>
          <button
            type="button"
            class="btn ghost small"
            [disabled]="!chapter()?.next"
            (click)="go(chapter()?.next)"
            aria-label="Next page"
          >
            ›
          </button>
        </div>
        <button
          type="button"
          class="btn ghost small aa"
          [attr.aria-expanded]="showSettings()"
          (click)="showSettings.set(!showSettings())"
          aria-label="Reading settings"
        >
          Aa
        </button>
        @if (showSettings()) {
          <app-reader-settings-panel (closed)="showSettings.set(false)" />
        }
      </div>

      <article class="text" aria-live="polite">
        @if (error(); as e) {
          <div class="error-box" role="alert">{{ e }}</div>
        }

        @if (chapter(); as c) {
          <h1 class="chapter-title">{{ c.title }}</h1>

          @if (c.verification && c.verification.status !== 'Pass' && !noteDismissed()) {
            <aside class="note" [class.fail]="c.verification.status === 'Fail'" role="note">
              <button
                type="button"
                class="close"
                (click)="noteDismissed.set(true)"
                aria-label="Dismiss"
              >
                ×
              </button>
              <strong>
                {{
                  c.verification.status === 'Fail'
                    ? 'This page does not match the PDF exactly.'
                    : 'This page was converted with notes.'
                }}
              </strong>
              <ul>
                @if (c.verification.missingWords.length) {
                  <li>Missing: {{ c.verification.missingWords.join(', ') }}</li>
                }
                @if (c.verification.extraWords.length) {
                  <li>Extra: {{ c.verification.extraWords.join(', ') }}</li>
                }
                @if (c.verification.missingCharacters) {
                  <li>Missing characters: {{ c.verification.missingCharacters }}</li>
                }
                @if (c.verification.orderSimilarity < 0.98) {
                  <li>
                    Word order differs from the PDF ({{
                      (c.verification.orderSimilarity * 100).toFixed(0)
                    }}% identical).
                  </li>
                }
                @for (issue of c.verification.imageIssues; track issue) {
                  <li>{{ issue }}</li>
                }
              </ul>
            </aside>
          }

          @for (block of c.blocks; track $index) {
            @if (block.type === 'p') {
              <p>{{ block.text }}</p>
            } @else if (block.src) {
              <figure>
                <img
                  [src]="api.imageUrl(id(), block.src)"
                  [attr.width]="block.w"
                  [attr.height]="block.h"
                  loading="lazy"
                  alt=""
                />
              </figure>
            }
          } @empty {
            <p class="empty">This page is empty in the PDF.</p>
          }

          <nav class="bottom-nav" aria-label="Page navigation">
            <button type="button" class="btn ghost" [disabled]="!c.prev" (click)="go(c.prev)">
              ‹ Previous
            </button>
            <span class="where">Page {{ c.number }} of {{ c.total }}</span>
            <button type="button" class="btn" [disabled]="!c.next" (click)="go(c.next)">
              Next ›
            </button>
          </nav>
        } @else if (!error()) {
          <p class="empty">Loading…</p>
        }
      </article>
    </div>
  `,
  styleUrl: './reader.scss',
})
export class Reader {
  protected readonly api = inject(BooksApi);
  protected readonly settings = inject(ReaderSettingsService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private loadedBookId: string | undefined;

  /** Route params / query params (component input binding). */
  readonly id = input.required<string>();
  readonly n = input.required({ transform: numberAttribute });
  readonly pos = input(undefined, { transform: optionalNumber });

  protected readonly chapter = signal<Chapter | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly bookTitle = signal('');
  protected readonly showSettings = signal(false);
  protected readonly noteDismissed = signal(false);
  protected readonly chapterNumbers = computed(() =>
    Array.from({ length: this.chapter()?.total ?? 0 }, (_, i) => i + 1),
  );

  constructor() {
    effect(() => {
      const id = this.id();
      const n = this.n();
      untracked(() => void this.load(id, n));
    });
    inject(DestroyRef).onDestroy(() => this.flushProgress());
  }

  private async load(id: string, n: number): Promise<void> {
    this.flushProgress();
    this.error.set(null);
    this.noteDismissed.set(false);
    if (this.loadedBookId !== id) {
      this.loadedBookId = id;
      this.api
        .get(id)
        .subscribe({ next: (d) => this.bookTitle.set(d.book.title), error: () => {} });
    }

    try {
      const chapter = await firstValueFrom(this.api.chapter(id, n));
      if (chapter.number !== this.n()) {
        return; // a newer navigation won
      }
      this.chapter.set(chapter);
      const restore = this.pos();
      afterNextRender(
        () => {
          window.scrollTo({ top: restore ? (restore / 100) * this.scrollable() : 0 });
          this.saveProgress(restore ?? 0);
        },
        { injector: this.injector },
      );
    } catch (e) {
      this.chapter.set(null);
      this.error.set(errorMessages(e)[0]!);
    }
  }

  go(target: number | null | undefined): void {
    if (target) {
      this.flushProgress();
      void this.router.navigate(['/book', this.id(), 'read', target]);
    }
  }

  protected onSelect(event: Event): void {
    this.go(Number((event.target as HTMLSelectElement).value));
  }

  onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) {
      return;
    }
    if (event.key === 'ArrowLeft') {
      this.go(this.chapter()?.prev);
    } else if (event.key === 'ArrowRight') {
      this.go(this.chapter()?.next);
    } else if (event.key === 'Escape') {
      this.showSettings.set(false);
    }
  }

  onScroll(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.saveProgress(this.scrollPercent());
    }, PROGRESS_DEBOUNCE_MS);
  }

  private flushProgress(): void {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      this.saveProgress(this.scrollPercent());
    }
  }

  private saveProgress(percent: number): void {
    const chapter = this.chapter();
    if (!chapter) {
      return;
    }
    const value = Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10;
    this.api.saveProgress(this.id(), chapter.number, value).subscribe({ error: () => {} });
  }

  private scrollable(): number {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  private scrollPercent(): number {
    const max = this.scrollable();
    return max > 0 ? (window.scrollY / max) * 100 : 0;
  }
}
