const OIDC_STATE_KEY = 'oidc_state';
const ID_TOKEN_KEY = 'oidc_id_token';

export function generateAndStoreState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem(OIDC_STATE_KEY, value);
  return value;
}

export function validateState(value: string): boolean {
  const stored = sessionStorage.getItem(OIDC_STATE_KEY);
  sessionStorage.removeItem(OIDC_STATE_KEY);
  return !stored || stored === value;
}

export function clearOidcSession(): void {
  sessionStorage.removeItem(OIDC_STATE_KEY);
  sessionStorage.removeItem(ID_TOKEN_KEY);
}

export function getIdToken(): string | null {
  return localStorage.getItem(ID_TOKEN_KEY) ?? sessionStorage.getItem(ID_TOKEN_KEY);
}

export function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
