/** The Claude models the app can organize books with, and what they cost (US$ per million tokens). */
export type ClaudeModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';

export interface ModelInfo {
  id: ClaudeModel;
  name: string;
  input: number;
  output: number;
  cacheRead: number;
  /** Whether the API may answer with another model when this one declines (server-side fallback). */
  fallback: boolean;
}

export const MODELS: readonly ModelInfo[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', input: 4, output: 20, cacheRead: 0.2, fallback: true },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', input: 2, output: 10, cacheRead: 0.2, fallback: true },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', input: 0.1, output: 0.5, cacheRead: 0.01, fallback: false },
];

export const DEFAULT_MODEL: ClaudeModel = 'claude-opus-5-5';

export function modelInfo(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** What one request cost; cache writes cost 1.25 × input. */
export function requestCost(model: ModelInfo, usage: Usage): number {
  const dollars =
    usage.input_tokens * model.input +
    (usage.cache_creation_input_tokens ?? 0) * model.input * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * model.cacheRead +
    usage.output_tokens * model.output;
  return dollars / 1_000_000;
}

/**
 * A rough estimate for organizing a book: per page about 900 input tokens (text, layout, a small preview of each
 * image) and 450 output tokens (the plan plus Claude's thinking), plus the context pages of each request.
 */
export function estimateCost(pageCount: number, model: ModelInfo): number {
  const requests = Math.ceil(pageCount / 12);
  const input = pageCount * 900 + requests * 3_000;
  const output = pageCount * 450;
  return (input * model.input + output * model.output) / 1_000_000;
}

/** "$0.04", "$1.20", "$12". */
export function formatDollars(amount: number): string {
  if (amount < 0.01) {
    return '< $0.01';
  }
  return amount < 10 ? `$${amount.toFixed(2)}` : `$${Math.round(amount)}`;
}
