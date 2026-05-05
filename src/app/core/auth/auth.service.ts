import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthResponse, AuthUser } from '../models/auth.models';
import { BehaviorSubject, catchError, finalize, Observable, of, shareReplay, tap, timeout } from 'rxjs';

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
        // bufferSize: 1 retiene la ultima emision para nuevos subscriptores
        // refCount: true  hace que el observable subyancente solo se mantenga vivo mientras hay al menos un suscriptor
        shareReplay({bufferSize: 1, refCount: true}) // Comparte la misma respuesta entre múltiples suscriptores y completa la petición cuando no hay más suscriptores
      );
      return this.refreshRequest$;
  }

  /**
   * La idea general
   * logout() debe hacer 3 cosas en orden de importancia
   * 1. Avisar al backend que invalide la sesion (POST /api/v1/auth/logout)
   * 2. Limpiar el estado local y redirigir al login (siempre!, pase lo que pase)
   * 3. Devolver observable<void> para que el componente que llama pueda subcribirse y saber cuando termino
   *
   * **El truco está en que la limpieza local debe ocurrir SIEMPRE, aunque el backend falle, tarde demasiado, o este caido.
   * Por esta razón usamos este encadenamiento de operadores de RxJS **
   *
   */
  logout():Observable<void> {
    const token = this._accessToken();
    if(!token) {
      this.clearSessionAndRedirect();
      return of(void 0);
    }
    return this.http.post('/api/v1/auth/logout', {}, {headers: {Authorization: `Bearer ${token}`}, withCredentials: true })
      .pipe(
        timeout({each: 3000}), // Si el servidor no responde en 3 segundos, se considera un error y se pasa al catchError para limpiar la sesión de todas formas
        catchError(() => of(void 0)), // Ignora errores en la petición de logout (ej. timeout, no response, etc.)
        finalize(() => this.clearSessionAndRedirect()), // Limpia la sesión y redirige al login independientemente del resultado de la petición
        tap(() => void 0)
      ) as Observable<void>;
  }

  clearSessionAndRedirect():void {
    this._accessToken.set(null);
    this._currentUser.set(null);
    this.router.navigate(['/login']);
  }
  private setSession(authResponse: AuthResponse): void {
    this._accessToken.set(authResponse.accessToken);
    this._currentUser.set(authResponse.user);
  }

}
