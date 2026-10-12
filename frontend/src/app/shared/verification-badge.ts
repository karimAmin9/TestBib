import { Component, computed, input } from '@angular/core';
import { VerificationStatus } from '../core/models';

/** Pill showing whether the conversion was proof-read 1:1 against the PDF. */
@Component({
  selector: 'app-verification-badge',
  template: `
    @if (label(); as l) {
      <span [class]="'pill ' + l.kind" [attr.title]="l.title">{{ l.text }}</span>
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
