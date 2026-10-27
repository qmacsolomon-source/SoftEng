/**
 * Client book. Staff can add and edit clients; only an Administrator can delete.
 */
import { Router } from 'express';
import { asyncHandler, badRequest, created, notFound, ok, translateDbError } from '../lib/http.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { logActivity } from '../lib/activity.js';
import { escapePostgrestTerm, sanitizeString, validate } from '../lib/validation.js';

const router = Router();

const CLIENT_RULES = {
  full_name: { label: 'Client full name', required: true, type: 'string', minLength: 2, maxLength: 120 },
  email: { label: 'Email address', type: 'email' },
  phone: { label: 'Contact number', type: 'phone' },
  address: { label: 'Address', type: 'string', maxLength: 300 },
  notes: { label: 'Notes', type: 'string', maxLength: 1000 },
};

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const keyword = escapePostgrestTerm(sanitizeString(req.query.keyword || '', { maxLength: 80 }));

    let query = req.db
      .from('clients')
      .select('id, full_name, email, phone, address, notes, created_at', { count: 'exact' })
      .order('full_name');

    if (keyword) query = query.or(`full_name.ilike.%${keyword}%,email.ilike.%${keyword}%,phone.ilike.%${keyword}%`);

    const { data, error, count } = await query.limit(500);
    if (error) throw translateDbError(error);

    return ok(res, { rows: data || [], total: count ?? 0 });
  }),
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, CLIENT_RULES);
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const { data, error } = await req.db
      .from('clients')
      .insert({
        full_name: value.full_name,
        email: value.email || null,
        phone: value.phone || null,
        address: value.address || null,
        notes: value.notes || null,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw translateDbError(error);

    await logActivity(req.db, {
      actor: req.user,
      action: 'created client',
      entityType: 'client',
      entityId: data.id,
      summary: `Client "${data.full_name}" was added.`,
    });

    return created(res, data);
  }),
);

router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rules = Object.fromEntries(
      Object.entries(CLIENT_RULES).map(([key, rule]) => [key, { ...rule, required: false }]),
    );
    const { valid, errors, value } = validate(req.body, rules);
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const patch = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null));
    if (!Object.keys(patch).length) throw badRequest('There is nothing to update.');

    const { data, error } = await req.db
      .from('clients')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error) throw translateDbError(error);
    if (!data) throw notFound('That client could not be found.');

    return ok(res, data);
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { data, error } = await req.db
      .from('clients')
      .delete()
      .eq('id', req.params.id)
      .select('id, full_name')
      .maybeSingle();

    if (error) throw translateDbError(error);
    if (!data) throw notFound('That client could not be found.');

    await logActivity(req.db, {
      actor: req.user,
      action: 'deleted client',
      entityType: 'client',
      entityId: data.id,
      summary: `Client "${data.full_name}" was deleted.`,
    });

    return ok(res, { deleted: true, id: data.id });
  }),
);

export default router;
