/** Small text rules shared by the layout rules, plan validation and the reader. */

export function words(text: string | undefined): string[] {
  return (text ?? '').split(/\s+/).filter(Boolean);
}

/** Ends like a finished sentence (also with closing quotes or brackets, «» included). */
export function endsSentence(text: string): boolean {
  return /[.!?…][»«"”’')\]]*\s*$/.test(text);
}

/** Ends with a word broken by a hyphen ("ziem-"), not a dash or a number range. */
export function endsWithBrokenWord(text: string): boolean {
  return /\p{L}[-­]$/u.test(text.trimEnd());
}

export function startsLowercase(text: string): boolean {
  const first = text.trimStart().match(/\p{L}/u)?.[0];
  return first !== undefined && first === first.toLowerCase() && first !== first.toUpperCase();
}

/** Joins a paragraph continued in the next block, repairing a word broken at the break ("ziem-" + "lich"). */
export function joinContinued(previous: string, next: string): string {
  const end = previous.trimEnd();
  if (endsWithBrokenWord(end) && startsLowercase(next)) {
    return end.slice(0, -1) + next.trimStart();
  }
  return `${end} ${next.trimStart()}`;
}

export function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}
