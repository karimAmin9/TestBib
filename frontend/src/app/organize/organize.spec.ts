import { ContentBlock } from '../core/models';
import { MAX_CHAPTER_WORDS, assemble } from './assemble';
import { rulePlan } from './rules';
import { joinContinued } from './text';
import { Plan, SourcePage, emptyPlan } from './types';
import { smallCorrection, validatePlan } from './validate';

type Spec = Partial<ContentBlock> & { size?: number; bold?: boolean; italic?: boolean };

/** A page as the engine delivers it: ids p{page}-b{seq}, body text at 10 pt unless said otherwise. */
function page(number: number, ...specs: Spec[]): SourcePage {
  const blocks = specs.map(({ size = 10, bold = false, italic = false, ...b }, seq) => ({
    type: 'p' as const,
    ...b,
    id: `p${number}-b${seq}`,
    page: number,
    seq,
    layout: { x: 50, y: 50 + seq * 100, w: 300, h: 80, fontSize: b.type === 'img' ? 0 : size, bold, italic },
  }));
  return { number, width: 420, height: 595, blocks, removed: [] };
}

const p = (text: string, extra: Spec = {}): Spec => ({ type: 'p', text, ...extra });
const h = (text: string): Spec => ({ type: 'h', text, size: 18 });
const img = (src: string): Spec => ({ type: 'img', src, w: 100, h: 80 });
const caption = (text: string): Spec => p(text, { size: 8, bold: true, italic: true });
const lorem = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ') + '.';

const ids = (blocks: ContentBlock[]) => blocks.map((b) => b.id);
const organize = (pages: SourcePage[], plan: Plan = rulePlan(pages), title = 'The Book') =>
  assemble(pages, validatePlan(plan, pages).plan, title);

describe('layout rules', () => {
  it('tells captions, headings and body text apart by type face', () => {
    const pages = [
      page(1, h('Chapter One'), p('Body text, set in the size most of the page is printed in.'), caption('Left: the lighthouse.'), p('Small print.', { size: 7 })),
    ];

    expect(rulePlan(pages).roles).toEqual({ 'p1-b0': 'heading', 'p1-b1': 'body', 'p1-b2': 'caption', 'p1-b3': 'caption' });
  });

  it('continues a paragraph across the page break only when it stopped mid-sentence', () => {
    const pages = [
      page(1, p('One can see what the patient hides, kann man ziem-')),
      page(2, p('lich leicht erkennen.'), p('A new paragraph starts here.')),
      page(3, p('Lower case but the sentence before had ended.')),
    ];

    expect(rulePlan(pages).cont).toEqual(['p2-b0']);
  });

  it('continues before a capitalized German noun after a longer passage, not after a short label', () => {
    const passage = [page(22, p('Aber die Tatsache, dass sich in jedem Traum sein')), page(23, p('Unbewusstes aus Gründen.'))];
    const label = [page(1, p('Der Initialtraum')), page(2, p('Henry träumte von einem Turm.'))];

    expect(rulePlan(passage).cont).toEqual(['p23-b0']);
    expect(rulePlan(label).cont).toEqual([]);
  });

  it('puts a caption printed on the facing page into that page’s figure', () => {
    const pages = [page(20, p(lorem(20)), img('p20-1.jpg')), page(21, caption('Left: pioneers of psychoanalysis, 1911.'), p(lorem(20)))];

    expect(rulePlan(pages).figures).toEqual([{ images: ['p20-b1'], captions: ['p21-b0'] }]);
  });

  it('starts one section at consecutive headings (author line + title)', () => {
    const pages = [page(1, h('C.G. Jung'), h('Zugang zum Unbewussten'), p('Text.'), h('Die Traumanalyse'), p('More.'))];

    expect(rulePlan(pages).sections).toEqual([
      { start: 'p1-b0', title: 'C.G. Jung – Zugang zum Unbewussten' },
      { start: 'p1-b3', title: 'Die Traumanalyse' },
    ]);
  });

  it('leaves out printed page numbers above or below everything else, not numbers in the text', () => {
    const pages = [page(20, p('26'), p(lorem(20)), p('1911'), p(lorem(20)), p(lorem(5)), p('- 27 -'))];
    // A scan with wide borders: the number sits far from the paper's edge, but still below all the text.
    const scan = { ...page(21, p(lorem(20)), p('27')), height: 5000 };

    const roles = rulePlan([...pages, scan]).roles;

    expect([roles['p20-b0'], roles['p20-b2'], roles['p20-b5'], roles['p21-b1']]).toEqual([
      'artifact',
      'body',
      'artifact',
      'artifact',
    ]);
  });

  it('starts chapters only at headings that read like titles', () => {
    const pages = [
      page(1, h('Inhalt'), h('Zugang zum Unbewussten'), h('Der moderne Mensch und die Mythen'), h('Der Individuationsprozess')),
      page(2, p(lorem(10)), h('ier'), p(lorem(10)), h('Tschuang-Tze, und sie fühlte sich von ihr sehr getröstet.'), p(lorem(10))),
      page(3, h('Die Traumanalyse'), p(lorem(10))),
    ];

    const plan = rulePlan(pages);

    expect(plan.sections).toEqual([
      { start: 'p1-b0', title: 'Inhalt' },
      { start: 'p3-b0', title: 'Die Traumanalyse' },
    ]);
    expect(plan.roles['p2-b3']).toBe('body'); // set large, but a sentence
  });

  it('prefers the PDF outline for sections', () => {
    const pages = [page(1, p('Preface text.')), page(2, h('Big type'), p('Chapter text.'))];

    expect(rulePlan(pages, [{ title: 'Chapter 1', page: 2, level: 0 }]).sections).toEqual([{ start: 'p2-b0', title: 'Chapter 1' }]);
  });
});

describe('assembly', () => {
  it('keeps every block exactly once, in its page order unless grouped', () => {
    const pages = [
      page(1, h('Intro'), p('Text ending mid sen-'), img('p1-1.jpg'), caption('Above: a map.')),
      page(2, p('tence here.'), p('Next.')),
    ];

    const book = organize(pages);

    const all = book.chapters.flatMap((c) => c.blocks);
    expect(ids(all).sort()).toEqual(pages.flatMap((pg) => ids(pg.blocks)).sort());
    expect(all.every((b) => b.layout === undefined)).toBe(true);
  });

  it('places a figure after the paragraph that runs across the page break, not inside it', () => {
    const pages = [page(1, p('One can see it, kann man ziem-'), img('p1-1.jpg')), page(2, p('lich leicht erkennen.'), p('Next paragraph.'))];

    const [chapter] = organize(pages).chapters;

    expect(ids(chapter!.blocks)).toEqual(['p1-b0', 'p2-b0', 'p1-b1', 'p2-b1']);
    expect(chapter!.blocks[1]).toMatchObject({ cont: true, role: 'body' });
    expect(chapter!.blocks[2]).toMatchObject({ type: 'img', figure: 'f1' });
  });

  it('keeps pictures near their page when the text runs on for pages, never inside a broken word', () => {
    // Columns of an illustrated book: each ends mid-sentence, pictures on every page.
    const pages = [
      page(1, p('Der Text beginnt und läuft weiter, ohne'), img('p1-1.jpg')),
      page(2, p('zu enden, und kann man ziem-'), img('p2-1.jpg')),
      page(3, p('lich leicht sehen, und weiter'), img('p3-1.jpg')),
      page(4, p('bis der Absatz endet.')),
    ];

    const [chapter] = organize(pages).chapters;

    expect(ids(chapter!.blocks)).toEqual(['p1-b0', 'p1-b1', 'p2-b0', 'p3-b0', 'p2-b1', 'p3-b1', 'p4-b0']);
    // The paragraph goes on after each picture.
    expect(chapter!.blocks.filter((b) => b.type === 'p').map((b) => !!b.cont)).toEqual([false, true, true, true]);
  });

  it('splits text that never ends a paragraph between words, as a last resort', () => {
    const run = Array.from({ length: 8 }, (_, i) => page(i + 2, p(`und ${lorem(600).slice(0, -1)} weiter`)));
    const pages = [page(1, h('Lang'), p(`Anfang ${lorem(600).slice(0, -1)} weiter`)), ...run];

    const { chapters } = organize(pages);

    expect(chapters.length).toBeGreaterThan(1);
    for (const c of chapters) {
      const n = c.blocks.reduce((sum, b) => sum + (b.text?.split(' ').length ?? 0), 0);
      expect(n).toBeLessThanOrEqual(MAX_CHAPTER_WORDS * 2);
    }
  });

  it('groups a figure as images first, then captions', () => {
    const pages = [page(1, caption('Right: the tower.'), img('p1-1.jpg'), p(lorem(10)))];

    const [chapter] = organize(pages).chapters;

    expect(chapter!.blocks.map((b) => [b.id, b.figure, b.role])).toEqual([
      ['p1-b1', 'f1', undefined],
      ['p1-b0', 'f1', 'caption'],
      ['p1-b2', undefined, 'body'],
    ]);
  });

  it('makes chapters of the book’s sections, with page ranges', () => {
    const pages = [page(1, p('Title page.')), page(2, h('Einführung'), p('Intro.')), page(3, h('Die Traumanalyse'), p('Dreams.'))];

    const { chapters } = organize(pages, rulePlan(pages), 'Der Mensch und seine Symbole');

    expect(chapters.map((c) => [c.number, c.title, c.firstPage, c.lastPage])).toEqual([
      [1, 'Der Mensch und seine Symbole', 1, 1],
      [2, 'Einführung', 2, 2],
      [3, 'Die Traumanalyse', 3, 3],
    ]);
  });

  it('splits a long section into parts at paragraph ends, and keeps short ones', () => {
    const long = Array.from({ length: 10 }, (_, i) => page(i + 2, p(lorem(500))));
    const pages = [page(1, h('Short'), p('A few words.')), ...long.map((pg, i) => (i === 0 ? page(2, h('Long'), p(lorem(500))) : pg))];

    const titles = organize(pages).chapters.map((c) => c.title);

    expect(titles).toEqual(['Short', 'Long (1/3)', 'Long (2/3)', 'Long (3/3)']);
    for (const c of organize(pages).chapters.slice(1)) {
      const n = c.blocks.reduce((sum, b) => sum + (b.text?.split(' ').length ?? 0), 0);
      expect(n).toBeLessThanOrEqual(MAX_CHAPTER_WORDS + 500);
    }
  });

  it('never splits inside a paragraph that continues', () => {
    const pages = [page(1, h('One'), p(lorem(1500).slice(0, -1))), page(2, p('and ' + lorem(1500)))];

    const { chapters } = organize(pages);

    expect(chapters).toHaveLength(1);
  });

  it('leaves out page furniture and records it on its page', () => {
    const pages = [page(1, p('DER MENSCH UND SEINE SYMBOLE'), p('Text.'))];
    const plan = { ...emptyPlan(), roles: { 'p1-b0': 'artifact' as const } };

    const book = organize(pages, plan);

    expect(ids(book.chapters[0]!.blocks)).toEqual(['p1-b1']);
    expect(book.removed).toEqual([{ page: 1, kind: 'artifact', text: 'DER MENSCH UND SEINE SYMBOLE' }]);
  });

  it('marks scan fixes without changing the text', () => {
    const pages = [page(1, p('das letzte W7ort gewesen sei.'))];
    const plan = { ...emptyPlan(), fixes: [{ block: 'p1-b0', from: 'W7ort', to: 'Wort' }] };

    const book = organize(pages, plan);

    expect(book.chapters[0]!.blocks[0]).toMatchObject({ text: 'das letzte W7ort gewesen sei.', fixes: [{ at: 11, len: 5, to: 'Wort' }] });
    expect(book.fixCount).toBe(1);
  });
});

describe('plan validation', () => {
  const pages = [page(1, p('Running head'), p(lorem(30)), img('p1-1.jpg'), p('vielleichtTräumeeineeigene Funktion'))];

  it('rejects unknown ids, long "artifacts" and double figure membership', () => {
    const { plan, rejected } = validatePlan(
      {
        roles: { 'p1-b0': 'artifact', 'p1-b1': 'artifact', 'p9-b9': 'body' },
        cont: ['p1-b0', 'nope'],
        figures: [
          { images: ['p1-b2'], captions: ['p1-b3'] },
          { images: ['p1-b2'], captions: [] },
          { images: ['p1-b1'], captions: [] },
        ],
        sections: [{ start: 'p1-b1', title: '  Start  ' }, { start: 'p1-b1', title: 'Twice' }, { start: 'x', title: 'Ghost' }],
        fixes: [],
      },
      pages,
    );

    expect(plan.roles).toEqual({ 'p1-b0': 'artifact', 'p1-b3': 'caption' });
    expect(plan.cont).toEqual([]);
    expect(plan.figures).toEqual([{ images: ['p1-b2'], captions: ['p1-b3'] }]);
    expect(plan.sections).toEqual([{ start: 'p1-b1', title: 'Start' }]);
    expect(rejected).toBeGreaterThanOrEqual(7);
  });

  it('accepts small exact corrections only', () => {
    const { plan, rejected } = validatePlan(
      {
        ...emptyPlan(),
        fixes: [
          { block: 'p1-b3', from: 'vielleichtTräumeeineeigene', to: 'vielleicht Träume eine eigene' },
          { block: 'p1-b3', from: 'Funktion', to: 'Function' },
          { block: 'p1-b3', from: 'Funktion', to: 'Bedeutung' },
          { block: 'p1-b3', from: 'not in the text', to: 'x' },
        ],
      },
      pages,
    );

    expect(plan.fixes['p1-b3']).toEqual([
      { at: 0, len: 26, to: 'vielleicht Träume eine eigene' },
      { at: 27, len: 8, to: 'Function' },
    ]);
    expect(rejected).toBe(2);
  });

  it('bounds corrections by size', () => {
    expect(smallCorrection('W7ort', 'Wort')).toBe(true);
    expect(smallCorrection('photographier t hei', 'photographiert bei')).toBe(true);
    expect(smallCorrection('Hund', 'Katze')).toBe(false);
    expect(smallCorrection('x'.repeat(41), 'y')).toBe(false);
  });
});

describe('text joins', () => {
  it('repairs a word broken at the page end', () => {
    expect(joinContinued('kann man ziem-', 'lich leicht')).toBe('kann man ziemlich leicht');
    expect(joinContinued('und dann', 'weiter')).toBe('und dann weiter');
    expect(joinContinued('Ost-', 'West')).toBe('Ost- West');
  });
});
