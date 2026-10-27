/**
 * Dashboard aggregates. Everything is computed from RLS-scoped queries, so a
 * Staff account sees exactly the data it is allowed to see.
 */
import { Router } from 'express';
import { asyncHandler, ok, translateDbError } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { PROJECT_STATUSES } from '../lib/validation.js';

const router = Router();

/** Last six months as [{ key: '2026-05', label: 'May' }] ending with this month. */
function lastSixMonths() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000); // Manila
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({
      key: d.toISOString().slice(0, 7),
      label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
    });
  }
  return months;
}

// ---------------------------------------------------------------------------
// GET /api/dashboard/summary
// ---------------------------------------------------------------------------
router.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sixMonthsAgo = new Date(Date.now() - 184 * 24 * 60 * 60 * 1000).toISOString();

    const [quotations, projects, recentQuotations, recentProjects, activity, milestones] = await Promise.all([
      req.db.from('quotations').select('status, total_amount, created_at'),
      req.db.from('projects').select('status, progress_pct, contract_amount, name, project_code'),
      req.db.from('quotations')
        .select('id, reference_no, client_name, project_name, total_amount, status, created_at, quotation_type')
        .order('created_at', { ascending: false }).limit(5),
      req.db.from('projects')
        .select('id, project_code, name, status, progress_pct, updated_at')
        .order('updated_at', { ascending: false }).limit(5),
      req.db.from('activity_log')
        .select('id, actor_name, action, entity_type, entity_id, summary, created_at')
        .order('created_at', { ascending: false }).limit(10),
      req.db.from('project_status_updates')
        .select('id, project_id, milestone_name, milestone_date, progress_pct, status, updated_by_name')
        .order('milestone_date', { ascending: false }).limit(5),
    ]);

    for (const result of [quotations, projects, recentQuotations, recentProjects, activity, milestones]) {
      if (result.error) throw translateDbError(result.error);
    }

    const quoteRows = quotations.data || [];
    const projectRows = projects.data || [];
    const countBy = (rows, status) => rows.filter((r) => r.status === status).length;

    const months = lastSixMonths();
    const series = months.map((month) => ({
      ...month,
      count: quoteRows.filter((q) => (q.created_at || '').slice(0, 7) === month.key).length,
      value: quoteRows
        .filter((q) => (q.created_at || '').slice(0, 7) === month.key)
        .reduce((sum, q) => sum + Number(q.total_amount || 0), 0),
    }));

    const quotedValue = quoteRows.reduce((sum, q) => sum + Number(q.total_amount || 0), 0);
    const approvedValue = quoteRows
      .filter((q) => q.status === 'approved')
      .reduce((sum, q) => sum + Number(q.total_amount || 0), 0);

    return ok(res, {
      quotations: {
        total: quoteRows.length,
        draft: countBy(quoteRows, 'draft'),
        sent: countBy(quoteRows, 'sent'),
        approved: countBy(quoteRows, 'approved'),
        rejected: countBy(quoteRows, 'rejected'),
        expired: countBy(quoteRows, 'expired'),
        quoted_value: quotedValue,
        approved_value: approvedValue,
        last_30_days: quoteRows.filter((q) => q.created_at >= sixMonthsAgo).length,
      },
      projects: {
        total: projectRows.length,
        planning: countBy(projectRows, 'planning'),
        ongoing: countBy(projectRows, 'ongoing'),
        completed: countBy(projectRows, 'completed'),
        active: projectRows.filter((p) => PROJECT_STATUSES.includes(p.status) && p.status !== 'completed').length,
        contract_value: projectRows.reduce((sum, p) => sum + Number(p.contract_amount || 0), 0),
        average_progress: projectRows.length
          ? Math.round(projectRows.reduce((sum, p) => sum + (p.progress_pct || 0), 0) / projectRows.length)
          : 0,
      },
      series,
      recent_quotations: recentQuotations.data || [],
      recent_projects: recentProjects.data || [],
      recent_activity: activity.data || [],
      upcoming_milestones: milestones.data || [],
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/dashboard/activity
// ---------------------------------------------------------------------------
router.get(
  '/activity',
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(5, Number.parseInt(req.query.pageSize, 10) || 25));
    const from = (page - 1) * pageSize;

    const { data, error, count } = await req.db
      .from('activity_log')
      .select('id, actor_name, action, entity_type, entity_id, summary, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
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

export default router;
