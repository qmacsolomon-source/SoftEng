/**
 * Quotation routes.
 *
 *  POST /api/quotations/preview/quick     live estimate, nothing saved
 *  POST /api/quotations/preview/detailed  live estimate, nothing saved
 *  POST /api/quotations/quick             create a Quick Quotation
 *  POST /api/quotations/detailed          create a Customized Quotation
 *  GET  /api/quotations                   searchable, filterable, paged list
 *  GET  /api/quotations/meta              work types, packages, materials, styles
 *  GET  /api/quotations/export.csv        CSV export of the current filter
 *  GET  /api/quotations/:id               full detail with line items
 *  PATCH  /api/quotations/:id             status / remarks / validity
 *  DELETE /api/quotations/:id             Admin only
 */
import { Router } from 'express';
import { asyncHandler, badRequest, created, notFound, ok, translateDbError } from '../lib/http.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { MIME_GROUPS, assertFileAllowed, storeUpload, upload } from '../middleware/upload.js';
import { logActivity } from '../lib/activity.js';
import {
  PROJECT_TYPES,
  QUOTATION_STATUSES,
  QUOTATION_TYPES,
  WORK_LABELS,
  WORK_TYPES,
  escapePostgrestTerm,
  readFilters,
  sanitizeString,
  todayManila,
  validate,
} from '../lib/validation.js';
import { DEFAULT_LABOR_PCT, buildDetailedBreakdown, buildQuickBreakdown } from '../lib/estimation.js';

const router = Router();

const MONEY_FIELDS = [
  'subtotal', 'labor_amount', 'contingency_amount', 'total_amount',
];

// ---------------------------------------------------------------------------
// Shared loaders
// ---------------------------------------------------------------------------

async function loadPackageWithItems(db, packageCode) {
  const { data: pkg, error } = await db
    .from('finish_packages')
    .select('id, code, name, description, is_active')
    .eq('code', packageCode)
    .maybeSingle();

  if (error) throw translateDbError(error);
  if (!pkg) throw badRequest('Choose a valid finish package.', { finish_package: 'That finish package does not exist.' });

  const { data: items, error: itemError } = await db
    .from('finish_package_items')
    .select('work_type, material_id, description, brand, style_variant, unit, unit_price, rate_per_sqm, sort_order')
    .eq('finish_package_id', pkg.id)
    .order('sort_order');

  if (itemError) throw translateDbError(itemError);
  return { pkg, items: items || [] };
}

async function loadMaterialsByIds(db, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();

  const { data, error } = await db
    .from('materials')
    .select('id, work_type, name, brand, unit, unit_price, cost_factor, style_variant, thumbnail_url, is_active')
    .in('id', unique);

  if (error) throw translateDbError(error);
  return new Map((data || []).map((row) => [row.id, row]));
}

async function loadStyleOptions(db) {
  const { data, error } = await db
    .from('style_options')
    .select('work_type, code, label, description, multiplier, sort_order')
    .eq('is_active', true)
    .order('sort_order');

  if (error) throw translateDbError(error);
  const grouped = {};
  for (const row of data || []) {
    (grouped[row.work_type] ||= []).push(row);
  }
  return grouped;
}

async function generateReference(db, scope, prefix) {
  const year = todayManila().slice(0, 4);
  const { data, error } = await db.rpc('next_doc_number', { p_scope: scope, p_period: year });

  if (error || !data) {
    // Fallback so a quotation can still be created if the counter is missing.
    return `${prefix}-${year}-${String(Date.now()).slice(-5)}`;
  }
  return `${prefix}-${year}-${String(data).padStart(4, '0')}`;
}

/** Resolves the shared quick-quotation form fields into a validated object. */
function validateQuickFields(body) {
  return validate(body, {
    client_name: { label: 'Client full name', required: true, type: 'string', minLength: 2, maxLength: 60 },
    client_email: { label: 'Email address', required: true, type: 'email' },
    client_phone: { label: 'Contact number', required: true, type: 'phone' },
    project_name: { label: 'Project name', type: 'string', maxLength: 160 },
    project_location: { label: 'Project location', required: true, type: 'string', minLength: 3, maxLength: 160 },
    project_type: { label: 'Project type', required: true, type: 'enum', values: PROJECT_TYPES },
    floor_area_sqm: { label: 'Floor area', required: true, type: 'number', min: 10, max: 5000 },
    number_of_floors: { label: 'Number of floors', required: true, type: 'int', min: 1, max: 20 },
    finish_package: { label: 'Finish package', required: true, type: 'enum', values: ['standard', 'elegant', 'luxury', 'bare'] },
    works_included: { label: 'Works included', required: true, type: 'array', values: WORK_TYPES, minItems: 1 },
    target_start_date: { label: 'Target start date', type: 'date', notPast: true },
    remarks: { label: 'Remarks', type: 'string', maxLength: 300 },
    include_labor: { label: 'Include labour cost', type: 'boolean', default: true },
    labor_pct: { label: 'Labour percentage', type: 'number', min: 0, max: 100, default: DEFAULT_LABOR_PCT },
    contingency_pct: { label: 'Contingency percentage', type: 'number', min: 0, max: 20, default: 0 },
    validity_date: { label: 'Validity date', type: 'date' },
    client_id: { label: 'Client', type: 'uuid' },
  });
}

/** Resolves the customized-quotation fields, including per-work selections. */
async function validateDetailedFields(db, body, { preview = false } = {}) {
  const base = validate(body, {
    client_name: {
      label: 'Client name', required: !preview, type: 'string', minLength: 2, maxLength: 60,
    },
    client_email: { label: 'Email address', type: 'email' },
    client_phone: { label: 'Contact number', type: 'phone' },
    client_id: { label: 'Client', type: 'uuid' },
    project_name: {
      label: 'Project name', required: !preview, type: 'string', minLength: 2, maxLength: 160,
    },
    project_location: { label: 'Project location', type: 'string', maxLength: 160 },
    project_type: { label: 'Project type', type: 'enum', values: PROJECT_TYPES },
    floor_area_sqm: { label: 'Floor area', required: true, type: 'number', min: 10, max: 5000 },
    number_of_floors: { label: 'Number of floors', type: 'int', min: 1, max: 20, default: 1 },
    base_finish_level: { label: 'Base finish level', required: true, type: 'enum', values: ['standard', 'elegant', 'luxury', 'bare'] },
    contingency_pct: { label: 'Contingency percentage', required: true, type: 'number', min: 0, max: 20 },
    include_labor: { label: 'Include labour cost', type: 'boolean', default: true },
    labor_pct: { label: 'Labour percentage', type: 'number', min: 0, max: 100, default: DEFAULT_LABOR_PCT },
    validity_date: { label: 'Quotation validity date', type: 'date', notPast: !preview },
    remarks: { label: 'Notes', type: 'string', maxLength: 300 },
  });

  const errors = { ...base.errors };

  // Per-work material and style selections arrive as small JSON objects.
  let materials = {};
  let styles = {};
  for (const [raw, key] of [[body.materials, 'materials'], [body.styles, 'styles']]) {
    if (!raw) continue;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (key === 'materials') materials = parsed; else styles = parsed;
      }
    } catch {
      errors[key] = 'The material or style selection could not be read. Please reload the page and try again.';
    }
  }

  const materialIds = WORK_TYPES.map((w) => materials[w]).filter(Boolean);
  const materialMap = await loadMaterialsByIds(db, materialIds);
  const styleOptions = await loadStyleOptions(db);

  const selections = {};
  for (const workType of WORK_TYPES) {
    const materialId = sanitizeString(materials[workType] || '', { maxLength: 40 });
    if (!materialId) {
      // On a live preview it is normal for the user not to have chosen yet.
      if (!preview) errors[`materials.${workType}`] = `Choose a material for ${WORK_LABELS[workType]}.`;
      continue;
    }
    const material = materialMap.get(materialId);
    if (!material) {
      if (!preview) errors[`materials.${workType}`] = `The material chosen for ${WORK_LABELS[workType]} is no longer available.`;
      continue;
    }
    if (material.work_type !== workType) {
      if (!preview) errors[`materials.${workType}`] = `That material does not belong to ${WORK_LABELS[workType]}.`;
      continue;
    }

    const options = styleOptions[workType] || [];
    const requestedStyle = sanitizeString(styles[workType] || '', { maxLength: 60 });
    const style = options.find((o) => o.code === requestedStyle) || options[0] || null;

    if (requestedStyle && !style) {
      if (!preview) errors[`styles.${workType}`] = `Choose a valid style for ${WORK_LABELS[workType]}.`;
      continue;
    }

    selections[workType] = {
      material_id: material.id,
      name: material.name,
      brand: material.brand,
      unit_price: Number(material.unit_price) || 0,
      cost_factor: Number(material.cost_factor) || 1,
      style_variant: material.style_variant,
      style_code: style?.code ?? null,
      style_label: style?.label ?? null,
      style_multiplier: Number(style?.multiplier) || 1,
    };
  }

  return { valid: Object.keys(errors).length === 0, errors, value: base.value, selections };
}

function payloadToRow(value, selections, totals, items, extra) {
  return {
    reference_no: extra.reference_no,
    quotation_type: extra.quotation_type,
    status: 'draft',
    client_id: value.client_id || null,
    client_name: value.client_name,
    client_email: value.client_email || null,
    client_phone: value.client_phone || null,
    project_name: value.project_name || null,
    project_location: value.project_location || null,
    project_type: value.project_type || null,
    floor_area_sqm: value.floor_area_sqm,
    number_of_floors: value.number_of_floors || 1,
    finish_package_id: extra.finish_package_id || null,
    base_finish_level: extra.base_finish_level || null,
    works_included: extra.works_included,
    target_start_date: value.target_start_date || null,
    validity_date: value.validity_date || null,
    contingency_pct: value.contingency_pct ?? 0,
    include_labor: value.include_labor !== false,
    labor_pct: value.labor_pct ?? DEFAULT_LABOR_PCT,
    subtotal: totals.subtotal,
    contingency_amount: totals.contingency_amount,
    labor_amount: totals.labor_amount,
    total_amount: totals.total_amount,
    remarks: value.remarks || null,
    price_source_at: extra.price_source_at,
    created_by: extra.created_by,
    created_by_name: extra.created_by_name,
  };
}

function itemsToRows(quotationId, items) {
  return items.map((item, index) => ({
    quotation_id: quotationId,
    work_type: item.work_type,
    material_id: item.material_id,
    description: item.description,
    brand: item.brand || '',
    style_variant: item.style_variant || null,
    unit: item.unit || 'sqm',
    quantity: item.quantity,
    unit_price: item.unit_price,
    rate_per_sqm: item.rate_per_sqm,
    line_total: item.line_total,
    sort_order: item.sort_order ?? index + 1,
  }));
}

// ---------------------------------------------------------------------------
// GET /api/quotations/meta  - everything the two quotation forms need
// ---------------------------------------------------------------------------
router.get(
  '/meta',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [packages, materials, styles, clients] = await Promise.all([
      req.db.from('finish_packages')
        .select('id, code, name, description, target_market, sort_order')
        .eq('is_active', true).order('sort_order'),
      req.db.from('materials')
        .select('id, work_type, name, brand, sku, unit, unit_price, cost_factor, style_variant, thumbnail_url, supplier, last_updated_at')
        .eq('is_active', true).order('work_type').order('name'),
      req.db.from('style_options')
        .select('work_type, code, label, description, multiplier, sort_order')
        .eq('is_active', true).order('sort_order'),
      req.db.from('clients').select('id, full_name, email, phone, address').order('full_name'),
    ]);

    for (const result of [packages, materials, styles, clients]) {
      if (result.error) throw translateDbError(result.error);
    }

    const packageItems = await req.db
      .from('finish_package_items')
      .select('finish_package_id, work_type, rate_per_sqm, sort_order')
      .order('sort_order');
    if (packageItems.error) throw translateDbError(packageItems.error);

    const materialsByWork = {};
    for (const material of materials.data || []) {
      (materialsByWork[material.work_type] ||= []).push(material);
    }

    const stylesByWork = {};
    for (const style of styles.data || []) {
      (stylesByWork[style.work_type] ||= []).push(style);
    }

    return ok(res, {
      work_types: WORK_TYPES.map((code) => ({ code, label: WORK_LABELS[code] })),
      project_types: PROJECT_TYPES,
      statuses: QUOTATION_STATUSES,
      quotation_types: QUOTATION_TYPES,
      finish_packages: packages.data || [],
      package_items: packageItems.data || [],
      materials_by_work: materialsByWork,
      styles_by_work: stylesByWork,
      clients: clients.data || [],
      default_labor_pct: DEFAULT_LABOR_PCT,
      price_source_at: (materials.data || []).reduce(
        (latest, m) => (!latest || m.last_updated_at > latest ? m.last_updated_at : latest),
        null,
      ),
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/quotations/preview/quick  - live total, nothing persisted
// ---------------------------------------------------------------------------
router.post(
  '/preview/quick',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, {
      floor_area_sqm: { label: 'Floor area', required: true, type: 'number', min: 10, max: 5000 },
      finish_package: { label: 'Finish package', required: true, type: 'enum', values: ['standard', 'elegant', 'luxury', 'bare'] },
      works_included: { label: 'Works included', type: 'array', values: WORK_TYPES },
      include_labor: { label: 'Include labour cost', type: 'boolean', default: true },
      labor_pct: { label: 'Labour percentage', type: 'number', min: 0, max: 100, default: DEFAULT_LABOR_PCT },
      contingency_pct: { label: 'Contingency percentage', type: 'number', min: 0, max: 20, default: 0 },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const { pkg, items } = await loadPackageWithItems(req.db, value.finish_package);
    const breakdown = buildQuickBreakdown({
      floorArea: value.floor_area_sqm,
      worksIncluded: value.works_included?.length ? value.works_included : WORK_TYPES,
      packageItems: items,
      includeLabor: value.include_labor !== false,
      laborPct: value.labor_pct ?? DEFAULT_LABOR_PCT,
      contingencyPct: value.contingency_pct ?? 0,
    });

    return ok(res, { package: pkg, ...breakdown });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/quotations/preview/detailed  - live total, nothing persisted
// ---------------------------------------------------------------------------
router.post(
  '/preview/detailed',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await validateDetailedFields(req.db, req.body, { preview: true });
    if (!result.valid) throw badRequest('Please correct the highlighted fields.', result.errors);

    const { items: packageItems } = await loadPackageWithItems(req.db, result.value.base_finish_level);
    const baseRates = Object.fromEntries(packageItems.map((row) => [row.work_type, row.rate_per_sqm]));

    const breakdown = buildDetailedBreakdown({
      floorArea: result.value.floor_area_sqm,
      baseRates,
      selections: result.selections,
      includeLabor: result.value.include_labor !== false,
      laborPct: result.value.labor_pct ?? DEFAULT_LABOR_PCT,
      contingencyPct: result.value.contingency_pct ?? 0,
    });

    return ok(res, breakdown);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/quotations/quick
// ---------------------------------------------------------------------------
router.post(
  '/quick',
  requireAuth,
  upload.single('site_plan'),
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validateQuickFields(req.body);
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    if (req.file) assertFileAllowed(req.file, MIME_GROUPS.sitePlan, 'Site plan');

    const { pkg, items } = await loadPackageWithItems(req.db, value.finish_package);
    const breakdown = buildQuickBreakdown({
      floorArea: value.floor_area_sqm,
      worksIncluded: value.works_included,
      packageItems: items,
      includeLabor: value.include_labor !== false,
      laborPct: value.labor_pct ?? DEFAULT_LABOR_PCT,
      contingencyPct: value.contingency_pct ?? 0,
    });

    if (!breakdown.items.length) {
      throw badRequest('This finish package has no rates configured yet. Please contact the administrator.', {
        finish_package: 'No rates are set up for that package.',
      });
    }

    const reference = await generateReference(req.db, 'QTE', 'QTE');

    const { data: inserted, error: insertError } = await req.db
      .from('quotations')
      .insert(payloadToRow(value, null, breakdown, breakdown.items, {
        reference_no: reference,
        quotation_type: 'quick',
        finish_package_id: pkg.id,
        works_included: value.works_included,
        price_source_at: new Date().toISOString(),
        created_by: req.user.id,
        created_by_name: req.user.profile.full_name || req.user.email,
      }))
      .select('id, reference_no')
      .single();

    if (insertError) throw translateDbError(insertError);

    const { error: itemsError } = await req.db
      .from('quotation_items')
      .insert(itemsToRows(inserted.id, breakdown.items));
    if (itemsError) {
      await req.db.from('quotations').delete().eq('id', inserted.id);
      throw translateDbError(itemsError);
    }

    let sitePlanPath = null;
    if (req.file) {
      sitePlanPath = await storeUpload(req.db, 'site-plans', req.user.id, req.file);
      await req.db.from('quotations').update({ site_plan_path: sitePlanPath }).eq('id', inserted.id);
    }

    await logActivity(req.db, {
      actor: req.user,
      action: 'created quotation',
      entityType: 'quotation',
      entityId: inserted.id,
      summary: `Quick Quotation ${inserted.reference_no} for ${value.client_name} (${value.floor_area_sqm} sqm, ${pkg.name}).`,
    });

    return created(res, { id: inserted.id, reference_no: inserted.reference_no, ...breakdown });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/quotations/detailed
// ---------------------------------------------------------------------------
router.post(
  '/detailed',
  requireAuth,
  upload.single('attachment'),
  asyncHandler(async (req, res) => {
    const result = await validateDetailedFields(req.db, req.body);
    if (!result.valid) throw badRequest('Please correct the highlighted fields.', result.errors);

    if (req.file) assertFileAllowed(req.file, MIME_GROUPS.attachment, 'Attachment');

    const { pkg, items: packageItems } = await loadPackageWithItems(req.db, result.value.base_finish_level);
    const baseRates = Object.fromEntries(packageItems.map((row) => [row.work_type, row.rate_per_sqm]));

    const breakdown = buildDetailedBreakdown({
      floorArea: result.value.floor_area_sqm,
      baseRates,
      selections: result.selections,
      includeLabor: result.value.include_labor !== false,
      laborPct: result.value.labor_pct ?? DEFAULT_LABOR_PCT,
      contingencyPct: result.value.contingency_pct ?? 0,
    });

    if (breakdown.missingBaseRates.length) {
      throw badRequest(
        `The base finish level "${pkg.name}" has no rate for: ${breakdown.missingBaseRates.map((w) => WORK_LABELS[w]).join(', ')}.`,
        { base_finish_level: 'That base finish level is incomplete. Please choose another.' },
      );
    }

    const reference = await generateReference(req.db, 'QTE', 'QTE');

    const { data: inserted, error: insertError } = await req.db
      .from('quotations')
      .insert(payloadToRow(result.value, result.selections, breakdown, breakdown.items, {
        reference_no: reference,
        quotation_type: 'detailed',
        finish_package_id: pkg.id,
        base_finish_level: result.value.base_finish_level,
        works_included: breakdown.items.map((i) => i.work_type),
        price_source_at: new Date().toISOString(),
        created_by: req.user.id,
        created_by_name: req.user.profile.full_name || req.user.email,
      }))
      .select('id, reference_no')
      .single();

    if (insertError) throw translateDbError(insertError);

    const { error: itemsError } = await req.db
      .from('quotation_items')
      .insert(itemsToRows(inserted.id, breakdown.items));
    if (itemsError) {
      await req.db.from('quotations').delete().eq('id', inserted.id);
      throw translateDbError(itemsError);
    }

    let attachmentPath = null;
    if (req.file) {
      attachmentPath = await storeUpload(req.db, 'attachments', req.user.id, req.file);
      await req.db.from('quotations').update({ attachment_path: attachmentPath }).eq('id', inserted.id);
    }

    await logActivity(req.db, {
      actor: req.user,
      action: 'created quotation',
      entityType: 'quotation',
      entityId: inserted.id,
      summary: `Customized Quotation ${inserted.reference_no} for ${result.value.client_name} (${result.value.floor_area_sqm} sqm).`,
    });

    return created(res, { id: inserted.id, reference_no: inserted.reference_no, ...breakdown });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/quotations  - list with search, filters, sorting and paging
// ---------------------------------------------------------------------------
const SORTABLE = {
  created_at: 'created_at',
  reference_no: 'reference_no',
  client_name: 'client_name',
  total_amount: 'total_amount',
  floor_area_sqm: 'floor_area_sqm',
  status: 'status',
};

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const filters = readFilters(req.query);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(5, Number.parseInt(req.query.pageSize, 10) || 15));
    const sortKey = SORTABLE[req.query.sort] || 'created_at';
    const ascending = String(req.query.dir || 'desc').toLowerCase() === 'asc';

    let query = req.db.from('quotations').select(
      'id, reference_no, quotation_type, status, client_name, client_email, client_phone, project_name, '
      + 'project_location, project_type, floor_area_sqm, number_of_floors, total_amount, subtotal, '
      + 'contingency_pct, validity_date, target_start_date, created_at, updated_at, created_by_name, '
      + 'finish_packages(code, name)',
      { count: 'exact' },
    );

    if (filters.keyword) {
      const term = escapePostgrestTerm(filters.keyword);
      if (term) {
        query = query.or(
          `reference_no.ilike.%${term}%,client_name.ilike.%${term}%,project_name.ilike.%${term}%,project_location.ilike.%${term}%`,
        );
      }
    }
    if (filters.status && QUOTATION_STATUSES.includes(filters.status)) query = query.eq('status', filters.status);
    if (filters.type && QUOTATION_TYPES.includes(filters.type)) query = query.eq('quotation_type', filters.type);
    if (filters.from) query = query.gte('created_at', `${filters.from}T00:00:00Z`);
    if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59Z`);

    if (filters.package) {
      const { data: pkg } = await req.db
        .from('finish_packages').select('id').eq('code', filters.package).maybeSingle();
      if (pkg) query = query.eq('finish_package_id', pkg.id);
      else query = query.eq('finish_package_id', '00000000-0000-0000-0000-000000000000');
    }

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query
      .order(sortKey, { ascending })
      .range(from, from + pageSize - 1);

    if (error) throw translateDbError(error);

    const rows = (data || []).map((row) => ({
      ...row,
      finish_package_code: row.finish_packages?.code ?? null,
      finish_package_name: row.finish_packages?.name ?? null,
      finish_packages: undefined,
    }));

    return ok(res, {
      rows,
      page,
      pageSize,
      total: count ?? 0,
      totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/quotations/export.csv
// ---------------------------------------------------------------------------
router.get(
  '/export.csv',
  requireAuth,
  asyncHandler(async (req, res) => {
    const filters = readFilters(req.query);
    const { data, error } = await req.db
      .from('v_quotation_list')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) throw translateDbError(error);

    const header = [
      'Reference', 'Type', 'Status', 'Client', 'Email', 'Phone', 'Project', 'Location',
      'Floor area (sqm)', 'Finish package', 'Subtotal', 'Contingency %', 'Total', 'Created',
    ];

    const escapeCsv = (value) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const lines = [header.join(',')];
    for (const row of data || []) {
      lines.push([
        row.reference_no, row.quotation_type, row.status, row.client_name, row.client_email,
        row.client_phone, row.project_name, row.project_location, row.floor_area_sqm,
        row.finish_package_name, row.subtotal, row.contingency_pct, row.total_amount,
        row.created_at,
      ].map(escapeCsv).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="apa-quotations.csv"');
    return res.send(`\uFEFF${lines.join('\r\n')}`);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/quotations/:id
// ---------------------------------------------------------------------------
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data: quotation, error } = await req.db
      .from('quotations')
      .select('*, finish_packages(id, code, name, description)')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw translateDbError(error);
    if (!quotation) throw notFound('That quotation could not be found.');

    const { data: items, error: itemError } = await req.db
      .from('quotation_items')
      .select('*')
      .eq('quotation_id', req.params.id)
      .order('sort_order');
    if (itemError) throw translateDbError(itemError);

    let client = null;
    if (quotation.client_id) {
      const { data: clientRow } = await req.db
        .from('clients').select('*').eq('id', quotation.client_id).maybeSingle();
      client = clientRow ?? null;
    }

    const { data: project } = await req.db
      .from('projects').select('id, project_code, name, status, progress_pct')
      .eq('quotation_id', quotation.id).maybeSingle();

    return ok(res, {
      quotation: { ...quotation, finish_package: quotation.finish_packages ?? null, finish_packages: undefined },
      items: items || [],
      client,
      project: project ?? null,
    });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/quotations/:id  - typically the status change (draft/sent/...)
// ---------------------------------------------------------------------------
router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, {
      status: { label: 'Status', type: 'enum', values: QUOTATION_STATUSES },
      remarks: { label: 'Remarks', type: 'string', maxLength: 300 },
      validity_date: { label: 'Validity date', type: 'date' },
      project_name: { label: 'Project name', type: 'string', maxLength: 160 },
      project_location: { label: 'Project location', type: 'string', maxLength: 160 },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const patch = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null));
    if (!Object.keys(patch).length) throw badRequest('There is nothing to update.');

    const { data, error } = await req.db
      .from('quotations')
      .update(patch)
      .eq('id', req.params.id)
      .select('id, reference_no, status')
      .maybeSingle();

    if (error) throw translateDbError(error);
    if (!data) throw notFound('That quotation could not be found.');

    await logActivity(req.db, {
      actor: req.user,
      action: 'updated quotation',
      entityType: 'quotation',
      entityId: data.id,
      summary: `Quotation ${data.reference_no} updated${patch.status ? ` to ${patch.status}` : ''}.`,
    });

    return ok(res, data);
  }),
);

// ---------------------------------------------------------------------------
// DELETE /api/quotations/:id  - Admin only
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { data, error } = await req.db
      .from('quotations')
      .delete()
      .eq('id', req.params.id)
      .select('id, reference_no')
      .maybeSingle();

    if (error) throw translateDbError(error);
    if (!data) throw notFound('That quotation could not be found.');

    await logActivity(req.db, {
      actor: req.user,
      action: 'deleted quotation',
      entityType: 'quotation',
      entityId: data.id,
      summary: `Quotation ${data.reference_no} was deleted.`,
    });

    return ok(res, { deleted: true, id: data.id });
  }),
);

export default router;
export { MONEY_FIELDS };
