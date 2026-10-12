import { TestBed } from '@angular/core/testing';
import { VerificationBadge } from './verification-badge';

describe('VerificationBadge', () => {
  function render(status: string, issues = 0): HTMLElement {
    const fixture = TestBed.createComponent(VerificationBadge);
    fixture.componentRef.setInput('status', status);
    fixture.componentRef.setInput('pagesWithIssues', issues);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows a verified badge', () => {
    const el = render('Verified');
    expect(el.textContent).toContain('Verified 1:1');
    expect(el.querySelector('.pill.ok')).not.toBeNull();
  });

  it('shows the number of differing pages', () => {
    const el = render('Differences', 3);
    expect(el.textContent).toContain('3 pages differ');
    expect(el.querySelector('.pill.bad')).not.toBeNull();
  });

  it('uses singular for one page with notes', () => {
    expect(render('Warnings', 1).textContent).toContain('1 page with notes');
  });

  it('renders nothing before verification', () => {
    expect(render('None').textContent?.trim()).toBe('');
  });
});
