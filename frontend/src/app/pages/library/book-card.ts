import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BooksApi } from '../../core/books.api';
import { BookSummary } from '../../core/models';
import { VerificationBadge } from '../../shared/verification-badge';

@Component({
  selector: 'app-book-card',
  imports: [RouterLink, VerificationBadge],
  template: `
    @let b = book();
    <a class="card" [routerLink]="['/book', b.id]" [attr.aria-label]="b.title">
      <div class="cover" [style.background]="placeholderColor()">
        @if (b.hasCover) {
          <img [src]="api.coverUrl(b.id)" alt="" loading="lazy" />
        } @else {
          <span class="initials">{{ initials() }}</span>
        }
        @if (b.status === 'Processing') {
          <div class="overlay"><span class="spinner" aria-hidden="true"></span>Converting…</div>
        } @else if (b.status === 'Failed') {
          <div class="overlay failed">Conversion failed</div>
        }
        @if (b.progress; as p) {
          <span class="continue">Continue: Page {{ p.chapterNumber }}</span>
        }
      </div>
      <div class="info">
        <h3 class="title" [title]="b.title">{{ b.title }}</h3>
        <div class="meta">
          {{ b.author ?? 'Unknown author' }}
        </div>
        <div class="meta row">
          @if (b.status === 'Ready') {
            <span>{{ b.pageCount }} pages</span>
            <app-verification-badge
              [status]="b.verificationStatus"
              [pagesWithIssues]="b.pagesWithIssues"
            />
          } @else if (b.status === 'Failed') {
            <span class="err">{{ b.error }}</span>
          }
        </div>
      </div>
    </a>
  `,
  styles: `
    .card {
      display: flex;
      flex-direction: column;
      height: 100%;
      color: inherit;
      text-decoration: none;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      transition:
        transform 0.15s,
        box-shadow 0.15s,
        border-color 0.15s;
    }
    .card:hover {
      transform: translateY(-3px);
      box-shadow: var(--shadow);
      border-color: var(--accent);
    }
    .cover {
      position: relative;
      aspect-ratio: 2 / 3;
      display: grid;
      place-items: center;
      overflow: hidden;
    }
    .cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top;
      background: #fff;
    }
    .initials {
      font-size: 42px;
      font-weight: 800;
      color: rgba(255, 255, 255, 0.85);
    }
    .overlay {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: rgba(10, 12, 16, 0.72);
      color: var(--text-strong);
      font-weight: 600;
    }
    .overlay.failed {
      color: var(--bad-fg);
    }
    .spinner {
      width: 28px;
      height: 28px;
      border: 3px solid rgba(255, 255, 255, 0.25);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    .continue {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 6px 8px;
      background: linear-gradient(transparent, rgba(0, 0, 0, 0.85));
      color: #fff;
      font-size: 12px;
      font-weight: 600;
    }
    .info {
      padding: 10px 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .title {
      margin: 0;
      font-size: 15px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .meta {
      font-size: 13px;
      color: var(--text-muted);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .err {
      color: var(--bad-fg);
    }
  `,
})
export class BookCard {
  protected readonly api = inject(BooksApi);
  readonly book = input.required<BookSummary>();

  protected readonly initials = computed(() =>
    this.book()
      .title.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join(''),
  );

  protected readonly placeholderColor = computed(() => {
    let hash = 0;
    for (const ch of this.book().title) {
      hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    return `linear-gradient(160deg, hsl(${hue} 45% 35%), hsl(${(hue + 40) % 360} 50% 18%))`;
  });
}
