import { ContentBlock, PageVerification } from '../../core/models';
import { endsWithBrokenWord, startsLowercase } from '../../organize/text';

/** A piece of text; a scan fix shows `text` and keeps what the PDF has in `original`. */
export interface Segment {
  text: string;
  original?: string;
}

export type ReadingItem =
  | {
      kind: 'p' | 'heading' | 'caption' | 'other';
      segments: Segment[];
      /** Goes on with the paragraph before a picture placed in between (shown without a paragraph break). */
      continued?: boolean;
    }
  | { kind: 'figure'; images: ContentBlock[]; captions: Segment[][] };

/**
 * What the reader shows for a chapter's blocks: continued blocks joined into one paragraph (a word broken at the
 * page end mended), images grouped with their captions, scan fixes applied as marked segments.
 */
export function readingItems(blocks: ContentBlock[]): ReadingItem[] {
  const items: ReadingItem[] = [];
  const figures = new Map<string, Extract<ReadingItem, { kind: 'figure' }>>();
  let figureId: string | undefined;
  for (const block of blocks) {
    if (block.figure) {
      let figure = figures.get(block.figure);
      if (!figure || figureId !== block.figure) {
        figure = { kind: 'figure', images: [], captions: [] };
        figures.set(block.figure, figure);
        items.push(figure);
      }
      figureId = block.figure;
      if (block.type === 'img') {
        figure.images.push(block);
      } else {
        figure.captions.push(segments(block));
      }
      continue;
    }
    figureId = undefined;
    if (block.type === 'img') {
      items.push({ kind: 'figure', images: [block], captions: [] });
      continue;
    }
    const kind =
      block.type === 'h' || block.role === 'heading'
        ? 'heading'
        : block.role === 'caption'
          ? 'caption'
          : block.role === 'other'
            ? 'other'
            : 'p';
    const previous = items.at(-1);
    if (block.cont && kind === 'p' && previous?.kind === 'p') {
      join(previous.segments, segments(block));
    } else if (block.cont && kind === 'p') {
      items.push({ kind, segments: segments(block), continued: true });
    } else {
      items.push({ kind, segments: segments(block) });
    }
  }
  return items;
}

function segments(block: ContentBlock): Segment[] {
  const text = block.text ?? '';
  const result: Segment[] = [];
  let at = 0;
  for (const fix of [...(block.fixes ?? [])].sort((a, b) => a.at - b.at)) {
    if (fix.at < at || fix.at + fix.len > text.length) {
      continue;
    }
    if (fix.at > at) {
      result.push({ text: text.slice(at, fix.at) });
    }
    result.push({ text: fix.to, original: text.slice(fix.at, fix.at + fix.len) });
    at = fix.at + fix.len;
  }
  if (at < text.length || result.length === 0) {
    result.push({ text: text.slice(at) });
  }
  return result;
}

/** Appends a continued block, like joinContinued: "ziem-" + "lich" → "ziemlich", otherwise one space. */
function join(into: Segment[], next: Segment[]): void {
  const last = into.at(-1)!;
  const before = into.map((s) => s.text).join('');
  const after = next.map((s) => s.text).join('');
  last.text = last.text.trimEnd();
  if (endsWithBrokenWord(before) && startsLowercase(after)) {
    last.text = last.text.slice(0, -1);
  } else {
    last.text += ' ';
  }
  next[0]!.text = next[0]!.text.trimStart();
  into.push(...next);
}

/** One line per page that differs from the PDF. */
export function describeIssue(page: PageVerification): string {
  const parts: string[] = [];
  if (page.missingWords.length) {
    parts.push(`missing: ${short(page.missingWords)}`);
  }
  if (page.extraWords.length) {
    parts.push(`extra: ${short(page.extraWords)}`);
  }
  if (page.missingCharacters) {
    parts.push(`missing characters: ${page.missingCharacters}`);
  }
  if (page.orderSimilarity < 0.98) {
    parts.push(`word order ${(page.orderSimilarity * 100).toFixed(0)}% identical`);
  }
  parts.push(...page.imageIssues, ...page.notes);
  return parts.join('; ') || 'differs from the PDF';
}

function short(words: string[]): string {
  return words.length > 8 ? `${words.slice(0, 8).join(', ')} …` : words.join(', ');
}

/** "Page 7" or "Pages 20–27". */
export function pageRange(first: number, last: number): string {
  if (first <= 0) {
    return '';
  }
  return first === last ? `Page ${first}` : `Pages ${first}–${last}`;
}
