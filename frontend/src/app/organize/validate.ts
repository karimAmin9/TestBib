import { TextFix } from '../core/models';
import { levenshtein, words } from './text';
import { Plan, SourcePage } from './types';

/** Longest block that may be left out as page furniture (a running header, a stray mark). */
export const MAX_ARTIFACT_WORDS = 12;
const MAX_FIX_LENGTH = 40;

export interface ValidPlan extends Omit<Plan, 'fixes'> {
  /** Fixes as character positions in the block text. */
  fixes: Record<string, TextFix[]>;
}

/**
 * Keeps only what is safe to apply: known ids, each block in at most one figure, short artifacts only, and
 * corrections that match the text exactly and stay small. Rejected items are counted, the rest is kept.
 */
export function validatePlan(plan: Plan, pages: SourcePage[]): { plan: ValidPlan; rejected: number } {
  const blocks = new Map(pages.flatMap((p) => p.blocks).filter((b) => b.id).map((b) => [b.id!, b]));
  const order = new Map([...blocks.keys()].map((id, i) => [id, i]));
  const isText = (id: string) => blocks.has(id) && blocks.get(id)!.type !== 'img';
  const isImage = (id: string) => blocks.get(id)?.type === 'img';
  let rejected = 0;

  const roles: ValidPlan['roles'] = {};
  for (const [id, role] of Object.entries(plan.roles)) {
    const ok =
      isText(id) &&
      ['body', 'heading', 'caption', 'other', 'artifact'].includes(role) &&
      (role !== 'artifact' || words(blocks.get(id)!.text).length <= MAX_ARTIFACT_WORDS);
    if (ok) {
      roles[id] = role;
    } else {
      rejected++;
    }
  }

  const firstText = [...blocks.values()].find((b) => b.type !== 'img')?.id;
  const cont = unique(plan.cont).filter((id) => {
    const ok = isText(id) && id !== firstText && roles[id] !== 'artifact';
    rejected += ok ? 0 : 1;
    return ok;
  });

  const placed = new Set<string>();
  const figures: ValidPlan['figures'] = [];
  for (const f of plan.figures) {
    const images = unique(f.images).filter((id) => isImage(id) && !placed.has(id));
    const captions = unique(f.captions).filter((id) => isText(id) && !placed.has(id) && roles[id] !== 'artifact');
    rejected += f.images.length - images.length + (f.captions.length - captions.length);
    if (images.length === 0) {
      rejected++;
      continue;
    }
    [...images, ...captions].forEach((id) => placed.add(id));
    captions.forEach((id) => (roles[id] = 'caption'));
    figures.push({ images, captions });
  }

  const sections: ValidPlan['sections'] = [];
  for (const s of plan.sections) {
    const title = s.title.trim().slice(0, 200) || blocks.get(s.start)?.text?.slice(0, 80) || '';
    if (blocks.has(s.start) && title && !sections.some((x) => x.start === s.start)) {
      sections.push({ start: s.start, title });
    } else {
      rejected++;
    }
  }
  sections.sort((a, b) => order.get(a.start)! - order.get(b.start)!);

  const fixes: ValidPlan['fixes'] = {};
  for (const f of plan.fixes) {
    const text = isText(f.block) ? (blocks.get(f.block)!.text ?? '') : '';
    const taken = fixes[f.block] ?? [];
    const at = findFree(text, f.from, taken);
    if (at < 0 || !smallCorrection(f.from, f.to)) {
      rejected++;
      continue;
    }
    fixes[f.block] = [...taken, { at, len: f.from.length, to: f.to }].sort((a, b) => a.at - b.at);
  }

  return { plan: { roles, cont, figures, sections, fixes }, rejected };
}

/**
 * A scan-error fix, not a rewrite: whitespace only ("vielleichtTräume" → "vielleicht Träume"), or at most a few
 * characters changed.
 */
export function smallCorrection(from: string, to: string): boolean {
  if (!from || from === to || from.length > MAX_FIX_LENGTH || to.length > MAX_FIX_LENGTH) {
    return false;
  }
  if (from.replace(/\s/g, '') === to.replace(/\s/g, '')) {
    return true;
  }
  return levenshtein(from, to) <= Math.min(3, Math.max(1, Math.floor(from.length / 3)));
}

/** First occurrence of `needle` that does not overlap an earlier fix; -1 if none. */
function findFree(text: string, needle: string, taken: TextFix[]): number {
  if (!needle) {
    return -1;
  }
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    if (taken.every((t) => at + needle.length <= t.at || at >= t.at + t.len)) {
      return at;
    }
  }
  return -1;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}
