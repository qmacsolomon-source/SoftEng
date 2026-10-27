/**
 * Thin fetch wrapper around the Express API.
 *
 * Every response from the server uses one of two envelopes:
 *   success -> { data: ... }
 *   failure -> { error: { message, code, fields? } }
 *
 * This module unwraps them, attaches the Bearer token, transparently retries
 * once after refreshing an expired session, and throws a single ApiError type
 * that the form layer understands (it carries per-field messages).
 */
import { session } from './session.js';

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', fields = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.isAuthError = status === 401;
  }
}

function buildUrl(path, query) {
  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === '' || value === null || value === undefined) continue;
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function parse(response) {
  const type = response.headers.get('Content-Type') || '';
  if (type.includes('application/json')) {
    try { return await response.json(); } catch { return null; }
  }
  const text = await response.text().catch(() => '');
  return text ? { __text: text } : null;
}

async function send(method, path, { body, formData, query, headers: extraHeaders } = {}) {
  const url = buildUrl(path, query);
  const headers = { Accept: 'application/json', ...(extraHeaders || {}) };

  const token = session.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (formData) {
    payload = formData; // The browser sets the multipart boundary itself.
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const fire = () => fetch(url, {
    method, headers, body: payload, credentials: 'same-origin',
  });

  let response = await fire();

  // One transparent refresh-and-retry when the access token has simply aged out.
  if (response.status === 401 && !path.startsWith('/api/auth/')) {
    if (await session.refresh()) {
      const fresh = session.getToken();
      if (fresh) headers.Authorization = `Bearer ${fresh}`;
      response = await fire();
    } else {
      session.clear();
      session.redirectToLogin();
      throw new ApiError('Your session has expired. Please sign in again.', { status: 401 });
    }
  }

  const data = await parse(response);

  if (!response.ok) {
    const error = data?.error || {};
    throw new ApiError(
      error.message || data?.__text || `Request failed (${response.status}).`,
      {
        status: response.status,
        code: error.code || '',
        fields: error.fields || null,
      },
    );
  }

  // A handful of endpoints return non-JSON payloads (CSV export).
  if (data && typeof data === 'object' && '__text' in data) return data.__text;
  if (data && typeof data === 'object' && 'data' in data) return data.data;
  return data;
}

export const api = {
  get: (path, options) => send('GET', path, options),
  post: (path, body, options = {}) => send('POST', path, { ...options, body }),
  patch: (path, body, options = {}) => send('PATCH', path, { ...options, body }),
  delete: (path, options) => send('DELETE', path, options),

  /** Multipart submit - used by the two file-upload forms. */
  postForm: (path, formData, options = {}) => send('POST', path, { ...options, formData }),

  /**
   * Downloads a file with the Authorization header attached, then hands the
   * blob to the browser. Used for the CSV export (a plain link cannot carry
   * the bearer token).
   */
  async download(path, { query, filename } = {}) {
    const url = buildUrl(path, query);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${session.getToken()}` },
      credentials: 'same-origin',
    });
    if (!response.ok) {
      const data = await parse(response);
      throw new ApiError(data?.error?.message || 'The file could not be downloaded.', {
        status: response.status,
      });
    }
    const blob = await response.blob();
    return { blob, filename: filename || 'download' };
  },

  /** Mints a short-lived URL for a file in one of the private buckets. */
  signedUrl: (bucket, path) => send('GET', '/api/uploads/signed-url', { query: { bucket, path } }),
};
