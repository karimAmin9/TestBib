import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './core/auth.service';
import { Icon } from './shared/icon';

/**
 * Shell: a slim icon rail on the left (desktop, like ranobes.net) that turns into a
 * top bar with a hamburger menu on small screens.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  template: `
    <div class="shell">
      <aside class="rail" aria-label="Main navigation">
        <a class="logo" routerLink="/" aria-label="Bib library"><span>B</span></a>
        @if (auth.user()) {
          <nav class="rail-nav">
            <a
              routerLink="/"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: true }"
              title="Library"
            >
              <app-icon name="book" [size]="22" />
              <span class="sr-only">Library</span>
            </a>
            <a routerLink="/" fragment="upload" title="Upload a PDF">
              <app-icon name="upload" [size]="22" />
              <span class="sr-only">Upload a PDF</span>
            </a>
          </nav>
          <div class="rail-bottom">
            <span class="avatar" [title]="auth.user()!.email">{{ initial() }}</span>
            <button type="button" class="rail-btn" (click)="logout()" title="Log out">
              <app-icon name="logout" [size]="20" />
              <span class="sr-only">Log out</span>
            </button>
          </div>
        }
      </aside>

      <header class="topbar">
        <a class="logo" routerLink="/" aria-label="Bib library"><span>B</span>ib</a>
        @if (auth.user()) {
          <button
            type="button"
            class="burger"
            [attr.aria-expanded]="menuOpen()"
            aria-controls="mobile-menu"
            (click)="menuOpen.set(!menuOpen())"
          >
            <app-icon [name]="menuOpen() ? 'close' : 'menu'" [size]="28" />
            <span class="sr-only">Menu</span>
          </button>
        }
      </header>

      @if (menuOpen() && auth.user()) {
        <nav id="mobile-menu" class="mobile-menu">
          <span class="menu-user">{{ auth.user()!.email }}</span>
          <a routerLink="/"><app-icon name="book" />Library</a>
          <a routerLink="/" fragment="upload"><app-icon name="upload" />Upload a PDF</a>
          <button type="button" (click)="logout()"><app-icon name="logout" />Log out</button>
        </nav>
      }

      <main class="content">
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    .shell {
      display: grid;
      grid-template-columns: var(--rail-width) minmax(0, 1fr);
      gap: 16px;
      max-width: calc(var(--page-width) + var(--rail-width) + 48px);
      margin: 0 auto;
      padding: 0 16px;
    }
    .content {
      min-width: 0;
    }
    .rail {
      position: sticky;
      top: 16px;
      align-self: start;
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-top: 16px;
      height: calc(100vh - 32px);
      border-radius: var(--radius);
      background: var(--panel);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 1px;
      color: var(--text);
      font-size: 22px;
      font-weight: 700;
      text-decoration: none;
    }
    .logo span {
      display: inline-grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: var(--accent);
      color: #2f3a24;
      font-size: 20px;
    }
    .rail .logo {
      justify-content: center;
      width: 100%;
      height: 68px;
      border-bottom: 1px solid var(--divider);
    }
    .rail-nav {
      display: flex;
      flex-direction: column;
      width: 100%;
    }
    .rail-nav a,
    .rail-btn {
      display: grid;
      place-items: center;
      width: 100%;
      height: 60px;
      border: 0;
      border-bottom: 1px solid var(--divider);
      background: none;
      color: var(--text-muted);
      cursor: pointer;
      transition:
        color 0.15s,
        background 0.15s;
    }
    .rail-nav a:hover,
    .rail-btn:hover,
    .rail-nav a.active {
      color: var(--text-strong);
      background: rgba(0, 0, 0, 0.12);
    }
    .rail-nav a.active {
      box-shadow: inset 3px 0 0 var(--accent);
    }
    .rail-bottom {
      margin-top: auto;
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      border-top: 1px solid var(--divider);
    }
    .rail-bottom .rail-btn {
      border-bottom: 0;
    }
    .avatar {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      margin: 14px 0 4px;
      border-radius: 50%;
      background: var(--btn);
      color: var(--text-strong);
      font-weight: 700;
      text-transform: uppercase;
    }
    .topbar,
    .mobile-menu {
      display: none;
    }

    @media (max-width: 760px) {
      .shell {
        display: block;
        padding: 0;
      }
      .rail {
        display: none;
      }
      .topbar {
        position: sticky;
        top: 0;
        z-index: 40;
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: var(--topbar-height);
        padding: 0 16px;
        background: var(--panel);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
      }
      .burger {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        border: 0;
        background: none;
        color: #2b2b2b;
        cursor: pointer;
      }
      .mobile-menu {
        position: sticky;
        top: var(--topbar-height);
        z-index: 39;
        display: flex;
        flex-direction: column;
        padding: 8px 16px 14px;
        background: var(--panel-dark);
        box-shadow: var(--shadow);
      }
      .mobile-menu a,
      .mobile-menu button {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 48px;
        border: 0;
        border-bottom: 1px solid var(--divider);
        background: none;
        color: var(--text);
        font: inherit;
        font-weight: 700;
        text-align: left;
        text-transform: uppercase;
        font-size: 13px;
        cursor: pointer;
      }
      .mobile-menu button {
        border-bottom: 0;
        padding: 0;
      }
      .menu-user {
        padding: 6px 0 10px;
        color: var(--text-muted);
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly menuOpen = signal(false);

  constructor() {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.menuOpen.set(false));
  }

  protected initial(): string {
    return this.auth.user()?.email.charAt(0) ?? '?';
  }

  protected async logout(): Promise<void> {
    this.menuOpen.set(false);
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
