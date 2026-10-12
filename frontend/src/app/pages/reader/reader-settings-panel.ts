import { Component, inject, output } from '@angular/core';
import { LIMITS, ReaderSettingsService, ReaderTheme } from '../../core/reader-settings.service';

@Component({
  selector: 'app-reader-settings-panel',
  template: `
    @let s = settings.settings();
    <div class="panel-pop" role="dialog" aria-label="Reading settings">
      <div class="row">
        <span class="label">Theme</span>
        <div class="themes">
          @for (t of themes; track t.value) {
            <button
              type="button"
              class="theme-btn"
              [class]="'theme-btn ' + t.value"
              [class.active]="s.theme === t.value"
              [attr.aria-pressed]="s.theme === t.value"
              (click)="settings.update({ theme: t.value })"
            >
              {{ t.label }}
            </button>
          }
        </div>
      </div>

      <div class="row">
        <span class="label">Font</span>
        <div class="seg">
          <button
            type="button"
            [class.active]="s.font === 'serif'"
            (click)="settings.update({ font: 'serif' })"
            class="serif"
          >
            Serif
          </button>
          <button
            type="button"
            [class.active]="s.font === 'sans'"
            (click)="settings.update({ font: 'sans' })"
          >
            Sans
          </button>
        </div>
      </div>

      <div class="row">
        <span class="label">Size</span>
        <div class="stepper">
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

      <div class="row">
        <span class="label">Spacing</span>
        <div class="stepper">
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

      <div class="row">
        <span class="label">Width</span>
        <div class="stepper">
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
        <button type="button" class="link" (click)="closed.emit()">Done</button>
      </div>
    </div>
  `,
  styles: `
    .panel-pop {
      position: absolute;
      top: calc(100% + 6px);
      right: 12px;
      width: 290px;
      padding: 14px 16px;
      border-radius: 10px;
      background: var(--surface);
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
      color: var(--text);
      font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
      font-size: 14px;
      z-index: 30;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
    }
    .label {
      color: var(--text-muted);
    }
    .themes,
    .seg,
    .stepper {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    button {
      font: inherit;
      cursor: pointer;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      padding: 4px 10px;
      min-width: 34px;
      height: 30px;
    }
    button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    button.active {
      border-color: var(--accent);
      color: var(--text-strong);
    }
    .theme-btn.light {
      background: #fbfbf8;
      color: #222;
    }
    .theme-btn.sepia {
      background: #f4ecd8;
      color: #5b4636;
    }
    .theme-btn.dark {
      background: #1b1d22;
      color: #ddd;
    }
    .theme-btn.active {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    .serif {
      font-family: Georgia, serif;
    }
    output {
      min-width: 48px;
      text-align: center;
      color: var(--text-strong);
    }
    .footer {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
    }
    .link {
      border: 0;
      background: none;
      color: var(--link);
      padding: 0;
      height: auto;
      min-width: 0;
    }
  `,
})
export class ReaderSettingsPanel {
  protected readonly settings = inject(ReaderSettingsService);
  protected readonly limits = LIMITS;
  readonly closed = output<void>();

  protected readonly themes: { value: ReaderTheme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'sepia', label: 'Sepia' },
    { value: 'dark', label: 'Dark' },
  ];
}
