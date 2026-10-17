import { BlockRole, ContentBlock } from '../core/models';
import { endsSentence, endsWithBrokenWord, startsLowercase, words } from './text';
import { OutlineEntry, Plan, SourcePage } from './types';

/**
 * The built-in layout rules: the plan used without Claude (no key, offline, an API error) and for books
 * converted before chapters existed. Deliberately conservative.
 */
export function rulePlan(pages: SourcePage[], outline: OutlineEntry[] = []): Plan {
  const blocks = pages.flatMap((p) => p.blocks);
  const body = bodyFontSize(blocks);
  const roles: Plan['roles'] = {};
  for (const page of pages) {
    for (const b of page.blocks) {
      if (b.id && b.type !== 'img') {
        roles[b.id] = roleOf(b, body, page);
      }
    }
  }

  return {
    roles,
    cont: continuations(blocks, roles),
    figures: figures(pages, roles),
    sections: outline.length > 0 ? outlineSections(pages, outline) : headingSections(blocks, roles),
    fixes: [],
  };
}

/** The font size of the body text: the size most of the book's characters are set in. */
export function bodyFontSize(blocks: ContentBlock[]): number {
  const chars = new Map<number, number>();
  for (const b of blocks) {
    const size = b.layout?.fontSize ?? 0;
    if (b.type === 'p' && size > 0) {
      chars.set(size, (chars.get(size) ?? 0) + (b.text?.length ?? 0));
    }
  }
  return [...chars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

function roleOf(b: ContentBlock, body: number, page: SourcePage): BlockRole | 'artifact' {
  const text = b.text ?? '';
  if (PAGE_NUMBER.test(text) && atPageEdge(b, page)) {
    return 'artifact'; // a printed page number the engine did not recognize (it differs from the PDF page)
  }
  if (b.type === 'h') {
    return looksLikeSentence(text) ? 'body' : 'heading';
  }
  const size = b.layout?.fontSize ?? 0;
  if (body > 0 && size > 0) {
    // Captions: smaller than the body text and set in bold or italic, or clearly smaller.
    if ((size <= body * 0.92 && (b.layout!.bold || b.layout!.italic)) || size <= body * 0.8) {
      return 'caption';
    }
  }
  return 'body';
}

/** A body block continues the previous body block when that one stopped mid-sentence. */
function continuations(blocks: ContentBlock[], roles: Plan['roles']): string[] {
  const cont: string[] = [];
  let previous: ContentBlock | null = null;
  for (const b of blocks) {
    if (b.type === 'img' || !b.id) {
      continue;
    }
    const role = roles[b.id];
    if (role === 'heading') {
      previous = null; // never continue across a heading
      continue;
    }
    if (role !== 'body') {
      continue; // captions and others sit beside the running text
    }
    if (previous && continues(previous, b)) {
      cont.push(b.id);
    }
    previous = b;
  }
  return cont;
}

/**
 * Text that stops mid-sentence goes on in the next block: always when that starts in lower case or the word was
 * broken, and after a longer passage also when it starts with a capital (in German, nouns: "dass sein" |
 * "Unbewusstes"). A short line without punctuation may be a label, so it needs the clearer signs.
 */
function continues(previous: ContentBlock, next: ContentBlock): boolean {
  const a = previous.text ?? '';
  const b = next.text ?? '';
  const nearby = (next.page ?? 0) - (previous.page ?? 0) <= 3;
  return nearby && !endsSentence(a) && (startsLowercase(b) || endsWithBrokenWord(a) || words(a).length >= 8);
}

/** The images of a page with that page's captions; captions on a page without images go to a neighbour's figure. */
function figures(pages: SourcePage[], roles: Plan['roles']): Plan['figures'] {
  const byPage = new Map<number, Plan['figures'][number]>();
  for (const p of pages) {
    const images = p.blocks.filter((b) => b.type === 'img' && b.id).map((b) => b.id!);
    if (images.length > 0) {
      byPage.set(p.number, { images, captions: [] });
    }
  }
  for (const p of pages) {
    const captions = p.blocks.filter((b) => b.id && roles[b.id] === 'caption').map((b) => b.id!);
    const figure = byPage.get(p.number) ?? byPage.get(p.number - 1) ?? byPage.get(p.number + 1);
    figure?.captions.push(...captions);
  }
  return [...byPage.values()];
}

/**
 * A section at every heading that looks like a title; consecutive headings (author + title) start one section
 * together. A longer run of headings is a list (a table of contents), named by its first entry.
 */
function headingSections(blocks: ContentBlock[], roles: Plan['roles']): Plan['sections'] {
  const sections: Plan['sections'] = [];
  let run: ContentBlock[] = [];
  const close = () => {
    const titles = run.filter((b) => isTitle(b.text ?? ''));
    if (titles.length > 0) {
      const title = titles.length <= 2 ? titles.map((b) => b.text!.trim()).join(' – ') : titles[0]!.text!.trim();
      sections.push({ start: titles[0]!.id!, title: title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title });
    }
    run = [];
  };
  for (const b of blocks) {
    if (!b.id || b.type === 'img' || roles[b.id] === 'caption' || roles[b.id] === 'artifact') {
      continue;
    }
    if (roles[b.id] === 'heading') {
      run.push(b);
    } else {
      close();
    }
  }
  close();
  return sections;
}

const PAGE_NUMBER = /^[\s\-–—]*\d{1,4}[\s\-–—]*$/;
const MAX_TITLE = 100;

/**
 * Above or below everything else on the page, where page numbers sit. (Not "near the paper's edge": scans often
 * have wide empty borders.)
 */
function atPageEdge(b: ContentBlock, page: SourcePage): boolean {
  const l = b.layout;
  const others = page.blocks.filter((o) => o !== b && o.layout).map((o) => o.layout!);
  if (!l || others.length === 0) {
    return true;
  }
  const top = Math.min(...others.map((o) => o.y));
  const bottom = Math.max(...others.map((o) => o.y + o.h));
  return l.y >= bottom - 1 || l.y + l.h <= top + 1;
}

/** Text set like a heading but written like a sentence (a lead-in line, an emphasized passage). */
function looksLikeSentence(text: string): boolean {
  const n = words(text).length;
  return n > 12 || startsLowercase(text) || (n > 3 && /[.,;:]\s*$/.test(text));
}

/** Good enough to name a chapter: a few letters at least, not a stray mark. */
function isTitle(text: string): boolean {
  return (text.match(/\p{L}/gu)?.length ?? 0) >= 4 && !looksLikeSentence(text);
}

function outlineSections(pages: SourcePage[], outline: OutlineEntry[]): Plan['sections'] {
  const sections: Plan['sections'] = [];
  for (const entry of outline) {
    const first = pages.find((p) => p.number === entry.page)?.blocks.find((b) => b.id);
    if (first && !sections.some((s) => s.start === first.id)) {
      sections.push({ start: first.id!, title: entry.title });
    }
  }
  return sections;
}
