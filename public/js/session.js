/**
 * Session handling for the APA front end.
 *
 * The browser never sees a Supabase key. It receives a Supabase access token
 * from POST /api/auth/login, keeps it (localStorage when "Remember me" is
 * ticked, sessionStorage otherwise) and replays it as a Bearer token on every
 * API call. This module is deliberately free of any dependency on api.js so
 * that api.js can import it without creating a circular import.
 */

const KEY = 'apa.session';
const LAST_ROLE_KEY = 'apa.lastRole';

/** Refresh this many seconds before the token actually expires. */
const EXPIRY_SKEW_SECONDS = 60;

/** Which storage backend is currently holding the session. */
let activeStorage = null;

function storages() {
  return [window.localStorage, window.sessionStorage];
}

function readRaw() {
  for (const storage of storages()) {
    try {
      const raw = storage.getItem(KEY);
      if (raw) {
        activeStorage = storage;
        return JSON.parse(raw);
      }
    } catch {
      /* Ignore corrupt entries and try the next store. */
    }
  }
  return null;
}

function writeRaw(payload) {
  const storage = activeStorage || window.localStorage;
  try {
    storage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* Storage may be disabled in private modes - the session stays in memory. */
  }
}

function clearRaw() {
  for (const storage of storages()) {
    try { storage.removeItem(KEY); } catch { /* noop */ }
  }
  activeStorage = null;
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  return Date.now() / 1000 >= Number(expiresAt) - EXPIRY_SKEW_SECONDS;
}

export const session = {
  /** Persists a login response. `remember` chooses localStorage vs sessionStorage. */
  save({ access_token, refresh_token, expires_at, user }, remember = false) {
    activeStorage = remember ? window.localStorage : window.sessionStorage;
    try { window.localStorage.setItem(LAST_ROLE_KEY, user?.role || 'staff'); } catch { /* noop */ }
    writeRaw({ access_token, refresh_token, expires_at, user, remember: Boolean(remember) });
  },

  /** The stored session object, or null when there is none. */
  get() {
    return readRaw();
  },

  getToken() {
    return readRaw()?.access_token || '';
  },

  user() {
    return readRaw()?.user || null;
  },

  role() {
    return readRaw()?.user?.role || '';
  },

  isAdmin() {
    return this.role() === 'admin';
  },

  isExpired() {
    return isExpired(readRaw()?.expires_at);
  },

  /** The role used to pre-select the dropdown on the sign-in screen. */
  lastRole() {
    try { return window.localStorage.getItem(LAST_ROLE_KEY) || ''; } catch { return ''; }
  },

  /**
   * Merges fresh user details (for example after a profile edit) into the
   * stored session without disturbing the tokens.
   */
  updateUser(user) {
    const current = readRaw();
    if (!current) return;
    writeRaw({ ...current, user: { ...current.user, ...user } });
  },

  /**
   * Exchanges the refresh token for a new access token.
   * @returns {Promise<boolean>} true when a usable token is now stored.
   */
  async refresh() {
    const current = readRaw();
    if (!current?.refresh_token) return false;

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
        credentials: 'same-origin',
      });
      if (!response.ok) return false;

      const payload = await response.json();
      const data = payload?.data;
      if (!data?.access_token) return false;

      writeRaw({
        ...current,
        access_token: data.access_token,
        refresh_token: data.refresh_token || current.refresh_token,
        expires_at: data.expires_at,
      });
      return true;
    } catch {
      return false;
    }
  },

  /** Loads the signed-in user's profile from the server (used on page load). */
  async hydrate() {
    const token = this.getToken();
    if (!token) return null;

    try {
      const response = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        credentials: 'same-origin',
      });

      if (response.status === 401) {
        if (await this.refresh()) return this.hydrate();
        return null;
      }
      if (!response.ok) return null;

      const payload = await response.json();
      const user = payload?.data?.user;
      if (user) this.updateUser(user);
      return user || null;
    } catch {
      return null;
    }
  },

  /** Asks the server to revoke the session, then clears it locally. */
  async logout() {
    const token = this.getToken();
    clearRaw();
    if (!token) return;
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        credentials: 'same-origin',
      });
    } catch {
      /* Signing out locally is enough even if the request fails. */
    }
  },

  clear: clearRaw,

  /** Sends the user to the sign-in screen, remembering where they were going. */
  redirectToLogin(returnTo = window.location.pathname + window.location.search) {
    const url = new URL('/login.html', window.location.origin);
    if (returnTo && !returnTo.startsWith('/login.html')) url.searchParams.set('next', returnTo);
    window.location.replace(url.toString());
  },
};
