import { Component, computed, input } from '@angular/core';
import { VerificationStatus } from '../core/models';

/** Shows whether the conversion was proof-read 1:1 against the PDF. */
@Component({
  selector: 'app-verification-badge',
  template: `
    @if (label(); as l) {
      <span [class]="'badge ' + l.kind" [attr.title]="l.title">{{ l.text }}</span>
    }
  `,
  styles: `
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }
    .ok {
      background: var(--ok-bg);
      color: var(--ok-fg);
    }
    .warn {
      background: var(--warn-bg);
      color: var(--warn-fg);
    }
    .bad {
      background: var(--bad-bg);
      color: var(--bad-fg);
    }
  `,
})
export class VerificationBadge {
  readonly status = input.required<VerificationStatus>();
  readonly pagesWithIssues = input(0);

  protected readonly label = computed(() => {
    const issues = this.pagesWithIssues();
    const pages = `${issues} page${issues === 1 ? '' : 's'}`;
    switch (this.status()) {
      case 'Verified':
        return {
          kind: 'ok',
          text: '✓ Verified 1:1',
          title: 'Every word and image matches the PDF.',
        };
      case 'Warnings':
        return {
          kind: 'warn',
          text: `⚠ ${pages} with notes`,
          title: 'All text is present; word order or splitting differs on some pages.',
        };
      case 'Differences':
        return {
          kind: 'bad',
          text: `⚠ ${pages} differ`,
          title: 'Some pages do not match the PDF exactly.',
        };
      default:
        return null;
    }
  });
}
