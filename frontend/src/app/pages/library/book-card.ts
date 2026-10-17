import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LocalLibrary } from '../../core/library.service';
import { BookSummary } from '../../core/models';
import { BookCover } from '../../shared/book-cover';
import { Icon } from '../../shared/icon';
import { TimeAgoPipe } from '../../shared/time-ago';
import { VerificationBadge } from '../../shared/verification-badge';

/** One book in the library list, laid out like a ranobes.net "short story" entry. */
@Component({
  selector: 'app-book-card',
  imports: [RouterLink, BookCover, Icon, TimeAgoPipe, VerificationBadge],
  template: `
    @let b = book();
    <article class="entry">
      <a class="cover" [routerLink]="['/book', b.id]" tabindex="-1" aria-hidden="true">
        <app-book-cover [book]="b" />
        @if (b.status === 'Processing') {
          <span class="overlay"><span class="spinner"></span></span>
        }
      </a>

      <div class="body">
        <h2 class="title">
          <a [routerLink]="['/book', b.id]">{{ b.title }}</a>
        </h2>
        @if (byline(); as line) {
          <div class="byline">{{ line }}</div>
        }
        <div class="meta">
          @switch (b.status) {
            @case ('Ready') {
              @if (organizingLabel(); as label) {
                <span class="pill neutral">{{ label }}</span>
              } @else if (b.verificationStatus === 'None') {
                <span class="pill neutral">Checking 1:1…</span>
              } @else {
                <app-verification-badge
                  [status]="b.verificationStatus"
                  [pagesWithIssues]="b.pagesWithIssues"
                />
              }
            }
            @case ('Processing') {
              <span class="pill neutral">{{ convertingLabel() }}</span>
            }
            @case ('Failed') {
              <span class="pill bad">Conversion failed</span>
            }
          }
          @if (b.organizedBy === 'ai') {
            <span class="pill neutral" title="Chapters arranged by Claude">Claude</span>
          }
          <span class="pill dot added">Added {{ b.createdAt | timeAgo }}</span>
        </div>

        @if (b.status === 'Failed') {
          <p class="excerpt error">{{ b.error }}</p>
        } @else if (b.excerpt) {
          <p class="excerpt">{{ b.excerpt }}</p>
        } @else if (b.status === 'Processing') {
          <p class="excerpt muted">
            The PDF is being converted on this device. You can keep using the app in the meantime.
          </p>
        }
      </div>

      <div class="actions">
        @if (b.status === 'Ready') {
          <a class="btn read" [routerLink]="readLink()" [queryParams]="readQuery()">
            <app-icon name="chevronLeft" [size]="14" [stroke]="3" />Read<app-icon
              name="chevronRight"
              [size]="14"
              [stroke]="3"
            />
          </a>
        } @else {
          <a class="btn read" [routerLink]="['/book', b.id]">Details</a>
        }
        <span class="stats">
          @if (b.status === 'Ready') {
            <span title="Pages"><app-icon name="file" [size]="14" />{{ b.pageCount }}</span>
            <span title="Chapters"><app-icon name="list" [size]="14" />{{ b.chapterCount }}</span>
            @if (progressPercent() !== null) {
              <span title="Read">{{ progressPercent() }}%</span>
            }
          }
        </span>
        @if (b.progress; as p) {
          <a class="link-action" [routerLink]="readLink()" [queryParams]="readQuery()">
            <app-icon name="bookmark" [size]="14" [filled]="true" />Continue: Chapter
            {{ p.chapterNumber }}
          </a>
        }
      </div>
    </article>
  `,
  styles: `
    .entry {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr);
      grid-template-areas:
        'cover body'
        'actions actions';
      gap: 18px 24px;
      padding: 26px 0;
      border-bottom: 1px solid var(--divider);
    }
    .cover {
      grid-area: cover;
      position: relative;
      display: block;
      aspect-ratio: 2 / 3;
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    .cover app-book-cover {
      height: 100%;
      border-radius: 6px;
    }
    .overlay {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      background: rgba(30, 30, 30, 0.65);
    }
    .spinner {
      width: 30px;
      height: 30px;
      border: 3px solid rgba(255, 255, 255, 0.2);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    .body {
      grid-area: body;
      min-width: 0;
    }
    .title {
      margin: 0 0 8px;
      font-size: 18px;
    }
    .title a {
      color: var(--text);
    }
    .title a:hover {
      color: var(--text-strong);
      text-decoration: none;
    }
    .byline {
      margin: -2px 0 10px;
      color: var(--text-muted);
      font-size: 12px;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 8px;
      margin-bottom: 12px;
    }
    .excerpt {
      margin: 0;
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
      overflow: hidden;
      font-size: 14px;
      line-height: 1.6;
    }
    .excerpt.error {
      color: var(--bad-fg);
    }
    .actions {
      grid-area: actions;
      display: flex;
      align-items: center;
      gap: 18px;
      min-height: 44px;
      padding-right: 22px;
      border-radius: 24px;
      background: rgba(0, 0, 0, 0.12);
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
    }
    .read {
      height: 44px;
      min-width: 150px;
      gap: 6px;
    }
    .stats {
      display: flex;
      gap: 26px;
      color: var(--text-muted);
      font-size: 13px;
    }
    .stats span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .link-action {
      margin-left: auto;
    }

    @media (max-width: 600px) {
      .entry {
        display: block;
        padding: 20px 0;
      }
      .entry::after {
        content: '';
        display: table;
        clear: both;
      }
      .cover {
        float: left;
        width: 104px;
        margin: 0 14px 8px 0;
      }
      .title {
        font-size: 17px;
      }
      .excerpt {
        -webkit-line-clamp: 5;
      }
      .actions {
        clear: both;
        margin-top: 14px;
        padding-right: 16px;
      }
      .added {
        display: none;
      }
      .read {
        min-width: 116px;
      }
      .stats {
        display: none;
      }
      .link-action {
        font-size: 11px;
      }
    }
  `,
})
export class BookCard {
  private readonly library = inject(LocalLibrary);
  readonly book = input.required<BookSummary>();

  /** "Converting 45/270" while this book converts; "Converting…" while it waits for its turn. */
  protected readonly convertingLabel = computed(() => {
    const c = this.library.conversion();
    return c?.bookId === this.book().id && c.stage === 'processing'
      ? `Converting ${c.done}/${c.total}`
      : 'Converting…';
  });

  /** "Claude 4/27" while Claude arranges this book's chapters. */
  protected readonly organizingLabel = computed(() => {
    const c = this.library.conversion();
    if (c?.bookId !== this.book().id || c.stage !== 'organizing') {
      return null;
    }
    return c.total ? `Claude ${c.done}/${c.total}` : 'Claude…';
  });

  protected readonly readLink = computed(() => [
    '/book',
    this.book().id,
    'read',
    this.book().progress?.chapterNumber ?? 1,
  ]);

  protected readonly readQuery = computed(() => {
    const p = this.book().progress;
    return p ? { pos: p.scrollPercent } : {};
  });

  /** "Author · 45 chapters · 315 pages", leaving out what is unknown. */
  protected readonly byline = computed(() => {
    const b = this.book();
    const parts = [
      b.author,
      b.status === 'Ready' ? `${b.chapterCount} chapters · ${b.pageCount} pages` : null,
    ].filter(Boolean);
    return parts.join(' · ');
  });

  protected readonly progressPercent = computed(() => {
    const b = this.book();
    if (!b.progress || b.chapterCount === 0) {
      return null;
    }
    return Math.round((100 * b.progress.chapterNumber) / b.chapterCount);
  });
}
