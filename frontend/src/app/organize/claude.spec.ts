import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { ContentBlock } from '../core/models';
import {
  CHUNK_PAGES,
  CachedChunk,
  ChunkAnswer,
  ClaudeClient,
  ClaudeMessage,
  ClaudeUnavailableError,
  OrganizeOptions,
  chunkPages,
  organizeWithClaude,
} from './claude';
import { ClaudeModel, requestCost, modelInfo } from './pricing';
import { rulePlan } from './rules';
import { SourcePage } from './types';

/** 14 pages: a heading on page 1 and 13, a picture on page 12 whose caption is printed on page 13. */
function book(): SourcePage[] {
  return Array.from({ length: 14 }, (_, i) => {
    const n = i + 1;
    const specs: Partial<ContentBlock>[] =
      n === 1
        ? [{ type: 'h', text: 'Erster Teil' }, { text: 'Am Anfang war das W7ort.' }]
        : n === 12
          ? [{ text: 'Text vor dem Bild.' }, { type: 'img', src: 'p12-1.jpg', w: 10, h: 10 }]
          : n === 13
            ? [{ text: 'Links: ein Turm.', size: 8 } as Partial<ContentBlock>, { type: 'h', text: 'Zweiter Teil' }, { text: 'Weiter.' }]
            : [{ text: `Seite ${n}.` }];
    const blocks = specs.map((spec, seq) => {
      const { size, ...b } = spec as Partial<ContentBlock> & { size?: number };
      return {
        type: 'p' as const,
        ...b,
        id: `p${n}-b${seq}`,
        page: n,
        seq,
        layout: { x: 40, y: 40 + 90 * seq, w: 300, h: 60, fontSize: b.type === 'img' ? 0 : (size ?? 10), bold: false, italic: false },
      };
    });
    return { number: n, width: 420, height: 595, blocks, removed: [] };
  });
}

const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 };

function message(answer: ChunkAnswer | string, extra: Partial<ClaudeMessage> = {}): ClaudeMessage {
  return {
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'thinking' }, { type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }],
    usage,
    ...extra,
  };
}

const FIRST: ChunkAnswer = {
  blocks: [
    { id: 'p1-b0', role: 'heading', continuesPrevious: false },
    { id: 'p1-b1', role: 'body', continuesPrevious: false },
    { id: 'p13-b0', role: 'body', continuesPrevious: false }, // a context page: ignored
  ],
  figures: [{ images: ['p12-b1'], captions: ['p13-b0'] }],
  sections: [{ start: 'p1-b0', title: 'Erster Teil' }],
  fixes: [{ id: 'p1-b1', from: 'W7ort', to: 'Wort' }],
  contents: ['Erster Teil … 1', 'Zweiter Teil … 13'],
};

const SECOND: ChunkAnswer = {
  blocks: [
    { id: 'p13-b0', role: 'caption', continuesPrevious: false },
    { id: 'p13-b1', role: 'heading', continuesPrevious: false },
    { id: 'p13-b2', role: 'body', continuesPrevious: false },
  ],
  figures: [{ images: ['p12-b1'], captions: ['p13-b0'] }], // the same figure, seen from the other side
  sections: [{ start: 'p13-b1', title: 'Zweiter Teil' }],
  fixes: [],
  contents: [],
};

/** Plays the SDK's side: answers request n with `replies[n]`. */
class FakeClient implements ClaudeClient {
  readonly requests: BetaMessageStreamParams[] = [];
  constructor(private readonly replies: (ClaudeMessage | Error)[]) {}
  readonly beta = {
    messages: {
      stream: (params: BetaMessageStreamParams) => {
        const reply = this.replies[this.requests.push(params) - 1];
        return {
          finalMessage: async () => {
            if (!reply || reply instanceof Error) {
              throw reply ?? new Error('unexpected request');
            }
            return reply;
          },
        };
      },
    },
  };
}

class MemoryCache {
  readonly chunks = new Map<number, CachedChunk>();
  get = async (index: number) => this.chunks.get(index);
  put = async (chunk: CachedChunk) => void this.chunks.set(chunk.index, chunk);
}

function options(client: ClaudeClient, cache = new MemoryCache(), model: ClaudeModel = 'claude-opus-5-5'): OrganizeOptions {
  const pages = book();
  return {
    title: 'Der Mensch und seine Symbole',
    pages,
    rules: rulePlan(pages),
    model,
    client,
    preview: async (src) => (src === 'p12-1.jpg' ? 'PREVIEW' : null),
    cache,
  };
}

const textOf = (params: BetaMessageStreamParams) =>
  (params.messages[0]!.content as { type: string; text?: string }[]).map((c) => c.text ?? `<${c.type}>`).join('');

describe('organizing with Claude', () => {
  it('asks about 12 pages at a time, with a page of context on each side', () => {
    const chunks = chunkPages(book());

    expect(CHUNK_PAGES).toBe(12);
    expect(chunks.map((c) => [c.own.map((p) => p.number), c.context.map((p) => p.number)])).toEqual([
      [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [13]],
      [[13, 14], [12]],
    ]);
  });

  it('sends text, layout and image previews, and combines the answers into one plan', async () => {
    const client = new FakeClient([message(FIRST), message(SECOND)]);
    const progress: [number, number][] = [];

    const result = await organizeWithClaude({ ...options(client), onProgress: (d, t) => progress.push([d, t]) });

    const [first, second] = client.requests;
    expect(first).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 32_000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(first!.system).toEqual([expect.objectContaining({ cache_control: { type: 'ephemeral' } })]);
    expect(textOf(first!)).toContain('Organize pages 1–12. Page(s) 13: context only.');
    expect(textOf(first!)).toContain('[p1-b1] 10pt x40 y130 w300 h60: Am Anfang war das W7ort.');
    expect(textOf(first!)).toContain('[p12-b1] IMAGE x40 y130 w300 h60\n<image>');
    expect(first!.messages[0]!.content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'PREVIEW' },
    });
    // The table of contents found in the first part goes along with the others.
    expect(textOf(second!)).toContain('Table of contents (from earlier pages):\nErster Teil … 1\nZweiter Teil … 13');

    expect(result.plan.roles).toMatchObject({ 'p1-b0': 'heading', 'p13-b0': 'caption', 'p13-b1': 'heading' });
    expect(result.plan.figures).toEqual([{ images: ['p12-b1'], captions: ['p13-b0'] }]);
    expect(result.plan.sections).toEqual([
      { start: 'p1-b0', title: 'Erster Teil' },
      { start: 'p13-b1', title: 'Zweiter Teil' },
    ]);
    expect(result.plan.fixes).toEqual([{ block: 'p1-b1', from: 'W7ort', to: 'Wort' }]);
    expect(result).toMatchObject({ chunks: 2, failedChunks: 0 });
    expect(result.cost).toBeCloseTo(2 * requestCost(modelInfo('claude-opus-5-5')!, usage));
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it('uses the layout rules for a part Claude declines or answers unusably', async () => {
    for (const bad of [
      message('', { stop_reason: 'refusal' }),
      message('{"blocks": [', { stop_reason: 'max_tokens' }),
      message('this is not JSON'),
      message({ ...SECOND, blocks: [{ id: 'p13-b0', role: 'poem' }] } as never),
    ]) {
      const client = new FakeClient([message(FIRST), bad]);
      const o = options(client);

      const result = await organizeWithClaude(o);

      expect(result).toMatchObject({ chunks: 2, failedChunks: 1 });
      const ruleSections = o.rules.sections.filter((s) => s.start.startsWith('p13'));
      expect(result.plan.sections).toEqual([{ start: 'p1-b0', title: 'Erster Teil' }, ...ruleSections]);
      expect(result.plan.roles['p13-b2']).toBe('body');
    }
  });

  it('stops with a readable message when Claude cannot be reached or the key is refused', async () => {
    const offline = new FakeClient([new Anthropic.APIConnectionError({ message: 'Connection error.' })]);
    await expect(organizeWithClaude(options(offline))).rejects.toThrow(ClaudeUnavailableError);
    await expect(organizeWithClaude(options(new FakeClient([new Anthropic.APIConnectionError({})])))).rejects.toThrow(
      'Claude could not be reached',
    );

    const refused = new Anthropic.AuthenticationError(401, { error: { message: 'invalid x-api-key' } }, 'invalid', new Headers());
    await expect(organizeWithClaude(options(new FakeClient([refused])))).rejects.toThrow('did not accept the API key');
  });

  it('does not ask again for parts answered before', async () => {
    const cache = new MemoryCache();
    await organizeWithClaude(options(new FakeClient([message(FIRST), message('', { stop_reason: 'refusal' })]), cache));
    expect([...cache.chunks.keys()]).toEqual([0]); // only usable answers are kept

    const again = new FakeClient([message(SECOND)]);
    const result = await organizeWithClaude(options(again, cache));

    expect(again.requests).toHaveLength(1);
    expect(textOf(again.requests[0]!)).toContain('Organize pages 13–14.');
    expect(result.failedChunks).toBe(0);
    expect(result.cost).toBeCloseTo(2 * requestCost(modelInfo('claude-opus-5-5')!, usage));

    // A different model is a different answer.
    const haiku = new FakeClient([message(FIRST), message(SECOND)]);
    await organizeWithClaude(options(haiku, cache, 'claude-haiku-5-5'));
    expect(haiku.requests).toHaveLength(2);
  });

  it('asks Haiku without the server-side fallback, which it does not have', async () => {
    const client = new FakeClient([message(FIRST, { model: 'claude-haiku-5-5' }), message(SECOND, { model: 'claude-haiku-5-5' })]);

    const result = await organizeWithClaude(options(client, new MemoryCache(), 'claude-haiku-5-5'));

    expect(client.requests[0]!.model).toBe('claude-haiku-5-5');
    expect('fallbacks' in client.requests[0]!).toBe(false);
    expect('betas' in client.requests[0]!).toBe(false);
    expect(result.cost).toBeCloseTo(2 * requestCost(modelInfo('claude-haiku-5-5')!, usage));
  });
});
