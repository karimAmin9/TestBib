import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { LocalLibrary, MAX_BOOK_BYTES, errorMessage } from '../../core/library.service';
import { BookSummary } from '../../core/models';
import { Icon } from '../../shared/icon';
import { BookCard } from './book-card';

@Component({
  selector: 'app-library',
  imports: [BookCard, Icon],
  template: `
    <div class="page with-sidebar">
      <section class="main">
        <div class="page-head">
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
            [disabled]="!!adding()"
          />
          <span class="upload-icon"><app-icon name="upload" [size]="18" /></span>
          @if (adding(); as name) {
            <span class="upload-text">
              <strong>Adding {{ name }}…</strong>
            </span>
          } @else {
            <span class="upload-text">
              <strong>Add a PDF to your library</strong>
              <span class="muted small"
                >Drop a file here or click to choose · max. {{ maxMb }} MB · stays on this device</span
              >
            </span>
            <span class="btn small upload-cta">Choose file</span>
          }
        </label>

        @for (book of books(); track book.id) {
          <app-book-card [book]="book" />
        }

        @if (loaded() && books().length === 0) {
          <p class="empty muted">
            Your library is empty. Add a PDF and it will appear here as a book you can read. It is converted on
            this device; nothing is uploaded.
          </p>
        }
      </section>

      <aside class="sidebar">
        <div class="sticky">
          <div class="side-block">
            <div class="page-head"><h2 class="section-title">Library statistics</h2></div>
            <div class="stat-tiles">
              <div class="stat-tile">
                <strong>{{ books().length }}</strong
                ><span>Books</span>
              </div>
              <div class="stat-tile">
                <strong>{{ totalPages() }}</strong
                ><span>Pages</span>
              </div>
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
        </div>
      </aside>
    </div>
  `,
  styles: `
    .upload {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 10px 12px 10px 10px;
      margin-bottom: 4px;
      border: 1px dashed var(--border);
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
      width: 38px;
      height: 38px;
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
    @media (max-width: 480px) {
      .upload-cta.btn {
        display: none;
      }
      .upload-text .small {
        display: none;
      }
    }
  `,
})
export class Library {
  private readonly library = inject(LocalLibrary);

  protected readonly maxMb = MAX_BOOK_BYTES / 1024 / 1024;
  protected readonly books = signal<BookSummary[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Name of the file being added. */
  protected readonly adding = signal<string | null>(null);
  protected readonly dragging = signal(false);

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

  constructor() {
    // Read again whenever the library changes (a book added, converted, checked, edited…).
    effect(() => {
      this.library.version();
      untracked(() => void this.refresh());
    });
  }

  async refresh(): Promise<void> {
    try {
      this.books.set(await this.library.list());
      this.loaded.set(true);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      void this.start(file);
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
      void this.start(file);
    }
  }

  async start(file: File): Promise<void> {
    if (this.adding()) {
      return;
    }
    this.error.set(null);
    this.adding.set(file.name);
    try {
      await this.library.add(file);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.adding.set(null);
    }
  }
}
