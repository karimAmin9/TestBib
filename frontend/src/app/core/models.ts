export type BookStatus = 'Processing' | 'Ready' | 'Failed';
export type VerificationStatus = 'None' | 'Verified' | 'Warnings' | 'Differences';
export type PageStatus = 'Pass' | 'Warning' | 'Fail';

/** Who arranged the pages into chapters: Claude, or the built-in layout rules. */
export type OrganizedBy = 'ai' | 'rules';

export interface Progress {
  chapterNumber: number;
  scrollPercent: number;
  updatedAt: string;
  /** The PDF page at that position, so progress survives re-organizing the chapters. */
  page?: number;
}

export interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  pageCount: number;
  chapterCount: number;
  status: BookStatus;
  error: string | null;
  verificationStatus: VerificationStatus;
  pagesWithIssues: number;
  excerpt: string | null;
  hasCover: boolean;
  createdAt: string;
  progress: Progress | null;
  organizedBy: OrganizedBy | null;
  /** Why organizing with Claude did not work (the rules were used instead). */
  organizeError: string | null;
  /** Scan errors corrected by Claude. */
  fixCount: number;
  /** What organizing with Claude cost, in US dollars. */
  aiCost: number | null;
}

export interface ChapterRef {
  number: number;
  title: string;
  firstPage: number;
  lastPage: number;
  verification: PageStatus | null;
}

export interface BookDetail {
  book: BookSummary;
  chapters: ChapterRef[];
  /** Result of the 1:1 check per PDF page. */
  pageChecks: { pass: number; warn: number; fail: number };
}

/** Position (points, origin top left) and type face of a block on its PDF page. */
export interface BlockLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
}

/** Show `to` instead of `len` characters at `at`; the stored text stays as in the PDF. */
export interface TextFix {
  at: number;
  len: number;
  to: string;
}

export type BlockRole = 'body' | 'heading' | 'caption' | 'other';

export interface ContentBlock {
  type: 'p' | 'h' | 'img';
  text?: string;
  src?: string;
  w?: number;
  h?: number;
  sha256?: string;
  rendered?: boolean;
  /** "p{page}-b{seq}", unique within the book. */
  id?: string;
  /** PDF page and reading position the block comes from (what the 1:1 check uses). */
  page?: number;
  seq?: number;
  layout?: BlockLayout;
  role?: BlockRole;
  /** Continues the previous text block: one paragraph running across a page or column. */
  cont?: boolean;
  /** Blocks sharing a figure id are one figure: images and their captions. */
  figure?: string;
  fixes?: TextFix[];
}

export interface PageVerification {
  page: number;
  status: PageStatus;
  missingCharacters: string;
  extraCharacters: string;
  missingWords: string[];
  extraWords: string[];
  orderSimilarity: number;
  sourceImages: number;
  outputImages: number;
  imageIssues: string[];
  notes: string[];
}

export interface VerificationReport {
  status: PageStatus;
  pageCount: number;
  pagesPassed: number;
  pagesWithWarnings: number;
  pagesFailed: number;
  notes: string[];
  pages: PageVerification[];
}

export interface Chapter {
  number: number;
  title: string;
  total: number;
  prev: number | null;
  next: number | null;
  firstPage: number;
  lastPage: number;
  blocks: ContentBlock[];
  /** Pages of this chapter that did not pass the 1:1 check. */
  issues: PageVerification[];
}
