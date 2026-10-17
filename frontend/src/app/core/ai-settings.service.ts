import { Injectable, computed, effect, signal } from '@angular/core';
import { ClaudeModel, DEFAULT_MODEL, modelInfo } from '../organize/pricing';

export interface AiSettings {
  /** The owner's Claude API key; stays on this device and is only sent to api.anthropic.com. */
  apiKey: string;
  model: ClaudeModel;
}

const STORAGE_KEY = 'bib.ai-settings';
const DEFAULT_SETTINGS: AiSettings = { apiKey: '', model: DEFAULT_MODEL };

/** Organizing books with Claude: the API key and the model, persisted per browser. */
@Injectable({ providedIn: 'root' })
export class AiSettingsService {
  readonly settings = signal<AiSettings>(load());
  /** New books are organized by Claude when a key is set. */
  readonly enabled = computed(() => this.settings().apiKey.length > 0);

  constructor() {
    effect(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings()));
      } catch {
        // storage unavailable (private mode): the key is not remembered
      }
    });
  }

  update(changes: Partial<AiSettings>): void {
    this.settings.update((s) => sanitize({ ...s, ...changes }));
  }

  forgetKey(): void {
    this.update({ apiKey: '' });
  }
}

export function sanitize(raw: Partial<AiSettings>): AiSettings {
  return {
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
    model: typeof raw.model === 'string' && modelInfo(raw.model) ? raw.model : DEFAULT_MODEL,
  };
}

function load(): AiSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? sanitize(JSON.parse(stored) as Partial<AiSettings>) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
