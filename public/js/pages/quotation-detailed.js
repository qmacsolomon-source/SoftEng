/**
 * Customized (Detailed) Quotation - MAJOR FORM 2.
 *
 * Same eight works as the Quick Quotation, but every work can be repriced by
 * swapping its material and its style. The running total is recomputed on every
 * change through POST /api/quotations/preview/detailed (nothing is saved), and
 * "Save Detailed Quotation" posts the whole thing to
 * POST /api/quotations/detailed as multipart because of the attachment.
 *
 * Cost model, mirroring server/lib/estimation.js:
 *   work rate per sqm = base rate (from the base finish level)
 *                       x material cost_factor
 *                       x style multiplier
 *   work line total   = floor area x work rate per sqm
 *
 * The work blocks are generated from GET /api/quotations/meta, so a material
 * added in the catalogue shows up here without a code change.
 */
import { api } from '../api.js';
import { mountShell } from '../shell.js';
import {
  EMAIL_RE,
  PHONE_RE,
  bindConditionalVisibility,
  bindForm,
  initCharCounters,
  initFileDrops,
  initSliders,
  toFormData,
} from '../forms.js';
import {
  WORK_LABELS,
  WORK_ORDER,
  addDaysISO,
  escapeHtml,
  formatDateTime,
  formatNumber,
  formatPeso,
  qs,
  todayISO,
  truncate,
  uid,
} from '../util.js';
import {
  announce,
  confirmAction,
  stateHtml,
  toastError,
  toastSuccess,
} from '../ui.js';

// Paint the shell first; it throws after redirecting when there is no session.
let currentUser = null;
try {
  ({ user: currentUser } = await mountShell({
    active: 'quotation-detailed',
    title: 'Customized Quotation',
    subtitle: 'Choose a material and a style for each work, and watch the total move.',
  }));
} catch { /* mountShell redirects to sign in */ }

/* --------------------------------------------------------------------------
   Elements
   -------------------------------------------------------------------------- */
const form = qs('#detailed-form');
const NEW_CLIENT = '__new__';

const clientSelect = qs('#client_select');
const clientName = qs('#client_name');
const clientEmail = qs('#client_email');
const clientPhone = qs('#client_phone');
const clientIdInput = qs('#client_id');
const projectName = qs('#project_name');
const areaInput = qs('#floor_area_sqm');
const baseFinishSelect = qs('#base_finish_level');
const workBlocks = qs('#work-blocks');
const contingencyInput = qs('#contingency_pct');
const includeLaborInput = qs('#include_labor');
const validityInput = qs('#validity_date');
const resetButton = qs('#reset-btn');
const saveButton = qs('#save-btn');

const totalValue = qs('#total-value');
const totalHint = qs('#total-hint');
const panelState = qs('#panel-state');
const panelWarning = qs('#panel-warning');
const breakdownList = qs('#breakdown');
const panelSummary = qs('#panel-summary');
const priceUpdated = qs('#price-updated');
const baseRateNote = qs('#base-rate-note');

const steps = {
  client: qs('#step-client'),
  materials: qs('#step-materials'),
  terms: qs('#step-terms'),
};

/* --------------------------------------------------------------------------
   Page state
   -------------------------------------------------------------------------- */
const PACKAGE_ORDER = ['standard', 'elegant', 'luxury', 'bare'];

let packages = [];
let packageById = new Map();
let clients = [];
let clientById = new Map();
let materialsByWork = {};
let stylesByWork = {};
let materialById = new Map();
let baseRatesByPackageId = new Map();
let defaultLaborPct = 15;

let previewSerial = 0;
let previewTimer = null;
let panelIsLoading = false;
let cleanSignature = '';

/* --------------------------------------------------------------------------
   Validation rules - a mirror of the server contract
   -------------------------------------------------------------------------- */
const BASE_RULES = {
  client_select: { label: 'Client', required: true, type: 'string' },
  client_id: { label: 'Client reference', type: 'uuid' },
  client_name: { label: 'Client full name', required: true, type: 'string', minLength: 2, maxLength: 60 },
  client_email: { label: 'Email address', type: 'email' },
  client_phone: { label: 'Contact number', type: 'phone' },
  project_name: { label: 'Project name', required: true, type: 'string', minLength: 2, maxLength: 160 },
  floor_area_sqm: { label: 'Floor area', required: true, type: 'number', min: 10, max: 5000 },
  base_finish_level: { label: 'Base finish level', required: true, type: 'enum', values: PACKAGE_ORDER },
  contingency_pct: { label: 'Contingency', required: true, type: 'number', min: 0, max: 20 },
  include_labor: { label: 'Include labour cost', type: 'boolean', default: true },
  labor_pct: { label: 'Labour percentage', type: 'number', min: 0, max: 100, default: 15 },
  validity_date: { label: 'Quotation validity date', type: 'date', notPast: true },
  remarks: { label: 'Notes', type: 'string', maxLength: 300 },
  attachment: {
    label: 'Attachment',
    type: 'file',
    maxFileMb: 5,
    accept: [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    extensions: ['.pdf', '.jpg', '.jpeg', '.png', '.docx', '.xlsx'],
  },
  // Hidden fields. Quotation id, the price-source stamp and the author id ride
  // along with the submission; the server ignores the ones it does not need.
  quotation_id: { label: 'Quotation id', type: 'string', maxLength: 40 },
  price_source_at: { label: 'Price source timestamp', type: 'string', maxLength: 40 },
  created_by: { label: 'Created by', type: 'string', maxLength: 60 },
  csrf_token: { label: 'Security token', type: 'string', maxLength: 120 },
};

// One material select and one style radio group per work. The dotted names
// (materials.flooring) are exactly the keys the server reports errors under,
// so a server-side message lands under the right work block.
const WORK_RULES = {};
for (const work of WORK_ORDER) {
  WORK_RULES[`materials.${work}`] = {
    label: `${WORK_LABELS[work]} material`,
    required: true,
    type: 'uuid',
  };
  WORK_RULES[`styles.${work}`] = {
    label: `${WORK_LABELS[work]} style or variant`,
    type: 'string',
    maxLength: 60,
  };
}

const RULES = { ...BASE_RULES, ...WORK_RULES };

/* --------------------------------------------------------------------------
   Step indicator
   -------------------------------------------------------------------------- */
function setStep(node, state) {
  node.classList.toggle('is-complete', state === 'complete');
  if (state === 'current') node.setAttribute('aria-current', 'step');
  else node.removeAttribute('aria-current');
}

function allWorksChosen() {
  return WORK_ORDER.every((work) => Boolean(form.elements[`materials.${work}`]?.value));
}

function updateSteps() {
  const area = Number(areaInput.value);
  const clientOk = Boolean(clientSelect.value)
    && (clientSelect.value !== NEW_CLIENT || clientName.value.trim().length >= 2);
  const projectOk = clientOk && projectName.value.trim().length >= 2
    && Number.isFinite(area) && area >= 10 && area <= 5000;
  const worksOk = projectOk && Boolean(baseFinishSelect.value) && allWorksChosen();

  if (!clientOk || !projectOk) {
    setStep(steps.client, 'current');
    setStep(steps.materials, '');
    setStep(steps.terms, '');
  } else if (!worksOk) {
    setStep(steps.client, 'complete');
    setStep(steps.materials, 'current');
    setStep(steps.terms, '');
  } else {
    setStep(steps.client, 'complete');
    setStep(steps.materials, 'complete');
    setStep(steps.terms, 'current');
  }
}

/* --------------------------------------------------------------------------
   Building the eight work blocks from the catalogue
   -------------------------------------------------------------------------- */
function materialOptionLabel(material) {
  const brand = material.brand ? `${material.brand} ` : '';
  return `${brand}${material.name} — ${formatPeso(material.unit_price, { symbol: true })} / ${material.unit}`;
}

function workBlockHtml(work, index) {
  const materials = materialsByWork[work] || [];
  const styles = stylesByWork[work] || [];

  const options = materials.length
    ? materials.map((material, position) => `
        <option value="${escapeHtml(material.id)}"${position === 0 ? ' selected' : ''}>
          ${escapeHtml(truncate(materialOptionLabel(material), 96))}
        </option>`).join('')
    : '<option value="">No materials available</option>';

  const styleHtml = styles.length
    ? `<div class="option-grid option-grid--compact" role="radiogroup" aria-labelledby="style-label-${work}">
        ${styles.map((style, position) => `
          <label class="option">
            <input type="radio" name="styles.${work}" value="${escapeHtml(style.code)}"${position === 0 ? ' checked' : ''}>
            <span class="option__body">
              <span class="option__title">${escapeHtml(style.label)}</span>
              ${style.description ? `<span class="option__desc">${escapeHtml(style.description)}</span>` : ''}
            </span>
          </label>`).join('')}
      </div>`
    : '<p class="field__help">No style variants are set up for this work, so the material alone sets its price.</p>';

  return `
    <section class="work-block">
      <div class="work-block__head">
        <span class="work-block__title">
          <span class="work-block__index" aria-hidden="true">${index + 1}</span>
          ${escapeHtml(WORK_LABELS[work])}
        </span>
        <span class="work-block__rate" data-rate-for="${work}">Rate: —</span>
      </div>

      <div class="field" data-field="materials.${work}">
        <label class="field__label" for="material-${work}">
          Material <span class="req" aria-hidden="true">*</span>
          <span class="field__required-note">(required)</span>
        </label>
        <select class="select" id="material-${work}" name="materials.${work}"
                ${materials.length ? '' : 'disabled'} required
                aria-describedby="material-${work}-help">
          ${options}
        </select>
        <p class="field__help" id="material-${work}-help">
          Each option shows the brand, the unit price and the unit. The thumbnail below the list shows what it looks like.
        </p>
        <p class="field__error" data-error-for="materials.${work}" role="alert"></p>
      </div>

      <!-- Same information as the selected option, shown visually. Hidden from
           assistive technology so the select is not read out twice. -->
      <div class="material-preview" id="preview-${work}" aria-hidden="true"></div>

      <div class="field" data-field="styles.${work}">
        <span class="field__label" id="style-label-${work}">Style or variant</span>
        ${styleHtml}
        <p class="field__error" data-error-for="styles.${work}" role="alert"></p>
      </div>
    </section>`;
}

function renderWorkBlocks() {
  workBlocks.innerHTML = WORK_ORDER.map(workBlockHtml).join('');
  WORK_ORDER.forEach(renderMaterialPreview);
}

/** Refreshes the thumbnail and price line under one work's material select. */
function renderMaterialPreview(work) {
  const node = qs(`#preview-${work}`);
  const select = form.elements[`materials.${work}`];
  if (!node || !select) return;

  const material = materialById.get(select.value);
  if (!material) {
    node.innerHTML = '<span class="material-preview__brand">No material selected for this work.</span>';
    return;
  }

  const thumb = material.thumbnail_url
    ? `<img class="material-preview__thumb" src="${escapeHtml(material.thumbnail_url)}" alt="" loading="lazy">`
    : '<span class="material-preview__thumb">No photo</span>';

  node.innerHTML = `
    ${thumb}
    <span class="material-preview__meta" style="display:flex;flex-direction:column;">
      <span class="material-preview__name">${escapeHtml(material.name)}</span>
      <span class="material-preview__brand">${escapeHtml(material.brand || 'Unbranded')}
        · ${escapeHtml(formatPeso(material.unit_price, { symbol: true }))} / ${escapeHtml(material.unit)}
        · cost factor ${escapeHtml(formatNumber(material.cost_factor, 2))}</span>
    </span>`;
}

/* --------------------------------------------------------------------------
   Live running total
   -------------------------------------------------------------------------- */
function showPanelState(options) {
  panelState.innerHTML = stateHtml(options);
  panelWarning.innerHTML = '';
  breakdownList.innerHTML = '';
  panelSummary.innerHTML = '';
  totalHint.textContent = options.text || '';
}

function setTotal(value) {
  totalValue.textContent = formatPeso(value);
  totalValue.classList.remove('is-updating');
  void totalValue.offsetWidth; // restart the pop animation
  totalValue.classList.add('is-updating');
  window.setTimeout(() => totalValue.classList.remove('is-updating'), 700);
}

function renderPanel(breakdown) {
  const area = Number(breakdown.floor_area_sqm) || 0;

  panelState.innerHTML = '';
  setTotal(breakdown.total_amount);
  totalHint.textContent = `${formatNumber(area, 0)} sqm across ${breakdown.items.length}`
    + ` ${breakdown.items.length === 1 ? 'work' : 'works'} at an average of `
    + `${formatPeso(breakdown.rate_per_sqm_total)} per sqm.`;

  // Keep each work block's own rate line in step with the calculation.
  for (const item of breakdown.items) {
    const node = qs(`[data-rate-for="${item.work_type}"]`);
    if (node) node.textContent = `Rate: ${formatPeso(item.rate_per_sqm)} / sqm`;
  }

  if (breakdown.missingBaseRates?.length) {
    panelWarning.innerHTML = `
      <div class="alert alert--warning" role="alert">
        <span class="alert__icon" aria-hidden="true">&#9888;</span>
        <span class="alert__body">The chosen base finish level has no rate for
          ${escapeHtml(breakdown.missingBaseRates.map((w) => WORK_LABELS[w] || w).join(', '))}.</span>
      </div>`;
  } else {
    panelWarning.innerHTML = '';
  }

  breakdownList.innerHTML = breakdown.items.map((item) => `
    <li class="breakdown-list__item">
      <span style="display:flex;flex-direction:column;">
        <span class="breakdown-list__work">${escapeHtml(item.work_label || WORK_LABELS[item.work_type] || item.work_type)}</span>
        <span class="breakdown-list__detail">${escapeHtml(truncate(item.description || '', 30))}
          · ${escapeHtml(formatPeso(item.rate_per_sqm))}/sqm</span>
      </span>
      <span class="breakdown-list__amount">${escapeHtml(formatPeso(item.line_total))}</span>
    </li>`).join('');

  const rows = [['Materials and installation', formatPeso(breakdown.subtotal)]];
  if (Number(breakdown.labor_amount) > 0) rows.push(['Labour', formatPeso(breakdown.labor_amount)]);
  if (Number(breakdown.contingency_amount) > 0) rows.push(['Contingency', formatPeso(breakdown.contingency_amount)]);

  panelSummary.innerHTML = `
    ${rows.map(([label, value]) => `
      <div class="quote-summary__row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
    <div class="quote-summary__row quote-summary__row--total">
      <dt>Running total</dt><dd>${escapeHtml(formatPeso(breakdown.total_amount))}</dd>
    </div>`;
}

/** Current selections in the shape the preview and save routes expect. */
function currentSelections() {
  const materials = {};
  const styles = {};
  for (const work of WORK_ORDER) {
    const materialId = form.elements[`materials.${work}`]?.value || '';
    if (materialId) materials[work] = materialId;
    const styleCode = form.elements[`styles.${work}`]?.value || '';
    if (styleCode) styles[work] = styleCode;
  }
  return { materials, styles };
}

async function refreshPreview({ immediate = false } = {}) {
  window.clearTimeout(previewTimer);

  const run = async () => {
    const area = Number(areaInput.value);
    const { materials, styles } = currentSelections();

    if (!baseFinishSelect.value) {
      showPanelState({
        iconName: 'sliders',
        title: 'Choose a base finish level',
        text: 'The base finish level sets the starting rate per sqm for each work.',
      });
      return;
    }
    if (!Number.isFinite(area) || area < 10) {
      showPanelState({
        iconName: 'sliders',
        title: 'Enter the floor area',
        text: 'A floor area of at least 10 sqm is needed before an estimate can be worked out.',
      });
      return;
    }

    const serial = ++previewSerial;
    if (!panelIsLoading) {
      panelIsLoading = true;
      panelState.innerHTML = '<div class="skeleton" style="height:14px;"></div><div class="skeleton" style="width:70%;height:14px;margin-top:10px;"></div>';
      panelWarning.innerHTML = '';
      breakdownList.innerHTML = '';
      panelSummary.innerHTML = '';
    }

    try {
      const data = await api.post('/api/quotations/preview/detailed', {
        floor_area_sqm: area,
        base_finish_level: baseFinishSelect.value,
        contingency_pct: Number(contingencyInput.value) || 0,
        include_labor: includeLaborInput.checked,
        labor_pct: defaultLaborPct,
        materials,
        styles,
      });
      if (serial !== previewSerial) return;
      panelIsLoading = false;
      renderPanel(data);
    } catch (error) {
      if (serial !== previewSerial) return;
      panelIsLoading = false;
      showPanelState({
        iconName: 'alert',
        title: 'The estimate could not be worked out',
        text: error?.message || 'Please check the floor area and the base finish level, then try again.',
      });
    }
  };

  if (immediate) await run();
  else previewTimer = window.setTimeout(run, 400);
}

/* --------------------------------------------------------------------------
   "Has anything been changed?" - used by Reset Selections
   -------------------------------------------------------------------------- */
function signature() {
  const { materials, styles } = currentSelections();
  return JSON.stringify({
    client: clientSelect.value,
    clientName: clientName.value.trim(),
    clientEmail: clientEmail.value.trim(),
    clientPhone: clientPhone.value.trim(),
    project: projectName.value.trim(),
    area: areaInput.value,
    base: baseFinishSelect.value,
    contingency: contingencyInput.value,
    labor: includeLaborInput.checked,
    validity: validityInput.value,
    remarks: form.elements.remarks.value.trim(),
    file: form.elements.attachment.files?.[0]?.name || '',
    materials,
    styles,
  });
}

function markClean() { cleanSignature = signature(); }
function isDirty() { return signature() !== cleanSignature; }

/* --------------------------------------------------------------------------
   Dropdowns, defaults and generated fields
   -------------------------------------------------------------------------- */
function fillClientSelect() {
  const options = ['<option value="">Select a client…</option>'];
  for (const client of clients) {
    const detail = client.email || client.phone || client.address || '';
    const label = detail ? `${client.full_name} — ${detail}` : client.full_name;
    options.push(`<option value="${escapeHtml(client.id)}">${escapeHtml(truncate(label, 90))}</option>`);
  }
  options.push(`<option value="${NEW_CLIENT}">Add a new client…</option>`);
  clientSelect.innerHTML = options.join('');
}

function fillPackageSelect() {
  const sorted = [...packages].sort((a, b) => {
    const ai = PACKAGE_ORDER.indexOf(a.code);
    const bi = PACKAGE_ORDER.indexOf(b.code);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  baseFinishSelect.innerHTML = sorted.length
    ? sorted.map((pkg, index) => `
        <option value="${escapeHtml(pkg.code)}"${index === 0 ? ' selected' : ''}>${escapeHtml(pkg.name)}</option>`).join('')
    : '<option value="">No finish levels available</option>';
}

/** "Standard — PHP 8,900.00 per sqm across 8 works". */
function updateBaseRateNote() {
  const pkg = packageById.get(baseFinishSelect.value);
  const rates = baseRatesByPackageId.get(pkg?.id) || {};
  const values = Object.values(rates);
  if (!pkg || !values.length) {
    baseRateNote.textContent = '—';
    return;
  }
  const sum = values.reduce((total, rate) => total + Number(rate || 0), 0);
  baseRateNote.textContent = `${pkg.name} — ${formatPeso(sum)} per sqm across ${values.length} works`;
}

function applyDefaults() {
  validityInput.min = todayISO();
  validityInput.value = addDaysISO(30);

  form.elements.csrf_token.value = uid('csrf');
  form.elements.created_by.value = currentUser?.id || '';
  form.elements.quotation_id.value = 'auto';
  form.elements.labor_pct.value = String(defaultLaborPct);
  clientIdInput.value = '';
}

/* --------------------------------------------------------------------------
   Client selection
   -------------------------------------------------------------------------- */
/** Copies a saved client into the form, but only the parts that pass validation. */
function applyClientRecord(client) {
  clientIdInput.value = client?.id || '';
  clientName.value = client?.full_name || '';
  clientEmail.value = client && EMAIL_RE.test(client.email || '') ? client.email : '';
  clientPhone.value = client && PHONE_RE.test((client.phone || '').replace(/[\s\-()]/g, ''))
    ? client.phone
    : '';
}

clientSelect.addEventListener('change', () => {
  if (clientSelect.value === NEW_CLIENT) {
    applyClientRecord(null);
    clientName.focus();
  } else {
    applyClientRecord(clientById.get(clientSelect.value));
  }
  updateSteps();
});

/* --------------------------------------------------------------------------
   The form itself
   -------------------------------------------------------------------------- */
bindForm(form, {
  rules: RULES,
  submitButton: saveButton,
  onSubmit: async (values) => {
    const { materials, styles } = currentSelections();
    const isNewClient = clientSelect.value === NEW_CLIENT;
    const selectedClient = isNewClient ? null : clientById.get(clientSelect.value);

    const payload = {
      client_id: isNewClient ? undefined : (selectedClient?.id || undefined),
      client_name: values.client_name,
      client_email: values.client_email || undefined,
      client_phone: values.client_phone || undefined,
      project_name: values.project_name,
      floor_area_sqm: values.floor_area_sqm,
      base_finish_level: values.base_finish_level,
      contingency_pct: values.contingency_pct,
      include_labor: values.include_labor,
      labor_pct: values.labor_pct,
      validity_date: values.validity_date || undefined,
      remarks: values.remarks || undefined,
      materials,
      styles,
      attachment: values.attachment,
    };

    const data = await api.postForm('/api/quotations/detailed', toFormData(payload));

    toastSuccess(
      'Detailed quotation saved',
      `${data.reference_no} for ${values.client_name} — ${formatPeso(data.total_amount)}.`,
    );
    announce(`Detailed quotation ${data.reference_no} saved.`);
    markClean();

    window.location.assign(`/quotation-detail.html?id=${encodeURIComponent(data.id)}`);
  },
});

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */
function handleFormEvent(event) {
  updateSteps();

  const name = event.target?.name || '';
  if (name.startsWith('materials.')) renderMaterialPreview(name.slice('materials.'.length));

  const affectsPrice = name.startsWith('materials.')
    || name.startsWith('styles.')
    || ['floor_area_sqm', 'base_finish_level', 'contingency_pct', 'include_labor'].includes(name);

  if (affectsPrice) refreshPreview();
  if (name === 'base_finish_level') updateBaseRateNote();
}

form.addEventListener('input', handleFormEvent);
form.addEventListener('change', handleFormEvent);

// Reset Selections: back to the studio defaults, after a confirmation.
resetButton.addEventListener('click', async (event) => {
  if (!isDirty()) return;
  event.preventDefault();
  const confirmed = await confirmAction({
    title: 'Reset every selection?',
    message: 'All materials, styles, the client and the notes will go back to their defaults.',
    confirmLabel: 'Reset selections',
    danger: true,
  });
  if (!confirmed) return;

  form.reset();
  window.setTimeout(async () => {
    fillClientSelect();
    fillPackageSelect();
    applyDefaults();
    // form.reset() restores the first material and the first style from the
    // markup they were generated with, so the blocks do not need rebuilding.
    WORK_ORDER.forEach(renderMaterialPreview);
    updateBaseRateNote();
    updateSteps();
    markClean();
    await refreshPreview({ immediate: true });
    announce('Selections reset.');
  }, 0);
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
  initSliders(form);
  initFileDrops(form);
  initCharCounters(form);
  bindConditionalVisibility(form);
  applyDefaults();

  showPanelState({
    iconName: 'sliders',
    title: 'Choose a base finish level and a floor area',
    text: 'The running total appears here and updates with every change.',
  });

  let meta;
  try {
    meta = await api.get('/api/quotations/meta');
  } catch (error) {
    toastError('The catalogue could not be loaded', error?.message || 'Please refresh the page and try again.');
    workBlocks.innerHTML = stateHtml({
      iconName: 'alert',
      title: 'Materials and prices are unavailable',
      text: 'Without the catalogue the quotation cannot be priced. Refresh the page, or ask an Administrator to check the material prices.',
    });
    baseFinishSelect.innerHTML = '<option value="">Unavailable</option>';
    clientSelect.innerHTML = '<option value="">Unavailable</option>';
    return;
  }

  packages = meta.finish_packages || [];
  packageById = new Map(packages.map((pkg) => [pkg.id, pkg]));
  clients = meta.clients || [];
  clientById = new Map(clients.map((client) => [client.id, client]));
  materialsByWork = meta.materials_by_work || {};
  stylesByWork = meta.styles_by_work || {};
  defaultLaborPct = Number(meta.default_labor_pct) || defaultLaborPct;

  materialById = new Map();
  for (const list of Object.values(materialsByWork)) {
    for (const material of list) materialById.set(material.id, material);
  }

  baseRatesByPackageId = new Map();
  for (const item of meta.package_items || []) {
    const existing = baseRatesByPackageId.get(item.finish_package_id) || {};
    existing[item.work_type] = Number(item.rate_per_sqm) || 0;
    baseRatesByPackageId.set(item.finish_package_id, existing);
  }

  form.elements.price_source_at.value = meta.price_source_at || '';
  priceUpdated.textContent = meta.price_source_at ? formatDateTime(meta.price_source_at) : 'Not recorded yet';
  form.elements.labor_pct.value = String(defaultLaborPct);

  fillClientSelect();
  fillPackageSelect();
  renderWorkBlocks();
  updateBaseRateNote();
  updateSteps();
  markClean();

  await refreshPreview({ immediate: true });
}

init();
