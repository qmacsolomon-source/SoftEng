/**
 * Simple in-memory brute-force guard for the sign-in form.
 * After 5 failed attempts for the same IP + email, the pair is locked for
 * 15 minutes. A successful sign-in clears the counter.
 *
 * Note: state lives in process memory, which is correct for a single-instance
 * deployment (APA runs one server). Restarting the server clears the locks.
 */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

const attempts = new Map();

export const loginKey = (req, email) =>
  `${req.ip || 'unknown'}|${String(email || '').toLowerCase().trim()}`;

function getEntry(key) {
  const entry = attempts.get(key);
  if (!entry) return null;
  if (entry.lockedUntil && entry.lockedUntil > Date.now()) return entry;
  if (!entry.lockedUntil && Date.now() - entry.firstAt > WINDOW_MS) {
    attempts.delete(key);
    return null;
  }
  return entry;
}

/** @returns {{ allowed: boolean, retryAfterSeconds: number, remaining: number }} */
export function checkLoginAllowed(key) {
  const entry = getEntry(key);
  if (!entry) return { allowed: true, retryAfterSeconds: 0, remaining: MAX_ATTEMPTS };

  if (entry.lockedUntil && entry.lockedUntil > Date.now()) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((entry.lockedUntil - Date.now()) / 1000),
      remaining: 0,
    };
  }
  return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, MAX_ATTEMPTS - entry.count) };
}

export function recordLoginFailure(key) {
  const entry = getEntry(key) || { count: 0, firstAt: Date.now(), lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCK_MS;
  }
  attempts.set(key, entry);

  if (attempts.size > 5000) {
    // House-keeping: drop anything that has fully expired.
    const now = Date.now();
    for (const [k, v] of attempts) {
      if ((v.lockedUntil || 0) < now && now - v.firstAt > WINDOW_MS) attempts.delete(k);
    }
  }

  return { remaining: Math.max(0, MAX_ATTEMPTS - entry.count), lockedOut: entry.count >= MAX_ATTEMPTS };
}

export function clearLoginFailures(key) {
  attempts.delete(key);
}

export const LOGIN_GUARD = { MAX_ATTEMPTS, WINDOW_MS, LOCK_MS };
