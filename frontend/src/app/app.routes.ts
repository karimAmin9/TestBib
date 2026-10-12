import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    title: 'Library · Bib',
    loadComponent: () => import('./pages/library/library').then((m) => m.Library),
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Sign in · Bib',
    data: { mode: 'login' },
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    title: 'Create account · Bib',
    data: { mode: 'register' },
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
  },
  {
    path: 'book/:id',
    canActivate: [authGuard],
    title: 'Book · Bib',
    loadComponent: () => import('./pages/book/book-detail').then((m) => m.BookDetailPage),
  },
  {
    path: 'book/:id/read/:n',
    canActivate: [authGuard],
    title: 'Reading · Bib',
    loadComponent: () => import('./pages/reader/reader').then((m) => m.Reader),
  },
  { path: '**', redirectTo: '' },
];
