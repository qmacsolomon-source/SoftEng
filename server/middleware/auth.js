/**
 * Authentication and role authorisation middleware.
 *
 * The browser sends the Supabase access token as "Authorization: Bearer <jwt>".
 * We verify it with Supabase, load the matching profile row and attach a
 * Row-Level-Security-scoped Supabase client to the request. Every business
 * query in the route handlers then runs as that user.
 */
import { supabaseAnon, userClient } from '../supabase.js';
import { asyncHandler, forbidden, unauthorized } from '../lib/http.js';

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) throw unauthorized('You must sign in to continue.');

  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data?.user) {
    throw unauthorized('Your session has expired. Please sign in again.');
  }

  const db = userClient(token);
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('id, email, full_name, phone, role, position, avatar_url, is_active, last_login_at')
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile) {
    throw forbidden('No staff profile is linked to this account. Ask the administrator to add you.');
  }
  if (!profile.is_active) {
    throw forbidden('This account has been deactivated. Contact the administrator.');
  }

  req.token = token;
  req.db = db;
  req.user = { id: data.user.id, email: data.user.email, profile };
  next();
});

/** Must run after requireAuth. Blocks Staff from Admin-only areas. */
export function requireAdmin(req, _res, next) {
  if (req.user?.profile?.role !== 'admin') {
    return next(forbidden('Only an Administrator can use this feature.'));
  }
  next();
}

/** Helper for handlers that need to branch on role rather than block. */
export const isAdmin = (req) => req.user?.profile?.role === 'admin';
