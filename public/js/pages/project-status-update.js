/**
 * Project Status Update - SUPPORTING FORM 2 (milestone tracking).
 *
 * One page that records a milestone against a project: which project, where it
 * stands, what was finished, how far along the project is, when, an optional
 * site photo and optional remarks. The rules here mirror
 * POST /api/projects/:id/updates in server/routes/projects.routes.js so the
 * browser shows the same message the server would; the server re-checks
 * everything, including the "completed means 100%" rule.
 *
 * The form is submitted as multipart because it may carry a photo, so the
 * validated values go through toFormData() and api.postForm().
 */
import { api } from '../api.js';
import { mountShell } from '../shell.js';
import {
  bindForm,
  clearErrors,
  initCharCounters,
  initFileDrops,
  initSliders,
  setFieldError,
  toFormData,
} from '../forms.js';
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_ORDER,
  escapeHtml,
  formatDate,
  formatPeso,
  getParam,
  nowTimeValue,
  qs,
  todayISO,
} from '../util.js';
import {
  announce,
  confirmAction,
  detailList,
  progressBar,
  stateHtml,
  statusBadge,
  toastError,
  toastSuccess,
} from '../ui.js';

// Paint the shell first; it throws after redirecting when there is no session.
let currentUser = null;
try {
  ({ user: currentUser } = await mountShell({
    active: 'project-status-update',
    title: 'Project Status Update',
    subtitle: 'Record a milestone, progress and a site photo.',
  }));
} catch { /* mountShell redirects to sign in */ }

/* --------------------------------------------------------------------------
   Elements
   -------------------------------------------------------------------------- */
const form = qs('#status-form');
const select = qs('#project_id');
const milestoneInput = qs('#milestone_name');
const datalist = qs('#milestone-suggestions');
const dateInput = qs('#milestone_date');
const timeInput = qs('#time_logged');
const progressInput = qs('#progress_pct');
const progressOutput = qs('[data-slider-output="progress_pct"]');
const photoInput = qs('#progress_photo');
const remarksInput = qs('#remarks');
const notifyInput = qs('#notify_owner');
const updatedByInput = qs('#updated_by');
const updatedByIdInput = qs('#updated_by_id');
const cancelButton = qs('#cancel-btn');
const saveButton = qs('#save-btn');
const successNote = qs('#success-note');
const successText = qs('#success-text');
const successLink = qs('#success-link');
const snapshotBody = qs('#snapshot-body');
const recentBody = qs('#recent-body');
const steps = {
  project: qs('#step-project'),
  milestone: qs('#step-milestone'),
  save: qs('#step-save'),
};

/* --------------------------------------------------------------------------
   Page state
   -------------------------------------------------------------------------- */
let projects = [];
let projectById = new Map();
let milestones = {};

// A snapshot of the values as they are right after a reset, used to decide
// whether "Cancel" needs to warn before throwing anything away.
let cleanSignature = '';

/* --------------------------------------------------------------------------
   Validation rules - a mirror of the server contract
   -------------------------------------------------------------------------- */
const UPDATE_RULES = {
  project_id: { label: 'Project', required: true, type: 'uuid' },
  status: { label: 'Current status', required: true, type: 'enum', values: PROJECT_STATUS_ORDER },
  milestone_name: { label: 'Milestone', required: true, type: 'string', minLength: 2, maxLength: 120 },
  progress_pct: { label: 'Progress percentage', required: true, type: 'int', min: 0, max: 100 },
  milestone_date: { label: 'Milestone date', required: true, type: 'date', notFuture: true },
  time_logged: { label: 'Time logged', type: 'time' },
  remarks: { label: 'Remarks', type: 'string', maxLength: 1000 },
  notify_owner: { label: 'Notify the owner', type: 'boolean', default: false },
  progress_photo: {
    label: 'Site photo',
    type: 'file',
    maxFileMb: 5,
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
  },
  // Sent for completeness; the server files the update under the signed-in user.
  updated_by_id: { label: 'Recorded by reference', type: 'uuid' },
};

/* --------------------------------------------------------------------------
   Step indicator
   -------------------------------------------------------------------------- */
function setStep(node, state) {
  node.classList.toggle('is-complete', state === 'complete');
  if (state === 'current') node.setAttribute('aria-current', 'step');
  else node.removeAttribute('aria-current');
}

/** Moves the guide along as the form fills in. */
function updateSteps() {
  const projectChosen = Boolean(select.value);
  const milestoneReady = projectChosen
    && milestoneInput.value.trim().length >= 2
    && Boolean(dateInput.value);

  if (!projectChosen) {
    setStep(steps.project, 'current');
    setStep(steps.milestone, '');
    setStep(steps.save, '');
  } else if (!milestoneReady) {
    setStep(steps.project, 'complete');
    setStep(steps.milestone, 'current');
    setStep(steps.save, '');
  } else {
    setStep(steps.project, 'complete');
    setStep(steps.milestone, 'complete');
    setStep(steps.save, 'current');
  }
}

/* --------------------------------------------------------------------------
   Dropdowns and defaults
   -------------------------------------------------------------------------- */
function fillProjects() {
  const options = ['<option value="">Select a project…</option>'];
  projects.forEach((project) => {
    const status = PROJECT_STATUS_LABELS[project.status] || project.status || '—';
    const label = `${project.project_code || 'PRJ'} — ${project.name || 'Untitled'} (${status})`;
    options.push(`<option value="${escapeHtml(project.id)}">${escapeHtml(label)}</option>`);
  });
  select.innerHTML = options.join('');
}

/** Suggested milestone names depend on the chosen status. */
function fillMilestones() {
  const list = milestones[form.elements.status.value] || [];
  datalist.innerHTML = list.map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
}

function syncProgressOutput() {
  progressOutput.textContent = `${progressInput.value}%`;
}

/** The slider starts at the project's current progress, the natural baseline. */
function applyProjectBaseline() {
  const project = projectById.get(select.value);
  progressInput.value = String(project ? (project.progress_pct ?? 0) : 0);
  syncProgressOutput();
}

/** Values that should be filled in for the user without them asking. */
function applyDefaults() {
  dateInput.value = todayISO();
  dateInput.max = todayISO(); // a milestone cannot be in the future
  timeInput.value = nowTimeValue();
  updatedByInput.value = currentUser?.full_name || currentUser?.email || 'Staff';
  updatedByIdInput.value = currentUser?.id || '';
  fillMilestones();
  updateSteps();
}

/* --------------------------------------------------------------------------
   "Has anything been typed?" - used by Cancel
   -------------------------------------------------------------------------- */
function signature() {
  return JSON.stringify({
    project: select.value,
    status: form.elements.status.value,
    milestone: milestoneInput.value.trim(),
    progress: progressInput.value,
    date: dateInput.value,
    time: timeInput.value,
    remarks: remarksInput.value.trim(),
    photo: photoInput.files?.[0]?.name || '',
    notify: notifyInput.checked,
  });
}

function markClean() {
  cleanSignature = signature();
}

function isDirty() {
  return signature() !== cleanSignature;
}

/* --------------------------------------------------------------------------
   Right-hand column
   -------------------------------------------------------------------------- */
function renderSnapshot(project, updates) {
  const last = updates[0];

  snapshotBody.innerHTML = `
    ${detailList([
      ['Project', `<span class="font-mono">${escapeHtml(project.project_code || '—')}</span>`],
      ['Name', escapeHtml(project.name || '—')],
      ['Client', escapeHtml(project.client_name || '')],
      ['Current status', statusBadge(project.status)],
      ['Contract amount', escapeHtml(formatPeso(project.contract_amount))],
      ['Last milestone', last ? escapeHtml(last.milestone_name || '') : ''],
      ['Last updated', last ? escapeHtml(formatDate(last.milestone_date)) : ''],
    ])}
    <div style="margin-top:var(--space-4);">
      ${progressBar(project.progress_pct, project.status, { showValue: true })}
    </div>`;
}

function renderRecent(rows) {
  if (!rows.length) {
    recentBody.innerHTML = stateHtml({
      iconName: 'flag',
      title: 'No milestones yet',
      text: 'Nothing has been recorded for this project.',
    });
    return;
  }

  recentBody.innerHTML = `
    <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-3);">
      ${rows.slice(0, 4).map((row) => `
        <li style="display:flex;justify-content:space-between;gap:var(--space-3);align-items:baseline;">
          <span>${escapeHtml(row.milestone_name || 'Milestone')}</span>
          <span class="text-muted" style="white-space:nowrap;font-size:0.78rem;">
            ${escapeHtml(formatDate(row.milestone_date))} · ${escapeHtml(String(row.progress_pct ?? 0))}%
          </span>
        </li>`).join('')}
    </ul>`;
}

async function refreshRightColumn(projectId) {
  if (!projectId) {
    snapshotBody.innerHTML = stateHtml({
      iconName: 'hardhat',
      title: 'No project chosen',
      text: 'Choose a project to see its current status, progress and recent milestones.',
    });
    recentBody.innerHTML = '';
    return;
  }

  snapshotBody.innerHTML = '<div class="skeleton" style="height:14px;"></div><div class="skeleton" style="width:70%;height:14px;margin-top:10px;"></div>';
  recentBody.innerHTML = '<div class="skeleton" style="height:14px;"></div>';

  try {
    const [detail, recent] = await Promise.all([
      api.get(`/api/projects/${encodeURIComponent(projectId)}`),
      api.get(`/api/projects/${encodeURIComponent(projectId)}/updates`),
    ]);
    renderSnapshot(detail.project, detail.updates || []);
    renderRecent(recent.rows || []);
  } catch (error) {
    snapshotBody.innerHTML = `<p class="text-muted">${escapeHtml(error?.message || 'This project could not be loaded.')}</p>`;
    recentBody.innerHTML = '';
  }
}

/* --------------------------------------------------------------------------
   Success note
   -------------------------------------------------------------------------- */
function showSuccessNote(values) {
  successText.textContent = `${values.milestone_name} on ${formatDate(values.milestone_date)} was saved. `;
  successLink.href = `/project-detail.html?id=${encodeURIComponent(values.project_id)}`;
  successNote.hidden = false;
}

/* --------------------------------------------------------------------------
   Reset
   -------------------------------------------------------------------------- */
function resetForm({ keepProject = true } = {}) {
  const keep = select.value;

  form.reset();          // returns the status radios to their default (Ongoing)
  clearErrors(form);
  successNote.hidden = true;

  if (keepProject) select.value = keep;
  applyDefaults();
  applyProjectBaseline();
  markClean();
  updateSteps();
}

/* --------------------------------------------------------------------------
   The form itself
   -------------------------------------------------------------------------- */
bindForm(form, {
  rules: UPDATE_RULES,
  submitButton: saveButton,
  onSubmit: async (values) => {
    // Rule the markup cannot express: a completed project is always 100%.
    if (values.status === 'completed' && Number(values.progress_pct) !== 100) {
      setFieldError(form, 'progress_pct', 'A completed project must be recorded at 100% progress.');
      announce('A completed project must be recorded at 100% progress.');
      return;
    }

    await api.postForm(
      `/api/projects/${encodeURIComponent(values.project_id)}/updates`,
      toFormData(values),
    );

    const project = projectById.get(values.project_id);
    const name = project ? `${project.project_code} — ${project.name}` : 'the project';

    toastSuccess('Status update saved', `${values.milestone_name} was recorded for ${name}.`);
    announce('Status update saved.');

    resetForm({ keepProject: true });
    showSuccessNote(values);
    await refreshRightColumn(values.project_id);
  },
});

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */
// The status radio group controls which milestone names are suggested.
form.addEventListener('change', (event) => {
  if (event.target.name === 'status') fillMilestones();
});

// Changing the project reloads the snapshot and resets the progress baseline.
select.addEventListener('change', () => {
  applyProjectBaseline();
  updateSteps();
  refreshRightColumn(select.value);
});

// Keep the step guide and the "dirty" check in step with every keystroke.
form.addEventListener('input', updateSteps);

// Cancel clears the form, but asks first if anything has been typed.
cancelButton.addEventListener('click', async () => {
  if (isDirty()) {
    const confirmed = await confirmAction({
      title: 'Discard this update?',
      message: 'Anything you have typed, including a chosen photo, will be lost.',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (!confirmed) return;
  }
  resetForm({ keepProject: true });
  announce('Form cleared.');
});

// Ctrl + Enter (or Cmd + Enter) saves from anywhere in the form.
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    form.requestSubmit();
  }
});

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */
async function init() {
  // Wire the small field behaviours before anything is filled in.
  initSliders(form);
  initFileDrops(form);
  initCharCounters(form);

  applyDefaults();

  try {
    const data = await api.get('/api/projects/options');
    projects = data.projects || [];
    milestones = data.milestones || {};
    projectById = new Map(projects.map((project) => [project.id, project]));
  } catch (error) {
    toastError('Projects could not be loaded', error?.message || 'Please refresh the page and try again.');
    select.innerHTML = '<option value="">Projects are unavailable right now</option>';
    applyDefaults();
    return;
  }

  fillProjects();

  // Pre-select the project passed in the address bar, when it still exists.
  const requested = getParam('project');
  if (requested && projectById.has(requested)) select.value = requested;

  fillMilestones();
  applyProjectBaseline();
  markClean();
  updateSteps();

  await refreshRightColumn(select.value);
}

init();
