import { Injectable, computed, effect, signal } from '@angular/core';

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type ReaderFont = 'serif' | 'sans';

export interface ReaderSettings {
  theme: ReaderTheme;
  font: ReaderFont;
  fontSize: number;
  lineHeight: number;
  width: number;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'dark',
  font: 'serif',
  fontSize: 19,
  lineHeight: 1.7,
  width: 760,
};

export const LIMITS = {
  fontSize: { min: 14, max: 30, step: 1 },
  lineHeight: { min: 1.3, max: 2.4, step: 0.1 },
  width: { min: 480, max: 1200, step: 40 },
} as const;

const STORAGE_KEY = 'bib.reader-settings';

/** Reader appearance, persisted per browser. */
@Injectable({ providedIn: 'root' })
export class ReaderSettingsService {
  readonly settings = signal<ReaderSettings>(load());

  /** CSS custom properties applied to the reader container. */
  readonly cssVars = computed(() => {
    const s = this.settings();
    return {
      '--reader-font-size': `${s.fontSize}px`,
      '--reader-line-height': `${s.lineHeight}`,
      '--reader-width': `${s.width}px`,
      '--reader-font':
        s.font === 'serif'
          ? "'Literata', Georgia, 'Times New Roman', serif"
          : "'Inter', 'Segoe UI', Roboto, Arial, sans-serif",
    };
  });

  constructor() {
    effect(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings()));
      } catch {
        // storage unavailable (private mode): settings just are not remembered
      }
    });
  }

  update(changes: Partial<ReaderSettings>): void {
    this.settings.update((s) => sanitize({ ...s, ...changes }));
  }

  step(key: keyof typeof LIMITS, direction: 1 | -1): void {
    const limit = LIMITS[key];
    const value = Math.round((this.settings()[key] + direction * limit.step) * 10) / 10;
    this.update({ [key]: value });
  }

  reset(): void {
    this.settings.set(DEFAULT_SETTINGS);
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function sanitize(raw: Partial<ReaderSettings>): ReaderSettings {
  return {
    theme:
      raw.theme === 'light' || raw.theme === 'sepia' || raw.theme === 'dark'
        ? raw.theme
        : DEFAULT_SETTINGS.theme,
    font: raw.font === 'sans' || raw.font === 'serif' ? raw.font : DEFAULT_SETTINGS.font,
    fontSize: clamp(
      raw.fontSize,
      LIMITS.fontSize.min,
      LIMITS.fontSize.max,
      DEFAULT_SETTINGS.fontSize,
    ),
    lineHeight: clamp(
      raw.lineHeight,
      LIMITS.lineHeight.min,
      LIMITS.lineHeight.max,
      DEFAULT_SETTINGS.lineHeight,
    ),
    width: clamp(raw.width, LIMITS.width.min, LIMITS.width.max, DEFAULT_SETTINGS.width),
  };
}

function load(): ReaderSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? sanitize(JSON.parse(stored) as Partial<ReaderSettings>) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
