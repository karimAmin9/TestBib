import { HttpClient, HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { BookDetail, BookSummary, Chapter } from './models';

@Injectable({ providedIn: 'root' })
export class BooksApi {
  private readonly http = inject(HttpClient);

  list(): Observable<BookSummary[]> {
    return this.http.get<BookSummary[]>('/api/books');
  }

  get(id: string): Observable<BookDetail> {
    return this.http.get<BookDetail>(`/api/books/${id}`);
  }

  upload(file: File): Observable<HttpEvent<BookSummary>> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<BookSummary>('/api/books', form, {
      reportProgress: true,
      observe: 'events',
    });
  }

  update(id: string, changes: { title?: string; author?: string }): Observable<BookSummary> {
    return this.http.patch<BookSummary>(`/api/books/${id}`, changes);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/books/${id}`);
  }

  chapterUrl(id: string, number: number): string {
    return `/api/books/${id}/chapters/${number}`;
  }

  chapter(id: string, number: number): Observable<Chapter> {
    return this.http.get<Chapter>(this.chapterUrl(id, number));
  }

  saveProgress(id: string, chapterNumber: number, scrollPercent: number): Observable<void> {
    return this.http.put<void>(`/api/books/${id}/progress`, { chapterNumber, scrollPercent });
  }

  coverUrl(id: string): string {
    return `/api/books/${id}/cover`;
  }

  imageUrl(id: string, src: string): string {
    return `/api/books/${id}/images/${encodeURIComponent(src)}`;
  }
}
