import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AppUpdates } from './app-updates';

class FakeSwUpdate {
  isEnabled = true;
  readonly versionUpdates = new Subject<VersionEvent>();
  readonly unrecoverable = new Subject<never>();
  readonly checkForUpdate = vi.fn(async () => false);
  readonly activateUpdate = vi.fn(async () => true);
}

describe('AppUpdates', () => {
  let sw: FakeSwUpdate;

  function create(): AppUpdates {
    TestBed.configureTestingModule({ providers: [{ provide: SwUpdate, useValue: sw }] });
    return TestBed.inject(AppUpdates);
  }

  function setVisibility(state: DocumentVisibilityState): void {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => (sw = new FakeSwUpdate()));

  it('offers the update once the new version is downloaded', () => {
    const updates = create();

    sw.versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'b' } });
    expect(updates.ready()).toBe(false);

    sw.versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'a' },
      latestVersion: { hash: 'b' },
    });
    expect(updates.ready()).toBe(true);
  });

  it('looks for a new version whenever the app comes back to the foreground', () => {
    create();

    setVisibility('hidden');
    expect(sw.checkForUpdate).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(sw.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it('stays quiet without a service worker (dev server)', () => {
    sw.isEnabled = false;
    const updates = create();

    sw.versionUpdates.next({ type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } });
    setVisibility('visible');

    expect(updates.ready()).toBe(false);
    expect(sw.checkForUpdate).not.toHaveBeenCalled();
  });
});
