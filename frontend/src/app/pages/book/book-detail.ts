import { DatePipe } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AiSettingsService } from '../../core/ai-settings.service';
import { LocalLibrary, errorMessage } from '../../core/library.service';
import { BookDetail } from '../../core/models';
import { estimateCost, formatDollars, modelInfo } from '../../organize/pricing';
import { pageRange } from '../reader/reading';
import { BookCover } from '../../shared/book-cover';
import { Icon } from '../../shared/icon';
import { TimeAgoPipe } from '../../shared/time-ago';
import { VerificationBadge } from '../../shared/verification-badge';

export const CHAPTERS_PER_PAGE = 100;

/** Book page in the ranobes.net novel-page layout: cover column, info + chapters, stats sidebar. */
@Component({
  selector: 'app-book-detail',
  imports: [RouterLink, DatePipe, FormsModule, BookCover, Icon, TimeAgoPipe, VerificationBadge],
  template: `
    <div class="page with-sidebar">
      <section class="main">
        @if (error(); as e) {
          <div class="error-box" role="alert">{{ e }}</div>
        }

        @if (detail(); as d) {
          @let b = d.book;
          <nav class="breadcrumbs" aria-label="Breadcrumb">
            <a routerLink="/">Library</a><span class="sep">»</span><span>{{ b.title }}</span>
          </nav>

          <div class="book">
            <div class="left">
              <div class="cover-frame">
                <app-book-cover class="cover" [book]="b" [alt]="true" />
                @if (b.status === 'Ready') {
                  @if (b.progress; as p) {
                    <a
                      class="btn light block"
                      [routerLink]="['/book', b.id, 'read', p.chapterNumber]"
                      [queryParams]="{ pos: p.scrollPercent }"
                    >
                      Continue reading
                    </a>
                  } @else {
                    <a class="btn light block" [routerLink]="['/book', b.id, 'read', 1]"
                      >Start reading</a
                    >
                  }
                  <a class="btn ghost block" [routerLink]="[]" fragment="chapters">Chapters list</a>
                }
              </div>

              <dl class="facts">
                <div>
                  <dt>Author:</dt>
                  <dd>{{ b.author ?? 'Unknown' }}</dd>
                </div>
                <div>
                  <dt>Pages:</dt>
                  <dd>{{ b.pageCount }}</dd>
                </div>
                @if (b.status === 'Ready') {
                  <div>
                    <dt>Chapters:</dt>
                    <dd>{{ b.chapterCount }}</dd>
                  </div>
                }
                <div>
                  <dt>Added:</dt>
                  <dd>{{ b.createdAt | date: 'mediumDate' }}</dd>
                </div>
                <div>
                  <dt>Status:</dt>
                  <dd>
                    @switch (b.status) {
                      @case ('Ready') {
                        Ready
                      }
                      @case ('Processing') {
                        Converting…
                      }
                      @case ('Failed') {
                        <span class="err">Failed</span>
                      }
                    }
                  </dd>
                </div>
                @if (b.progress; as p) {
                  <div>
                    <dt>Reading:</dt>
                    <dd>
                      <a [routerLink]="['/book', b.id, 'read', p.chapterNumber]"
                        >Chapter {{ p.chapterNumber }}</a
                      >
                    </dd>
                  </div>
                }
              </dl>
            </div>

            <div class="center">
              <div class="pills">
                @if (b.status === 'Ready') {
                  @if (b.verificationStatus === 'None') {
                    <span class="pill neutral">Checking 1:1…</span>
                  } @else {
                    <app-verification-badge
                      [status]="b.verificationStatus"
                      [pagesWithIssues]="b.pagesWithIssues"
                    />
                  }
                }
                @if (b.organizedBy === 'ai') {
                  <span class="pill neutral" title="Chapters, captions and paragraphs arranged by Claude">
                    Arranged by Claude
                  </span>
                }
                @if (b.fixCount > 0) {
                  <span class="pill neutral" title="Scan errors corrected; tap an underlined word to see the original">
                    {{ b.fixCount }} scan {{ b.fixCount === 1 ? 'fix' : 'fixes' }}
                  </span>
                }
                <span class="pill dot added">Added {{ b.createdAt | timeAgo }}</span>
              </div>

              @if (editing()) {
                <form class="edit" (ngSubmit)="save()">
                  <label class="field"
                    >Title <input name="title" [(ngModel)]="editTitle" required maxlength="300"
                  /></label>
                  <label class="field"
                    >Author <input name="author" [(ngModel)]="editAuthor" maxlength="300"
                  /></label>
                  <div class="edit-actions">
                    <button class="btn small" type="submit">Save</button>
                    <button class="btn ghost small" type="button" (click)="editing.set(false)">
                      Cancel
                    </button>
                  </div>
                </form>
              } @else {
                <h1 class="title">{{ b.title }}</h1>
                <div class="author muted">{{ b.author ?? 'Unknown author' }}</div>
              }

              @if (b.status === 'Failed') {
                <p class="err">{{ b.error }}</p>
                <button type="button" class="btn small" (click)="retry()">Convert again</button>
              } @else if (b.status === 'Processing') {
                <p class="muted">
                  The PDF is being converted on this device{{ converting() }}. You can keep using the app in the
                  meantime.
                </p>
              } @else if (b.excerpt) {
                <p class="excerpt" [class.open]="excerptOpen()">{{ b.excerpt }}</p>
                <button type="button" class="more" (click)="excerptOpen.set(!excerptOpen())">
                  {{ excerptOpen() ? 'Show less' : 'Read more' }} »
                </button>
              }

              @if (b.status === 'Ready') {
                <div class="organize" [class.warn]="b.organizeError">
                  @if (organizing(); as o) {
                    <p>
                      Claude is arranging the chapters{{ o.total ? ' (part ' + o.done + ' of ' + o.total + ')' : '' }}…
                      You can keep reading meanwhile.
                    </p>
                  } @else if (verifying()) {
                    <p class="muted">Checking the chapters against the PDF…</p>
                  } @else {
                    @if (b.organizedBy === 'ai') {
                      <p class="muted">
                        Chapters, captions and paragraphs arranged by Claude{{
                          b.aiCost !== null ? ' (cost ' + dollars(b.aiCost) + ')' : ''
                        }}.
                      </p>
                    } @else {
                      <p class="muted">Chapters arranged by the layout rules.</p>
                    }
                    @if (b.organizeError) {
                      <p class="err">{{ b.organizeError }}</p>
                    }
                    @if (b.organizedBy !== 'ai' || b.organizeError) {
                      @if (ai.enabled()) {
                        <button type="button" class="btn small" (click)="organize()">
                          Organize with Claude<span class="muted">≈ {{ estimate() }}</span>
                        </button>
                      } @else {
                        <p class="muted small">
                          <a routerLink="/settings">Add a Claude API key</a> to have Claude keep text, images and
                          their captions together and arrange real chapters.
                        </p>
                      }
                    }
                  }
                </div>

                <div class="chapters-head" id="chapters">
                  <h2 class="section-title">Chapters</h2>
                  <span class="muted small">{{ d.chapters.length }} chapters · {{ b.pageCount }} pages</span>
                </div>
                <ol class="chapter-list">
                  @for (c of visibleChapters(); track c.number) {
                    <li>
                      <a
                        [routerLink]="['/book', b.id, 'read', c.number]"
                        [class.current]="b.progress?.chapterNumber === c.number"
                      >
                        <span class="ch-title">
                          {{ c.title }}
                          @if (b.progress?.chapterNumber === c.number) {
                            <span class="pill dot">Reading</span>
                          }
                        </span>
                        <span
                          class="ch-meta"
                          [class.warn]="c.verification === 'Warning'"
                          [class.bad]="c.verification === 'Fail'"
                        >
                          @if (range(c.firstPage, c.lastPage); as r) {
                            {{ r }} ·
                          }
                          @switch (c.verification) {
                            @case ('Pass') {
                              ✓ Verified
                            }
                            @case ('Warning') {
                              ⚠ Converted with notes
                            }
                            @case ('Fail') {
                              ⚠ Differs from the PDF
                            }
                            @default {
                              Not verified
                            }
                          }
                        </span>
                      </a>
                    </li>
                  }
                </ol>
                <div class="chapters-foot">
                  <a [routerLink]="['/book', b.id, 'read', 1]" class="first">First</a>
                  @if (d.chapters.length > 1) {
                    <span class="muted">·</span>
                    <a [routerLink]="['/book', b.id, 'read', d.chapters.length]" class="first"
                      >Last</a
                    >
                  }
                  @if (pageCount() > 1) {
                    <nav class="pager" aria-label="Chapter pages">
                      @for (p of pages(); track p) {
                        <button
                          type="button"
                          class="btn small"
                          [class.ghost]="p !== chapterPage()"
                          (click)="chapterPage.set(p)"
                        >
                          {{ (p - 1) * perPage + 1 }}–{{ min(p * perPage, d.chapters.length) }}
                        </button>
                      }
                    </nav>
                  }
                </div>
              }
            </div>
          </div>
        } @else if (!error()) {
          <p class="muted">Loading…</p>
        }
      </section>

      <aside class="sidebar">
        <div class="sticky">
          @if (detail(); as d) {
            @let b = d.book;
            @if (b.status === 'Ready') {
              <div class="side-block">
                <h2 class="section-title">Conversion check</h2>
                @if (b.verificationStatus === 'None') {
                  <div class="stat-row">
                    <span>{{ organizing() ? 'Waiting for Claude…' : 'Checking pages…' }}</span
                    ><span class="muted">{{ checked().done }} / {{ b.pageCount }}</span>
                    <span class="bar"><span [style.width.%]="share(checked().done)"></span></span>
                  </div>
                } @else {
                  <div class="score">
                    <span class="score-value">{{ verifiedPercent() }}%</span>
                    <span class="muted small"
                      >of {{ b.pageCount }} pages<br />match the PDF 1:1</span
                    >
                  </div>
                  <div class="stat-row">
                    <span>✓ Verified</span><span class="muted">{{ d.pageChecks.pass }}</span>
                    <span class="bar ok"><span [style.width.%]="share(d.pageChecks.pass)"></span></span>
                  </div>
                  <div class="stat-row">
                    <span>⚠ With notes</span><span class="muted">{{ d.pageChecks.warn }}</span>
                    <span class="bar warn"><span [style.width.%]="share(d.pageChecks.warn)"></span></span>
                  </div>
                  <div class="stat-row">
                    <span>⚠ Differ</span><span class="muted">{{ d.pageChecks.fail }}</span>
                    <span class="bar bad"><span [style.width.%]="share(d.pageChecks.fail)"></span></span>
                  </div>
                }
                <p class="muted small hint">
                  Every page is compared with the original PDF: all characters, words, word order
                  and images. Scan fixes are marked in the text and don't change what is compared.
                </p>
              </div>

              <div class="side-block">
                <h2 class="section-title">Your progress</h2>
                <div class="stat-row">
                  <span>Chapter {{ b.progress?.chapterNumber ?? 0 }} of {{ b.chapterCount }}</span>
                  <span class="muted">{{ readPercent() }}%</span>
                  <span class="bar ok"><span [style.width.%]="readPercent()"></span></span>
                </div>
                @if (b.progress; as p) {
                  <p class="muted small">Last read {{ p.updatedAt | timeAgo }}</p>
                }
              </div>
            }

            <div class="side-block">
              <h2 class="section-title">Manage</h2>
              <div class="manage">
                @if (!editing()) {
                  <button type="button" class="link-action" (click)="startEdit()">
                    <app-icon name="edit" [size]="14" />Edit details
                  </button>
                }
                <button type="button" class="link-action danger" (click)="remove()">
                  <app-icon name="trash" [size]="14" />Delete book
                </button>
              </div>
            </div>
          }
        </div>
      </aside>
    </div>
  `,
  styles: `
    .book {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 28px;
    }
    .cover-frame {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 6px;
      border-radius: var(--radius);
      background: var(--panel-dark);
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
    }
    .cover {
      aspect-ratio: 2 / 3;
      border-radius: 4px;
      margin-bottom: 4px;
    }
    .facts {
      margin: 20px 0 0;
      font-size: 12px;
    }
    .facts div {
      display: flex;
      gap: 6px;
      margin-bottom: 6px;
    }
    .facts dt {
      color: var(--text-muted);
    }
    .facts dd {
      margin: 0;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .pills {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    .title {
      margin: 0 0 4px;
      font-size: 24px;
      overflow-wrap: anywhere;
    }
    .author {
      margin-bottom: 16px;
    }
    .excerpt {
      margin: 0;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.65;
    }
    .excerpt.open {
      display: block;
    }
    .more {
      margin: 4px 0 0;
      padding: 0;
      border: 0;
      background: none;
      color: var(--link);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .err {
      color: var(--bad-fg);
    }
    .edit {
      max-width: 460px;
    }
    .edit-actions {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    .chapters-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-top: 28px;
      padding-top: 20px;
      border-top: 1px solid var(--divider);
      scroll-margin-top: 80px;
    }
    .chapter-list {
      position: relative;
      list-style: none;
      margin: 0;
      padding: 0 12px 0 0;
      max-height: 560px;
      overflow-y: auto;
      scrollbar-color: var(--accent) rgba(0, 0, 0, 0.2);
      scrollbar-width: thin;
    }
    .chapter-list a {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 9px 0;
      border-bottom: 1px solid var(--divider);
      color: var(--text);
    }
    .chapter-list a:hover {
      text-decoration: none;
    }
    .chapter-list a:hover .ch-title {
      color: var(--text-strong);
    }
    .ch-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      font-weight: 700;
    }
    .ch-meta {
      color: var(--text-muted);
      font-size: 11px;
    }
    .ch-meta.warn {
      color: var(--warn-fg);
    }
    .ch-meta.bad {
      color: var(--bad-fg);
    }
    .chapters-foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 14px;
    }
    .first {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .pager {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      width: 100%;
      margin-top: 8px;
    }
    .score {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 16px;
    }
    .score-value {
      color: var(--text-strong);
      font-size: 34px;
      font-weight: 700;
    }
    .hint {
      margin: 12px 0 0;
    }
    .organize {
      margin-top: 20px;
      padding: 12px 14px;
      border-radius: var(--radius);
      background: var(--panel-dark);
      font-size: 13px;
    }
    .organize.warn {
      border-left: 4px solid var(--warn-fg);
    }
    .organize p {
      margin: 0 0 8px;
    }
    .organize p:last-child {
      margin-bottom: 0;
    }
    .organize .btn .muted {
      margin-left: 8px;
      font-weight: 400;
    }
    .manage {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }

    @media (max-width: 640px) {
      .book {
        grid-template-columns: minmax(0, 1fr);
        gap: 18px;
      }
      .left {
        display: grid;
        grid-template-columns: 132px minmax(0, 1fr);
        gap: 16px;
        align-items: start;
      }
      .cover-frame .btn {
        height: auto;
        min-height: 36px;
        padding: 6px 8px;
        font-size: 11px;
        line-height: 1.2;
        white-space: normal;
        text-align: center;
      }
      .facts {
        margin: 0;
      }
      .title {
        font-size: 20px;
      }
      .chapter-list {
        max-height: none;
        overflow: visible;
        padding: 0;
      }
    }
  `,
})
export class BookDetailPage {
  private readonly library = inject(LocalLibrary);
  protected readonly ai = inject(AiSettingsService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private loadedId: string | undefined;

  /** Route param. */
  readonly id = input.required<string>();

  protected readonly perPage = CHAPTERS_PER_PAGE;
  protected readonly detail = signal<BookDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal(false);
  protected readonly excerptOpen = signal(false);
  protected readonly chapterPage = signal(1);
  protected editTitle = '';
  protected editAuthor = '';

  protected readonly pageCount = computed(() =>
    Math.ceil((this.detail()?.chapters.length ?? 0) / CHAPTERS_PER_PAGE),
  );
  protected readonly pages = computed(() =>
    Array.from({ length: this.pageCount() }, (_, i) => i + 1),
  );
  protected readonly visibleChapters = computed(() => {
    const start = (this.chapterPage() - 1) * CHAPTERS_PER_PAGE;
    return this.detail()?.chapters.slice(start, start + CHAPTERS_PER_PAGE) ?? [];
  });
  protected readonly verifiedPercent = computed(() => {
    const total = this.detail()?.book.pageCount ?? 0;
    return total ? Math.floor((100 * (this.detail()?.pageChecks.pass ?? 0)) / total) : 0;
  });
  protected readonly readPercent = computed(() => {
    const b = this.detail()?.book;
    return b?.progress && b.chapterCount
      ? Math.round((100 * b.progress.chapterNumber) / b.chapterCount)
      : 0;
  });
  /** What organizing this book with the chosen model should cost. */
  protected readonly estimate = computed(() => {
    const model = modelInfo(this.ai.settings().model);
    return model ? formatDollars(estimateCost(this.detail()?.book.pageCount ?? 0, model)) : '';
  });
  protected readonly min = Math.min;
  protected readonly range = pageRange;
  protected readonly dollars = formatDollars;

  /** Progress of this book's conversion or 1:1 check, when one is running. */
  private readonly ownConversion = computed(() => {
    const c = this.library.conversion();
    return c?.bookId === this.id() ? c : null;
  });
  protected readonly converting = computed(() => {
    const c = this.ownConversion();
    return c?.stage === 'processing' ? ` (page ${c.done} of ${c.total})` : '';
  });
  protected readonly checked = computed(() => {
    const c = this.ownConversion();
    return { done: c?.stage === 'verifying' ? c.done : 0 };
  });
  protected readonly organizing = computed(() => {
    const c = this.ownConversion();
    return c?.stage === 'organizing' ? c : null;
  });
  protected readonly verifying = computed(() => this.ownConversion()?.stage === 'verifying');

  constructor() {
    // Load when the route changes, and again whenever the library changes (conversion finished, check done…).
    effect(() => {
      const id = this.id();
      this.library.version();
      untracked(() => void this.load(id));
    });
  }

  protected share(count: number): number {
    const total = this.detail()?.book.pageCount ?? 0;
    return total ? (100 * count) / total : 0;
  }

  private async load(id: string): Promise<void> {
    try {
      const detail = await this.library.get(id);
      this.detail.set(detail);
      if (this.loadedId !== id) {
        // Only on opening the book: later refreshes must not move the chapter list under the reader's finger.
        this.loadedId = id;
        afterNextRender(() => this.scrollToCurrentChapter(), { injector: this.injector });
        const current = detail.book.progress?.chapterNumber;
        if (current) {
          this.chapterPage.set(Math.ceil(current / CHAPTERS_PER_PAGE));
        }
      }
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  /** Scrolls the chapter list (not the page) so the page being read is visible. */
  private scrollToCurrentChapter(): void {
    const list = this.host.nativeElement.querySelector<HTMLElement>('.chapter-list');
    const current = list?.querySelector<HTMLElement>('a.current');
    if (list && current && list.scrollHeight > list.clientHeight) {
      list.scrollTop = current.offsetTop - list.clientHeight / 3;
    }
  }

  protected startEdit(): void {
    const b = this.detail()!.book;
    this.editTitle = b.title;
    this.editAuthor = b.author ?? '';
    this.editing.set(true);
  }

  protected async save(): Promise<void> {
    try {
      const updated = await this.library.update(this.id(), { title: this.editTitle, author: this.editAuthor });
      this.detail.update((d) =>
        d ? { ...d, book: { ...d.book, title: updated.title, author: updated.author } } : d,
      );
      this.editing.set(false);
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  protected async organize(): Promise<void> {
    const b = this.detail()?.book;
    if (b && !confirm(`Organize “${b.title}” with Claude? This uses your API key and costs about ${this.estimate()}.`)) {
      return;
    }
    try {
      await this.library.organizeWithAI(this.id());
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  protected async retry(): Promise<void> {
    try {
      await this.library.retry(this.id());
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  protected async remove(): Promise<void> {
    const title = this.detail()?.book.title ?? 'this book';
    if (!confirm(`Delete “${title}”? This cannot be undone.`)) {
      return;
    }
    try {
      await this.library.delete(this.id());
      await this.router.navigate(['/']);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
