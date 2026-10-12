import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, errorMessages } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page">
      <form class="card" (ngSubmit)="submit()" #form="ngForm">
        <h1>{{ isRegister() ? 'Create your library' : 'Welcome back' }}</h1>
        <p class="muted">
          {{
            isRegister()
              ? 'Your uploaded books are private to your account.'
              : 'Sign in to continue reading.'
          }}
        </p>

        @if (errors().length) {
          <div class="error-box" role="alert">
            @for (e of errors(); track e) {
              <div>{{ e }}</div>
            }
          </div>
        }

        <label class="field">
          Email
          <input type="email" name="email" autocomplete="email" required [(ngModel)]="email" />
        </label>
        <label class="field">
          Password
          <input
            type="password"
            name="password"
            required
            [attr.autocomplete]="isRegister() ? 'new-password' : 'current-password'"
            [attr.minlength]="isRegister() ? 8 : null"
            [(ngModel)]="password"
          />
        </label>
        @if (isRegister()) {
          <p class="hint muted">
            At least 8 characters with an uppercase letter, a lowercase letter and a digit.
          </p>
        }

        <button class="btn wide" type="submit" [disabled]="busy() || form.invalid">
          {{ busy() ? 'Please wait…' : isRegister() ? 'Create account' : 'Sign in' }}
        </button>

        <p class="switch muted">
          @if (isRegister()) {
            Already have an account? <a routerLink="/login">Sign in</a>
          } @else {
            New here? <a routerLink="/register">Create an account</a>
          }
        </p>
      </form>
    </div>
  `,
  styles: `
    .page {
      display: grid;
      place-items: center;
      padding: 24px 16px;
    }
    .card {
      width: 100%;
      max-width: 400px;
      padding: 8px 0;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 22px;
    }
    p {
      margin: 0 0 20px;
    }
    .hint {
      font-size: 13px;
      margin-top: -6px;
    }
    .wide {
      width: 100%;
    }
    .switch {
      margin: 18px 0 0;
      text-align: center;
      font-size: 14px;
    }
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Route data. */
  readonly mode = input<'login' | 'register'>('login');
  /** Query param set by the auth guard. */
  readonly returnUrl = input<string>();

  protected readonly isRegister = computed(() => this.mode() === 'register');
  protected readonly busy = signal(false);
  protected readonly errors = signal<string[]>([]);
  protected email = '';
  protected password = '';

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.errors.set([]);
    try {
      if (this.isRegister()) {
        await this.auth.register(this.email.trim(), this.password);
      } else {
        await this.auth.login(this.email.trim(), this.password);
      }
      const target = this.returnUrl();
      await this.router.navigateByUrl(
        target?.startsWith('/') && !target.startsWith('//') ? target : '/',
      );
    } catch (error) {
      this.errors.set(errorMessages(error));
    } finally {
      this.busy.set(false);
    }
  }
}
