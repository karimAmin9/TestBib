import { ContentBlock } from '../core/models';
import { endsSentence, endsWithBrokenWord, words } from './text';
import { AssembledBook, AssembledChapter, PageRemoval, SourcePage } from './types';
import { ValidPlan } from './validate';

/** Sections longer than this are split into parts of about this many words. */
export const MAX_CHAPTER_WORDS = 2000;

/** A text block, or a figure (images followed by their captions), in reading order. */
type Item = { kind: 'text'; block: ContentBlock } | { kind: 'figure'; blocks: ContentBlock[] };

/**
 * Turns pages into chapters by a validated plan. It only reorders, groups and marks blocks: every block of the
 * book ends up exactly once in the result (or, as page furniture, in `removed`), with its original text. That is
 * what the 1:1 check (ConversionVerifier.VerifyAssembled) relies on.
 */
export function assemble(pages: SourcePage[], plan: ValidPlan, bookTitle: string): AssembledBook {
  const ordered = pages.flatMap((p) => [...p.blocks].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)));
  const removed: PageRemoval[] = pages.flatMap((p) => p.removed.map((r) => ({ page: p.number, ...r })));
  const cont = new Set(plan.cont);
  const figureOf = new Map<string, number>();
  plan.figures.forEach((f, i) => [...f.images, ...f.captions].forEach((id) => figureOf.set(id, i)));

  const items: Item[] = [];
  const pending: Item[] = []; // figures and loose captions wait for the end of the sentence being read
  const emitted = new Set<number>();
  let lastText = '';
  for (const source of ordered) {
    const id = source.id ?? '';
    const role = plan.roles[id];
    if (role === 'artifact') {
      removed.push({ page: source.page ?? 0, kind: 'artifact', text: source.text ?? '' });
      continue;
    }
    const block = mark(source, plan, cont);
    const figure = figureOf.get(id);
    if (figure !== undefined) {
      if (!emitted.has(figure)) {
        emitted.add(figure);
        pending.push({ kind: 'figure', blocks: figureBlocks(plan.figures[figure]!, ordered, plan, figure) });
      }
      continue;
    }
    if (block.role === 'caption') {
      pending.push({ kind: 'text', block });
      continue;
    }
    // Place what was waiting where a paragraph or a sentence ends, or once the text has moved past the pages of
    // what waits: in illustrated books the text runs on for many pages, and its pictures should stay near it.
    // Never inside a word broken at the column end ("ziem-" | "lich").
    const movedOn = (block.page ?? 0) > lastPage(pending) && !endsWithBrokenWord(lastText);
    if (pending.length > 0 && (!block.cont || endsSentence(lastText) || movedOn)) {
      items.push(...pending.splice(0));
    }
    items.push({ kind: 'text', block });
    lastText = block.text ?? '';
  }
  items.push(...pending);

  const fixCount = Object.values(plan.fixes).reduce((n, f) => n + f.length, 0);
  return { chapters: number(split(sections(dropBrokenJoins(items), plan, bookTitle))), removed, fixCount };
}

function mark(source: ContentBlock, plan: ValidPlan, cont: Set<string>): ContentBlock {
  const id = source.id ?? '';
  const block: ContentBlock = { ...source };
  delete block.layout; // only needed for organizing, not for reading
  if (source.type !== 'img') {
    const role = plan.roles[id];
    block.role = role === undefined || role === 'artifact' ? (source.type === 'h' ? 'heading' : 'body') : role;
  }
  if (cont.has(id)) {
    block.cont = true;
  }
  const fixes = plan.fixes[id];
  if (fixes?.length) {
    block.fixes = fixes;
  }
  return block;
}

/** The figure's images, then its captions, each in reading order. */
function figureBlocks(
  figure: ValidPlan['figures'][number],
  ordered: ContentBlock[],
  plan: ValidPlan,
  index: number,
): ContentBlock[] {
  const position = new Map(ordered.map((b, i) => [b.id, i]));
  const byId = new Map(ordered.map((b) => [b.id, b]));
  const inOrder = (ids: string[]) => [...ids].sort((a, b) => position.get(a)! - position.get(b)!);
  const id = `f${index + 1}`;
  return [...inOrder(figure.images), ...inOrder(figure.captions)].map((member) => ({
    ...mark(byId.get(member)!, plan, new Set()),
    figure: id,
  }));
}

/**
 * A continuation only makes sense after body text (a figure or caption placed in between is fine: the reader shows
 * the paragraph going on after it); after a heading or other text it would glue unrelated text together.
 */
function dropBrokenJoins(items: Item[]): Item[] {
  let lastRole: string | undefined;
  return items.map((item) => {
    if (item.kind === 'figure') {
      return item;
    }
    const role = item.block.role;
    let result = item;
    if (item.block.cont && !(lastRole === 'body' && role === 'body')) {
      const { cont: _, ...block } = item.block;
      result = { kind: 'text', block };
    }
    if (role !== 'caption') {
      lastRole = role;
    }
    return result;
  });
}

function itemBlocks(item: Item): ContentBlock[] {
  return item.kind === 'text' ? [item.block] : item.blocks;
}

function lastPage(items: Item[]): number {
  return Math.max(0, ...items.flatMap(itemBlocks).map((b) => b.page ?? 0));
}

interface Section {
  title: string;
  items: Item[];
}

function sections(items: Item[], plan: ValidPlan, bookTitle: string): Section[] {
  const starts = new Map(plan.sections.map((s) => [s.start, s.title]));
  const result: Section[] = [{ title: bookTitle, items: [] }];
  for (const item of items) {
    const ids = item.kind === 'text' ? [item.block.id] : item.blocks.map((b) => b.id);
    const title = ids.map((id) => starts.get(id ?? '')).find((t) => t !== undefined);
    if (title !== undefined) {
      result.push({ title, items: [] });
    }
    result.at(-1)!.items.push(item);
  }
  return result.filter((s) => s.items.length > 0);
}

/** Splits sections over MAX_CHAPTER_WORDS into near-equal parts, only where a paragraph or a sentence ends. */
function split(all: Section[]): Section[] {
  return all.flatMap((section) => {
    const counts = section.items.map(itemWords);
    const total = counts.reduce((a, b) => a + b, 0);
    const parts = Math.ceil(total / MAX_CHAPTER_WORDS);
    if (parts <= 1) {
      return [section];
    }
    const target = total / parts;
    const pieces: Item[][] = [[]];
    let sum = 0;
    let pieceWords = 0;
    let lastText = '';
    section.items.forEach((item, i) => {
      const next = section.items[i + 1];
      pieces.at(-1)!.push(item);
      sum += counts[i]!;
      pieceWords += counts[i]!;
      if (item.kind === 'text') {
        lastText = item.block.text ?? '';
      }
      if (next === undefined || pieces.length >= parts) {
        return;
      }
      const ends = !(next.kind === 'text' && next.block.cont) || endsSentence(lastText);
      // Text that runs on for pages without a paragraph end in between: as a last resort, between two words.
      const tooLong = pieceWords >= target * 1.5 && !endsWithBrokenWord(lastText);
      if ((ends && sum >= target * pieces.length) || tooLong) {
        pieces.push([]);
        pieceWords = 0;
      }
    });
    const filled = pieces.filter((p) => p.length > 0);
    return filled.map((p, i) => ({
      title: filled.length > 1 ? `${section.title} (${i + 1}/${filled.length})` : section.title,
      items: p,
    }));
  });
}

function itemWords(item: Item): number {
  const blocks = item.kind === 'text' ? [item.block] : item.blocks;
  return blocks.reduce((n, b) => n + words(b.text).length, 0);
}

function number(all: Section[]): AssembledChapter[] {
  return all.map((s, i) => {
    const blocks = s.items.flatMap((item) => (item.kind === 'text' ? [item.block] : item.blocks));
    const pages = blocks.map((b) => b.page ?? 0).filter((p) => p > 0);
    return {
      number: i + 1,
      title: s.title,
      firstPage: pages.length ? Math.min(...pages) : 0,
      lastPage: pages.length ? Math.max(...pages) : 0,
      blocks,
    };
  });
}
