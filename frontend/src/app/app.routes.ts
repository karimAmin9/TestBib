import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Library · Bib',
    loadComponent: () => import('./pages/library/library').then((m) => m.Library),
  },
  {
    path: 'book/:id',
    title: 'Book · Bib',
    loadComponent: () => import('./pages/book/book-detail').then((m) => m.BookDetailPage),
  },
  {
    path: 'book/:id/read/:n',
    title: 'Reading · Bib',
    loadComponent: () => import('./pages/reader/reader').then((m) => m.Reader),
  },
  { path: '**', redirectTo: '' },
];
