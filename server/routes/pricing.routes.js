/**
 * Finish packages and style options — the parts of "price settings" that only
 * an Administrator may change.
 */
import { Router } from 'express';
import { asyncHandler, badRequest, notFound, ok, translateDbError } from '../lib/http.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { logActivity } from '../lib/activity.js';
import { WORK_TYPES, validate } from '../lib/validation.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/pricing/finish-packages  - packages with their per-work rates
// ---------------------------------------------------------------------------
router.get(
  '/finish-packages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [packages, items] = await Promise.all([
      req.db.from('v_finish_package_rates').select('*').order('sort_order'),
      req.db.from('finish_package_items')
        .select('id, finish_package_id, work_type, material_id, description, brand, style_variant, unit_price, rate_per_sqm, sort_order')
        .order('sort_order'),
    ]);

    if (packages.error) throw translateDbError(packages.error);
    if (items.error) throw translateDbError(items.error);

    const grouped = {};
    for (const item of items.data || []) {
      (grouped[item.finish_package_id] ||= []).push(item);
    }

    return ok(res, {
      packages: (packages.data || []).map((pkg) => ({ ...pkg, items: grouped[pkg.id] || [] })),
    });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/pricing/finish-packages/:id  (Admin)
// ---------------------------------------------------------------------------
router.patch(
  '/finish-packages/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, {
      name: { label: 'Package name', type: 'string', minLength: 2, maxLength: 80 },
      description: { label: 'Description', type: 'string', maxLength: 500 },
      target_market: { label: 'Target market', type: 'string', maxLength: 160 },
      is_active: { label: 'Active', type: 'boolean' },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const patch = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null));
    if (!Object.keys(patch).length) throw badRequest('There is nothing to update.');

    const { data, error } = await req.db
      .from('finish_packages')
      .update(patch)
      .eq('id', req.params.id)
      .select('id, code, name')
      .maybeSingle();

    if (error) throw translateDbError(error);
    if (!data) throw notFound('That finish package could not be found.');

    await logActivity(req.db, {
      actor: req.user,
      action: 'updated package',
      entityType: 'material',
      entityId: data.id,
      summary: `Finish package "${data.name}" was updated.`,
    });

    return ok(res, data);
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/pricing/finish-package-items/:id  (Admin) - the rate per sqm
// ---------------------------------------------------------------------------
router.patch(
  '/finish-package-items/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, {
      work_type: { label: 'Work', type: 'enum', values: WORK_TYPES },
      rate_per_sqm: { label: 'Rate per square metre', type: 'number', min: 0, max: 1000000 },
      unit_price: { label: 'Unit price', type: 'number', min: 0, max: 100000000 },
      description: { label: 'Description', type: 'string', maxLength: 300 },
      brand: { label: 'Brand', type: 'string', maxLength: 80 },
      material_id: { label: 'Material', type: 'uuid' },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const patch = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null));
    if (!Object.keys(patch).length) throw badRequest('There is nothing to update.');

    const { data, error } = await req.db
      .from('finish_package_items')
      .update(patch)
      .eq('id', req.params.id)
      .select('id, work_type, rate_per_sqm, finish_package_id')
      .maybeSingle();

    if (error) throw translateDbError(error);
    if (!data) throw notFound('That package line could not be found.');

    await logActivity(req.db, {
      actor: req.user,
      action: 'updated rate',
      entityType: 'material',
      entityId: data.id,
      summary: `Rate for ${data.work_type.replace(/_/g, ' ')} set to PHP ${data.rate_per_sqm} per sqm.`,
    });

    return ok(res, data);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/pricing/style-options
// ---------------------------------------------------------------------------
router.get(
  '/style-options',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await req.db
      .from('style_options')
      .select('*')
      .order('work_type')
      .order('sort_order');
    if (error) throw translateDbError(error);
    return ok(res, { rows: data || [] });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/pricing/style-options/:id  (Admin)
// ---------------------------------------------------------------------------
router.patch(
  '/style-options/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, {
      label: { label: 'Label', type: 'string', minLength: 2, maxLength: 80 },
      description: { label: 'Description', type: 'string', maxLength: 300 },
      multiplier: { label: 'Multiplier', type: 'number', min: 0.5, max: 3 },
      is_active: { label: 'Active', type: 'boolean' },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const patch = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null));
    if (!Object.keys(patch).length) throw badRequest('There is nothing to update.');

    const { data, error } = await req.db
      .from('style_options')
      .update(patch)
      .eq('id', req.params.id)
      .select('id, work_type, code, label, multiplier')
      .maybeSingle();

    if (error) throw translateDbError(error);
    if (!data) throw notFound('That style option could not be found.');

    await logActivity(req.db, {
      actor: req.user,
      action: 'updated style',
      entityType: 'material',
      entityId: data.id,
      summary: `Style "${data.label}" multiplier set to ${data.multiplier}.`,
    });

    return ok(res, data);
  }),
);

export default router;
