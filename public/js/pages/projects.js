/**
 * Project Tracking - the searchable list of every project.
 *
 * The whole filter state (keyword, status, created-from/to, sort and page) is
 * mirrored into the address bar so a filtered view can be shared and survives a
 * reload. The headline figures come from GET /api/projects/summary and the rows
 * from GET /api/projects; "New project" posts to POST /api/projects through the
 * same validation rules the server uses.
 */
import { api } from '../api.js';
import { mountShell } from '../shell.js';
import { bindForm } from '../forms.js';
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_ORDER,
  debounce,
  escapeHtml,
  formatDate,
  formatPeso,
  getParam,
  qs,
  setParams,
  todayISO,
} from '../util.js';
import {
  bindPagination,
  createModal,
  emptyRow,
  errorRow,
  loadingRows,
  paginationHtml,
  progressCell,
  statusBadge,
  toastError,
  toastSuccess,
} from '../ui.js';

// Paint the shell first. Without a session this throws after it has already
// sent the user to the sign-in screen.
try {
  await mountShell({
    active: 'projects',
    title: 'Project Tracking',
    subtitle: 'Every project, its status and its progress.',
  });
} catch { /* mountShell redirects to sign in */ }

/* --------------------------------------------------------------------------
   Constants and elements
   -------------------------------------------------------------------------- */
const PAGE_SIZE = 15;

// Code, Project, Location, Status, Progress, Contract amount, Target
// completion, Created and the row actions - used by every table state row.
const COLSPAN = 9;

const SORTABLE_KEYS = ['created_at', 'project_code', 'name', 'status', 'progress_pct', 'contract_amount'];
const DEFAULT_SORT = 'created_at';
const DEFAULT_DIR = 'desc';

// Columns that read best largest / newest first.
const DESC_FIRST = ['created_at', 'progress_pct', 'contract_amount'];

const form = qs('#filters');
const keywordInput = qs('#f-keyword');
const statusSelect = qs('#f-status');
const fromInput = qs('#f-from');
const toInput = qs('#f-to');
const countEl = qs('#filters-count');
const tbody = qs('#projects-body');
const paginationEl = qs('#projects-pagination');
const table = qs('#projects-table');
const resetButton = qs('#filters-reset');
const newProjectButton = qs('#new-project');

const statEls = {
  planning: qs('#stat-planning'),
  ongoing: qs('#stat-ongoing'),
  completed: qs('#stat-completed'),
  contract: qs('#stat-contract'),
};

/* --------------------------------------------------------------------------
   Filter state, restored from the address bar
   -------------------------------------------------------------------------- */
const state = {
  keyword: getParam('keyword'),
  status: getParam('status'),
  from: getParam('from'),
  to: getParam('to'),
  page: Math.max(1, Number.parseInt(getParam('page'), 10) || 1),
  sort: SORTABLE_KEYS.includes(getParam('sort')) ? getParam('sort') : DEFAULT_SORT,
  dir: getParam('dir') === 'asc' ? 'asc' : DEFAULT_DIR,
};

let rows = [];
let pageInfo = { page: 1, totalPages: 1, total: 0, pageSize: PAGE_SIZE };

/* --------------------------------------------------------------------------
   Small helpers
   -------------------------------------------------------------------------- */
/** Reads the whole filter bar back into `state`. */
function readControls() {
  state.keyword = keywordInput.value.trim();
  state.status = statusSelect.value;
  state.from = fromInput.value;
  state.to = toInput.value;
}

/** Reflects `state` in the address bar without reloading the page. */
function syncUrl() {
  const isDefaultSort = state.sort === DEFAULT_SORT && state.dir === DEFAULT_DIR;
  setParams({
    keyword: state.keyword,
    status: state.status,
    from: state.from,
    to: state.to,
    page: state.page > 1 ? String(state.page) : '',
    sort: isDefaultSort ? '' : state.sort,
    dir: isDefaultSort ? '' : state.dir,
  });
}

/** True when the target completion date has passed and the project is not closed. */
function isOverdue(project) {
  return Boolean(project.target_end_date)
    && project.status !== 'completed'
    && project.target_end_date < todayISO();
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */
function rowHtml(project) {
  const targetCell = project.target_end_date
    ? `${escapeHtml(formatDate(project.target_end_date))}${isOverdue(project)
      ? '<span class="table__secondary text-muted">Overdue</span>' : ''}`
    : '—';

  return `
    <tr>
      <td><span class="font-mono">${escapeHtml(project.project_code || '—')}</span></td>
      <td>
        <span class="table__primary">${escapeHtml(project.name || '—')}</span>
        <span class="table__secondary">${escapeHtml(project.client_name || 'No client recorded')}</span>
      </td>
      <td>${escapeHtml(project.location || '—')}</td>
      <td>${statusBadge(project.status)}</td>
      <td>${progressCell(project.progress_pct, project.status)}</td>
      <td class="num">${escapeHtml(formatPeso(project.contract_amount))}</td>
      <td>${targetCell}</td>
      <td>${escapeHtml(formatDate(project.created_at))}</td>
      <td class="actions">
        <a class="btn btn--secondary btn--sm" href="/project-detail.html?id=${encodeURIComponent(project.id)}">View</a>
      </td>
    </tr>`;
}

function renderRows() {
  if (!rows.length) {
    // An empty table gets the standard empty state plus a way to start one.
    tbody.innerHTML = emptyRow(COLSPAN, 'No projects match the current filters. Adjust the filters, or add the first project.');
    tbody.querySelector('.state')?.insertAdjacentHTML(
      'beforeend',
      '<button type="button" class="btn btn--primary" data-new-project>Add the first project</button>',
    );
    return;
  }
  tbody.innerHTML = rows.map(rowHtml).join('');
}

function renderPagination() {
  paginationEl.innerHTML = pageInfo.total > 0 ? paginationHtml(pageInfo) : '';
}

function updateCount() {
  const total = pageInfo.total;
  countEl.textContent = `Showing ${rows.length} of ${total} project${total === 1 ? '' : 's'}`;
}

/** Paints the ▲/▼ indicator and the aria-sort value on every sortable header. */
function updateSortIndicators() {
  table.querySelectorAll('.th-sort[data-sort]').forEach((button) => {
    const active = button.dataset.sort === state.sort;
    const sortValue = active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    const iconEl = button.querySelector('.th-sort__icon');

    // aria-sort belongs on the column header, not on the button inside it.
    const header = button.closest('th');
    if (header) header.setAttribute('aria-sort', sortValue);
    if (iconEl) iconEl.textContent = active ? (state.dir === 'asc' ? '\u25B2' : '\u25BC') : '\u2195';
  });
}

/* --------------------------------------------------------------------------
   Loading the list and the summary
   -------------------------------------------------------------------------- */
async function loadRows() {
  syncUrl();
  updateSortIndicators();

  tbody.innerHTML = loadingRows(COLSPAN, 8);
  paginationEl.innerHTML = '';
  countEl.textContent = 'Loading projects…';

  try {
    const data = await api.get('/api/projects', {
      query: {
        keyword: state.keyword,
        status: state.status,
        from: state.from,
        to: state.to,
        page: state.page,
        pageSize: PAGE_SIZE,
        sort: state.sort,
        dir: state.dir,
      },
    });

    rows = data.rows || [];
    pageInfo = {
      page: data.page || 1,
      totalPages: data.totalPages || 1,
      total: data.total || 0,
      pageSize: data.pageSize || PAGE_SIZE,
    };
    state.page = pageInfo.page;

    renderRows();
    renderPagination();
    updateCount();
  } catch (error) {
    rows = [];
    pageInfo = { page: 1, totalPages: 1, total: 0, pageSize: PAGE_SIZE };
    paginationEl.innerHTML = '';
    countEl.textContent = 'Showing 0 of 0 projects';
    tbody.innerHTML = errorRow(COLSPAN, error?.message || 'The project list could not be loaded.', 'data-retry');
  }
}

async function loadSummary() {
  try {
    const summary = await api.get('/api/projects/summary');
    statEls.planning.textContent = String(summary.planning ?? 0);
    statEls.ongoing.textContent = String(summary.ongoing ?? 0);
    statEls.completed.textContent = String(summary.completed ?? 0);
    statEls.contract.textContent = formatPeso(summary.contract_value);
  } catch {
    // The figures are a nicety: a failure here must not hide the table.
    statEls.contract.textContent = '—';
  }
}

/* --------------------------------------------------------------------------
   New project (modal)
   -------------------------------------------------------------------------- */
// Mirrors the POST /api/projects rules in server/routes/projects.routes.js.
const PROJECT_RULES = {
  name: { label: 'Project name', required: true, type: 'string', minLength: 2, maxLength: 160 },
  client_name: { label: 'Client name', type: 'string', maxLength: 120 },
  location: { label: 'Location', type: 'string', maxLength: 160 },
  status: { label: 'Status', required: true, type: 'enum', values: PROJECT_STATUS_ORDER },
  progress_pct: { label: 'Progress', required: true, type: 'int', min: 0, max: 100 },
  floor_area_sqm: { label: 'Floor area', type: 'number', min: 10, max: 5000 },
  contract_amount: { label: 'Contract amount', type: 'number', min: 0, max: 999999999 },
  start_date: { label: 'Start date', type: 'date' },
  target_end_date: {
    label: 'Target completion',
    type: 'date',
    after: { field: 'start_date', label: 'Start date' },
  },
};

const statusOptions = (selected) => PROJECT_STATUS_ORDER
  .map((code) => `<option value="${code}"${code === selected ? ' selected' : ''}>${escapeHtml(PROJECT_STATUS_LABELS[code])}</option>`)
  .join('');

function projectFormHtml() {
  return `
    <form id="project-form" novalidate>
      <div class="error-summary" data-error-summary tabindex="-1" role="alert" aria-live="assertive"></div>
      <div class="form-grid">
        <div class="field span-2" data-field="name">
          <label class="field__label" for="name">Project name <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required, 2–160 characters)</span></label>
          <input class="input" type="text" id="name" name="name" maxlength="160"
                 placeholder="e.g. Two-storey residential renovation — Dela Cruz"
                 aria-describedby="name-help" required>
          <p class="field__help" id="name-help">A short, recognisable name for the job, for example "Two-storey residential renovation — Dela Cruz".</p>
          <p class="field__error" data-error-for="name" role="alert"></p>
        </div>

        <div class="field" data-field="client_name">
          <label class="field__label" for="client_name">Client name</label>
          <input class="input" type="text" id="client_name" name="client_name" maxlength="120"
                 placeholder="e.g. Maria Dela Cruz" aria-describedby="client_name-help">
          <p class="field__help" id="client_name-help">Who the project is for. Optional, up to 120 characters.</p>
          <p class="field__error" data-error-for="client_name" role="alert"></p>
        </div>

        <div class="field" data-field="location">
          <label class="field__label" for="location">Location</label>
          <input class="input" type="text" id="location" name="location" maxlength="160"
                 placeholder="e.g. Barangay San Roque, Antipolo" aria-describedby="location-help">
          <p class="field__help" id="location-help">The site address, so the crew knows where to go. Optional.</p>
          <p class="field__error" data-error-for="location" role="alert"></p>
        </div>

        <div class="field" data-field="status">
          <label class="field__label" for="status">Status <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required)</span></label>
          <select class="select" id="status" name="status" aria-describedby="status-help" required>
            ${statusOptions('planning')}
          </select>
          <p class="field__help" id="status-help">Where the project stands today. Choose Planning for a job that has not started on site.</p>
          <p class="field__error" data-error-for="status" role="alert"></p>
        </div>

        <div class="field" data-field="progress_pct">
          <label class="field__label" for="progress_pct">Progress percentage <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required, 0–100)</span></label>
          <input class="input" type="number" id="progress_pct" name="progress_pct" min="0" max="100" step="1"
                 value="0" placeholder="0" aria-describedby="progress_pct-help" required>
          <p class="field__help" id="progress_pct-help">Overall completion of the whole project, from 0 to 100. Use the status update page once work starts.</p>
          <p class="field__error" data-error-for="progress_pct" role="alert"></p>
        </div>

        <div class="field" data-field="floor_area_sqm">
          <label class="field__label" for="floor_area_sqm">Floor area</label>
          <div class="input-group">
            <input class="input" type="number" id="floor_area_sqm" name="floor_area_sqm" min="10" max="5000" step="0.01"
                   placeholder="e.g. 120.50" aria-describedby="floor_area_sqm-help">
            <span class="input-group__suffix" aria-hidden="true">sqm</span>
          </div>
          <p class="field__help" id="floor_area_sqm-help">Square metres, between 10 and 5,000. Optional, but it keeps the quotation and the project comparable.</p>
          <p class="field__error" data-error-for="floor_area_sqm" role="alert"></p>
        </div>

        <div class="field" data-field="contract_amount">
          <label class="field__label" for="contract_amount">Contract amount</label>
          <div class="input-group">
            <input class="input" type="number" id="contract_amount" name="contract_amount" min="0" max="999999999" step="0.01"
                   placeholder="e.g. 1850000.00" aria-describedby="contract_amount-help">
            <span class="input-group__suffix" aria-hidden="true">PHP</span>
          </div>
          <p class="field__help" id="contract_amount-help">The agreed contract price in pesos, for example 1850000.00. Optional.</p>
          <p class="field__error" data-error-for="contract_amount" role="alert"></p>
        </div>

        <div class="field" data-field="start_date">
          <label class="field__label" for="start_date">Start date</label>
          <input class="input" type="date" id="start_date" name="start_date" aria-describedby="start_date-help">
          <p class="field__help" id="start_date-help">The day work begins on site. Optional.</p>
          <p class="field__error" data-error-for="start_date" role="alert"></p>
        </div>

        <div class="field" data-field="target_end_date">
          <label class="field__label" for="target_end_date">Target completion</label>
          <input class="input" type="date" id="target_end_date" name="target_end_date" aria-describedby="target_end_date-help">
          <p class="field__help" id="target_end_date-help">Must not be earlier than the start date. Rows past this date are flagged as overdue.</p>
          <p class="field__error" data-error-for="target_end_date" role="alert"></p>
        </div>
      </div>
    </form>`;
}

function openProjectModal() {
  const modal = createModal({
    title: 'New project',
    description: 'Record a job so its milestones and progress can be tracked.',
    size: 'wide',
  });

  modal.body.innerHTML = projectFormHtml();
  modal.footer.innerHTML = `
    <button type="button" class="btn btn--secondary" data-close>Cancel</button>
    <button type="submit" form="project-form" class="btn btn--primary">Create project</button>`;

  const projectForm = modal.body.querySelector('#project-form');

  bindForm(projectForm, {
    rules: PROJECT_RULES,
    submitButton: modal.footer.querySelector('button[type="submit"]'),
    onSubmit: async (values) => {
      const created = await api.post('/api/projects', values);
      modal.close();
      toastSuccess('Project created', `${created.project_code || 'The project'} — ${created.name} is now on the list.`);
      state.page = 1;
      await Promise.all([loadRows(), loadSummary()]);
    },
  });
}

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */
// Explicit "Apply filters" submit.
form.addEventListener('submit', (event) => {
  event.preventDefault();
  readControls();
  state.page = 1;
  loadRows();
});

// The keyword box waits for a pause in typing before it queries the server.
const onKeywordInput = debounce(() => {
  state.keyword = keywordInput.value.trim();
  state.page = 1;
  loadRows();
}, 350);
keywordInput.addEventListener('input', onKeywordInput);

// The status and date pickers apply the moment they change.
statusSelect.addEventListener('change', () => {
  state.status = statusSelect.value;
  state.page = 1;
  loadRows();
});
[fromInput, toInput].forEach((input) => input.addEventListener('change', () => {
  state.from = fromInput.value;
  state.to = toInput.value;
  state.page = 1;
  loadRows();
}));

// Reset clears the form and returns to the default view (newest first).
resetButton.addEventListener('click', () => {
  form.reset();
  state.keyword = '';
  state.status = '';
  state.from = '';
  state.to = '';
  state.page = 1;
  state.sort = DEFAULT_SORT;
  state.dir = DEFAULT_DIR;
  loadRows();
});

// Sorting: clicking the active column flips the direction.
table.addEventListener('click', (event) => {
  const button = event.target.closest('.th-sort[data-sort]');
  if (!button) return;

  const key = button.dataset.sort;
  if (state.sort === key) {
    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sort = key;
    state.dir = DESC_FIRST.includes(key) ? 'desc' : 'asc';
  }
  state.page = 1;
  loadRows();
});

// "Try again" inside the error row, and the empty-state button.
tbody.addEventListener('click', (event) => {
  if (event.target.closest('[data-retry]') || event.target.closest('[data-new-project]')) {
    if (event.target.closest('[data-new-project]')) openProjectModal();
    else loadRows();
  }
});

// Paging.
bindPagination(paginationEl, (page) => {
  state.page = page;
  loadRows();
});

newProjectButton.addEventListener('click', openProjectModal);

/* --------------------------------------------------------------------------
   Start-up
   -------------------------------------------------------------------------- */
function restoreControls() {
  keywordInput.value = state.keyword;
  statusSelect.value = state.status;
  fromInput.value = state.from;
  toInput.value = state.to;

  // Normalise: an unknown status left in the URL simply leaves "All statuses".
  state.status = statusSelect.value;
}

async function init() {
  statusSelect.insertAdjacentHTML('beforeend', PROJECT_STATUS_ORDER
    .map((code) => `<option value="${code}">${escapeHtml(PROJECT_STATUS_LABELS[code])}</option>`)
    .join(''));

  restoreControls();
  await Promise.all([loadRows(), loadSummary()]);
}

init();
