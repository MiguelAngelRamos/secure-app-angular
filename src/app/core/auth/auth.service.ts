import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthResponse, AuthUser } from '../models/auth.models';
import { BehaviorSubject, finalize, Observable, shareReplay, tap } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly _accessToken = signal<string | null>(null);
  private readonly _currentUser = signal<AuthUser | null>(null);

  private refreshRequest$: Observable<AuthResponse> | null = null;
  private readonly _isRefreshing = new BehaviorSubject<boolean>(false);

  readonly isRefreshing$ = this._isRefreshing.asObservable();

  readonly accessToken = this._accessToken.asReadonly();
  readonly currentUser = this._currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this._accessToken() !== null);
  readonly userRole = computed(() => this._currentUser()?.role ?? null);
  readonly isAdmin = computed(() => this._currentUser()?.role === 'admin');
  readonly isDoctor = computed(() => this._currentUser()?.role === 'doctor');
  readonly isPatient = computed(() => this._currentUser()?.role === 'patient');

  //* helper exponer el valor sincrono del gate para consultas rápidas desde el interceptor
  // antes de decidir si encolar o disparar el refresh

  isRefreshing(): boolean {
    return this._isRefreshing.value;
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/api/v1/auth/login', { email, password }, { withCredentials: true })
      .pipe(tap(authResponse => this.setSession(authResponse)));
  }

  register(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/api/v1/auth/register', { email, password }, { withCredentials: true })
      .pipe(tap(authResponse => this.setSession(authResponse)));
  }



  refresh(): Observable<AuthResponse> {
    // si ya hay una petición de refresh en curso, devuelve esa misma petición
    if (this.refreshRequest$) return this.refreshRequest$;
    this._isRefreshing.next(true); // indica que se está haciendo una petición de refresh
    this.refreshRequest$ = this.http.post<AuthResponse>('/api/v1/auth/refresh', {}, { withCredentials: true })
      .pipe(
        tap(responseRefresh => this.setSession(responseRefresh)), // Actualiza el accessToken y el currentUser con la respuesta del refresh
        finalize(() => {
          this.refreshRequest$ = null; // Limpia la referencia a la petición de refresh
          this._isRefreshing.next(false); // Indica que ya no se está haciendo una petición de refresh
        }),
        shareReplay({bufferSize: 1, refCount: true}) // Comparte la misma respuesta entre múltiples suscriptores y completa la petición cuando no hay más suscriptores
      );
      return this.refreshRequest$;
  }

  private setSession(authResponse: AuthResponse): void {
    this._accessToken.set(authResponse.accessToken);
    this._currentUser.set(authResponse.user);
  }

}
