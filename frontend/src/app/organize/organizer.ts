import { InjectionToken } from '@angular/core';
import type { OrganizeOptions, OrganizeResult } from './claude';
import type { ClaudeModel } from './pricing';

export interface Claude {
  organize(options: Omit<OrganizeOptions, 'client'> & { apiKey: string }): Promise<OrganizeResult>;
  /** Checks that the key works for the model (a free request: the model's details). */
  checkKey(apiKey: string, model: ClaudeModel): Promise<void>;
}

/** Claude, for organizing books. The SDK is loaded only when it is used; tests provide a fake. */
export const CLAUDE = new InjectionToken<Claude>('CLAUDE', {
  providedIn: 'root',
  factory: () => ({
    organize: async ({ apiKey, ...options }) => {
      const { createClient, organizeWithClaude } = await import('./claude');
      return organizeWithClaude({ ...options, client: createClient(apiKey) });
    },
    checkKey: async (apiKey, model) => (await import('./claude')).checkKey(apiKey, model),
  }),
});

/** Makes the image previews sent to Claude; tests provide a fake (no canvas there). */
export const IMAGE_PREVIEW = new InjectionToken<(bytes: Uint8Array, type: string) => Promise<string | null>>(
  'IMAGE_PREVIEW',
  {
    providedIn: 'root',
    factory: () => async (bytes, type) => (await import('./preview')).jpegPreview(bytes, type),
  },
);
