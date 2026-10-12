import { HttpEventType } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessages } from '../../core/auth.service';
import { BooksApi } from '../../core/books.api';
import { BookSummary } from '../../core/models';
import { BookCover } from '../../shared/book-cover';
import { Icon } from '../../shared/icon';
import { TimeAgoPipe } from '../../shared/time-ago';
import { BookCard } from './book-card';

export const POLL_INTERVAL_MS = 2000;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

interface Upload {
  name: string;
  percent: number;
}

type SideTab = 'continue' | 'recent';

@Component({
  selector: 'app-library',
  imports: [BookCard, BookCover, Icon, RouterLink, TimeAgoPipe],
  template: `
    <div class="page with-sidebar">
      <section class="main">
        <div class="head">
          <h1 class="section-title">My library</h1>
          @if (loaded()) {
            <span class="muted small"
              >{{ books().length }} {{ books().length === 1 ? 'book' : 'books' }}</span
            >
          }
        </div>

        @if (error(); as e) {
          <div class="error-box" role="alert">{{ e }}</div>
        }

        <label
          id="upload"
          class="upload"
          [class.dragging]="dragging()"
          (dragover)="onDragOver($event)"
          (dragleave)="dragging.set(false)"
          (drop)="onDrop($event)"
        >
          <input
            type="file"
            accept="application/pdf,.pdf"
            class="sr-only"
            (change)="onPick($event)"
            [disabled]="!!upload()"
          />
          <span class="upload-icon"><app-icon name="upload" [size]="22" /></span>
          @if (upload(); as u) {
            <span class="upload-text">
              <strong>Uploading {{ u.name }}</strong>
              <span class="bar"><span [style.width.%]="u.percent"></span></span>
            </span>
            <span class="upload-cta muted">{{ u.percent }}%</span>
          } @else {
            <span class="upload-text">
              <strong>Add a PDF to your library</strong>
              <span class="muted small">Drop a file here or click to choose · max. 100 MB</span>
            </span>
            <span class="btn small upload-cta">Choose file</span>
          }
        </label>

        @for (book of books(); track book.id) {
          <app-book-card [book]="book" />
        }

        @if (loaded() && books().length === 0) {
          <p class="empty muted">
            Your library is empty. Upload a PDF and it will appear here as a book you can read.
          </p>
        }
      </section>

      <aside class="sidebar">
        <div class="side-block">
          <div class="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              [class.active]="tab() === 'continue'"
              [attr.aria-selected]="tab() === 'continue'"
              (click)="tab.set('continue')"
            >
              Continue
            </button>
            <button
              type="button"
              role="tab"
              [class.active]="tab() === 'recent'"
              [attr.aria-selected]="tab() === 'recent'"
              (click)="tab.set('recent')"
            >
              Recently added
            </button>
          </div>

          @for (b of sideList(); track b.id) {
            <a
              class="thumb-row"
              [routerLink]="
                b.progress && tab() === 'continue'
                  ? ['/book', b.id, 'read', b.progress.chapterNumber]
                  : ['/book', b.id]
              "
            >
              <app-book-cover class="thumb" [book]="b" />
              <span>
                <span class="thumb-title" [title]="b.title">{{ b.title }}</span>
                <span class="thumb-meta">
                  @if (tab() === 'continue' && b.progress) {
                    Page {{ b.progress.chapterNumber }} of {{ b.pageCount }} ·
                    {{ b.progress.updatedAt | timeAgo }}
                  } @else {
                    {{ b.pageCount ? b.pageCount + ' pages · ' : '' }}{{ b.createdAt | timeAgo }}
                  }
                </span>
              </span>
            </a>
          } @empty {
            <p class="muted small">
              {{ tab() === 'continue' ? 'Books you start reading show up here.' : 'No books yet.' }}
            </p>
          }
        </div>

        <div class="side-block">
          <h2 class="section-title">Library statistics</h2>
          <div class="stat-row">
            <span>Books</span><strong>{{ books().length }}</strong>
          </div>
          <div class="stat-row">
            <span>Pages</span><strong>{{ totalPages() }}</strong>
          </div>
          <div class="stat-row">
            <span>Verified 1:1</span><strong>{{ verified() }} / {{ readyCount() }}</strong>
            <span class="bar ok"
              ><span [style.width.%]="readyCount() ? (100 * verified()) / readyCount() : 0"></span
            ></span>
          </div>
          <div class="stat-row">
            <span>Started reading</span><strong>{{ started() }} / {{ readyCount() }}</strong>
            <span class="bar"
              ><span [style.width.%]="readyCount() ? (100 * started()) / readyCount() : 0"></span
            ></span>
          </div>
        </div>
      </aside>
    </div>
  `,
  styles: `
    .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }
    .upload {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px 18px;
      margin-bottom: 6px;
      border: 2px dashed var(--border);
      border-radius: var(--radius);
      background: rgba(0, 0, 0, 0.08);
      cursor: pointer;
      scroll-margin-top: 80px;
      transition:
        border-color 0.15s,
        background 0.15s;
    }
    .upload:hover,
    .upload.dragging,
    .upload:focus-within,
    .upload:target {
      border-color: var(--accent);
      background: var(--accent-bg);
    }
    .upload-icon {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--accent);
      color: #2f3a24;
    }
    .upload-text {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
      flex: 1;
    }
    .upload-text strong {
      overflow: hidden;
      color: var(--text-strong);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .upload-cta {
      flex: 0 0 auto;
    }
    .bar {
      display: block;
      height: 6px;
      border-radius: 3px;
      background: rgba(0, 0, 0, 0.25);
      overflow: hidden;
    }
    .bar span {
      display: block;
      height: 100%;
      background: var(--accent);
      transition: width 0.2s;
    }
    .empty {
      margin-top: 24px;
    }
    .thumb-row > span {
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    @media (max-width: 480px) {
      .upload-cta.btn {
        display: none;
      }
    }
  `,
})
export class Library implements OnInit {
  private readonly api = inject(BooksApi);
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly books = signal<BookSummary[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly upload = signal<Upload | null>(null);
  protected readonly dragging = signal(false);
  protected readonly tab = signal<SideTab>('continue');
  protected readonly hasProcessing = computed(() =>
    this.books().some((b) => b.status === 'Processing'),
  );

  protected readonly readyCount = computed(
    () => this.books().filter((b) => b.status === 'Ready').length,
  );
  protected readonly verified = computed(
    () => this.books().filter((b) => b.verificationStatus === 'Verified').length,
  );
  protected readonly started = computed(() => this.books().filter((b) => b.progress).length);
  protected readonly totalPages = computed(() =>
    this.books().reduce((sum, b) => sum + b.pageCount, 0),
  );

  protected readonly sideList = computed(() => {
    const books = this.books();
    if (this.tab() === 'continue') {
      return books
        .filter((b) => b.progress)
        .sort((a, b) => b.progress!.updatedAt.localeCompare(a.progress!.updatedAt))
        .slice(0, 8);
    }
    return books.slice(0, 8);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.pollTimer));
  }

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    clearTimeout(this.pollTimer);
    try {
      this.books.set(await firstValueFrom(this.api.list()));
      this.loaded.set(true);
    } catch (e) {
      this.error.set(errorMessages(e)[0]!);
    }
    // Keep polling while any book is still being converted.
    if (this.hasProcessing()) {
      this.pollTimer = setTimeout(() => void this.refresh(), POLL_INTERVAL_MS);
    }
  }

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      this.start(file);
    }
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.start(file);
    }
  }

  start(file: File): void {
    this.error.set(null);
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      this.error.set('Only PDF files can be uploaded.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      this.error.set('The file is larger than 100 MB.');
      return;
    }
    if (this.upload()) {
      return;
    }

    this.upload.set({ name: file.name, percent: 0 });
    this.api.upload(file).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.upload.set({
            name: file.name,
            percent: Math.round((100 * event.loaded) / event.total),
          });
        } else if (event.type === HttpEventType.Response && event.body) {
          const created = event.body;
          this.books.update((list) => [created, ...list.filter((b) => b.id !== created.id)]);
        }
      },
      error: (e: unknown) => {
        this.upload.set(null);
        this.error.set(errorMessages(e)[0]!);
      },
      complete: () => {
        this.upload.set(null);
        void this.refresh();
      },
    });
  }
}
