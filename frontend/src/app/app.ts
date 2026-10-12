import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="logo" routerLink="/" aria-label="Bib home"><span class="logo-mark">B</span>ib</a>
        @if (auth.user(); as user) {
          <nav class="nav">
            <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"
              >Library</a
            >
          </nav>
          <div class="account">
            <span class="email" [title]="user.email">{{ user.email }}</span>
            <button type="button" class="btn ghost small" (click)="logout()">Log out</button>
          </div>
        }
      </div>
    </header>
    <main>
      <router-outlet />
    </main>
  `,
  styles: `
    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      background: var(--topbar-bg);
      border-bottom: 1px solid var(--border);
    }
    .topbar-inner {
      max-width: var(--page-width);
      margin: 0 auto;
      height: 56px;
      padding: 0 16px;
      display: flex;
      align-items: center;
      gap: 24px;
    }
    .logo {
      font-size: 22px;
      font-weight: 800;
      color: var(--text-strong);
      text-decoration: none;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
    }
    .logo-mark {
      display: inline-grid;
      place-items: center;
      width: 30px;
      height: 30px;
      margin-right: 2px;
      border-radius: 6px;
      background: var(--accent);
      color: #fff;
    }
    .nav a {
      color: var(--text-muted);
      text-decoration: none;
      font-weight: 600;
      padding: 18px 0;
      border-bottom: 2px solid transparent;
    }
    .nav a.active,
    .nav a:hover {
      color: var(--text-strong);
      border-color: var(--accent);
    }
    .account {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .email {
      color: var(--text-muted);
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (max-width: 560px) {
      .email {
        display: none;
      }
    }
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
