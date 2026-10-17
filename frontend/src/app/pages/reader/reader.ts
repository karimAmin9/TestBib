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
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { LOADING_IMAGE, LocalLibrary, errorMessage } from '../../core/library.service';
import { Chapter, ChapterRef, ContentBlock } from '../../core/models';
import { ReaderSettingsService } from '../../core/reader-settings.service';
import { Icon } from '../../shared/icon';
import { ReaderSettingsPanel } from './reader-settings-panel';
import { Segment, describeIssue, pageRange, readingItems } from './reading';

export const PROGRESS_DEBOUNCE_MS = 800;

/** Pages rendered from vector drawings are stored at 2× (144 dpi); show them at their real size. */
export const RENDER_SCALE = 2;

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Display size hint for an image block in CSS pixels (the image still shrinks to fit the column). */
export function displaySize(block: ContentBlock): { w: number | null; h: number | null } {
  if (!block.w || !block.h) {
    return { w: null, h: null };
  }
  const scale = block.rendered ? RENDER_SCALE : 1;
  return { w: Math.round(block.w / scale), h: Math.round(block.h / scale) };
}

@Component({
  selector: 'app-reader',
  imports: [NgTemplateOutlet, RouterLink, ReaderSettingsPanel, Icon],
  host: {
    '(document:keydown)': 'onKey($event)',
    '(window:scroll)': 'onScroll()',
  },
  template: `
    <div
      class="page with-sidebar reader"
      [class]="'page with-sidebar reader theme-' + settings.settings().theme"
      [style]="settings.cssVars()"
    >
      <section class="main">
        <div class="reader-col">
          <nav class="breadcrumbs" aria-label="Breadcrumb">
            <a routerLink="/">Library</a><span class="sep">»</span>
            <a [routerLink]="['/book', id()]">{{ bookTitle() || 'Book' }}</a
            ><span class="sep">»</span>
            <span>{{ chapter()?.title ?? 'Chapter ' + n() }}</span>
          </nav>

          <div class="options-row">
            <button
              type="button"
              class="link-action"
              [attr.aria-expanded]="showSettings()"
              aria-controls="reader-options"
              aria-label="Reading settings"
              (click)="showSettings.set(!showSettings())"
            >
              <app-icon name="gear" [size]="15" />Options
            </button>
            <label class="goto">
              <span class="sr-only">Go to chapter</span>
              <select [value]="n()" (change)="onSelect($event)">
                @for (c of chapterOptions(); track c.number) {
                  <option [value]="c.number" [selected]="c.number === n()">{{ c.number }}. {{ c.title }}</option>
                }
              </select>
            </label>
          </div>

          @if (showSettings()) {
            <app-reader-settings-panel id="reader-options" (closed)="showSettings.set(false)" />
          }

          <nav class="nav-row" aria-label="Chapter navigation (top)">
            <button
              type="button"
              class="btn"
              [disabled]="!chapter()?.prev"
              (click)="go(chapter()?.prev)"
            >
              « Back
            </button>
            <a class="btn list" [routerLink]="['/book', id()]" fragment="chapters">Chapters list</a>
            <button
              type="button"
              class="btn"
              [disabled]="!chapter()?.next"
              (click)="go(chapter()?.next)"
            >
              Next »
            </button>
          </nav>

          <article class="text" aria-live="polite">
            @if (error(); as e) {
              <div class="error-box" role="alert">{{ e }}</div>
            }

            @if (chapter(); as c) {
              <h1 class="chapter-title">{{ c.title }}</h1>
              <div class="chapter-book muted">
                {{ bookTitle() }}@if (pages(c); as p) {
                  · {{ p }} of the PDF
                }
              </div>

              @if (c.issues.length && !noteDismissed()) {
                <aside class="note" [class.fail]="hasFailure(c)" role="note">
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
                      hasFailure(c)
                        ? 'Part of this chapter does not match the PDF exactly.'
                        : 'Part of this chapter was converted with notes.'
                    }}
                  </strong>
                  <ul>
                    @for (p of c.issues; track p.page) {
                      <li>Page {{ p.page }}: {{ describe(p) }}</li>
                    }
                  </ul>
                </aside>
              }

              <ng-template #text let-segments>
                @for (s of segments; track $index) {
                  @if (s.original !== undefined) {
                    <button
                      type="button"
                      class="fix"
                      [class.showing]="shownFix() === s"
                      [attr.title]="'Scan fix. The PDF has: ' + s.original"
                      (click)="toggleFix(s)"
                    >{{ shownFix() === s ? s.original : s.text }}</button>
                  } @else {
                    <span>{{ s.text }}</span>
                  }
                }
              </ng-template>

              @for (item of items(); track $index) {
                @switch (item.kind) {
                  @case ('figure') {
                    <figure>
                      @for (img of item.images; track $index) {
                        @if (img.src) {
                          @let size = sizeOf(img);
                          <button
                            type="button"
                            class="img-btn"
                            (click)="zoom.set(img.src)"
                            aria-label="Show image full screen"
                          >
                            <img
                              [src]="library.imageUrl(id(), img.src) ?? loadingImage"
                              [attr.width]="size.w"
                              [attr.height]="size.h"
                              loading="lazy"
                              decoding="async"
                              alt=""
                            />
                          </button>
                        }
                      }
                      @if (item.captions.length) {
                        <figcaption>
                          @for (caption of item.captions; track $index) {
                            <span class="caption-line"
                              ><ng-container *ngTemplateOutlet="text; context: { $implicit: caption }"
                            /></span>
                          }
                        </figcaption>
                      }
                    </figure>
                  }
                  @case ('heading') {
                    <h2 class="heading">
                      <ng-container *ngTemplateOutlet="text; context: { $implicit: item.segments }" />
                    </h2>
                  }
                  @default {
                    <p
                      [class.caption]="item.kind === 'caption'"
                      [class.other]="item.kind === 'other'"
                      [class.continued]="item.continued"
                    >
                      <ng-container *ngTemplateOutlet="text; context: { $implicit: item.segments }" />
                    </p>
                  }
                }
              } @empty {
                <p class="empty">This chapter is empty in the PDF.</p>
              }
            } @else if (!error()) {
              <p class="empty">Loading…</p>
            }
          </article>

          @if (chapter(); as c) {
            <nav class="nav-row bottom-nav" aria-label="Chapter navigation">
              <button type="button" class="btn" [disabled]="!c.prev" (click)="go(c.prev)">
                « Back
              </button>
              <span class="where">Chapter {{ c.number }} of {{ c.total }}</span>
              <button type="button" class="btn" [disabled]="!c.next" (click)="go(c.next)">
                Next »
              </button>
            </nav>
          }
        </div>
      </section>

      <aside class="sidebar reader-sidebar">
        <div class="sticky">
          <div class="side-block">
            <h2 class="section-title">Nearby chapters</h2>
            <ol class="nearby">
              @for (c of nearby(); track c.number) {
                <li>
                  <a
                    [routerLink]="['/book', id(), 'read', c.number]"
                    [class.current]="c.number === n()"
                  >
                    <span>{{ c.title }}</span>
                    @if (c.verification === 'Warning' || c.verification === 'Fail') {
                      <span
                        class="flag"
                        [class.bad]="c.verification === 'Fail'"
                        title="Differs from the PDF"
                        >⚠</span
                      >
                    }
                  </a>
                </li>
              }
            </ol>
          </div>
          @if (chapter(); as c) {
            <div class="side-block">
              <h2 class="section-title">This chapter</h2>
              <div class="stat-row">
                <span>Read in this book</span><span class="muted">{{ bookPercent() }}%</span>
                <span class="bar ok"><span [style.width.%]="bookPercent()"></span></span>
              </div>
              <p class="small muted">
                @switch (currentCheck()) {
                  @case ('Pass') {
                    ✓ Text and images verified 1:1 against the PDF.
                  }
                  @case ('Warning') {
                    ⚠ All text present; order or word splitting differs on some pages.
                  }
                  @case ('Fail') {
                    ⚠ Some pages differ from the PDF (details above the text).
                  }
                  @default {
                    Not verified.
                  }
                }
              </p>
            </div>
          }
        </div>
      </aside>
    </div>

    @if (zoom(); as src) {
      <div class="lightbox" role="dialog" aria-label="Image" (click)="zoom.set(null)">
        <img [src]="library.imageUrl(id(), src) ?? loadingImage" alt="" />
        <button type="button" class="lightbox-close" aria-label="Close">
          <app-icon name="close" [size]="26" />
        </button>
      </div>
    }
  `,
  styleUrl: './reader.scss',
})
export class Reader {
  protected readonly library = inject(LocalLibrary);
  protected readonly loadingImage = LOADING_IMAGE;
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
  protected readonly chapters = signal<ChapterRef[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly bookTitle = signal('');
  protected readonly showSettings = signal(false);
  protected readonly noteDismissed = signal(false);
  protected readonly zoom = signal<string | null>(null);
  /** The scan fix whose original text is shown (tap a fix to see what the PDF has). */
  protected readonly shownFix = signal<Segment | null>(null);
  protected readonly items = computed(() => readingItems(this.chapter()?.blocks ?? []));
  protected readonly chapterOptions = computed(() => {
    const refs = this.chapters();
    if (refs.length > 0) {
      return refs;
    }
    return Array.from({ length: this.chapter()?.total ?? 0 }, (_, i) => ({ number: i + 1, title: `Chapter ${i + 1}` }));
  });
  /** The 1:1 check of the open chapter; null while the book is not checked yet. */
  protected readonly currentCheck = computed(
    () => this.chapters().find((c) => c.number === this.n())?.verification ?? null,
  );
  protected readonly describe = describeIssue;
  protected readonly nearby = computed(() => {
    const all = this.chapters();
    const i = Math.max(0, this.n() - 1);
    const start = Math.max(0, Math.min(i - 3, all.length - 9));
    return all.slice(start, start + 9);
  });
  protected readonly bookPercent = computed(() => {
    const c = this.chapter();
    return c && c.total ? Math.round((100 * c.number) / c.total) : 0;
  });
  protected readonly sizeOf = displaySize;

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
    this.zoom.set(null);
    this.shownFix.set(null);
    if (this.loadedBookId !== id) {
      this.loadedBookId = id;
      this.library.get(id).then(
        (d) => {
          this.bookTitle.set(d.book.title);
          this.chapters.set(d.chapters);
        },
        () => {}, // the chapter request below reports the error
      );
    }

    try {
      const chapter = await this.library.chapter(id, n);
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
      this.error.set(errorMessage(e));
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

  protected toggleFix(segment: Segment): void {
    this.shownFix.set(this.shownFix() === segment ? null : segment);
  }

  protected hasFailure(chapter: Chapter): boolean {
    return chapter.issues.some((p) => p.status === 'Fail');
  }

  protected pages(chapter: Chapter): string {
    return pageRange(chapter.firstPage, chapter.lastPage);
  }

  onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (event.key === 'Escape') {
      this.zoom.set(null);
      this.showSettings.set(false);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || this.zoom()) {
      return;
    }
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) {
      return;
    }
    if (event.key === 'ArrowLeft') {
      this.go(this.chapter()?.prev);
    } else if (event.key === 'ArrowRight') {
      this.go(this.chapter()?.next);
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
    this.library.saveProgress(this.id(), chapter.number, value).catch(() => {});
  }

  private scrollable(): number {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  private scrollPercent(): number {
    const max = this.scrollable();
    return max > 0 ? (window.scrollY / max) * 100 : 0;
  }
}
