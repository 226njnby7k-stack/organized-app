/**
 * Self-hosted auth client (M4) — replaces Firebase Auth.
 *
 * Exposes the same function names the app used with Firebase, so the existing
 * call sites are unchanged. The access JWT (minted by our API) is held in
 * memory only; the refresh mechanism is the httpOnly, signed `visitorid`
 * session cookie the API sets at login (see POST /session-token). Nothing
 * auth-related is written to localStorage.
 *
 * Congregation master-key / access-code encryption is untouched — that lives in
 * @services/encryption and never involved auth.
 */

import { atom } from 'jotai';
import { store } from '@states/index';
import { apiHostState } from '@states/app';

export type AuthUser = {
  uid: string;
  getIdToken: () => Promise<string | undefined>;
};

/** Reactive "is there a live session" flag; mirrors the in-memory token. */
export const isDeviceAuthenticatedState = atom(false);

let accessToken: string | undefined;
let currentUser: AuthUser | undefined;

const authHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  appclient: 'organized',
  appversion: import.meta.env.PACKAGE_VERSION,
});

const apiUrl = (path: string) => {
  const host = store.get(apiHostState);
  return `${host}api/v3/${path}`;
};

/** Decode a JWT payload without verifying (client only reads sub/exp). */
const decodeJwt = (token: string): { sub?: string; exp?: number } => {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload));
  } catch {
    return {};
  }
};

/** True if the token is missing or within 30s of its exp. */
const isExpired = (token: string | undefined): boolean => {
  if (!token) return true;
  const { exp } = decodeJwt(token);
  return !exp || Date.now() >= exp * 1000 - 30_000;
};

const buildUser = (token: string): AuthUser => {
  const { sub } = decodeJwt(token);

  return {
    uid: sub ?? '',
    // Silent refresh: return the cached JWT while valid; when it expires, mint a
    // fresh one from the session cookie. Returns undefined if the session was
    // revoked, at which point the caller (apiDefault) sends no Bearer and the
    // API bounces the request to re-login.
    getIdToken: async () => {
      if (!isExpired(accessToken)) return accessToken;
      return await refreshAccessToken();
    },
  };
};

const setToken = (token: string) => {
  accessToken = token;
  currentUser = buildUser(token);
  store.set(isDeviceAuthenticatedState, true);
};

const clearToken = () => {
  accessToken = undefined;
  currentUser = undefined;
  store.set(isDeviceAuthenticatedState, false);
};

/** POST /session-token — mint a fresh access JWT from the visitorid cookie. */
let refreshInFlight: Promise<string | undefined> | undefined;

const refreshAccessToken = async (): Promise<string | undefined> => {
  // De-dupe concurrent refreshes: when several API calls hit an expired token at
  // once, they share one /session-token request instead of stampeding it.
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(apiUrl('session-token'), {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
      });

      if (!res.ok) {
        clearToken();
        return undefined;
      }

      const data = await res.json();
      setToken(data.token);
      return data.token;
    } catch {
      return undefined;
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = undefined;
  }
};

// --- Firebase-compatible surface -------------------------------------------

export const currentAuthUser = (): AuthUser | undefined => currentUser;

export const userSignOut = async (): Promise<void> => {
  clearToken();
};

/** No-op: the Firebase persistence layer is replaced by the session cookie. */
export const setAuthPersistence = async (): Promise<void> => {};

/**
 * Complete a login by exchanging a one-time code for an access JWT.
 * Both the email-link flow (?code= in the URL) and the email-OTP flow
 * (custom_token from /verify-email-token) hand a one-time code here.
 */
export const userSignInCustomToken = async (
  code: string
): Promise<AuthUser | undefined> => {
  const res = await fetch(apiUrl('token-login'), {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
    body: JSON.stringify({ code }),
  });

  if (!res.ok) throw new Error('error_auth_invalid-token');

  const data = await res.json();
  setToken(data.token);
  return currentUser;
};

/** Password login: exchange email + password for an access JWT. */
export const userSignInPassword = async (
  email: string,
  password: string
): Promise<AuthUser | undefined> => {
  const res = await fetch(apiUrl('password-login'), {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) throw new Error('error_auth_invalid-credentials');

  const data = await res.json();
  setToken(data.token);
  return currentUser;
};

/**
 * Restore a session on app start from the httpOnly visitorid cookie. Populates
 * currentAuthUser() without a fresh login when a valid device session exists.
 */
export const restoreSession = async (): Promise<AuthUser | undefined> => {
  await refreshAccessToken();
  return currentUser;
};
