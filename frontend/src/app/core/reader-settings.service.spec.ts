import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_SETTINGS,
  LIMITS,
  ReaderSettingsService,
  sanitize,
} from './reader-settings.service';

describe('ReaderSettingsService', () => {
  beforeEach(() => localStorage.clear());

  function create(): ReaderSettingsService {
    return TestBed.inject(ReaderSettingsService);
  }

  it('starts with defaults', () => {
    expect(create().settings()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists changes to localStorage', () => {
    const service = create();
    service.update({ theme: 'sepia', fontSize: 22 });
    TestBed.tick();

    const stored = JSON.parse(localStorage.getItem('bib.reader-settings')!);
    expect(stored.theme).toBe('sepia');
    expect(stored.fontSize).toBe(22);
  });

  it('restores saved settings on startup', () => {
    localStorage.setItem(
      'bib.reader-settings',
      JSON.stringify({ ...DEFAULT_SETTINGS, theme: 'light', width: 600 }),
    );

    const s = create().settings();

    expect(s.theme).toBe('light');
    expect(s.width).toBe(600);
  });

  it('ignores corrupt or out-of-range stored values', () => {
    localStorage.setItem(
      'bib.reader-settings',
      JSON.stringify({ theme: 'neon', fontSize: 999, lineHeight: 'x' }),
    );

    const s = create().settings();

    expect(s.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(s.fontSize).toBe(LIMITS.fontSize.max);
    expect(s.lineHeight).toBe(DEFAULT_SETTINGS.lineHeight);
  });

  it('steps values within limits', () => {
    const service = create();
    for (let i = 0; i < 50; i++) service.step('fontSize', 1);
    expect(service.settings().fontSize).toBe(LIMITS.fontSize.max);

    service.step('lineHeight', 1);
    expect(service.settings().lineHeight).toBeCloseTo(DEFAULT_SETTINGS.lineHeight + 0.1, 5);
  });

  it('exposes CSS variables', () => {
    const service = create();
    service.update({ fontSize: 20, font: 'sans' });

    expect(service.cssVars()['--reader-font-size']).toBe('20px');
    expect(service.cssVars()['--reader-font']).toContain('sans-serif');
  });

  it('sanitize keeps valid values', () => {
    expect(
      sanitize({ theme: 'dark', font: 'sans', fontSize: 16, lineHeight: 1.5, width: 800 }),
    ).toEqual({
      theme: 'dark',
      font: 'sans',
      fontSize: 16,
      lineHeight: 1.5,
      width: 800,
    });
  });
});
