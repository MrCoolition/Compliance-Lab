import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  clearOidcSession,
  generateAndStoreState,
  getIdToken as getIdTokenUtil,
  parseJwt,
  validateState,
} from './oidc.utils';

const AUTH_CODE_KEY = 'oidc_auth_code';
const ACCESS_TOKEN_KEY = 'oauth_access_token';
const ID_TOKEN_KEY = 'oidc_id_token';

interface ExchangeCodeResponse {
  access_token: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
}

@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);

  isAuthenticated(): boolean {
    return !!localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  isTokenBypass(): boolean {
    return !!localStorage.getItem('authTokenBypass');
  }

  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY) ?? localStorage.getItem('authToken');
  }

  getAuthCode(): string | null {
    return localStorage.getItem(AUTH_CODE_KEY);
  }

  getIdToken(): string | null {
    return localStorage.getItem(ID_TOKEN_KEY) ?? sessionStorage.getItem(ID_TOKEN_KEY) ?? getIdTokenUtil();
  }

  getIdTokenClaims(): Record<string, unknown> | null {
    const token = this.getIdToken();
    if (!token) return null;
    return parseJwt(token);
  }

  loginRedirect(): void {
    const state = generateAndStoreState();
    const params = new URLSearchParams({
      client_id: environment.auth.clientId,
      redirect_uri: environment.auth.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    window.location.href = `${environment.auth.oidcIssuer}/authorize?${params}`;
  }

  async handleCallback(code?: string, state?: string): Promise<boolean> {
    const params = new URLSearchParams(window.location.search);
    const authCode = code ?? params.get('code');
    const stateParam = state ?? params.get('state');

    if (!authCode) return false;

    if (stateParam && !validateState(stateParam)) {
      console.error('State parameter validation failed - possible CSRF attack');
      return false;
    }

    try {
      const response = await firstValueFrom(
        this.http.post<ExchangeCodeResponse>(`${environment.complianceHubApiUrl}/Auth/exchange-code`, {
          code: authCode,
          redirectUri: environment.auth.redirectUri,
        }),
      );
      localStorage.setItem(AUTH_CODE_KEY, authCode);
      localStorage.setItem(ACCESS_TOKEN_KEY, response.access_token);
      if (response.id_token) {
        localStorage.setItem(ID_TOKEN_KEY, response.id_token);
        sessionStorage.setItem(ID_TOKEN_KEY, response.id_token);
      }
    } catch (error) {
      console.error('Code exchange failed', error);
      return false;
    }

    window.history.replaceState({}, '', window.location.pathname);
    return true;
  }

  logout(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(ID_TOKEN_KEY);
    localStorage.removeItem(AUTH_CODE_KEY);
    clearOidcSession();
    const service = encodeURIComponent(window.location.origin);
    window.location.href = `${environment.auth.logoutUrl}?service=${service}`;
  }

  clearLocalSession(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(ID_TOKEN_KEY);
    localStorage.removeItem(AUTH_CODE_KEY);
    clearOidcSession();
  }

  updateAuthState(): void {}
}
