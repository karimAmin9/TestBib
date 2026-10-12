import { Component, inject, output } from '@angular/core';
import { LIMITS, ReaderSettingsService, ReaderTheme } from '../../core/reader-settings.service';

/** Inline "Options" panel shown under the reader's options row (like ranobes.net). */
@Component({
  selector: 'app-reader-settings-panel',
  template: `
    @let s = settings.settings();
    <div class="options" role="group" aria-label="Reading settings">
      <div class="opt">
        <span class="label">Background</span>
        <div class="choices">
          @for (t of themes; track t.value) {
            <button
              type="button"
              [class]="'swatch ' + t.value"
              [class.active]="s.theme === t.value"
              [attr.aria-pressed]="s.theme === t.value"
              (click)="settings.update({ theme: t.value })"
            >
              {{ t.label }}
            </button>
          }
        </div>
      </div>

      <div class="opt">
        <span class="label">Font</span>
        <div class="choices">
          <button
            type="button"
            [class.active]="s.font === 'sans'"
            (click)="settings.update({ font: 'sans' })"
          >
            Sans
          </button>
          <button
            type="button"
            class="serif"
            [class.active]="s.font === 'serif'"
            (click)="settings.update({ font: 'serif' })"
          >
            Serif
          </button>
        </div>
      </div>

      <div class="opt">
        <span class="label">Font size</span>
        <div class="choices">
          <button
            type="button"
            (click)="settings.step('fontSize', -1)"
            [disabled]="s.fontSize <= limits.fontSize.min"
            aria-label="Smaller text"
          >
            A−
          </button>
          <output>{{ s.fontSize }}px</output>
          <button
            type="button"
            (click)="settings.step('fontSize', 1)"
            [disabled]="s.fontSize >= limits.fontSize.max"
            aria-label="Larger text"
          >
            A+
          </button>
        </div>
      </div>

      <div class="opt">
        <span class="label">Line spacing</span>
        <div class="choices">
          <button
            type="button"
            (click)="settings.step('lineHeight', -1)"
            [disabled]="s.lineHeight <= limits.lineHeight.min"
            aria-label="Less line spacing"
          >
            −
          </button>
          <output>{{ s.lineHeight.toFixed(1) }}</output>
          <button
            type="button"
            (click)="settings.step('lineHeight', 1)"
            [disabled]="s.lineHeight >= limits.lineHeight.max"
            aria-label="More line spacing"
          >
            +
          </button>
        </div>
      </div>

      <div class="opt">
        <span class="label">Text width</span>
        <div class="choices">
          <button
            type="button"
            (click)="settings.step('width', -1)"
            [disabled]="s.width <= limits.width.min"
            aria-label="Narrower column"
          >
            −
          </button>
          <output>{{ s.width }}px</output>
          <button
            type="button"
            (click)="settings.step('width', 1)"
            [disabled]="s.width >= limits.width.max"
            aria-label="Wider column"
          >
            +
          </button>
        </div>
      </div>

      <div class="footer">
        <button type="button" class="link" (click)="settings.reset()">Reset</button>
        <button type="button" class="link" (click)="closed.emit()">Close</button>
      </div>
    </div>
  `,
  styles: `
    .options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 14px 28px;
      margin: 0 0 22px;
      padding: 16px 18px;
      border-radius: var(--radius);
      background: rgba(0, 0, 0, 0.12);
      font-family: var(--font);
      font-size: 12px;
    }
    .opt {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .label {
      color: var(--r-muted, var(--text-muted));
      font-weight: 700;
      text-transform: uppercase;
    }
    .choices {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    button {
      min-width: 36px;
      height: 30px;
      padding: 0 12px;
      border: 1px solid transparent;
      border-radius: var(--pill);
      background: var(--r-btn, var(--btn));
      color: var(--r-btn-text, #efefef);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    button.active {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .swatch.light {
      background: #f7f6f2;
      color: #222;
    }
    .swatch.sepia {
      background: #f4ecd8;
      color: #5b4636;
    }
    .swatch.dark {
      background: #474747;
      color: #ddd;
    }
    .serif {
      font-family: Georgia, serif;
    }
    output {
      min-width: 46px;
      text-align: center;
      font-weight: 700;
    }
    .footer {
      grid-column: 1 / -1;
      display: flex;
      justify-content: flex-end;
      gap: 18px;
    }
    .link {
      height: auto;
      min-width: 0;
      padding: 0;
      border: 0;
      background: none;
      color: var(--accent);
      text-transform: uppercase;
    }
  `,
})
export class ReaderSettingsPanel {
  protected readonly settings = inject(ReaderSettingsService);
  protected readonly limits = LIMITS;
  readonly closed = output<void>();

  protected readonly themes: { value: ReaderTheme; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'sepia', label: 'Sepia' },
  ];
}
