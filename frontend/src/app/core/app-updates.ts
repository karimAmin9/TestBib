import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

/**
 * Tells the app when a newer version has been published (GitHub Pages deploy → service worker downloads it in the
 * background). Installed apps stay open for days, so it also checks whenever the app comes back to the foreground.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdates {
  private readonly sw = inject(SwUpdate);

  /** True once a new version is downloaded and ready; reloading switches to it. */
  readonly ready = signal(false);

  constructor() {
    if (!this.sw.isEnabled) {
      return; // dev server, unit tests, or a browser without service workers
    }
    const versions = this.sw.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this.ready.set(true));
    // The cached app can no longer be served (e.g. files were evicted): only a reload recovers.
    const broken = this.sw.unrecoverable.subscribe(() => location.reload());

    const check = () => {
      if (document.visibilityState === 'visible') {
        void this.sw.checkForUpdate().catch(() => undefined); // offline: try again next time
      }
    };
    document.addEventListener('visibilitychange', check);
    inject(DestroyRef).onDestroy(() => {
      versions.unsubscribe();
      broken.unsubscribe();
      document.removeEventListener('visibilitychange', check);
    });
  }

  /** Switches to the new version. A running conversion restarts by itself after the reload. */
  async apply(): Promise<void> {
    await this.sw.activateUpdate().catch(() => undefined);
    location.reload();
  }
}
