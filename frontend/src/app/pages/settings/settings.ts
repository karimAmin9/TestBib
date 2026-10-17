import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AiSettingsService } from '../../core/ai-settings.service';
import { errorMessage } from '../../core/library.service';
import { CLAUDE } from '../../organize/organizer';
import { ClaudeModel, MODELS, estimateCost, formatDollars } from '../../organize/pricing';

/** Pages of a typical book, for the cost examples. */
export const EXAMPLE_PAGES = 300;

/** Settings: organizing books with Claude (API key and model). */
@Component({
  selector: 'app-settings',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page with-sidebar">
      <section class="main">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <a routerLink="/">Library</a><span class="sep">»</span><span>Settings</span>
        </nav>
        <div class="page-head">
          <h1 class="section-title">Organize books with Claude</h1>
        </div>

        <p class="intro">
          Claude reads each new book (its text and small previews of its images) and arranges it for reading: paragraphs
          that run across pages stay together, captions go with their images even when they are printed on another page,
          chapters follow the book's sections (long ones are split into parts of about 2,000 words), and obvious scan
          errors are corrected and marked. Every chapter is still checked 1:1 against the PDF.
        </p>

        @if (status(); as s) {
          <div [class]="s.ok ? 'ok-box' : 'error-box'" role="status">{{ s.text }}</div>
        }

        @if (ai.enabled()) {
          <div class="key-row">
            <span>API key <span class="muted">…{{ keyEnd() }}</span> saved on this device.</span>
            <button type="button" class="btn small ghost" [disabled]="checking()" (click)="check()">
              {{ checking() ? 'Checking…' : 'Test key' }}
            </button>
            <button type="button" class="link-action danger" (click)="forget()">Remove key</button>
          </div>
        } @else {
          <form class="key-form" (ngSubmit)="saveKey()">
            <label class="field">
              Claude API key
              <input
                name="apiKey"
                type="password"
                autocomplete="off"
                spellcheck="false"
                placeholder="sk-ant-…"
                [(ngModel)]="keyInput"
                required
              />
            </label>
            <button class="btn small" type="submit" [disabled]="!keyInput.trim() || checking()">
              {{ checking() ? 'Checking…' : 'Save key' }}
            </button>
          </form>
        }

        <fieldset class="models">
          <legend class="section-title">Model</legend>
          @for (m of models; track m.id) {
            <label class="model" [class.selected]="ai.settings().model === m.id">
              <input
                type="radio"
                name="model"
                [value]="m.id"
                [checked]="ai.settings().model === m.id"
                (change)="choose(m.id)"
              />
              <span class="model-name">{{ m.name }}</span>
              <span class="muted small">≈ {{ m.example }} for a {{ examplePages }}-page book</span>
              <span class="muted small">{{ m.note }}</span>
            </label>
          }
        </fieldset>
        <p class="muted small">
          Estimates; the actual cost is shown on each book. Answers are kept on this device, so organizing the same
          book again only asks about the parts that are missing.
        </p>
      </section>

      <aside class="sidebar">
        <div class="sticky">
          <div class="side-block">
            <h2 class="section-title">Your key</h2>
            <p class="small">
              Create a key in the <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener"
                >Claude Console</a
              >. Best use a key only for this app, with a monthly spend limit.
            </p>
            <p class="small muted">
              The key is stored only in this browser on this device and is sent only to api.anthropic.com. Book text and
              image previews go to Claude only while a book is organized.
            </p>
          </div>
          <div class="side-block">
            <h2 class="section-title">Without a key</h2>
            <p class="small muted">
              Books are arranged by built-in layout rules: free and offline, but less precise. You can organize any book
              with Claude later from its page.
            </p>
          </div>
        </div>
      </aside>
    </div>
  `,
  styles: `
    .intro {
      max-width: 680px;
      margin: 0 0 20px;
      line-height: 1.6;
    }
    .key-form {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      max-width: 560px;
    }
    .key-form .field {
      flex: 1;
      margin: 0;
    }
    .key-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }
    .ok-box {
      padding: 10px 14px;
      margin-bottom: 14px;
      border-radius: var(--radius);
      background: var(--accent-bg);
      color: var(--accent);
      font-size: 13px;
    }
    .models {
      margin: 28px 0 10px;
      padding: 0;
      border: 0;
    }
    .model {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 2px 12px;
      max-width: 560px;
      padding: 12px 14px;
      margin-bottom: 8px;
      border-radius: var(--radius);
      background: var(--panel-dark);
      cursor: pointer;
    }
    .model.selected {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    .model input {
      grid-row: span 3;
      margin: 3px 0 0;
      accent-color: var(--accent);
    }
    .model-name {
      font-weight: 700;
    }
    @media (max-width: 600px) {
      .key-form {
        flex-direction: column;
        align-items: stretch;
      }
    }
  `,
})
export class SettingsPage {
  protected readonly ai = inject(AiSettingsService);
  private readonly claude = inject(CLAUDE);

  protected readonly examplePages = EXAMPLE_PAGES;
  protected readonly models = MODELS.map((m) => ({
    ...m,
    example: formatDollars(estimateCost(EXAMPLE_PAGES, m)),
    note:
      m.id === 'claude-opus-5-5'
        ? 'Most careful. If it declines a part, the API may answer with another model.'
        : m.id === 'claude-sonnet-5-5'
          ? 'Nearly as good, half the price. Same automatic fallback.'
          : 'Cheapest and fastest; may miss more captions and joins.',
  }));
  protected keyInput = '';
  protected readonly checking = signal(false);
  protected readonly status = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly keyEnd = computed(() => this.ai.settings().apiKey.slice(-4));

  /** Saves the key once Claude accepts it. */
  protected async saveKey(): Promise<void> {
    const key = this.keyInput.trim();
    if (!key) {
      return;
    }
    if (await this.test(key)) {
      this.ai.update({ apiKey: key });
      this.keyInput = '';
      this.status.set({ ok: true, text: 'Key saved. New books are organized by Claude.' });
    }
  }

  protected async check(): Promise<void> {
    if (await this.test(this.ai.settings().apiKey)) {
      this.status.set({ ok: true, text: 'The key works.' });
    }
  }

  protected choose(model: ClaudeModel): void {
    this.ai.update({ model });
    this.status.set(null);
  }

  protected forget(): void {
    this.ai.forgetKey();
    this.status.set({ ok: true, text: 'Key removed from this device. New books use the layout rules.' });
  }

  private async test(key: string): Promise<boolean> {
    this.checking.set(true);
    this.status.set(null);
    try {
      await this.claude.checkKey(key, this.ai.settings().model);
      return true;
    } catch (e) {
      this.status.set({ ok: false, text: errorMessage(e) });
      return false;
    } finally {
      this.checking.set(false);
    }
  }
}
