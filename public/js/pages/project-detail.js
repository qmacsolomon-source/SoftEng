/**
 * Project detail - one project, its milestone timeline and its site photos.
 *
 * Reads ?id= and loads GET /api/projects/:id, which answers with the project
 * row, every milestone in newest-first order (each with a short-lived photo
 * URL), the linked quotation and the suggested-milestone lists. The left column
 * is the timeline; the right column is a sticky summary card. Administrators
 * also get a delete action.
 */
import { api } from '../api.js';
import { mountShell } from '../shell.js';
import { session } from '../session.js';
import { bindForm } from '../forms.js';
import { icon } from '../icons.js';
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_ORDER,
  escapeHtml,
  formatDate,
  formatNumber,
  formatPeso,
  getParam,
  qs,
} from '../util.js';
import {
  announce,
  confirmAction,
  createModal,
  detailList,
  progressBar,
  stateHtml,
  statusBadge,
  timeline,
  toastError,
  toastSuccess,
} from '../ui.js';

// Paint the shell first; it throws after redirecting when there is no session.
try {
  await mountShell({
    active: 'projects',
    title: 'Project',
    subtitle: 'Status, milestones and site photos.',
  });
} catch { /* mountShell redirects to sign in */ }

/* --------------------------------------------------------------------------
   Elements and inputs
   -------------------------------------------------------------------------- */
const root = qs('#project-root');
const actionsEl = qs('#detail-actions');
const projectId = getParam('id');

// The three pieces the API returns for this screen.
let project = null;
let updates = [];
let quotation = null;

/* --------------------------------------------------------------------------
   Small formatting helpers
   -------------------------------------------------------------------------- */

/** "09:30:00" -> "09:30". Time is optional, so a blank returns an empty string. */
function timeLabel(value) {
  return value ? String(value).slice(0, 5) : '';
}

/* --------------------------------------------------------------------------
   Loading / missing / error states
   -------------------------------------------------------------------------- */
function loadingHtml() {
  return `
    <div class="card mb-5" aria-busy="true">
      <div class="card__body">
        <div class="skeleton" style="width:150px;height:12px;"></div>
        <div class="skeleton" style="width:60%;height:22px;margin-top:10px;"></div>
        <div class="skeleton" style="width:100%;height:12px;margin-top:18px;"></div>
      </div>
    </div>
    <div class="grid grid--sidebar-right">
      <div class="card"><div class="card__body">
        <div class="skeleton" style="height:14px;"></div>
        <div class="skeleton" style="height:14px;width:80%;margin-top:12px;"></div>
        <div class="skeleton" style="height:14px;width:65%;margin-top:12px;"></div>
      </div></div>
      <div class="card"><div class="card__body">
        <div class="skeleton" style="height:14px;"></div>
        <div class="skeleton" style="height:14px;width:70%;margin-top:12px;"></div>
      </div></div>
    </div>`;
}

function missingIdHtml() {
  return stateHtml({
    iconName: 'empty',
    title: 'No project selected',
    text: 'Choose a project from the tracking list to open its details.',
    actionHtml: '<a class="btn btn--primary" href="/projects.html">Open project tracking</a>',
  });
}

function errorHtml(message) {
  return stateHtml({
    iconName: 'alert',
    title: 'That project could not be loaded',
    text: message,
    actionHtml: '<button type="button" class="btn btn--secondary" data-retry>Try again</button>',
  });
}

/* --------------------------------------------------------------------------
   Toolbar
   -------------------------------------------------------------------------- */
function renderActions() {
  const isAdmin = session.isAdmin();

  actionsEl.innerHTML = `
    <a class="btn btn--secondary" href="/project-status-update.html?project=${encodeURIComponent(project.id)}">
      ${icon('flag', { size: 16 })} Log a status update
    </a>
    <button type="button" class="btn btn--secondary" data-edit>${icon('edit', { size: 16 })} Edit project</button>
    <button type="button" class="btn btn--secondary" data-print>${icon('printer', { size: 16 })} Print</button>
    ${isAdmin ? `<button type="button" class="btn btn--danger" data-delete>${icon('trash', { size: 16 })} Delete project</button>` : ''}`;

  actionsEl.querySelector('[data-edit]').addEventListener('click', openEditModal);
  actionsEl.querySelector('[data-print]').addEventListener('click', () => window.print());
  actionsEl.querySelector('[data-delete]')?.addEventListener('click', deleteProject);
}

/* --------------------------------------------------------------------------
   Identity block
   -------------------------------------------------------------------------- */
function identityHtml() {
  const subtitleParts = [project.client_name, project.location].filter(Boolean).map(escapeHtml).join(' · ');

  return `
    <div class="card mb-5">
      <div class="card__body">
        <p class="font-mono text-muted mb-2">${escapeHtml(project.project_code || '—')}</p>
        <h2 class="mb-2">${escapeHtml(project.name || 'Untitled project')}</h2>
        <div style="display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;">
          ${statusBadge(project.status)}
          <span class="text-soft">${subtitleParts || 'No client or location recorded'}</span>
        </div>
        <div style="margin-top:var(--space-5);">
          ${progressBar(project.progress_pct, project.status, { large: true, showValue: true })}
        </div>
      </div>
    </div>`;
}

/* --------------------------------------------------------------------------
   Timeline (left column)
   -------------------------------------------------------------------------- */
function milestoneItems() {
  return updates.map((row) => ({
    status: row.status,
    title: row.milestone_name || 'Milestone',
    meta: [
      formatDate(row.milestone_date),
      timeLabel(row.time_logged),
      row.updated_by_name ? `by ${row.updated_by_name}` : '',
    ].filter(Boolean).join(' · '),
    body: row.remarks || '',
    photoUrl: row.photo_url || '',
    pct: row.progress_pct,
  }));
}

function timelineHtml() {
  const items = milestoneItems();

  const body = items.length
    ? timeline(items)
    : stateHtml({
      iconName: 'flag',
      title: 'No milestones logged yet',
      text: 'Use "Log a status update" to record site progress.',
      actionHtml: `<a class="btn btn--primary" href="/project-status-update.html?project=${encodeURIComponent(project.id)}">Log a status update</a>`,
    });

  return `
    <div class="card">
      <div class="card__header">
        <div>
          <h3>Milestone timeline</h3>
          <p>${items.length
            ? 'The most recent milestone is shown first.'
            : 'Milestones appear here as they are recorded.'}</p>
        </div>
      </div>
      <div class="card__body">${body}</div>
    </div>`;
}

/* --------------------------------------------------------------------------
   Summary panel (right column)
   -------------------------------------------------------------------------- */
function quotationValue() {
  if (!quotation) return '';
  const total = quotation.total_amount != null ? ` · ${escapeHtml(formatPeso(quotation.total_amount))}` : '';
  return `<a href="/quotation-detail.html?id=${encodeURIComponent(quotation.id)}">${escapeHtml(quotation.reference_no || 'Quotation')}${total}</a>`;
}

function summaryHtml() {
  const rows = [
    ['Client', escapeHtml(project.client_name || '')],
    ['Location', escapeHtml(project.location || '')],
    ['Status', statusBadge(project.status)],
    ['Progress', `${formatNumber(project.progress_pct)}%`],
    ['Contract amount', escapeHtml(formatPeso(project.contract_amount))],
    ['Floor area', project.floor_area_sqm != null ? `${escapeHtml(formatNumber(project.floor_area_sqm))} sqm` : ''],
    ['Start date', project.start_date ? escapeHtml(formatDate(project.start_date)) : ''],
    ['Target completion', project.target_end_date ? escapeHtml(formatDate(project.target_end_date)) : ''],
    ['Actual completion', project.actual_end_date ? escapeHtml(formatDate(project.actual_end_date)) : ''],
    ['Created by', escapeHtml(project.created_by_name || '')],
    ['Created on', project.created_at ? escapeHtml(formatDate(project.created_at)) : ''],
    ['Linked quotation', quotationValue()],
  ];

  return `
    <div class="card card--sticky">
      <div class="card__header">
        <h3>Project details</h3>
      </div>
      <div class="card__body">${detailList(rows)}</div>
    </div>`;
}

/* --------------------------------------------------------------------------
   Site photos
   -------------------------------------------------------------------------- */
function photosHtml() {
  const withPhotos = updates.filter((row) => row.photo_url);

  // No photos means no card at all, so the page stays tidy.
  if (!withPhotos.length) return '';

  const tiles = withPhotos.map((row) => {
    const alt = `Site photo for "${row.milestone_name || 'milestone'}" taken ${formatDate(row.milestone_date)}`;
    return `
      <a href="${escapeHtml(row.photo_url)}" target="_blank" rel="noopener">
        <img src="${escapeHtml(row.photo_url)}" alt="${escapeHtml(alt)}" loading="lazy"
             style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius-md);border:1px solid var(--color-border);">
      </a>`;
  }).join('');

  return `
    <div class="card" style="margin-top:var(--space-5);">
      <div class="card__header">
        <div>
          <h3>Photos from site</h3>
          <p>${withPhotos.length} ${withPhotos.length === 1 ? 'photo' : 'photos'} attached to milestones.</p>
        </div>
      </div>
      <div class="card__body">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:var(--space-3);">
          ${tiles}
        </div>
      </div>
    </div>`;
}

/* --------------------------------------------------------------------------
   Full render
   -------------------------------------------------------------------------- */
function render() {
  root.innerHTML = identityHtml()
    + `<div class="grid grid--sidebar-right">${timelineHtml()}${summaryHtml()}</div>`
    + photosHtml();
}

/* --------------------------------------------------------------------------
   Edit project (modal) - mirrors PATCH /api/projects/:id
   -------------------------------------------------------------------------- */
const EDIT_RULES = {
  name: { label: 'Project name', required: true, type: 'string', minLength: 2, maxLength: 160 },
  client_name: { label: 'Client name', type: 'string', maxLength: 120 },
  location: { label: 'Location', type: 'string', maxLength: 160 },
  status: { label: 'Status', required: true, type: 'enum', values: PROJECT_STATUS_ORDER },
  progress_pct: { label: 'Progress', required: true, type: 'int', min: 0, max: 100 },
  contract_amount: { label: 'Contract amount', type: 'number', min: 0, max: 999999999 },
  start_date: { label: 'Start date', type: 'date' },
  target_end_date: {
    label: 'Target completion',
    type: 'date',
    after: { field: 'start_date', label: 'Start date' },
  },
  actual_end_date: { label: 'Actual completion', type: 'date' },
};

const statusOptions = (selected) => PROJECT_STATUS_ORDER
  .map((code) => `<option value="${code}"${code === selected ? ' selected' : ''}>${escapeHtml(PROJECT_STATUS_LABELS[code])}</option>`)
  .join('');

function editFormHtml() {
  const value = (key) => escapeHtml(project[key] ?? '');

  return `
    <form id="edit-project-form" novalidate>
      <div class="error-summary" data-error-summary tabindex="-1" role="alert" aria-live="assertive"></div>
      <div class="form-grid">
        <div class="field span-2" data-field="name">
          <label class="field__label" for="edit-name">Project name <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required, 2–160 characters)</span></label>
          <input class="input" type="text" id="edit-name" name="name" maxlength="160"
                 value="${value('name')}" placeholder="e.g. Two-storey residential renovation — Dela Cruz"
                 aria-describedby="edit-name-help" required>
          <p class="field__help" id="edit-name-help">A short, recognisable name for the job.</p>
          <p class="field__error" data-error-for="name" role="alert"></p>
        </div>

        <div class="field" data-field="client_name">
          <label class="field__label" for="edit-client_name">Client name</label>
          <input class="input" type="text" id="edit-client_name" name="client_name" maxlength="120"
                 value="${value('client_name')}" placeholder="e.g. Maria Dela Cruz" aria-describedby="edit-client_name-help">
          <p class="field__help" id="edit-client_name-help">Who the project is for. Optional.</p>
          <p class="field__error" data-error-for="client_name" role="alert"></p>
        </div>

        <div class="field" data-field="location">
          <label class="field__label" for="edit-location">Location</label>
          <input class="input" type="text" id="edit-location" name="location" maxlength="160"
                 value="${value('location')}" placeholder="e.g. Barangay San Roque, Antipolo" aria-describedby="edit-location-help">
          <p class="field__help" id="edit-location-help">The site address. Optional.</p>
          <p class="field__error" data-error-for="location" role="alert"></p>
        </div>

        <div class="field" data-field="status">
          <label class="field__label" for="edit-status">Status <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required)</span></label>
          <select class="select" id="edit-status" name="status" aria-describedby="edit-status-help" required>
            ${statusOptions(project.status)}
          </select>
          <p class="field__help" id="edit-status-help">Where the project stands today.</p>
          <p class="field__error" data-error-for="status" role="alert"></p>
        </div>

        <div class="field" data-field="progress_pct">
          <label class="field__label" for="edit-progress_pct">Progress percentage <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required, 0–100)</span></label>
          <input class="input" type="number" id="edit-progress_pct" name="progress_pct" min="0" max="100" step="1"
                 value="${escapeHtml(project.progress_pct ?? 0)}" aria-describedby="edit-progress_pct-help" required>
          <p class="field__help" id="edit-progress_pct-help">Overall completion of the whole project, from 0 to 100.</p>
          <p class="field__error" data-error-for="progress_pct" role="alert"></p>
        </div>

        <div class="field" data-field="contract_amount">
          <label class="field__label" for="edit-contract_amount">Contract amount</label>
          <div class="input-group">
            <input class="input" type="number" id="edit-contract_amount" name="contract_amount" min="0" max="999999999" step="0.01"
                   value="${escapeHtml(project.contract_amount ?? '')}" placeholder="e.g. 1850000.00" aria-describedby="edit-contract_amount-help">
            <span class="input-group__suffix" aria-hidden="true">PHP</span>
          </div>
          <p class="field__help" id="edit-contract_amount-help">The agreed contract price in pesos. Optional.</p>
          <p class="field__error" data-error-for="contract_amount" role="alert"></p>
        </div>

        <div class="field" data-field="start_date">
          <label class="field__label" for="edit-start_date">Start date</label>
          <input class="input" type="date" id="edit-start_date" name="start_date" value="${value('start_date')}"
                 aria-describedby="edit-start_date-help">
          <p class="field__help" id="edit-start_date-help">The day work begins on site. Optional.</p>
          <p class="field__error" data-error-for="start_date" role="alert"></p>
        </div>

        <div class="field" data-field="target_end_date">
          <label class="field__label" for="edit-target_end_date">Target completion</label>
          <input class="input" type="date" id="edit-target_end_date" name="target_end_date" value="${value('target_end_date')}"
                 aria-describedby="edit-target_end_date-help">
          <p class="field__help" id="edit-target_end_date-help">Must not be earlier than the start date.</p>
          <p class="field__error" data-error-for="target_end_date" role="alert"></p>
        </div>

        <div class="field" data-field="actual_end_date">
          <label class="field__label" for="edit-actual_end_date">Actual completion</label>
          <input class="input" type="date" id="edit-actual_end_date" name="actual_end_date" value="${value('actual_end_date')}"
                 aria-describedby="edit-actual_end_date-help">
          <p class="field__help" id="edit-actual_end_date-help">Fill this in once the project is handed over. Optional.</p>
          <p class="field__error" data-error-for="actual_end_date" role="alert"></p>
        </div>
      </div>
    </form>`;
}

function openEditModal() {
  const modal = createModal({
    title: 'Edit project',
    description: `Update the details for ${project.project_code || 'this project'}.`,
    size: 'wide',
  });

  modal.body.innerHTML = editFormHtml();
  modal.footer.innerHTML = `
    <button type="button" class="btn btn--secondary" data-close>Cancel</button>
    <button type="submit" form="edit-project-form" class="btn btn--primary">Save changes</button>`;

  const form = modal.body.querySelector('#edit-project-form');

  bindForm(form, {
    rules: EDIT_RULES,
    submitButton: modal.footer.querySelector('button[type="submit"]'),
    onSubmit: async (values) => {
      await api.patch(`/api/projects/${encodeURIComponent(project.id)}`, values);
      modal.close();
      toastSuccess('Project updated', 'The project details were saved.');
      announce('Project updated.');
      await load();
    },
  });
}

/* --------------------------------------------------------------------------
   Delete (Administrators only)
   -------------------------------------------------------------------------- */
async function deleteProject() {
  const confirmed = await confirmAction({
    title: 'Delete this project?',
    message: `Project ${project.project_code || ''} "${project.name || ''}" and all of its milestone updates will be removed. This cannot be undone.`,
    confirmLabel: 'Delete project',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await api.delete(`/api/projects/${encodeURIComponent(project.id)}`);
    toastSuccess('Project deleted', 'The project and its milestones were removed.');
    window.location.replace('/projects.html');
  } catch (error) {
    toastError('Could not delete', error?.message || 'The project could not be deleted.');
  }
}

/* --------------------------------------------------------------------------
   Loading
   -------------------------------------------------------------------------- */
async function load() {
  root.innerHTML = loadingHtml();

  try {
    const data = await api.get(`/api/projects/${encodeURIComponent(projectId)}`);
    project = data.project;
    updates = data.updates || [];
    quotation = data.quotation || null;

    renderActions();
    render();
  } catch (error) {
    actionsEl.innerHTML = '';
    root.innerHTML = errorHtml(error?.message || 'Please try again in a moment.');
  }
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */
if (!projectId) {
  actionsEl.innerHTML = '';
  root.innerHTML = missingIdHtml();
} else {
  // "Try again" inside the error state reloads the record.
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-retry]')) load();
  });
  load();
}
