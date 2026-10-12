import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessages } from '../../core/auth.service';
import { BooksApi } from '../../core/books.api';
import { BookDetail } from '../../core/models';
import { VerificationBadge } from '../../shared/verification-badge';

export const CHAPTERS_PER_PAGE = 100;

@Component({
  selector: 'app-book-detail',
  imports: [RouterLink, DatePipe, FormsModule, VerificationBadge],
  template: `
    <div class="page">
      @if (error(); as e) {
        <div class="error-box" role="alert">{{ e }}</div>
      }

      @if (detail(); as d) {
        @let b = d.book;
        <section class="panel hero">
          <div class="cover">
            @if (b.hasCover) {
              <img [src]="api.coverUrl(b.id)" alt="Cover of {{ b.title }}" />
            } @else {
              <div class="cover-placeholder">{{ b.title }}</div>
            }
          </div>

          <div class="info">
            @if (editing()) {
              <form class="edit" (ngSubmit)="save()">
                <label class="field"
                  >Title <input name="title" [(ngModel)]="editTitle" required maxlength="300"
                /></label>
                <label class="field"
                  >Author <input name="author" [(ngModel)]="editAuthor" maxlength="300"
                /></label>
                <div class="actions">
                  <button class="btn small" type="submit">Save</button>
                  <button class="btn ghost small" type="button" (click)="editing.set(false)">
                    Cancel
                  </button>
                </div>
              </form>
            } @else {
              <h1>{{ b.title }}</h1>
              <dl class="facts">
                <dt>Author</dt>
                <dd>{{ b.author ?? 'Unknown' }}</dd>
                <dt>Pages</dt>
                <dd>{{ b.pageCount }}</dd>
                <dt>Added</dt>
                <dd>{{ b.createdAt | date: 'mediumDate' }}</dd>
                <dt>Status</dt>
                <dd>
                  @switch (b.status) {
                    @case ('Ready') {
                      <app-verification-badge
                        [status]="b.verificationStatus"
                        [pagesWithIssues]="b.pagesWithIssues"
                      />
                    }
                    @case ('Processing') {
                      Converting…
                    }
                    @case ('Failed') {
                      <span class="err">{{ b.error }}</span>
                    }
                  }
                </dd>
              </dl>
            }

            @if (b.status === 'Ready') {
              <div class="actions">
                @if (b.progress; as p) {
                  <a
                    class="btn"
                    [routerLink]="['/book', b.id, 'read', p.chapterNumber]"
                    [queryParams]="{ pos: p.scrollPercent }"
                  >
                    Continue reading · Page {{ p.chapterNumber }}
                  </a>
                  <a class="btn ghost" [routerLink]="['/book', b.id, 'read', 1]"
                    >Start from the beginning</a
                  >
                } @else {
                  <a class="btn" [routerLink]="['/book', b.id, 'read', 1]">Start reading</a>
                }
              </div>
            }

            <div class="actions secondary">
              @if (!editing()) {
                <button class="btn ghost small" type="button" (click)="startEdit()">
                  Edit details
                </button>
              }
              <button class="btn danger small" type="button" (click)="remove()">Delete book</button>
            </div>
          </div>
        </section>

        @if (b.status === 'Ready') {
          <section class="panel chapters">
            <div class="chapters-head">
              <h2 class="section-title">Chapters</h2>
              <span class="muted">{{ d.chapters.length }} pages</span>
            </div>
            <ol class="chapter-list">
              @for (c of visibleChapters(); track c.number) {
                <li>
                  <a
                    [routerLink]="['/book', b.id, 'read', c.number]"
                    [class.current]="b.progress?.chapterNumber === c.number"
                  >
                    {{ c.title }}
                    @if (c.verification && c.verification !== 'Pass') {
                      <span
                        class="flag"
                        [class.fail]="c.verification === 'Fail'"
                        title="This page differs from the PDF"
                        >⚠</span
                      >
                    }
                  </a>
                </li>
              }
            </ol>
            @if (pageCount() > 1) {
              <nav class="pager" aria-label="Chapter pages">
                @for (p of pages(); track p) {
                  <button
                    type="button"
                    class="btn ghost small"
                    [class.active]="p === chapterPage()"
                    (click)="chapterPage.set(p)"
                  >
                    {{ (p - 1) * perPage + 1 }}–{{ min(p * perPage, d.chapters.length) }}
                  </button>
                }
              </nav>
            }
          </section>
        }
      } @else if (!error()) {
        <p class="muted">Loading…</p>
      }
    </div>
  `,
  styles: `
    .hero {
      display: grid;
      grid-template-columns: 220px 1fr;
      gap: 28px;
      padding: 24px;
    }
    @media (max-width: 640px) {
      .hero {
        grid-template-columns: 1fr;
      }
      .cover {
        max-width: 220px;
        margin: 0 auto;
      }
    }
    .cover img,
    .cover-placeholder {
      width: 100%;
      aspect-ratio: 2 / 3;
      object-fit: cover;
      object-position: top;
      border-radius: 6px;
      background: #fff;
      box-shadow: var(--shadow);
    }
    .cover-placeholder {
      display: grid;
      place-items: center;
      padding: 16px;
      text-align: center;
      font-weight: 700;
      background: var(--surface-2);
      color: var(--text-strong);
    }
    h1 {
      margin: 0 0 16px;
      font-size: 26px;
    }
    .facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 8px 18px;
      margin: 0 0 22px;
    }
    dt {
      color: var(--text-muted);
    }
    dd {
      margin: 0;
    }
    .err {
      color: var(--bad-fg);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 14px;
    }
    .secondary {
      margin-top: 8px;
    }
    .edit {
      max-width: 480px;
    }
    .chapters {
      margin-top: 20px;
      padding: 20px 24px;
    }
    .chapters-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .chapter-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 6px;
    }
    .chapter-list a {
      display: flex;
      justify-content: space-between;
      padding: 8px 12px;
      border-radius: 6px;
      background: var(--surface-2);
      color: var(--text);
      text-decoration: none;
    }
    .chapter-list a:hover {
      background: var(--border);
      color: var(--text-strong);
    }
    .chapter-list a.current {
      outline: 1px solid var(--accent);
    }
    .flag {
      color: var(--warn-fg);
    }
    .flag.fail {
      color: var(--bad-fg);
    }
    .pager {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 16px;
    }
    .pager .active {
      border-color: var(--accent);
      color: var(--text-strong);
    }
  `,
})
export class BookDetailPage {
  protected readonly api = inject(BooksApi);
  private readonly router = inject(Router);
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  /** Route param. */
  readonly id = input.required<string>();

  protected readonly perPage = CHAPTERS_PER_PAGE;
  protected readonly detail = signal<BookDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal(false);
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
  protected readonly min = Math.min;

  constructor() {
    effect(() => void this.load(this.id()));
    inject(DestroyRef).onDestroy(() => clearTimeout(this.pollTimer));
  }

  private async load(id: string): Promise<void> {
    clearTimeout(this.pollTimer);
    try {
      const detail = await firstValueFrom(this.api.get(id));
      this.detail.set(detail);
      const current = detail.book.progress?.chapterNumber;
      if (current) {
        this.chapterPage.set(Math.ceil(current / CHAPTERS_PER_PAGE));
      }
      if (detail.book.status === 'Processing') {
        this.pollTimer = setTimeout(() => void this.load(id), 2000);
      }
    } catch (e) {
      this.error.set(errorMessages(e)[0]!);
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
      const updated = await firstValueFrom(
        this.api.update(this.id(), { title: this.editTitle, author: this.editAuthor }),
      );
      this.detail.update((d) =>
        d ? { ...d, book: { ...d.book, title: updated.title, author: updated.author } } : d,
      );
      this.editing.set(false);
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessages(e)[0]!);
    }
  }

  protected async remove(): Promise<void> {
    const title = this.detail()?.book.title ?? 'this book';
    if (!confirm(`Delete “${title}”? This cannot be undone.`)) {
      return;
    }
    try {
      await firstValueFrom(this.api.delete(this.id()));
      await this.router.navigate(['/']);
    } catch (e) {
      this.error.set(errorMessages(e)[0]!);
    }
  }
}
