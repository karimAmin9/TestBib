import { HttpEventType } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { errorMessages } from '../../core/auth.service';
import { BooksApi } from '../../core/books.api';
import { BookSummary } from '../../core/models';
import { BookCard } from './book-card';

export const POLL_INTERVAL_MS = 2000;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

interface Upload {
  name: string;
  percent: number;
}

@Component({
  selector: 'app-library',
  imports: [BookCard],
  template: `
    <div class="page">
      <h2 class="section-title">My library</h2>

      @if (error(); as e) {
        <div class="error-box" role="alert">{{ e }}</div>
      }

      <div class="grid">
        <label
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
          @if (upload(); as u) {
            <span class="upload-title">Uploading…</span>
            <span class="upload-name" [title]="u.name">{{ u.name }}</span>
            <span class="bar"><span [style.width.%]="u.percent"></span></span>
            <span class="muted">{{ u.percent }}%</span>
          } @else {
            <span class="plus" aria-hidden="true">+</span>
            <span class="upload-title">Add a PDF</span>
            <span class="muted small">Click or drop a file here<br />(max. 100 MB)</span>
          }
        </label>

        @for (book of books(); track book.id) {
          <app-book-card [book]="book" />
        }
      </div>

      @if (loaded() && books().length === 0) {
        <p class="empty muted">
          Your library is empty. Upload a PDF to turn it into a book you can read here.
        </p>
      }
    </div>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 18px;
    }
    @media (max-width: 480px) {
      .grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
      }
    }
    .upload {
      aspect-ratio: 2 / 3.6;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 16px;
      text-align: center;
      border: 2px dashed var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      cursor: pointer;
      transition:
        border-color 0.15s,
        background 0.15s;
    }
    .upload:hover,
    .upload.dragging,
    .upload:focus-within {
      border-color: var(--accent);
      background: var(--surface-2);
    }
    .plus {
      display: grid;
      place-items: center;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: var(--accent);
      color: #fff;
      font-size: 30px;
      line-height: 1;
    }
    .upload-title {
      font-weight: 700;
      color: var(--text-strong);
    }
    .upload-name {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }
    .small {
      font-size: 13px;
    }
    .bar {
      width: 100%;
      height: 6px;
      border-radius: 3px;
      background: var(--bg);
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
  protected readonly hasProcessing = computed(() =>
    this.books().some((b) => b.status === 'Processing'),
  );

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
