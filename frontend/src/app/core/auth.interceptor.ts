import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** Sends the auth cookie and redirects to the login page when the session has expired. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req.clone({ withCredentials: true })).pipe(
    catchError((error: unknown) => {
      const isAuthCall = req.url.startsWith('/api/auth/');
      if (error instanceof HttpErrorResponse && error.status === 401 && !isAuthCall) {
        auth.user.set(null);
        void router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
      }
      return throwError(() => error);
    }),
  );
};
