import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { VerificationReport } from '../../core/models';
import { BibEngine, ConvertedBook, EngineProgress, verificationSummary } from '../../engine/bib-engine';
import { VerificationBadge } from '../../shared/verification-badge';

type Phase = 'idle' | 'converting' | 'checking' | 'done' | 'failed';

/**
 * Test page for the in-browser conversion engine (phone-app Phase 2). Not linked from the app: open /lab/engine.
 * `?pdf=<URL on this site>` converts that file right away.
 */
@Component({
  selector: 'app-engine-lab',
  imports: [VerificationBadge],
  template: `
    <div class="page lab">
      <header class="page-head"><h1>Engine lab</h1></header>
      <p class="muted intro">
        Converts a PDF entirely in this browser, with the same engine as the server. Nothing is uploaded or saved.
      </p>

      <label class="btn" [class.disabled]="busy()">
        Choose PDF
        <input
          type="file"
          accept="application/pdf,.pdf"
          class="sr-only"
          [disabled]="busy()"
          (change)="onFile($any($event.target))"
        />
      </label>

      @if (phase() !== 'idle') {
        <section class="status">
          <p>
            <strong>{{ fileName() }}</strong> · {{ statusText() }}
          </p>
          @if (progress(); as p) {
            <progress [value]="p.done" [max]="p.total"></progress>
          }
          <p class="small muted">
            @if (timings().convertMs; as ms) {
              Converted in {{ seconds(ms) }} s
            }
            @if (timings().checkMs; as ms) {
              · checked in {{ seconds(ms) }} s
            }
          </p>
          @if (error(); as e) {
            <p class="error-box">{{ e }}</p>
          }
        </section>
      }

      @if (book(); as b) {
        <section class="result">
          @if (coverUrl(); as url) {
            <img class="cover" [src]="url" alt="Cover" />
          }
          <div>
            <h2>{{ b.title }}</h2>
            @if (b.author) {
              <p class="muted">{{ b.author }}</p>
            }
            <p>{{ b.pageCount }} pages · {{ b.images.size }} images</p>
            @if (summary(); as s) {
              <app-verification-badge [status]="s.status" [pagesWithIssues]="s.pagesWithIssues" />
            } @else {
              <span class="pill">Checking 1:1…</span>
            }
          </div>
        </section>

        <section class="reader">
          <label class="small">
            Page
            <select (change)="page.set(+$any($event.target).value)">
              @for (c of b.chapters; track c.number) {
                <option [value]="c.number" [selected]="c.number === page()">{{ c.title }}</option>
              }
            </select>
          </label>
          @if (chapter(); as c) {
            <article>
              @for (block of c.blocks; track $index) {
                @if (block.type === 'p') {
                  <p>{{ block.text }}</p>
                } @else if (block.type === 'h') {
                  <h3>{{ block.text }}</h3>
                } @else if (block.src) {
                  <img [src]="imageUrl(block.src)" [attr.data-src]="block.src" alt="" />
                }
              } @empty {
                <p class="muted">This page is empty in the PDF.</p>
              }
            </article>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .intro { max-width: 640px; }
    .btn.disabled { opacity: 0.5; pointer-events: none; }
    .status, .result, .reader { background: var(--panel); border-radius: var(--radius); padding: 16px; margin-top: 16px; }
    .status progress { width: 100%; accent-color: var(--accent); }
    .result { display: flex; gap: 16px; align-items: flex-start; }
    .result h2 { margin: 0 0 4px; color: var(--text-strong); }
    .cover { width: 120px; border-radius: 4px; background: #fff; }
    .reader article { font-family: Georgia, serif; line-height: 1.6; max-width: 720px; }
    .reader img { display: block; max-width: 100%; height: auto; margin: 12px 0; background: #fff; }
    .reader select { margin-left: 8px; }
  `,
})
export class EngineLab {
  private readonly engine = inject(BibEngine);
  private readonly objectUrls = new Map<Blob, string>();

  protected readonly phase = signal<Phase>('idle');
  protected readonly fileName = signal('');
  protected readonly progress = signal<EngineProgress | null>(null);
  protected readonly book = signal<ConvertedBook | null>(null);
  protected readonly report = signal<VerificationReport | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly timings = signal<{ convertMs?: number; checkMs?: number }>({});
  protected readonly page = signal(1);

  protected readonly busy = computed(() => this.phase() === 'converting' || this.phase() === 'checking');
  protected readonly chapter = computed(() => this.book()?.chapters.find((c) => c.number === this.page()) ?? null);
  protected readonly summary = computed(() => {
    const report = this.report();
    return report ? verificationSummary(report) : null;
  });
  protected readonly coverUrl = computed(() => {
    const cover = this.book()?.cover;
    return cover ? this.urlFor(cover) : null;
  });
  protected readonly statusText = computed(() => {
    const p = this.progress();
    switch (this.phase()) {
      case 'converting':
        return p ? `converting page ${p.done} of ${p.total}…` : 'starting the engine…';
      case 'checking':
        return p?.stage === 'verifying' ? `readable · checking 1:1, page ${p.done} of ${p.total}…` : 'readable · checking 1:1…';
      case 'done':
        return 'done';
      case 'failed':
        return 'failed';
      default:
        return '';
    }
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.revokeUrls());
    const url = inject(ActivatedRoute).snapshot.queryParamMap.get('pdf');
    if (url) {
      void this.convertUrl(url);
    }
  }

  protected async onFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      await this.convert(new Uint8Array(await file.arrayBuffer()), file.name);
    }
  }

  protected imageUrl(name: string): string | null {
    const image = this.book()?.images.get(name);
    return image ? this.urlFor(image) : null;
  }

  protected seconds(ms: number): string {
    return (ms / 1000).toFixed(1);
  }

  private async convertUrl(url: string): Promise<void> {
    const resolved = new URL(url, document.baseURI);
    if (resolved.origin !== location.origin) {
      this.fail('Only PDFs from this site can be opened by URL.');
      return;
    }
    const response = await fetch(resolved);
    if (!response.ok) {
      this.fail(`Could not load ${resolved.pathname} (${response.status}).`);
      return;
    }
    const name = decodeURIComponent(resolved.pathname.split('/').pop() || 'book.pdf');
    await this.convert(new Uint8Array(await response.arrayBuffer()), name);
  }

  private async convert(pdf: Uint8Array, name: string): Promise<void> {
    this.revokeUrls();
    this.book.set(null);
    this.report.set(null);
    this.error.set(null);
    this.progress.set(null);
    this.timings.set({});
    this.fileName.set(name);
    this.phase.set('converting');

    const started = performance.now();
    let convertedAt = started;
    try {
      const { report } = await this.engine.convert(pdf, name, {
        onProgress: (p) => this.progress.set(p),
        onConverted: (book) => {
          convertedAt = performance.now();
          this.timings.set({ convertMs: convertedAt - started });
          this.page.set(1);
          this.book.set(book);
          this.phase.set('checking');
        },
      });
      this.timings.update((t) => ({ ...t, checkMs: performance.now() - convertedAt }));
      this.report.set(report);
      this.phase.set('done');
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  private fail(message: string): void {
    this.error.set(message);
    this.phase.set('failed');
  }

  private urlFor(blob: Blob): string {
    let url = this.objectUrls.get(blob);
    if (!url) {
      url = URL.createObjectURL(blob);
      this.objectUrls.set(blob, url);
    }
    return url;
  }

  private revokeUrls(): void {
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls.clear();
  }
}
