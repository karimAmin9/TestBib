import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AppUpdates } from './core/app-updates';
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
          <a routerLink="/" fragment="upload" title="Add a PDF">
            <app-icon name="upload" [size]="22" />
            <span class="sr-only">Add a PDF</span>
          </a>
          <a routerLink="/settings" routerLinkActive="active" title="Settings">
            <app-icon name="gear" [size]="22" />
            <span class="sr-only">Settings</span>
          </a>
        </nav>
      </aside>

      <header class="topbar">
        <a class="logo" routerLink="/" aria-label="Bib library"><span>B</span>ib</a>
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
      </header>

      @if (menuOpen()) {
        <nav id="mobile-menu" class="mobile-menu">
          <a routerLink="/"><app-icon name="book" />Library</a>
          <a routerLink="/" fragment="upload"><app-icon name="upload" />Add a PDF</a>
          <a routerLink="/settings"><app-icon name="gear" />Settings</a>
        </nav>
      }

      <main class="content">
        <router-outlet />
      </main>

      @if (updates.ready()) {
        <div class="update" role="status">
          <span>A new version of Bib is ready.</span>
          <button type="button" class="btn small" (click)="updates.apply()">Update now</button>
        </div>
      }
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
    .rail-nav a {
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
    .rail-nav a.active {
      color: var(--text-strong);
      background: rgba(0, 0, 0, 0.12);
    }
    .rail-nav a.active {
      box-shadow: inset 3px 0 0 var(--accent);
    }
    .topbar,
    .mobile-menu {
      display: none;
    }
    .update {
      position: fixed;
      left: 50%;
      bottom: 16px;
      z-index: 50;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 12px;
      width: max-content;
      max-width: calc(100vw - 32px);
      padding: 10px 12px 10px 16px;
      border-radius: var(--radius);
      background: var(--panel);
      box-shadow: var(--shadow);
      color: var(--text-strong);
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
        color: var(--text);
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
      .mobile-menu a {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 48px;
        border-bottom: 1px solid var(--divider);
        color: var(--text);
        font-weight: 700;
        text-transform: uppercase;
        font-size: 13px;
      }
      .mobile-menu a:last-child {
        border-bottom: 0;
      }
    }
  `,
})
export class App {
  protected readonly updates = inject(AppUpdates);
  private readonly router = inject(Router);
  protected readonly menuOpen = signal(false);

  constructor() {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.menuOpen.set(false));
  }
}
