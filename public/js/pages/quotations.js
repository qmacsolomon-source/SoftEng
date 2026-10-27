/**
 * Quotation Records - the searchable, filterable list of every quotation.
 *
 * The whole filter state (keyword, status, type, finish package, dates, sort
 * and page) is mirrored into the address bar so a filtered view can be shared
 * and survives a reload. Data comes from GET /api/quotations; the finish
 * package choices come from GET /api/quotations/meta.
 */
import { api } from '../api.js';
import { mountShell } from '../shell.js';
import {
  PACKAGE_LABELS,
  QUOTATION_STATUS_LABELS,
  QUOTATION_TYPE_LABELS,
  debounce,
  downloadBlob,
  escapeHtml,
  formatDate,
  formatNumber,
  formatPeso,
  getParam,
  qs,
  relativeTime,
  setParams,
} from '../util.js';
import {
  announce,
  bindPagination,
  emptyRow,
  errorRow,
  loadingRows,
  paginationHtml,
  quotationStatusBadge,
  toastError,
  toastSuccess,
} from '../ui.js';

// Paint the shell first. When the session is missing this throws after it has
// already sent the user to the sign-in screen.
try {
  await mountShell({
    active: 'quotations',
    title: 'Quotation Records',
    subtitle: 'Search, filter and open every quotation.',
  });
} catch { /* mountShell redirects to sign in */ }

/* --------------------------------------------------------------------------
   Constants and elements
   -------------------------------------------------------------------------- */
const PAGE_SIZE = 15;

// Reference, Client, Project, Floor area, Finish package, Total, Status,
// Created and the row actions - used by every full-width table state row.
const COLSPAN = 9;

const SORTABLE_KEYS = ['created_at', 'reference_no', 'client_name', 'total_amount', 'floor_area_sqm', 'status'];
const DEFAULT_SORT = 'created_at';
const DEFAULT_DIR = 'desc';

const form = qs('#filters');
const keywordInput = qs('#f-keyword');
const statusSelect = qs('#f-status');
const typeSelect = qs('#f-type');
const packageSelect = qs('#f-package');
const fromInput = qs('#f-from');
const toInput = qs('#f-to');
const countEl = qs('#filters-count');
const tbody = qs('#quotations-body');
const paginationEl = qs('#quotations-pagination');
const table = qs('#quotations-table');
const exportButton = qs('#export-csv');
const resetButton = qs('#filters-reset');

/* --------------------------------------------------------------------------
   Filter state, restored from the address bar
   -------------------------------------------------------------------------- */
const state = {
  keyword: getParam('keyword'),
  status: getParam('status'),
  type: getParam('type'),
  package: getParam('package'),
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
function fillSelect(select, entries, allLabel) {
  select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>`
    + entries.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
}

/** Reads the whole filter bar back into `state`. */
function readControls() {
  state.keyword = keywordInput.value.trim();
  state.status = statusSelect.value;
  state.type = typeSelect.value;
  state.package = packageSelect.value;
  state.from = fromInput.value;
  state.to = toInput.value;
}

/** Reflects `state` in the address bar without reloading the page. */
function syncUrl() {
  const isDefaultSort = state.sort === DEFAULT_SORT && state.dir === DEFAULT_DIR;
  setParams({
    keyword: state.keyword,
    status: state.status,
    type: state.type,
    package: state.package,
    from: state.from,
    to: state.to,
    page: state.page > 1 ? String(state.page) : '',
    sort: isDefaultSort ? '' : state.sort,
    dir: isDefaultSort ? '' : state.dir,
  });
}

/** The filters the CSV export should honour (it ignores paging and sorting). */
function exportFilters() {
  return {
    keyword: state.keyword,
    status: state.status,
    type: state.type,
    package: state.package,
    from: state.from,
    to: state.to,
  };
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */
function rowHtml(quotation) {
  const typeLabel = QUOTATION_TYPE_LABELS[quotation.quotation_type] || quotation.quotation_type || '';
  const packageName = quotation.finish_package_name
    || PACKAGE_LABELS[quotation.finish_package_code] || '—';

  return `
    <tr>
      <td>
        <span class="font-mono">${escapeHtml(quotation.reference_no || '—')}</span>
        ${typeLabel ? `<span class="badge badge--navy badge--plain" style="margin-left:6px;">${escapeHtml(typeLabel)}</span>` : ''}
      </td>
      <td>
        <span class="table__primary">${escapeHtml(quotation.client_name || '—')}</span>
        ${quotation.client_email ? `<span class="table__secondary">${escapeHtml(quotation.client_email)}</span>` : ''}
      </td>
      <td>
        <span class="table__primary">${escapeHtml(quotation.project_name || '—')}</span>
        ${quotation.project_location ? `<span class="table__secondary">${escapeHtml(quotation.project_location)}</span>` : ''}
      </td>
      <td class="num">${quotation.floor_area_sqm != null ? `${formatNumber(quotation.floor_area_sqm)} sqm` : '—'}</td>
      <td>${escapeHtml(packageName)}</td>
      <td class="num">${formatPeso(quotation.total_amount)}</td>
      <td>${quotationStatusBadge(quotation.status)}</td>
      <td>${formatDate(quotation.created_at)}<span class="table__secondary">${escapeHtml(relativeTime(quotation.created_at))}</span></td>
      <td class="actions">
        <a class="btn btn--secondary btn--sm" href="/quotation-detail.html?id=${encodeURIComponent(quotation.id)}">View</a>
      </td>
    </tr>`;
}

function renderRows() {
  if (!rows.length) {
    // An empty table gets the standard empty state plus a way to start one.
    tbody.innerHTML = emptyRow(COLSPAN, 'No quotations match the current filters. Adjust the filters, or create the first quotation.');
    const emptyState = tbody.querySelector('.state');
    if (emptyState) {
      emptyState.insertAdjacentHTML(
        'beforeend',
        '<a class="btn btn--primary" href="/quotation-quick.html">Create the first quotation</a>',
      );
    }
    return;
  }
  tbody.innerHTML = rows.map(rowHtml).join('');
}

function renderPagination() {
  paginationEl.innerHTML = pageInfo.total > 0 ? paginationHtml(pageInfo) : '';
}

function updateCount() {
  const total = pageInfo.total;
  countEl.textContent = `Showing ${rows.length} of ${total} quotation${total === 1 ? '' : 's'}`;
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
   Loading the list
   -------------------------------------------------------------------------- */
async function loadRows() {
  syncUrl();
  updateSortIndicators();

  tbody.innerHTML = loadingRows(COLSPAN, 8);
  paginationEl.innerHTML = '';

  try {
    const data = await api.get('/api/quotations', {
      query: {
        keyword: state.keyword,
        status: state.status,
        type: state.type,
        package: state.package,
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
    countEl.textContent = 'Showing 0 of 0 quotations';
    tbody.innerHTML = errorRow(COLSPAN, error?.message || 'The quotation list could not be loaded.', 'data-retry');
    announce('The quotation list could not be loaded.');
  }
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

// Selects and dates apply the moment they change.
form.addEventListener('change', (event) => {
  if (event.target === keywordInput) return;
  readControls();
  state.page = 1;
  loadRows();
});

// Reset clears the form and returns to the default view (newest first).
resetButton.addEventListener('click', () => {
  form.reset();
  state.keyword = '';
  state.status = '';
  state.type = '';
  state.package = '';
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
    // Numbers and dates read best newest / largest first, text A-Z.
    state.dir = ['created_at', 'total_amount', 'floor_area_sqm'].includes(key) ? 'desc' : 'asc';
  }
  state.page = 1;
  loadRows();
});

// "Try again" inside the error row.
tbody.addEventListener('click', (event) => {
  if (event.target.closest('[data-retry]')) loadRows();
});

// Paging.
bindPagination(paginationEl, (page) => {
  state.page = page;
  loadRows();
});

// CSV export: downloaded with the bearer token attached, so it needs api.download.
exportButton.addEventListener('click', async () => {
  const originalLabel = exportButton.textContent;
  exportButton.disabled = true;
  exportButton.setAttribute('aria-busy', 'true');
  exportButton.textContent = 'Preparing…';

  try {
    const { blob, filename } = await api.download('/api/quotations/export.csv', {
      query: exportFilters(),
      filename: 'apa-quotations.csv',
    });
    downloadBlob(blob, filename);
    toastSuccess('Export ready', 'The CSV download has started.');
    announce('The quotation CSV download has started.');
  } catch (error) {
    toastError('Export failed', error?.message || 'The CSV could not be downloaded.');
    announce('The CSV export failed.');
  } finally {
    exportButton.disabled = false;
    exportButton.removeAttribute('aria-busy');
    exportButton.textContent = originalLabel;
  }
});

/* --------------------------------------------------------------------------
   Start-up
   -------------------------------------------------------------------------- */
async function fillPackages() {
  try {
    const meta = await api.get('/api/quotations/meta');
    const packages = meta.finish_packages || [];
    packageSelect.insertAdjacentHTML('beforeend', packages.map((pkg) =>
      `<option value="${escapeHtml(pkg.code)}">${escapeHtml(pkg.name)}</option>`).join(''));
  } catch {
    /* Without the metadata the package filter simply keeps "All packages". */
  }
}

function restoreControls() {
  keywordInput.value = state.keyword;
  statusSelect.value = state.status;
  typeSelect.value = state.type;
  packageSelect.value = state.package;
  fromInput.value = state.from;
  toInput.value = state.to;

  // Normalise: an unknown value in the URL leaves the select unselected.
  state.status = statusSelect.value;
  state.type = typeSelect.value;
  state.package = packageSelect.value;
}

async function init() {
  fillSelect(statusSelect, Object.entries(QUOTATION_STATUS_LABELS), 'All statuses');
  fillSelect(typeSelect, Object.entries(QUOTATION_TYPE_LABELS), 'All types');
  await fillPackages();
  restoreControls();
  await loadRows();
}

init();
