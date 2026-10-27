/**
 * Project tracking routes: projects, milestone timeline and status updates.
 */
import { Router } from 'express';
import { asyncHandler, badRequest, created, notFound, ok, translateDbError } from '../lib/http.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { MIME_GROUPS, assertFileAllowed, signedUrl, storeUpload, upload } from '../middleware/upload.js';
import { logActivity } from '../lib/activity.js';
import {
  PROJECT_STATUSES,
  escapePostgrestTerm,
  readFilters,
  sanitizeString,
  todayManila,
  validate,
} from '../lib/validation.js';

const router = Router();

/** Suggested milestone names shown in the Project Status Update form. */
export const MILESTONES = {
  planning: [
    'Site inspection completed',
    'Design and plans approved',
    'Building permit secured',
    'Materials specified and approved',
    'Contract signed',
  ],
  ongoing: [
    'Site clearing and layout',
    'Excavation and footing',
    'Column and beam framing',
    'Wall construction',
    'Roof framing and roofing',
    'Ceiling installation',
    'Flooring installation',
    'Doors and windows installed',
    'Toilet and bath fit-out',
    'Kitchen fit-out',
    'Electrical rough-in',
    'Electrical fixtures and lighting',
    'Painting and finishing',
    'Final cleaning and punch list',
  ],
  completed: [
    'Client inspection and acceptance',
    'Punch list items closed',
    'As-built drawings issued',
    'Warranty documents turned over',
    'Project closed',
  ],
};

const SORTABLE = {
  created_at: 'created_at',
  project_code: 'project_code',
  name: 'name',
  status: 'status',
  progress_pct: 'progress_pct',
  contract_amount: 'contract_amount',
};

// ---------------------------------------------------------------------------
// GET /api/projects/options  - data for the status-update dropdowns
// ---------------------------------------------------------------------------
router.get(
  '/options',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await req.db
      .from('projects')
      .select('id, project_code, name, status, progress_pct')
      .order('created_at', { ascending: false });

    if (error) throw translateDbError(error);

    return ok(res, {
      projects: data || [],
      statuses: PROJECT_STATUSES,
      milestones: MILESTONES,
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/projects/summary
// ---------------------------------------------------------------------------
router.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [all, values] = await Promise.all([
      req.db.from('projects').select('status, progress_pct'),
      req.db.from('projects').select('contract_amount').neq('status', 'rejected'),
    ]);

    if (all.error) throw translateDbError(all.error);

    const rows = all.data || [];
    const count = (status) => rows.filter((r) => r.status === status).length;

    return ok(res, {
      total: rows.length,
      planning: count('planning'),
      ongoing: count('ongoing'),
      completed: count('completed'),
      active: count('planning') + count('ongoing'),
      average_progress: rows.length
        ? Math.round(rows.reduce((sum, r) => sum + (r.progress_pct || 0), 0) / rows.length)
        : 0,
      contract_value: (values.data || []).reduce((sum, r) => sum + Number(r.contract_amount || 0), 0),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/projects  - searchable list
// ---------------------------------------------------------------------------
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const filters = readFilters(req.query);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(5, Number.parseInt(req.query.pageSize, 10) || 15));
    const sortKey = SORTABLE[req.query.sort] || 'created_at';
    const ascending = String(req.query.dir || 'desc').toLowerCase() === 'asc';

    let query = req.db.from('projects').select('*', { count: 'exact' });

    if (filters.keyword) {
      const term = escapePostgrestTerm(filters.keyword);
      if (term) {
        query = query.or(
          `project_code.ilike.%${term}%,name.ilike.%${term}%,client_name.ilike.%${term}%,location.ilike.%${term}%`,
        );
      }
    }
    if (filters.status && PROJECT_STATUSES.includes(filters.status)) query = query.eq('status', filters.status);
    if (filters.from) query = query.gte('created_at', `${filters.from}T00:00:00Z`);
    if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59Z`);

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query
      .order(sortKey, { ascending })
      .range(from, from + pageSize - 1);

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
// POST /api/projects
// ---------------------------------------------------------------------------
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, {
      name: { label: 'Project name', required: true, type: 'string', minLength: 2, maxLength: 160 },
      client_name: { label: 'Client name', type: 'string', maxLength: 120 },
      client_id: { label: 'Client', type: 'uuid' },
      location: { label: 'Location', type: 'string', maxLength: 160 },
      quotation_id: { label: 'Quotation', type: 'uuid' },
      status: { label: 'Status', required: true, type: 'enum', values: PROJECT_STATUSES },
      progress_pct: { label: 'Progress', required: true, type: 'int', min: 0, max: 100 },
      floor_area_sqm: { label: 'Floor area', type: 'number', min: 10, max: 5000 },
      contract_amount: { label: 'Contract amount', type: 'number', min: 0, max: 999999999 },
      start_date: { label: 'Start date', type: 'date' },
      target_end_date: { label: 'Target completion', type: 'date' },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    if (value.start_date && value.target_end_date && value.target_end_date < value.start_date) {
      throw badRequest('Please correct the highlighted fields.', {
        target_end_date: 'The target completion date cannot be earlier than the start date.',
      });
    }

    const year = todayManila().slice(0, 4);
    const { data: seq } = await req.db.rpc('next_doc_number', { p_scope: 'PRJ', p_period: year });
    const projectCode = seq ? `PRJ-${year}-${String(seq).padStart(4, '0')}` : `PRJ-${year}-${String(Date.now()).slice(-5)}`;

    const { data, error } = await req.db
      .from('projects')
      .insert({
        project_code: projectCode,
        name: value.name,
        client_id: value.client_id || null,
        client_name: value.client_name || null,
        location: value.location || null,
        quotation_id: value.quotation_id || null,
        status: value.status,
        progress_pct: value.progress_pct ?? 0,
        floor_area_sqm: value.floor_area_sqm ?? null,
        contract_amount: value.contract_amount ?? 0,
        start_date: value.start_date || null,
        target_end_date: value.target_end_date || null,
        created_by: req.user.id,
        created_by_name: req.user.profile.full_name || req.user.email,
      })
      .select()
      .single();

    if (error) throw translateDbError(error);

    await logActivity(req.db, {
      actor: req.user,
      action: 'created project',
      entityType: 'project',
      entityId: data.id,
      summary: `Project ${data.project_code} "${data.name}" was created.`,
    });

    return created(res, data);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/projects/:id  - detail with the full milestone timeline
// ---------------------------------------------------------------------------
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data: project, error } = await req.db
      .from('projects')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw translateDbError(error);
    if (!project) throw notFound('That project could not be found.');

    const { data: updates, error: updateError } = await req.db
      .from('project_status_updates')
      .select('*')
      .eq('project_id', req.params.id)
      .order('milestone_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (updateError) throw translateDbError(updateError);

    const withPhotos = await Promise.all(
      (updates || []).map(async (row) => ({
        ...row,
        photo_url: row.photo_path ? await signedUrl(req.db, 'progress-photos', row.photo_path) : null,
      })),
    );

    let quotation = null;
    if (project.quotation_id) {
      const { data: quoteRow } = await req.db
        .from('quotations')
        .select('id, reference_no, total_amount, floor_area_sqm, status')
        .eq('id', project.quotation_id)
        .maybeSingle();
      quotation = quoteRow ?? null;
    }

    return ok(res, {
      project,
      updates: withPhotos,
      quotation,
      milestones: MILESTONES,
    });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/projects/:id
// ---------------------------------------------------------------------------
router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { valid, errors, value } = validate(req.body, {
      name: { label: 'Project name', type: 'string', minLength: 2, maxLength: 160 },
      client_name: { label: 'Client name', type: 'string', maxLength: 120 },
      location: { label: 'Location', type: 'string', maxLength: 160 },
      status: { label: 'Status', type: 'enum', values: PROJECT_STATUSES },
      progress_pct: { label: 'Progress', type: 'int', min: 0, max: 100 },
      contract_amount: { label: 'Contract amount', type: 'number', min: 0, max: 999999999 },
      start_date: { label: 'Start date', type: 'date' },
      target_end_date: { label: 'Target completion', type: 'date' },
      actual_end_date: { label: 'Actual completion', type: 'date' },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    const patch = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null));
    if (!Object.keys(patch).length) throw badRequest('There is nothing to update.');

    const { data, error } = await req.db
      .from('projects')
      .update(patch)
      .eq('id', req.params.id)
      .select('id, project_code, name, status, progress_pct')
      .maybeSingle();

    if (error) throw translateDbError(error);
    if (!data) throw notFound('That project could not be found.');

    await logActivity(req.db, {
      actor: req.user,
      action: 'updated project',
      entityType: 'project',
      entityId: data.id,
      summary: `Project ${data.project_code} updated${patch.status ? ` to ${patch.status}` : ''}.`,
    });

    return ok(res, data);
  }),
);

// ---------------------------------------------------------------------------
// DELETE /api/projects/:id  (Admin only)
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { data, error } = await req.db
      .from('projects')
      .delete()
      .eq('id', req.params.id)
      .select('id, project_code, name')
      .maybeSingle();

    if (error) throw translateDbError(error);
    if (!data) throw notFound('That project could not be found.');

    await logActivity(req.db, {
      actor: req.user,
      action: 'deleted project',
      entityType: 'project',
      entityId: data.id,
      summary: `Project ${data.project_code} "${data.name}" was deleted.`,
    });

    return ok(res, { deleted: true, id: data.id });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/projects/:id/updates  - SUPPORTING FORM 2 (milestone tracking)
// ---------------------------------------------------------------------------
router.post(
  '/:id/updates',
  requireAuth,
  upload.single('progress_photo'),
  asyncHandler(async (req, res) => {
    const { data: project, error: projectError } = await req.db
      .from('projects')
      .select('id, project_code, name')
      .eq('id', req.params.id)
      .maybeSingle();

    if (projectError) throw translateDbError(projectError);
    if (!project) throw notFound('That project could not be found.');

    if (req.file) assertFileAllowed(req.file, MIME_GROUPS.photo, 'Progress photo');

    const { valid, errors, value } = validate(req.body, {
      status: { label: 'Current status', required: true, type: 'enum', values: PROJECT_STATUSES },
      milestone_name: { label: 'Milestone', required: true, type: 'string', minLength: 2, maxLength: 120 },
      progress_pct: { label: 'Progress percentage', required: true, type: 'int', min: 0, max: 100 },
      milestone_date: { label: 'Milestone date', required: true, type: 'date' },
      time_logged: { label: 'Time logged', type: 'time' },
      remarks: { label: 'Remarks', type: 'string', maxLength: 1000 },
      notify_owner: { label: 'Notify the owner', type: 'boolean', default: false },
    });
    if (!valid) throw badRequest('Please correct the highlighted fields.', errors);

    if (value.status === 'completed' && value.progress_pct !== 100) {
      throw badRequest('Please correct the highlighted fields.', {
        progress_pct: 'A completed project must be recorded at 100% progress.',
      });
    }

    let photoPath = null;
    if (req.file) {
      photoPath = await storeUpload(req.db, 'progress-photos', req.user.id, req.file);
    }

    const { data, error } = await req.db
      .from('project_status_updates')
      .insert({
        project_id: project.id,
        status: value.status,
        milestone_name: value.milestone_name,
        progress_pct: value.progress_pct,
        milestone_date: value.milestone_date,
        time_logged: value.time_logged || null,
        remarks: value.remarks || null,
        photo_path: photoPath,
        notify_owner: value.notify_owner === true,
        updated_by: req.user.id,
        updated_by_name: req.user.profile.full_name || req.user.email,
      })
      .select()
      .single();

    if (error) throw translateDbError(error);

    await logActivity(req.db, {
      actor: req.user,
      action: 'logged milestone',
      entityType: 'status_update',
      entityId: data.id,
      summary: `${project.project_code}: "${value.milestone_name}" at ${value.progress_pct}% (${value.status}).`,
    });

    return created(res, {
      ...data,
      photo_url: photoPath ? await signedUrl(req.db, 'progress-photos', photoPath) : null,
      notify_owner: value.notify_owner === true,
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/projects/:id/updates  - the timeline on its own
// ---------------------------------------------------------------------------
router.get(
  '/:id/updates',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await req.db
      .from('project_status_updates')
      .select('*')
      .eq('project_id', req.params.id)
      .order('milestone_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw translateDbError(error);

    const rows = await Promise.all(
      (data || []).map(async (row) => ({
        ...row,
        photo_url: row.photo_path ? await signedUrl(req.db, 'progress-photos', row.photo_path) : null,
      })),
    );

    return ok(res, { rows });
  }),
);

export default router;
