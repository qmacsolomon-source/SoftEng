/**
 * Authentication routes.
 *
 * The browser never talks to Supabase directly: it posts credentials here, the
 * server exchanges them for a Supabase session and returns the tokens. This
 * keeps the Supabase project URL and keys entirely server-side and lets us add
 * role verification, rate limiting and audit logging in one place.
 */
import { Router } from 'express';
import { supabaseAdmin, newAnonClient, userClient } from '../supabase.js';
import { asyncHandler, badRequest, ok, unauthorized } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { LOGIN_GUARD, checkLoginAllowed, clearLoginFailures, loginKey, recordLoginFailure } from '../middleware/rateLimit.js';
import { validate } from '../lib/validation.js';
import { logActivity } from '../lib/activity.js';

const router = Router();

/** Deliberately generic: never reveals which field was wrong. */
const GENERIC_LOGIN_ERROR =
  'We could not sign you in. Please check your email address, password and role, then try again.';

const LOGIN_RULES = {
  email: { label: 'Email address', required: true, type: 'email' },
  password: { label: 'Password', required: true, type: 'string', minLength: 8, maxLength: 72 },
  role: { label: 'Role', required: true, type: 'enum', values: ['admin', 'staff'] },
};

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, LOGIN_RULES);
    if (!valid) {
      // Field-level detail is fine here: the form itself is malformed, so there
      // is no account information being leaked.
      throw badRequest('Please complete the sign-in form.', errors);
    }

    const key = loginKey(req, value.email);
    const gate = checkLoginAllowed(key);
    if (!gate.allowed) {
      throw badRequest(
        `Too many failed sign-in attempts. Please wait ${Math.ceil(gate.retryAfterSeconds / 60)} minute(s) and try again.`,
        { locked: true, retryAfterSeconds: gate.retryAfterSeconds },
      );
    }

    const authClient = newAnonClient();
    const { data: signIn, error: signInError } = await authClient.auth.signInWithPassword({
      email: value.email,
      password: value.password,
    });

    if (signInError || !signIn?.session) {
      const result = recordLoginFailure(key);
      throw unauthorized(
        result.lockedOut
          ? `Too many failed sign-in attempts. This sign-in is locked for ${LOGIN_GUARD.LOCK_MS / 60000} minutes.`
          : `${GENERIC_LOGIN_ERROR}${result.remaining <= 2 ? ` ${result.remaining} attempt(s) remaining.` : ''}`,
      );
    }

    const db = userClient(signIn.session.access_token);

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('id, email, full_name, phone, role, position, avatar_url, is_active')
      .eq('id', signIn.user.id)
      .single();

    if (profileError || !profile || !profile.is_active || profile.role !== value.role) {
      // Wrong role for this account, or no profile: revoke immediately.
      await authClient.auth.signOut().catch(() => {});
      if (profile?.is_active === false) {
        recordLoginFailure(key);
        throw unauthorized('This account has been deactivated. Please contact the administrator.');
      }
      recordLoginFailure(key);
      throw unauthorized(GENERIC_LOGIN_ERROR);
    }

    clearLoginFailures(key);

    await db
      .from('profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', profile.id);

    await logActivity(db, {
      actor: { id: profile.id, email: profile.email, profile },
      action: 'signed in',
      entityType: 'auth',
      summary: `${profile.full_name || profile.email} signed in as ${profile.role === 'admin' ? 'Admin' : 'Staff'}.`,
    });

    return ok(res, {
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
      expires_at: signIn.session.expires_at,
      user: {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        role: profile.role,
        position: profile.position,
        avatar_url: profile.avatar_url,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/auth/refresh  - exchange a refresh token for a new session
// ---------------------------------------------------------------------------
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const refreshToken = String(req.body?.refresh_token || '').trim();
    if (!refreshToken) throw badRequest('A refresh token is required.');

    const { data, error } = await newAnonClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session) throw unauthorized('Your session has expired. Please sign in again.');

    return ok(res, {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (token) {
      await supabaseAdmin.auth.admin.signOut(token, 'global').catch(() => {});
    }
    return ok(res, { signedOut: true });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/auth/me  - who am I (used on every page load to restore the shell)
// ---------------------------------------------------------------------------
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => ok(res, { user: req.user.profile })),
);

// ---------------------------------------------------------------------------
// PATCH /api/auth/profile  - a user editing their own details
// ---------------------------------------------------------------------------
router.patch(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, {
      full_name: { label: 'Full name', required: true, type: 'string', minLength: 2, maxLength: 120 },
      phone: { label: 'Contact number', type: 'phone' },
      position: { label: 'Position', type: 'string', maxLength: 80 },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const { data, error } = await req.db
      .from('profiles')
      .update({
        full_name: value.full_name,
        phone: value.phone || null,
        position: value.position || null,
      })
      .eq('id', req.user.id)
      .select('id, email, full_name, phone, role, position, avatar_url')
      .single();

    if (error) throw badRequest(error.message);

    await logActivity(req.db, {
      actor: req.user,
      action: 'updated',
      entityType: 'user',
      entityId: req.user.id,
      summary: `${value.full_name} updated their profile details.`,
    });

    return ok(res, { user: data });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/auth/change-password
// ---------------------------------------------------------------------------
router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, {
      current_password: { label: 'Current password', required: true, type: 'string', minLength: 8, maxLength: 72 },
      new_password: { label: 'New password', required: true, type: 'string', minLength: 8, maxLength: 72 },
      confirm_password: { label: 'Confirm new password', required: true, type: 'string', minLength: 8, maxLength: 72 },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    if (value.new_password !== value.confirm_password) {
      throw badRequest('Please correct the highlighted fields.', {
        confirm_password: 'The two new passwords do not match.',
      });
    }
    if (value.new_password === value.current_password) {
      throw badRequest('Please correct the highlighted fields.', {
        new_password: 'Choose a password that is different from your current one.',
      });
    }

    // Re-authenticate before allowing the change.
    const { error: verifyError } = await newAnonClient().auth.signInWithPassword({
      email: req.user.email,
      password: value.current_password,
    });
    if (verifyError) {
      throw badRequest('Please correct the highlighted fields.', {
        current_password: 'Your current password is not correct.',
      });
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
      password: value.new_password,
    });
    if (updateError) throw badRequest(updateError.message);

    await logActivity(req.db, {
      actor: req.user,
      action: 'changed password',
      entityType: 'auth',
      entityId: req.user.id,
      summary: `${req.user.profile.full_name || req.user.email} changed their password.`,
    });

    return ok(res, { updated: true });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password  - always answers the same way
// ---------------------------------------------------------------------------
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, {
      email: { label: 'Email address', required: true, type: 'email' },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const siteUrl = req.headers.origin || `http://localhost:${process.env.PORT || 3000}`;

    await newAnonClient().auth
      .resetPasswordForEmail(value.email, { redirectTo: `${siteUrl}/reset-password.html` })
      .catch(() => {});

    return ok(res, {
      message: `If ${value.email} matches an account, a password reset link is on its way.`,
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password  - finish the recovery flow
//
// The emailed link comes back to reset-password.html carrying either an
// `access_token` (recovery session, usually in the URL hash) or a `code` (the
// PKCE style link). We accept whichever is present, confirm it belongs to a
// real user, then set the new password with the service-role client.
// ---------------------------------------------------------------------------
router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, {
      access_token: { label: 'Reset token', type: 'string', maxLength: 4096 },
      code: { label: 'Reset code', type: 'string', maxLength: 4096 },
      new_password: { label: 'New password', required: true, type: 'string', minLength: 8, maxLength: 72 },
      confirm_password: { label: 'Confirm new password', required: true, type: 'string', minLength: 8, maxLength: 72 },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    if (value.new_password !== value.confirm_password) {
      throw badRequest('Please correct the highlighted fields.', {
        confirm_password: 'The two passwords do not match.',
      });
    }

    if (!value.access_token && !value.code) {
      throw badRequest(
        'This password reset link is missing or has expired. Please request a new one.',
        { access_token: 'Request a new reset link from the sign-in screen.' },
      );
    }

    let userId = '';

    if (value.access_token) {
      const { data, error } = await supabaseAdmin.auth.getUser(value.access_token);
      if (!error && data?.user?.id) userId = data.user.id;
    }

    if (!userId && value.code) {
      const { data, error } = await newAnonClient().auth.exchangeCodeForSession(value.code);
      if (!error && data?.user?.id) userId = data.user.id;
    }

    if (!userId) {
      throw badRequest(
        'This password reset link is invalid or has already been used. Please request a new one.',
        { access_token: 'Reset links can only be used once. Request a new link and try again.' },
      );
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: value.new_password,
    });
    if (updateError) throw badRequest(updateError.message);

    // Any session opened with the old password (or the recovery token) is dead.
    await supabaseAdmin.auth.admin.signOut(userId, 'global').catch(() => {});

    return ok(res, { updated: true });
  }),
);

export default router;
