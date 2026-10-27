/**
 * User management. ADMIN ONLY — every route on this router is behind
 * requireAuth + requireAdmin, and the underlying RLS policies independently
 * block a Staff account from reading or writing other profiles.
 *
 * Creating, deleting and password-resetting an auth user requires the Supabase
 * service-role key, which lives only on the server.
 */
import { Router } from 'express';
import { supabaseAdmin } from '../supabase.js';
import { asyncHandler, badRequest, created, notFound, ok, translateDbError } from '../lib/http.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { logActivity } from '../lib/activity.js';
import { validate } from '../lib/validation.js';

const router = Router();

router.use(requireAuth, requireAdmin);

// ---------------------------------------------------------------------------
// GET /api/users
// ---------------------------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { data, error } = await req.db
      .from('profiles')
      .select('id, email, full_name, phone, role, position, avatar_url, is_active, last_login_at, created_at')
      .order('created_at');

    if (error) throw translateDbError(error);
    return ok(res, { rows: data || [] });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/users  - invite a new Admin or Staff member
// ---------------------------------------------------------------------------
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, {
      email: { label: 'Email address', required: true, type: 'email' },
      full_name: { label: 'Full name', required: true, type: 'string', minLength: 2, maxLength: 120 },
      password: { label: 'Temporary password', required: true, type: 'string', minLength: 8, maxLength: 72 },
      role: { label: 'Role', required: true, type: 'enum', values: ['admin', 'staff'] },
      phone: { label: 'Contact number', type: 'phone' },
      position: { label: 'Position', type: 'string', maxLength: 80 },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: value.email,
      password: value.password,
      email_confirm: true,
      user_metadata: {
        full_name: value.full_name,
        role: value.role,
        phone: value.phone || '',
        position: value.position || '',
      },
    });

    if (authError) {
      throw badRequest(
        /already/i.test(authError.message)
          ? 'An account with that email address already exists.'
          : `The account could not be created: ${authError.message}`,
        { email: /already/i.test(authError.message) ? 'That email address is already registered.' : undefined },
      );
    }

    // The auth trigger has already written the profile row; read it back.
    const { data: profile, error: profileError } = await req.db
      .from('profiles')
      .select('id, email, full_name, phone, role, position, is_active, created_at')
      .eq('id', authUser.user.id)
      .maybeSingle();

    if (profileError) throw translateDbError(profileError);

    await logActivity(req.db, {
      actor: req.user,
      action: 'created user',
      entityType: 'user',
      entityId: authUser.user.id,
      summary: `${value.full_name} was added as ${value.role === 'admin' ? 'Administrator' : 'Staff'}.`,
    });

    return created(res, profile ?? { id: authUser.user.id, email: value.email, role: value.role });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/users/:id  - name, role, active flag, position
// ---------------------------------------------------------------------------
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, {
      full_name: { label: 'Full name', type: 'string', minLength: 2, maxLength: 120 },
      role: { label: 'Role', type: 'enum', values: ['admin', 'staff'] },
      phone: { label: 'Contact number', type: 'phone' },
      position: { label: 'Position', type: 'string', maxLength: 80 },
      is_active: { label: 'Active', type: 'boolean' },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const patch = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null));
    if (!Object.keys(patch).length) throw badRequest('There is nothing to update.');

    const { data, error } = await req.db
      .from('profiles')
      .update(patch)
      .eq('id', req.params.id)
      .select('id, email, full_name, phone, role, position, is_active')
      .maybeSingle();

    if (error) {
      throw translateDbError(error) ?? badRequest('That change could not be saved.');
    }
    if (!data) throw notFound('That user could not be found.');

    // Keep the auth metadata in step so a re-created session sees the new role.
    await supabaseAdmin.auth.admin
      .updateUserById(req.params.id, {
        user_metadata: { full_name: data.full_name, role: data.role },
      })
      .catch(() => {});

    await logActivity(req.db, {
      actor: req.user,
      action: 'updated user',
      entityType: 'user',
      entityId: data.id,
      summary: `Account for ${data.full_name} updated (${data.role}${data.is_active ? '' : ', deactivated'}).`,
    });

    return ok(res, data);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/users/:id/reset-password
// ---------------------------------------------------------------------------
router.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, {
      password: { label: 'New temporary password', required: true, type: 'string', minLength: 8, maxLength: 72 },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, {
      password: value.password,
    });
    if (error) throw badRequest(`The password could not be reset: ${error.message}`);

    await logActivity(req.db, {
      actor: req.user,
      action: 'reset password',
      entityType: 'user',
      entityId: req.params.id,
      summary: 'A temporary password was issued for a user account.',
    });

    return ok(res, { updated: true });
  }),
);

// ---------------------------------------------------------------------------
// DELETE /api/users/:id
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) {
      throw badRequest('You cannot delete your own account.');
    }

    const { data: target } = await req.db
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('id', req.params.id)
      .maybeSingle();

    if (!target) throw notFound('That user could not be found.');

    const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
    if (error) throw badRequest(`The account could not be deleted: ${error.message}`);

    await logActivity(req.db, {
      actor: req.user,
      action: 'deleted user',
      entityType: 'user',
      entityId: target.id,
      summary: `Account for ${target.full_name || target.email} was deleted.`,
    });

    return ok(res, { deleted: true, id: target.id });
  }),
);

export default router;
