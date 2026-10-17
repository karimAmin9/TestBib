import { BlockRole, ContentBlock } from '../core/models';

/** One PDF page as the engine converted it: blocks in reading order (with id, page, seq, layout). */
export interface SourcePage {
  number: number;
  width: number;
  height: number;
  blocks: ContentBlock[];
  removed: { kind: string; text: string }[];
}

/** An entry of the PDF's own outline (bookmarks). */
export interface OutlineEntry {
  title: string;
  page: number;
  level: number;
}

/**
 * How to arrange a book's pages into chapters, by block id. Claude or the layout rules propose it; it is always
 * validated (validate.ts) before it is assembled.
 */
export interface Plan {
  /** Role per text block; "artifact" = page furniture (running header) that is left out and recorded. */
  roles: Record<string, BlockRole | 'artifact'>;
  /** Text blocks that continue the previous text block (a paragraph across a page or column). */
  cont: string[];
  /** Images and the captions that describe them. */
  figures: { images: string[]; captions: string[] }[];
  /** Where the book's sections start (a block id) and their titles. */
  sections: { start: string; title: string }[];
  /** Scan-error corrections: replace the exact text `from` in the block by `to`. */
  fixes: { block: string; from: string; to: string }[];
}

export interface AssembledChapter {
  number: number;
  title: string;
  firstPage: number;
  lastPage: number;
  blocks: ContentBlock[];
}

/** A removal attributed to its page, as the verifier expects it. */
export interface PageRemoval {
  page: number;
  kind: string;
  text: string;
}

export interface AssembledBook {
  chapters: AssembledChapter[];
  /** Everything left out, by page: the engine's removals plus left-out page furniture. */
  removed: PageRemoval[];
  fixCount: number;
}

export const emptyPlan = (): Plan => ({ roles: {}, cont: [], figures: [], sections: [], fixes: [] });
