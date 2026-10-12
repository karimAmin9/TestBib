import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { authGuard, guestGuard } from './auth.guard';
import { AuthService } from './auth.service';

describe('auth guards', () => {
  let user: { id: string; email: string } | null;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { ensureLoaded: async () => user } },
      ],
    });
  });

  const run = (guard: typeof authGuard, url = '/book/1') =>
    TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    ) as Promise<boolean | UrlTree>;

  it('lets logged-in users through', async () => {
    user = { id: '1', email: 'a@b.c' };
    expect(await run(authGuard)).toBe(true);
  });

  it('redirects anonymous users to login with a return url', async () => {
    user = null;
    const result = (await run(authGuard, '/book/42')) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(result)).toBe('/login?returnUrl=%2Fbook%2F42');
  });

  it('keeps logged-in users away from the login page', async () => {
    user = { id: '1', email: 'a@b.c' };
    const result = (await run(guestGuard)) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(result)).toBe('/');
  });
});
