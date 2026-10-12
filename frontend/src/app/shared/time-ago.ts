import { Pipe, PipeTransform } from '@angular/core';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 days ago", "just now". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) {
    return '';
  }
  if (seconds < 60) {
    return 'just now';
  }
  for (const [unit, size] of UNITS) {
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

@Pipe({ name: 'timeAgo' })
export class TimeAgoPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ? timeAgo(value) : '';
  }
}
