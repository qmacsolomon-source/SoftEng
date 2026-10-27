/**
 * Materials and prices.
 *
 * Staff may read the catalogue; only an Administrator may add, edit or retire a
 * material, or trigger a price refresh. The screen is driven by three reads -
 * the summary (source, last refresh, refresh log), the paged material list, and
 * the finish packages with their per-work rates.
 *
 * Prices are intended to come from Wilcon Depot. Until the live feed is wired
 * up, "Refresh prices" simply re-stamps every active material and records an
 * event - which is what this page reports back to the user.
 */
import { mountShell } from '../shell.js';
import { api } from '../api.js';
import { session } from '../session.js';
import { bindForm, setButtonLoading } from '../forms.js';
import { icon } from '../icons.js';
import {
  bindPagination, confirmAction, createModal, emptyRow, errorRow, loadingRows,
  paginationHtml, stateHtml, toastError, toastSuccess,
} from '../ui.js';
import {
  UNITS, WORK_LABELS, WORK_ORDER, escapeHtml, formatDateTime, formatNumber,
  formatPeso, getParam, qs, relativeTime, setParams, workLabel,
} from '../util.js';

/* --------------------------------------------------------------------------
   Session and shell
   -------------------------------------------------------------------------- */
let currentUser = null;
try {
  ({ user: currentUser } = await mountShell({
    active: 'materials',
    title: 'Materials & prices',
    subtitle: 'Wilcon Depot prices and Fajardo-based finish rates',
    requireAdmin: false,
  }));
} catch { /* mountShell redirects when there is no session */ }

/* --------------------------------------------------------------------------
   Page state
   -------------------------------------------------------------------------- */
const isAdmin = session.isAdmin();

// The current filter set, restored from the address bar so a refresh keeps it.
const state = {
  keyword: getParam('keyword'),
  work_type: getParam('work_type'),
  include_inactive: getParam('include_inactive') === 'true',
  page: Math.max(1, Number(getParam('page')) || 1),
  pageSize: 25,
  rows: [],
  packages: [],
};

const els = {
  source: qs('#materials-source'),
  actions: qs('#materials-actions'),
  note: qs('#materials-note'),
  statTotal: qs('#stat-total'),
  statActive: qs('#stat-active'),
  statCoverage: qs('#stat-coverage'),
  statRefreshed: qs('#stat-refreshed'),
  statRefreshedHint: qs('#stat-refreshed-hint'),
  filters: qs('#filters'),
  keyword: qs('#filter-keyword'),
  work: qs('#filter-work'),
  include: qs('#filter-include'),
  filterCount: qs('#filter-count'),
  count: qs('#materials-count'),
  body: qs('#materials-body'),
  pagination: qs('#materials-pagination'),
  packages: qs('#packages-body'),
  refreshLog: qs('#refresh-log'),
};

/* --------------------------------------------------------------------------
   Header actions and the Staff note
   -------------------------------------------------------------------------- */
function renderHeader() {
  if (isAdmin) {
    els.actions.innerHTML = `
      <button type="button" class="btn btn--secondary" data-refresh>${icon('refresh', { size: 16 })} Refresh prices</button>
      <button type="button" class="btn btn--primary" data-add>${icon('plus', { size: 16 })} Add material</button>`;

    els.actions.querySelector('[data-refresh]').addEventListener('click', refreshPrices);
    els.actions.querySelector('[data-add]').addEventListener('click', () => openMaterialModal(null));
  } else {
    els.note.innerHTML = `
      <div class="alert alert--info" role="note">
        <span class="alert__icon" aria-hidden="true">&#8505;</span>
        <span class="alert__body">An Administrator maintains these prices. You can browse the
        catalogue and the finish-package rates, but adding, editing and refreshing prices is
        restricted to Administrators.</span>
      </div>`;
  }
}

/* --------------------------------------------------------------------------
   Summary: source line, stat cards and the refresh log
   -------------------------------------------------------------------------- */
async function loadSummary() {
  try {
    // The summary gives the active-catalogue count, the refresh stamp and the
    // log; a small extra read gives the all-records total and the work coverage
    // (the summary only ever counts active materials).
    const [summary, catalogue] = await Promise.all([
      api.get('/materials/summary'),
      api.get('/materials', { query: { include_inactive: 'true', page: 1, pageSize: 200 } }),
    ]);

    const rows = catalogue.rows || [];
    const covered = new Set(rows.filter((row) => row.is_active).map((row) => row.work_type));

    els.statTotal.textContent = formatNumber(catalogue.total || 0);
    els.statActive.textContent = formatNumber(summary.total_materials || 0);
    els.statCoverage.textContent = `${covered.size} of ${WORK_ORDER.length}`;
    els.statRefreshed.textContent = summary.last_updated_at ? relativeTime(summary.last_updated_at) : '—';
    els.statRefreshedHint.textContent = summary.last_updated_at ? formatDateTime(summary.last_updated_at) : 'No refresh recorded yet';

    els.source.innerHTML = `Source: <strong>${escapeHtml(summary.source || 'Wilcon Depot')}</strong> · `
      + `Estimate basis: ${escapeHtml(summary.basis || 'Fajardo - Simplified Construction Estimate')} · `
      + `Last updated ${escapeHtml(formatDateTime(summary.last_updated_at))} (${escapeHtml(relativeTime(summary.last_updated_at))})`;

    renderRefreshLog(summary.refresh_log || []);
  } catch (error) {
    els.source.textContent = 'The price source could not be loaded.';
    renderRefreshLog(null, error?.message);
  }
}

function renderRefreshLog(rows, errorMessage) {
  if (rows === null) {
    els.refreshLog.innerHTML = stateHtml({
      iconName: 'alert',
      title: 'Refresh history unavailable',
      text: errorMessage || 'The list of past price refreshes could not be loaded.',
    });
    return;
  }
  if (!rows.length) {
    els.refreshLog.innerHTML = stateHtml({
      iconName: 'empty',
      title: 'No refreshes recorded yet',
      text: 'Once an Administrator refreshes prices, the events will be listed here.',
    });
    return;
  }

  els.refreshLog.innerHTML = `<ul class="activity-list">${rows.map((row) => `
    <li class="activity-item">
      <div class="activity-item__body">
        <div class="activity-item__text"><strong>${escapeHtml(row.status || 'refresh')}</strong> — ${escapeHtml(row.message || 'Prices were refreshed.')} (${escapeHtml(formatNumber(row.materials_updated || 0))} materials)</div>
        <div class="activity-item__time">${escapeHtml(row.source || 'Wilcon Depot')} · ${escapeHtml(formatDateTime(row.created_at))} · ${escapeHtml(relativeTime(row.created_at))}</div>
      </div>
    </li>`).join('')}</ul>`;
}

/* --------------------------------------------------------------------------
   The material list
   -------------------------------------------------------------------------- */
function materialRow(material) {
  const actions = isAdmin
    ? `<div class="btn-group">
         <button type="button" class="btn btn--secondary btn--sm" data-edit="${escapeHtml(material.id)}">Edit</button>
         <button type="button" class="btn btn--danger btn--sm" data-retire="${escapeHtml(material.id)}">Retire</button>
       </div>`
    : '<span class="text-muted">View only</span>';

  const brandLine = [material.brand, material.sku].filter(Boolean).join(' · ');

  return `<tr>
    <td>${escapeHtml(workLabel(material.work_type))}</td>
    <td>
      <span class="table__primary">${escapeHtml(material.name)}</span>
      <span class="table__secondary">${escapeHtml(brandLine || 'No brand or SKU recorded')}</span>
    </td>
    <td>${escapeHtml(material.unit || '—')}</td>
    <td class="num">${escapeHtml(formatPeso(material.unit_price, { symbol: true }))}
      <span class="table__secondary">cost factor ×${escapeHtml(String(material.cost_factor ?? 1))}</span>
    </td>
    <td>${escapeHtml(material.supplier || '—')}</td>
    <td>${escapeHtml(material.style_variant || '—')}</td>
    <td>${escapeHtml(relativeTime(material.last_updated_at))}</td>
    <td>${material.is_active
      ? '<span class="badge badge--completed">Active</span>'
      : '<span class="badge badge--neutral">Retired</span>'}</td>
    <td class="actions">${actions}</td>
  </tr>`;
}

async function loadList() {
  els.body.innerHTML = loadingRows(9, 6);
  els.pagination.innerHTML = '';
  els.filterCount.textContent = 'Loading materials…';

  try {
    const data = await api.get('/materials', {
      query: {
        keyword: state.keyword,
        work_type: state.work_type,
        include_inactive: state.include_inactive ? 'true' : '',
        page: state.page,
        pageSize: state.pageSize,
      },
    });

    const rows = data.rows || [];
    state.rows = rows;

    if (!rows.length) {
      els.body.innerHTML = emptyRow(9, 'No materials match these filters yet.');
    } else {
      els.body.innerHTML = rows.map(materialRow).join('');
    }

    const summaryText = `${formatNumber(data.total || 0)} material${(data.total || 0) === 1 ? '' : 's'}`
      + (state.include_inactive ? ' (including retired)' : '');
    els.filterCount.textContent = summaryText;
    els.count.textContent = summaryText;
    els.pagination.innerHTML = paginationHtml(data);
  } catch (error) {
    els.body.innerHTML = errorRow(9, error?.message || 'The catalogue could not be loaded.', 'data-retry');
    els.filterCount.textContent = '';
    els.count.textContent = 'The catalogue could not be loaded.';
    els.pagination.innerHTML = '';
  }
}

function findMaterial(id) {
  return state.rows.find((row) => row.id === id) || null;
}

async function retireMaterial(material) {
  if (!material) return;
  const confirmed = await confirmAction({
    title: 'Retire this material?',
    message: `"${material.name}" will stop appearing in new quotations. Quotations already saved keep their copy of the price.`,
    confirmLabel: 'Retire material',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await api.delete(`/materials/${material.id}`);
    toastSuccess('Material retired', `${material.name} is now hidden from new quotations.`);
    await Promise.all([loadSummary(), loadList()]);
  } catch (error) {
    toastError('Could not retire the material', error?.message);
  }
}

/* --------------------------------------------------------------------------
   Add / edit a material (modal)
   -------------------------------------------------------------------------- */
const MATERIAL_RULES = {
  work_type: { label: 'Work', required: true, type: 'enum', values: WORK_ORDER },
  name: { label: 'Material name', required: true, type: 'string', minLength: 2, maxLength: 160 },
  brand: { label: 'Brand', type: 'string', maxLength: 80 },
  sku: { label: 'SKU', type: 'string', maxLength: 40 },
  unit: { label: 'Unit', required: true, type: 'enum', values: UNITS },
  unit_price: { label: 'Unit price', required: true, type: 'number', min: 0, max: 100000000 },
  cost_factor: { label: 'Cost factor', type: 'number', min: 0.1, max: 5, decimals: 2 },
  supplier: { label: 'Supplier', type: 'string', maxLength: 80 },
  source_url: { label: 'Source link', type: 'string', maxLength: 300 },
  thumbnail_url: { label: 'Thumbnail link', type: 'string', maxLength: 300 },
  style_variant: { label: 'Style variant', type: 'string', maxLength: 80 },
  notes: { label: 'Notes', type: 'string', maxLength: 300 },
  is_active: { label: 'Active', type: 'boolean' },
};

const workOptions = (selected) => WORK_ORDER
  .map((code) => `<option value="${code}"${code === selected ? ' selected' : ''}>${escapeHtml(WORK_LABELS[code])}</option>`)
  .join('');

const unitOptions = (selected) => UNITS
  .map((unit) => `<option value="${escapeHtml(unit)}"${unit === selected ? ' selected' : ''}>${escapeHtml(unit)}</option>`)
  .join('');

function materialFormHtml(row) {
  const value = row || {};
  return `
    <form id="material-form" novalidate>
      <div class="error-summary" data-error-summary tabindex="-1" role="alert" aria-live="assertive"></div>
      <div class="form-grid">
        <div class="field" data-field="work_type">
          <label class="field__label" for="work_type">Work <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required)</span></label>
          <select class="select" id="work_type" name="work_type" aria-describedby="work_type-help" required>
            <option value="">Choose a work…</option>
            ${workOptions(value.work_type)}
          </select>
          <p class="field__help" id="work_type-help">The construction work this material belongs to.</p>
          <p class="field__error" data-error-for="work_type" role="alert"></p>
        </div>

        <div class="field span-2" data-field="name">
          <label class="field__label" for="name">Material name <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required, 2–160 characters)</span></label>
          <input class="input" type="text" id="name" name="name" maxlength="160"
                 value="${escapeHtml(value.name || '')}" placeholder="e.g. Unglazed ceramic floor tile 30x30"
                 aria-describedby="name-help" required>
          <p class="field__help" id="name-help">The name as it should appear on a quotation, for example "Unglazed ceramic floor tile 30x30".</p>
          <p class="field__error" data-error-for="name" role="alert"></p>
        </div>

        <div class="field" data-field="brand">
          <label class="field__label" for="brand">Brand</label>
          <input class="input" type="text" id="brand" name="brand" maxlength="80"
                 value="${escapeHtml(value.brand || '')}" placeholder="e.g. Mariwasa"
                 aria-describedby="brand-help">
          <p class="field__help" id="brand-help">The manufacturer or label shown to the client.</p>
          <p class="field__error" data-error-for="brand" role="alert"></p>
        </div>

        <div class="field" data-field="sku">
          <label class="field__label" for="sku">SKU</label>
          <input class="input" type="text" id="sku" name="sku" maxlength="40"
                 value="${escapeHtml(value.sku || '')}" placeholder="e.g. MWZ-3030"
                 aria-describedby="sku-help">
          <p class="field__help" id="sku-help">The Wilcon product code, when you have it.</p>
          <p class="field__error" data-error-for="sku" role="alert"></p>
        </div>

        <div class="field" data-field="unit">
          <label class="field__label" for="unit">Unit <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required)</span></label>
          <select class="select" id="unit" name="unit" aria-describedby="unit-help" required>
            <option value="">Choose a unit…</option>
            ${unitOptions(value.unit)}
          </select>
          <p class="field__help" id="unit-help">The unit the price is quoted in (pc, sqm, bag…).</p>
          <p class="field__error" data-error-for="unit" role="alert"></p>
        </div>

        <div class="field" data-field="unit_price">
          <label class="field__label" for="unit_price">Unit price <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required, PHP)</span></label>
          <input class="input" type="number" id="unit_price" name="unit_price" min="0" max="100000000" step="0.01"
                 value="${escapeHtml(value.unit_price ?? '')}" placeholder="e.g. 245.50"
                 aria-describedby="unit_price-help" required>
          <p class="field__help" id="unit_price-help">The Wilcon price per unit in pesos, for example 245.50.</p>
          <p class="field__error" data-error-for="unit_price" role="alert"></p>
        </div>

        <div class="field" data-field="cost_factor">
          <label class="field__label" for="cost_factor">Cost factor</label>
          <input class="input" type="number" id="cost_factor" name="cost_factor" min="0.1" max="5" step="0.05"
                 value="${escapeHtml(value.cost_factor ?? 1)}" placeholder="1.00"
                 aria-describedby="cost_factor-help">
          <p class="field__help" id="cost_factor-help">Scales the Fajardo base rate before waste and labour are added. Leave at 1.00 to use the price as-is (allowed range 0.10–5.00).</p>
          <p class="field__error" data-error-for="cost_factor" role="alert"></p>
        </div>

        <div class="field" data-field="supplier">
          <label class="field__label" for="supplier">Supplier</label>
          <input class="input" type="text" id="supplier" name="supplier" maxlength="80"
                 value="${escapeHtml(value.supplier ?? 'Wilcon Depot')}" placeholder="Wilcon Depot"
                 aria-describedby="supplier-help">
          <p class="field__help" id="supplier-help">Defaults to Wilcon Depot.</p>
          <p class="field__error" data-error-for="supplier" role="alert"></p>
        </div>

        <div class="field" data-field="style_variant">
          <label class="field__label" for="style_variant">Style variant</label>
          <input class="input" type="text" id="style_variant" name="style_variant" maxlength="80"
                 value="${escapeHtml(value.style_variant || '')}" placeholder="e.g. Matte finish"
                 aria-describedby="style_variant-help">
          <p class="field__help" id="style_variant-help">The finish or colour option, when the brand sells several.</p>
          <p class="field__error" data-error-for="style_variant" role="alert"></p>
        </div>

        <div class="field" data-field="source_url">
          <label class="field__label" for="source_url">Source link</label>
          <input class="input" type="url" id="source_url" name="source_url" maxlength="300"
                 value="${escapeHtml(value.source_url || '')}" placeholder="https://www.wilcon.com.ph/…"
                 aria-describedby="source_url-help">
          <p class="field__help" id="source_url-help">The product page, so the price can be checked later.</p>
          <p class="field__error" data-error-for="source_url" role="alert"></p>
        </div>

        <div class="field" data-field="thumbnail_url">
          <label class="field__label" for="thumbnail_url">Thumbnail link</label>
          <input class="input" type="url" id="thumbnail_url" name="thumbnail_url" maxlength="300"
                 value="${escapeHtml(value.thumbnail_url || '')}" placeholder="https://…/photo.jpg"
                 aria-describedby="thumbnail_url-help">
          <p class="field__help" id="thumbnail_url-help">A small image of the product, if you have one.</p>
          <p class="field__error" data-error-for="thumbnail_url" role="alert"></p>
        </div>

        <div class="field span-2" data-field="notes">
          <label class="field__label" for="notes">Notes</label>
          <textarea class="textarea" id="notes" name="notes" maxlength="300"
                    placeholder="Anything worth remembering when quoting this material."
                    aria-describedby="notes-help">${escapeHtml(value.notes || '')}</textarea>
          <p class="field__help" id="notes-help">Optional, up to 300 characters.</p>
          <p class="field__error" data-error-for="notes" role="alert"></p>
        </div>

        <div class="field span-2" data-field="is_active">
          <label class="switch" for="is_active">
            <input type="checkbox" id="is_active" name="is_active" role="switch"${value.is_active === false ? '' : ' checked'}>
            <span class="switch__track" aria-hidden="true"></span>
            <span class="switch__label">Active <span class="switch__hint">Retired materials stay on saved quotations but are hidden from new ones.</span></span>
          </label>
          <p class="field__error" data-error-for="is_active" role="alert"></p>
        </div>
      </div>
    </form>`;
}

function openMaterialModal(row) {
  const isEdit = Boolean(row);
  const modal = createModal({
    title: isEdit ? `Edit ${row.name}` : 'Add a material',
    description: isEdit
      ? 'Update this material and save it back to the catalogue.'
      : 'Add a new material to the catalogue so it can be quoted.',
    size: 'wide',
  });

  modal.body.innerHTML = materialFormHtml(row);
  modal.footer.innerHTML = `
    <button type="button" class="btn btn--secondary" data-close>Cancel</button>
    <button type="submit" form="material-form" class="btn btn--primary">${isEdit ? 'Save changes' : 'Add material'}</button>`;

  const form = modal.body.querySelector('#material-form');
  const submitButton = modal.footer.querySelector('button[type="submit"]');

  bindForm(form, {
    rules: MATERIAL_RULES,
    submitButton,
    onSubmit: async (values) => {
      if (isEdit) {
        await api.patch(`/materials/${row.id}`, values);
      } else {
        await api.post('/materials', values);
      }
      modal.close();
      toastSuccess(
        isEdit ? 'Material updated' : 'Material added',
        `${values.name} saved to the catalogue.`,
      );
      await Promise.all([loadSummary(), loadList()]);
    },
  });
}

/* --------------------------------------------------------------------------
   Refresh prices
   -------------------------------------------------------------------------- */
async function refreshPrices() {
  const confirmed = await confirmAction({
    title: 'Refresh prices now?',
    message: 'This re-stamps every active material with today\'s date and records a refresh event. '
      + 'The live Wilcon Depot feed is not connected yet, so the prices themselves are not re-downloaded.',
    confirmLabel: 'Refresh prices',
  });
  if (!confirmed) return;

  const button = els.actions.querySelector('[data-refresh]');
  setButtonLoading(button, true, 'Refreshing prices…');
  try {
    const data = await api.post('/materials/refresh', {});
    toastSuccess('Prices refreshed', `${formatNumber(data.materials_updated || 0)} materials re-stamped.`);
    await Promise.all([loadSummary(), loadList()]);
  } catch (error) {
    toastError('The refresh failed', error?.message);
  } finally {
    setButtonLoading(button, false);
  }
}

/* --------------------------------------------------------------------------
   Finish packages and rates
   -------------------------------------------------------------------------- */
function packageBlock(pkg) {
  const items = pkg.items || [];
  const columns = isAdmin ? 6 : 5;
  const rows = items.length
    ? items.map((item) => `
        <tr>
          <td>${escapeHtml(workLabel(item.work_type))}</td>
          <td>${escapeHtml(item.description || '—')}</td>
          <td>${escapeHtml(item.brand || '—')}</td>
          <td class="num">${escapeHtml(formatPeso(item.unit_price, { symbol: true }))}</td>
          <td class="num">${escapeHtml(formatPeso(item.rate_per_sqm, { symbol: true }))}</td>
          ${isAdmin ? `<td class="actions"><button type="button" class="btn btn--secondary btn--sm" data-rate="${escapeHtml(item.id)}">Edit rate</button></td>` : ''}
        </tr>`).join('')
    : `<tr><td colspan="${columns}">${stateHtml({ iconName: 'empty', title: 'No lines yet', text: 'This package has no work lines recorded.' })}</td></tr>`;

  return `
    <div class="work-block">
      <div class="work-block__head">
        <div class="work-block__title">
          ${escapeHtml(pkg.name || 'Finish package')}
          ${pkg.code ? `<span class="badge badge--navy badge--plain">${escapeHtml(pkg.code)}</span>` : ''}
        </div>
        <div class="work-block__rate">${escapeHtml(pkg.target_market || '')}</div>
      </div>
      ${pkg.description ? `<p class="text-soft text-sm">${escapeHtml(pkg.description)}</p>` : ''}
      <div class="table-wrap mt-3">
        <table class="table table--compact">
          <caption>Per-work rates for the ${escapeHtml(pkg.name || 'package')} package.</caption>
          <thead>
            <tr>
              <th scope="col">Work</th>
              <th scope="col">Description</th>
              <th scope="col">Brand</th>
              <th scope="col" class="num">Unit price</th>
              <th scope="col" class="num">Rate / sqm</th>
              ${isAdmin ? '<th scope="col" class="actions">Actions</th>' : ''}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

async function loadPackages() {
  els.packages.innerHTML = '<p class="text-muted">Loading finish packages…</p>';
  try {
    const data = await api.get('/pricing/finish-packages');
    const packages = data.packages || [];
    state.packages = packages;

    if (!packages.length) {
      els.packages.innerHTML = stateHtml({
        iconName: 'empty',
        title: 'No finish packages found',
        text: 'The Standard, Elegant, Luxury and Bare packages have not been set up yet.',
      });
      return;
    }
    els.packages.innerHTML = packages.map(packageBlock).join('');
  } catch (error) {
    els.packages.innerHTML = stateHtml({
      iconName: 'alert',
      title: 'The packages could not be loaded',
      text: error?.message || 'Please try again in a moment.',
    });
  }
}

function findItem(id) {
  for (const pkg of state.packages) {
    const item = (pkg.items || []).find((candidate) => candidate.id === id);
    if (item) return item;
  }
  return null;
}

function openRateModal(item) {
  const modal = createModal({
    title: `Edit rate — ${workLabel(item.work_type)}`,
    description: 'The rate per square metre used to cost this line in the package.',
  });

  const initialRate = Number(item.rate_per_sqm) || 0;

  modal.body.innerHTML = `
    <form id="rate-form" novalidate>
      <div class="error-summary" data-error-summary tabindex="-1" role="alert" aria-live="assertive"></div>
      <div class="field" data-field="rate_per_sqm">
        <label class="field__label" for="rate_per_sqm">Rate per square metre <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required, PHP)</span></label>
        <input class="input" type="number" id="rate_per_sqm" name="rate_per_sqm" min="0" max="1000000" step="0.01"
               value="${escapeHtml(initialRate)}" aria-describedby="rate_per_sqm-help" required>
        <p class="field__help" id="rate_per_sqm-help">Applied to every square metre of this work. Between 0 and 1,000,000.</p>
        <p class="field__error" data-error-for="rate_per_sqm" role="alert"></p>
      </div>
      <div class="material-preview" aria-live="polite">
        <div class="material-preview__meta">
          <div class="material-preview__name">Sample: 100 sqm floor area</div>
          <div class="material-preview__brand" id="rate-preview"></div>
        </div>
      </div>
    </form>`;

  modal.footer.innerHTML = `
    <button type="button" class="btn btn--secondary" data-close>Cancel</button>
    <button type="submit" form="rate-form" class="btn btn--primary">Save rate</button>`;

  const form = modal.body.querySelector('#rate-form');
  const input = form.querySelector('#rate_per_sqm');
  const preview = form.querySelector('#rate-preview');

  const updatePreview = () => {
    const rate = Number(input.value) || 0;
    preview.textContent = `100 sqm × ${formatPeso(rate, { symbol: true })} = ${formatPeso(rate * 100, { symbol: true })}`;
  };
  input.addEventListener('input', updatePreview);
  updatePreview();

  bindForm(form, {
    rules: { rate_per_sqm: { label: 'Rate per square metre', required: true, type: 'number', min: 0, max: 1000000 } },
    submitButton: modal.footer.querySelector('button[type="submit"]'),
    onSubmit: async (values) => {
      await api.patch(`/pricing/finish-package-items/${item.id}`, { rate_per_sqm: values.rate_per_sqm });
      modal.close();
      toastSuccess('Rate updated', `${workLabel(item.work_type)} is now ${formatPeso(values.rate_per_sqm, { symbol: true })} per sqm.`);
      await loadPackages();
    },
  });
}

/* --------------------------------------------------------------------------
   Filters
   -------------------------------------------------------------------------- */
function syncFiltersToUrl() {
  setParams({
    keyword: state.keyword,
    work_type: state.work_type,
    include_inactive: state.include_inactive ? 'true' : '',
    page: state.page > 1 ? state.page : '',
  });
}

function applyFilters() {
  state.keyword = els.keyword.value.trim();
  state.work_type = WORK_ORDER.includes(els.work.value) ? els.work.value : '';
  state.include_inactive = els.include.checked;
  state.page = 1;
  syncFiltersToUrl();
  loadList();
}

function resetFilters() {
  els.keyword.value = '';
  els.work.value = '';
  els.include.checked = false;
  state.keyword = '';
  state.work_type = '';
  state.include_inactive = false;
  state.page = 1;
  syncFiltersToUrl();
  loadList();
}

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */
function init() {
  renderHeader();

  // Reflect the filters restored from the address bar.
  els.keyword.value = state.keyword;
  els.work.value = WORK_ORDER.includes(state.work_type) ? state.work_type : '';
  els.include.checked = state.include_inactive;

  els.filters.addEventListener('submit', (event) => {
    event.preventDefault();
    applyFilters();
  });
  els.filters.addEventListener('reset', (event) => {
    event.preventDefault();
    resetFilters();
  });

  // Row actions and the retry button inside the table.
  els.body.addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit]');
    if (edit) { openMaterialModal(findMaterial(edit.dataset.edit)); return; }
    const retire = event.target.closest('[data-retire]');
    if (retire) { retireMaterial(findMaterial(retire.dataset.retire)); return; }
    if (event.target.closest('[data-retry]')) loadList();
  });

  // Package rate buttons.
  els.packages.addEventListener('click', (event) => {
    const button = event.target.closest('[data-rate]');
    if (!button) return;
    const item = findItem(button.dataset.rate);
    if (item) openRateModal(item);
  });

  bindPagination(els.pagination, (page) => {
    state.page = page;
    syncFiltersToUrl();
    loadList();
  });

  return Promise.all([loadSummary(), loadList(), loadPackages()]);
}

// Booting happens last so every `const` above is initialised first.
if (currentUser) await init();
