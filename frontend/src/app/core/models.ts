export type BookStatus = 'Processing' | 'Ready' | 'Failed';
export type VerificationStatus = 'None' | 'Verified' | 'Warnings' | 'Differences';
export type PageStatus = 'Pass' | 'Warning' | 'Fail';

export interface Progress {
  chapterNumber: number;
  scrollPercent: number;
  updatedAt: string;
}

export interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  pageCount: number;
  status: BookStatus;
  error: string | null;
  verificationStatus: VerificationStatus;
  pagesWithIssues: number;
  excerpt: string | null;
  hasCover: boolean;
  createdAt: string;
  progress: Progress | null;
}

export interface ChapterRef {
  number: number;
  title: string;
  verification: PageStatus | null;
}

export interface BookDetail {
  book: BookSummary;
  chapters: ChapterRef[];
}

export interface ContentBlock {
  type: 'p' | 'h' | 'img';
  text?: string;
  src?: string;
  w?: number;
  h?: number;
  rendered?: boolean;
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
  blocks: ContentBlock[];
  verification: PageVerification | null;
}
