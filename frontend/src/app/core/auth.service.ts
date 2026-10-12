import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Me } from './models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  /** undefined = not checked yet, null = logged out. */
  readonly user = signal<Me | null | undefined>(undefined);

  async ensureLoaded(): Promise<Me | null> {
    const current = this.user();
    if (current !== undefined) {
      return current;
    }
    try {
      const me = await firstValueFrom(this.http.get<Me>('/api/auth/me'));
      this.user.set(me);
      return me;
    } catch {
      this.user.set(null);
      return null;
    }
  }

  async login(email: string, password: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/login?useCookies=true', { email, password }));
    this.user.set(undefined);
    await this.ensureLoaded();
  }

  async register(email: string, password: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/register', { email, password }));
    await this.login(email, password);
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', null));
    } finally {
      this.user.set(null);
    }
  }
}

/** Turns Identity / ProblemDetails errors into readable messages. */
export function errorMessages(error: unknown): string[] {
  if (!(error instanceof HttpErrorResponse)) {
    return ['Something went wrong. Please try again.'];
  }
  if (error.status === 0) {
    return ['The server is not reachable.'];
  }
  if (error.status === 401) {
    return ['Email or password is incorrect.'];
  }
  const body = error.error as {
    detail?: string;
    title?: string;
    errors?: Record<string, string[]>;
  } | null;
  if (body?.errors) {
    return Object.values(body.errors).flat();
  }
  return [body?.detail ?? body?.title ?? `Request failed (${error.status}).`];
}
