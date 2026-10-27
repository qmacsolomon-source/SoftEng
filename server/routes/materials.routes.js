/**
 * Materials and live prices.
 *
 * Read: any signed-in user. Write: Admin only (enforced both by RLS and by the
 * requireAdmin middleware, so a Staff account cannot change prices).
 *
 * Prices are intended to come from the Wilcon Depot catalogue. Until the live
 * connector is enabled, POST /refresh records a manual refresh event and stamps
 * every material with a new "last updated" time — which is exactly what the
 * Materials and Prices screen displays.
 */
import { Router } from 'express';
import { asyncHandler, badRequest, created, notFound, ok, translateDbError } from '../lib/http.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { logActivity } from '../lib/activity.js';
import { WORK_TYPES, escapePostgrestTerm, sanitizeString, validate } from '../lib/validation.js';

const router = Router();

const MATERIAL_RULES = {
  work_type: { label: 'Work', required: true, type: 'enum', values: WORK_TYPES },
  name: { label: 'Material name', required: true, type: 'string', minLength: 2, maxLength: 160 },
  brand: { label: 'Brand', type: 'string', maxLength: 80, default: '' },
  sku: { label: 'SKU', type: 'string', maxLength: 40 },
  unit: {
    label: 'Unit', required: true, type: 'enum',
    values: ['pc', 'sqm', 'sqft', 'lm', 'm', 'bag', 'kg', 'set', 'roll', 'gal', 'ltr', 'box', 'length', 'sheet', 'cu.m', 'lot'],
  },
  unit_price: { label: 'Unit price', required: true, type: 'number', min: 0, max: 100000000 },
  cost_factor: { label: 'Cost factor', type: 'number', min: 0.1, max: 5 },
  supplier: { label: 'Supplier', type: 'string', maxLength: 80, default: 'Wilcon Depot' },
  source_url: { label: 'Source link', type: 'string', maxLength: 300 },
  thumbnail_url: { label: 'Thumbnail link', type: 'string', maxLength: 300 },
  style_variant: { label: 'Style variant', type: 'string', maxLength: 80 },
  notes: { label: 'Notes', type: 'string', maxLength: 300 },
  is_active: { label: 'Active', type: 'boolean', default: true },
};

// ---------------------------------------------------------------------------
// GET /api/materials
// ---------------------------------------------------------------------------
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(5, Number.parseInt(req.query.pageSize, 10) || 25));
    const workType = sanitizeString(req.query.work_type || '', { maxLength: 40 });
    const keyword = escapePostgrestTerm(sanitizeString(req.query.keyword || '', { maxLength: 80 }));
    const includeInactive = String(req.query.include_inactive || '') === 'true';

    let query = req.db
      .from('materials')
      .select('*', { count: 'exact' })
      .order('work_type')
      .order('name');

    if (WORK_TYPES.includes(workType)) query = query.eq('work_type', workType);
    if (!includeInactive) query = query.eq('is_active', true);
    if (keyword) {
      query = query.or(`name.ilike.%${keyword}%,brand.ilike.%${keyword}%,sku.ilike.%${keyword}%`);
    }

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query.range(from, from + pageSize - 1);
    if (error) throw translateDbError(error);

    return ok(res, {
      rows: data || [],
      page,
      pageSize,
      total: count ?? 0,
      totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/materials/summary  - headline figures for the prices screen
// ---------------------------------------------------------------------------
router.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [counts, latest, refreshLog] = await Promise.all([
      req.db.from('materials').select('work_type', { count: 'exact' }).eq('is_active', true),
      req.db.from('materials').select('last_updated_at').order('last_updated_at', { ascending: false }).limit(1),
      req.db.from('price_refresh_log')
        .select('id, source, status, materials_updated, message, created_at')
        .order('created_at', { ascending: false }).limit(5),
    ]);

    if (counts.error) throw translateDbError(counts.error);

    return ok(res, {
      total_materials: counts.count ?? 0,
      last_updated_at: latest.data?.[0]?.last_updated_at ?? null,
      refresh_log: refreshLog.data ?? [],
      source: 'Wilcon Depot',
      basis: 'Fajardo - Simplified Construction Estimate',
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/materials  (Admin)
// ---------------------------------------------------------------------------
router.post(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, MATERIAL_RULES);
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const { data, error } = await req.db
      .from('materials')
      .insert({
        ...value,
        unit_price: value.unit_price ?? 0,
        cost_factor: value.cost_factor ?? 1,
        updated_by: req.user.id,
        last_updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw translateDbError(error);

    await logActivity(req.db, {
      actor: req.user,
      action: 'created material',
      entityType: 'material',
      entityId: data.id,
      summary: `Material "${data.name}" (${data.brand || 'no brand'}) added at PHP ${data.unit_price} per ${data.unit}.`,
    });

    return created(res, data);
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/materials/:id  (Admin)
// ---------------------------------------------------------------------------
router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const rules = Object.fromEntries(
      Object.entries(MATERIAL_RULES).map(([key, rule]) => [key, { ...rule, required: false }]),
    );
    const { valid, errors, value } = validate(req.body, rules);
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const patch = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null));
    if (!Object.keys(patch).length) throw badRequest('There is nothing to update.');

    patch.updated_by = req.user.id;
    patch.last_updated_at = new Date().toISOString();

    const { data, error } = await req.db
      .from('materials')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error) throw translateDbError(error);
    if (!data) throw notFound('That material could not be found.');

    await logActivity(req.db, {
      actor: req.user,
      action: 'updated price',
      entityType: 'material',
      entityId: data.id,
      summary: `Price for "${data.name}" set to PHP ${data.unit_price} per ${data.unit}.`,
    });

    return ok(res, data);
  }),
);

// ---------------------------------------------------------------------------
// DELETE /api/materials/:id  (Admin) - soft delete, keeps quotation history
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { data, error } = await req.db
      .from('materials')
      .update({ is_active: false, updated_by: req.user.id })
      .eq('id', req.params.id)
      .select('id, name')
      .maybeSingle();

    if (error) throw translateDbError(error);
    if (!data) throw notFound('That material could not be found.');

    await logActivity(req.db, {
      actor: req.user,
      action: 'retired material',
      entityType: 'material',
      entityId: data.id,
      summary: `Material "${data.name}" was retired from the catalogue.`,
    });

    return ok(res, { deactivated: true, id: data.id });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/materials/refresh  (Admin) - "Refresh prices from Wilcon"
// ---------------------------------------------------------------------------
router.post(
  '/refresh',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { data: materials, error } = await req.db
      .from('materials')
      .select('id')
      .eq('is_active', true);

    if (error) throw translateDbError(error);

    const stamp = new Date().toISOString();
    const count = materials?.length ?? 0;

    if (count) {
      const { error: updateError } = await req.db
        .from('materials')
        .update({ last_updated_at: stamp, updated_by: req.user.id })
        .eq('is_active', true);
      if (updateError) throw translateDbError(updateError);
    }

    const { data: logRow, error: logError } = await req.db
      .from('price_refresh_log')
      .insert({
        source: 'wilcon',
        status: 'manual',
        materials_updated: count,
        message: 'Prices re-stamped manually. Connect the Wilcon feed to import live prices.',
        triggered_by: req.user.id,
      })
      .select()
      .single();

    if (logError) throw translateDbError(logError);

    await logActivity(req.db, {
      actor: req.user,
      action: 'refreshed prices',
      entityType: 'material',
      summary: `Price refresh triggered for ${count} materials.`,
    });

    return ok(res, { last_updated_at: stamp, materials_updated: count, log: logRow });
  }),
);

export default router;
