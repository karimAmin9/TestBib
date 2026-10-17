import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import * as z from 'zod';
import { ContentBlock } from '../core/models';
import { ClaudeModel, ModelInfo, Usage, modelInfo, requestCost } from './pricing';
import { bodyFontSize } from './rules';
import { Plan, SourcePage, emptyPlan } from './types';

/** Bump when the prompt or the answer format changes: answers stored for an older prompt are asked again. */
export const PROMPT_VERSION = 1;
export const CHUNK_PAGES = 12;
const CONTEXT_PAGES = 1;
const PARALLEL = 3;
const MAX_PREVIEWS = 40;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const Answer = z.object({
  blocks: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['body', 'heading', 'caption', 'artifact', 'other']),
      continuesPrevious: z.boolean(),
    }),
  ),
  figures: z.array(z.object({ images: z.array(z.string()), captions: z.array(z.string()) })),
  sections: z.array(z.object({ start: z.string(), title: z.string() })),
  fixes: z.array(z.object({ id: z.string(), from: z.string(), to: z.string() })),
  contents: z.array(z.string()),
});
export type ChunkAnswer = z.infer<typeof Answer>;

// The schema goes to the API; parsing stays here, so a refusal or a cut-off answer is handled, not thrown.
const { parse: parseAnswer, ...answerFormat } = betaZodOutputFormat(Answer);

const SYSTEM = `You arrange the pages of a scanned book for reading in an e-book app. The text comes from OCR.
You get a few pages at a time: every text block and image of each page in reading order, with its id, type size and
style, and its position on the page (points from the top left). Images come with a small preview.

Return a plan for the pages to organize (the context pages before and after are there so you can see what continues):

blocks: one entry for every text block on the pages to organize, with
  role:
    body     running text of the book.
    heading  a title or sub heading.
    caption  text that describes an image: picture captions, often in a smaller, bold or italic type, often starting
             with a direction ("Links:", "Rechts:", "Oben:", "Unten:", "Gegenüber:", "Left:", "Above:" …). In
             illustrated books a caption is often printed on the page before or after its image.
    artifact page furniture that is not part of the text: running heads (the book or chapter title repeated at the top
             or bottom of pages), page numbers, scanner noise. Short blocks only (12 words at most).
    other    part of the book but not running text: title page, table of contents, credits, footnotes, set-off quotes.
  continuesPrevious: true when the block continues the same paragraph as the previous body block, because the
    paragraph was interrupted by a page break, a column break, an image or a caption. Typical: the previous body block
    ends without closing punctuation or with a hyphenated word, and this one completes the sentence. False when the
    block starts a new paragraph, and for anything that is not body text.

figures: each image with the captions that describe it. Captions and images may be on different pages; you may use
  ids from the context pages for that. A caption describing several images belongs to the first of them.

sections: where a section of the book starts: a chapter or part as listed in the table of contents, or an obvious
  chapter opening. Sub headings inside a chapter are not sections. start = the id of the section's first block (its
  heading, or the author line above it); title = the section title as the table of contents gives it (or as printed),
  scan errors corrected.

fixes: obvious scan errors in the text of the pages to organize: misread characters ("W7ort" → "Wort"), words run
  together ("vielleichtTräumeeineeigene" → "vielleicht Träume eine eigene"), a word torn apart ("photographier t" →
  "photographiert"). from = the text exactly as it appears in the block, as short as possible (40 characters at most);
  to = the correction. Keep the book's spelling (also old spellings such as "daß"), wording and punctuation; only undo
  scanning mistakes. When in doubt, leave it.

contents: if one of the pages to organize shows the book's table of contents, its entries in order ("title … page");
  otherwise empty.

Copy ids exactly as given. Never invent text.`;

/** The part of the SDK client the organizer uses (tests pass a fake). */
export interface ClaudeClient {
  beta: { messages: { stream(params: BetaMessageStreamParams): { finalMessage(): Promise<ClaudeMessage> } } };
}

export interface ClaudeMessage {
  model: string;
  stop_reason: string | null;
  content: { type: string; text?: string }[];
  usage: Usage;
}

/** The browser talks to the API directly with the owner's own key (there is no server in between). */
export function createClient(apiKey: string): ClaudeClient {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export async function checkKey(apiKey: string, model: ClaudeModel): Promise<void> {
  try {
    await new Anthropic({ apiKey, dangerouslyAllowBrowser: true }).models.retrieve(model);
  } catch (e) {
    throw new ClaudeUnavailableError(readable(e));
  }
}

/** Claude could not be used at all (wrong key, no credit, offline): the book keeps the rule plan. */
export class ClaudeUnavailableError extends Error {}

/** One answer stored per chunk, so an interrupted or repeated run does not pay twice. */
export interface CachedChunk {
  index: number;
  key: string;
  answer: ChunkAnswer;
  cost: number;
}

export interface ChunkCache {
  get(index: number): Promise<CachedChunk | undefined>;
  put(chunk: CachedChunk): Promise<void>;
}

export interface OrganizeOptions {
  title: string;
  pages: SourcePage[];
  /** The layout-rule plan, used for the pages Claude could not organize. */
  rules: Plan;
  model: ClaudeModel;
  client: ClaudeClient;
  /** A small JPEG preview (base64) of an image block's file; null to leave it out. */
  preview(src: string): Promise<string | null>;
  cache: ChunkCache;
  onProgress?(done: number, total: number): void;
}

export interface OrganizeResult {
  plan: Plan;
  /** US$, all chunks (including answers stored by an earlier run). */
  cost: number;
  chunks: number;
  /** Chunks Claude declined or answered unusably; their pages use the layout rules. */
  failedChunks: number;
}

interface Chunk {
  index: number;
  own: SourcePage[];
  context: SourcePage[];
}

/** Asks Claude for a plan, about 12 pages per request: the first chunk alone (it usually has the contents), then 3 at a time. */
export async function organizeWithClaude(options: OrganizeOptions): Promise<OrganizeResult> {
  const model = modelInfo(options.model);
  if (!model) {
    throw new ClaudeUnavailableError(`Unknown model: ${options.model}`);
  }
  const chunks = chunkPages(options.pages);
  const body = bodyFontSize(options.pages.flatMap((p) => p.blocks));
  const answers: (ChunkAnswer | null)[] = [];
  let cost = 0;
  let done = 0;
  options.onProgress?.(0, chunks.length);

  const run = async (chunk: Chunk, contents: string[]) => {
    const result = await organizeChunk(options, model, chunk, contents, body);
    answers[chunk.index] = result.answer;
    cost += result.cost;
    options.onProgress?.(++done, chunks.length);
  };
  if (chunks.length > 0) {
    await run(chunks[0]!, []);
    const contents = answers[0]?.contents ?? [];
    await pool(chunks.slice(1), PARALLEL, (chunk) => run(chunk, contents));
  }

  const pageOf = new Map(options.pages.flatMap((p) => p.blocks.map((b) => [b.id ?? '', p.number] as const)));
  const parts = chunks.map((chunk) => {
    const own = new Set(chunk.own.map((p) => p.number));
    const answer = answers[chunk.index];
    const rules = restrict(options.rules, own, pageOf);
    if (!answer) {
      return rules;
    }
    const plan = fromAnswer(answer, own, new Set([...own, ...chunk.context.map((p) => p.number)]), pageOf);
    return { ...plan, roles: { ...rules.roles, ...plan.roles } }; // blocks Claude skipped keep the rule role
  });
  return {
    plan: combine(parts),
    cost,
    chunks: chunks.length,
    failedChunks: answers.filter((a) => a === null).length,
  };
}

export function chunkPages(pages: SourcePage[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (let start = 0; start < pages.length; start += CHUNK_PAGES) {
    const end = Math.min(pages.length, start + CHUNK_PAGES);
    chunks.push({
      index: chunks.length,
      own: pages.slice(start, end),
      context: [...pages.slice(Math.max(0, start - CONTEXT_PAGES), start), ...pages.slice(end, end + CONTEXT_PAGES)],
    });
  }
  return chunks;
}

async function organizeChunk(
  options: OrganizeOptions,
  model: ModelInfo,
  chunk: Chunk,
  contents: string[],
  body: number,
): Promise<{ answer: ChunkAnswer | null; cost: number }> {
  const { content, fingerprint } = await chunkMessage(options, chunk, contents, body);
  const key = `v${PROMPT_VERSION}:${model.id}:${hash(fingerprint)}`;
  const cached = await options.cache.get(chunk.index);
  if (cached?.key === key) {
    return { answer: cached.answer, cost: cached.cost };
  }

  let message: ClaudeMessage;
  try {
    message = await options.client.beta.messages
      .stream({
        model: model.id,
        max_tokens: 32_000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: answerFormat },
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content }],
        ...(model.fallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      })
      .finalMessage();
  } catch (e) {
    throw new ClaudeUnavailableError(readable(e));
  }

  const cost = requestCost(modelInfo(message.model) ?? model, message.usage);
  const answer = readAnswer(message);
  if (answer) {
    await options.cache.put({ index: chunk.index, key, answer, cost });
  }
  return { answer, cost };
}

type Content = Exclude<BetaMessageStreamParams['messages'][number]['content'], string>;

async function chunkMessage(options: OrganizeOptions, chunk: Chunk, contents: string[], body: number) {
  const first = chunk.own[0]!.number;
  const last = chunk.own.at(-1)!.number;
  const before = chunk.context.filter((p) => p.number < first);
  const after = chunk.context.filter((p) => p.number > last);
  const intro = [
    `Book: ${options.title}`,
    body > 0 ? `Body text size: ${body} pt.` : '',
    contents.length > 0 ? `Table of contents (from earlier pages):\n${contents.join('\n')}` : '',
    `Organize pages ${first}–${last}.` +
      (chunk.context.length > 0 ? ` Page(s) ${chunk.context.map((p) => p.number).join(', ')}: context only.` : ''),
  ].filter(Boolean);

  const content: Content = [];
  let text = intro.join('\n') + '\n';
  let fingerprint = text;
  let previews = 0;
  for (const page of [...before, ...chunk.own, ...after]) {
    const context = page.number < first || page.number > last;
    text += `\n=== Page ${page.number}${context ? ' (context only)' : ''}, ${page.width}×${page.height} pt ===\n`;
    for (const block of page.blocks) {
      const line = describe(block);
      text += line + '\n';
      fingerprint += line + '\n';
      if (block.type === 'img' && block.src && previews < MAX_PREVIEWS) {
        const data = await options.preview(block.src).catch(() => null);
        if (data) {
          previews++;
          content.push({ type: 'text', text });
          content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
          text = '';
        }
      }
    }
  }
  content.push({ type: 'text', text });
  return { content, fingerprint };
}

function describe(b: ContentBlock): string {
  const l = b.layout;
  const where = l ? ` x${Math.round(l.x)} y${Math.round(l.y)} w${Math.round(l.w)} h${Math.round(l.h)}` : '';
  if (b.type === 'img') {
    return `[${b.id}] IMAGE${where}`;
  }
  const face = l && l.fontSize > 0 ? ` ${l.fontSize}pt${l.bold ? ' bold' : ''}${l.italic ? ' italic' : ''}` : '';
  return `[${b.id}]${b.type === 'h' ? ' HEADING' : ''}${face}${where}: ${b.text ?? ''}`;
}

function readAnswer(message: ClaudeMessage): ChunkAnswer | null {
  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
    return null;
  }
  const text = message.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('');
  try {
    return parseAnswer(text);
  } catch {
    return null;
  }
}

/** The answer as a plan for the chunk's own pages; figures may reach into the context pages. */
function fromAnswer(answer: ChunkAnswer, own: Set<number>, visible: Set<number>, pageOf: Map<string, number>): Plan {
  const on = (pages: Set<number>) => (id: string) => pages.has(pageOf.get(id) ?? -1);
  const mine = on(own);
  const seen = on(visible);
  const plan = emptyPlan();
  for (const b of answer.blocks.filter((b) => mine(b.id))) {
    plan.roles[b.id] = b.role;
    if (b.continuesPrevious) {
      plan.cont.push(b.id);
    }
  }
  for (const f of answer.figures) {
    const images = f.images.filter(seen);
    const captions = f.captions.filter(seen);
    if (images.length > 0 && [...images, ...captions].some(mine)) {
      plan.figures.push({ images, captions });
    }
  }
  plan.sections = answer.sections.filter((s) => mine(s.start));
  plan.fixes = answer.fixes.filter((f) => mine(f.id)).map((f) => ({ block: f.id, from: f.from, to: f.to }));
  return plan;
}

/** The part of a plan about the given pages (a figure goes with its first image). */
function restrict(plan: Plan, pages: Set<number>, pageOf: Map<string, number>): Plan {
  const mine = (id: string) => pages.has(pageOf.get(id) ?? -1);
  return {
    roles: Object.fromEntries(Object.entries(plan.roles).filter(([id]) => mine(id))),
    cont: plan.cont.filter(mine),
    figures: plan.figures.filter((f) => f.images.length > 0 && mine(f.images[0]!)),
    sections: plan.sections.filter((s) => mine(s.start)),
    fixes: plan.fixes.filter((f) => mine(f.block)),
  };
}

/** Joins the chunks' plans; figures that share an image (seen from both sides of a chunk border) become one. */
function combine(parts: Plan[]): Plan {
  const plan = emptyPlan();
  const figureOfImage = new Map<string, Plan['figures'][number]>();
  for (const part of parts) {
    Object.assign(plan.roles, part.roles);
    plan.cont.push(...part.cont);
    plan.sections.push(...part.sections);
    plan.fixes.push(...part.fixes);
    for (const f of part.figures) {
      const existing = f.images.map((id) => figureOfImage.get(id)).find((x) => x !== undefined);
      const target = existing ?? { images: [], captions: [] };
      if (!existing) {
        plan.figures.push(target);
      }
      target.images = [...new Set([...target.images, ...f.images])];
      target.captions = [...new Set([...target.captions, ...f.captions])];
      f.images.forEach((id) => figureOfImage.set(id, target));
    }
  }
  return plan;
}

function readable(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) {
    return 'Claude did not accept the API key. Check it in Settings.';
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return 'This API key is not allowed to use Claude. Check it in Settings.';
  }
  if (e instanceof Anthropic.NotFoundError) {
    return 'The chosen Claude model is not available for this API key.';
  }
  if (e instanceof Anthropic.RateLimitError) {
    return 'Claude is receiving too many requests for this API key. Try again later.';
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return 'Claude could not be reached. Check the internet connection and try again.';
  }
  if (e instanceof Anthropic.APIError) {
    const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message;
    return `Claude: ${detail ?? e.message}`;
  }
  return e instanceof Error && e.message ? e.message : 'Claude could not organize this book.';
}

/** Runs `work` for every item, at most `limit` at a time; stops at the first error. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next++]!;
      try {
        await work(item);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** FNV-1a: tells whether a chunk's pages are still the ones Claude answered for. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
