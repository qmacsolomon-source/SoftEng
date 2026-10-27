/**
 * Quick Quotation - MAJOR FORM 1.
 *
 * The client's simplest path: pick a finish package, type the floor area, and
 * the estimate appears immediately. Nothing is saved until "Generate Quotation"
 * is pressed, at which point the record goes to POST /api/quotations/quick
 * (multipart, because it may carry a site plan) and the browser moves to the
 * printed Quotation Detail page.
 *
 * The rules below mirror validateQuickFields() in
 * server/routes/quotations.routes.js so the message a user sees in the browser
 * is the same one the server would produce. The server re-validates everything,
 * and the database CHECK constraints are the last line of defence.
 */
import { api } from '../api.js';
import { mountShell } from '../shell.js';
import { EMAIL_RE, PHONE_RE, bindForm, initCharCounters, initFileDrops, toFormData } from '../forms.js';
import {
  PROJECT_TYPES,
  WORK_LABELS,
  WORK_ORDER,
  escapeHtml,
  formatDateTime,
  formatNumber,
  formatPeso,
  qs,
  todayISO,
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
    active: 'quotation-quick',
    title: 'Quick Quotation',
    subtitle: 'A finish package plus a floor area gives an instant estimate.',
  }));
} catch { /* mountShell redirects to sign in */ }

/* --------------------------------------------------------------------------
   Elements
   -------------------------------------------------------------------------- */
const form = qs('#quick-form');
const projectTypeSelect = qs('#project_type');
const areaInput = qs('#floor_area_sqm');
const floorsInput = qs('#number_of_floors');
const startDateInput = qs('#target_start_date');
const clearButton = qs('#clear-btn');

const totalValue = qs('#total-value');
const totalHint = qs('#total-hint');
const panelState = qs('#panel-state');
const breakdownList = qs('#breakdown');
const panelSummary = qs('#panel-summary');
const priceUpdated = qs('#price-updated');
const packageRate = qs('#package-rate');

const steps = {
  client: qs('#step-client'),
  project: qs('#step-project'),
  scope: qs('#step-scope'),
  save: qs('#step-save'),
};

/* --------------------------------------------------------------------------
   Page state
   -------------------------------------------------------------------------- */
const PACKAGE_CODES = ['standard', 'elegant', 'luxury', 'bare'];

let defaultLaborPct = 15;
let previewSerial = 0;
let previewTimer = null;
let cleanSignature = '';
let panelIsLoading = false;

/* --------------------------------------------------------------------------
   Validation rules - a mirror of the server contract
   -------------------------------------------------------------------------- */
const QUICK_RULES = {
  client_name: { label: 'Client full name', required: true, type: 'string', minLength: 2, maxLength: 60 },
  client_email: { label: 'Email address', required: true, type: 'email' },
  client_phone: { label: 'Contact number', required: true, type: 'phone' },
  project_name: { label: 'Project name', type: 'string', maxLength: 160 },
  project_location: { label: 'Project location', required: true, type: 'string', minLength: 3, maxLength: 160 },
  project_type: { label: 'Project type', required: true, type: 'enum', values: PROJECT_TYPES },
  floor_area_sqm: { label: 'Floor area', required: true, type: 'number', min: 10, max: 5000 },
  number_of_floors: { label: 'Number of floors', required: true, type: 'int', min: 1, max: 20 },
  finish_package: { label: 'Finish package', required: true, type: 'enum', values: PACKAGE_CODES },
  works_included: { label: 'Works included', required: true, type: 'array', values: WORK_ORDER, minItems: 1 },
  target_start_date: { label: 'Target start date', type: 'date', notPast: true },
  remarks: { label: 'Remarks', type: 'string', maxLength: 300 },
  site_plan: {
    label: 'Site plan',
    type: 'file',
    maxFileMb: 5,
    accept: ['application/pdf', 'image/jpeg', 'image/png'],
    extensions: ['.pdf', '.jpg', '.jpeg', '.png'],
  },
  // Hidden fields. They are listed here so bindForm() carries them through with
  // the submission; the server ignores the ones it does not need.
  csrf_token: { label: 'Security token', type: 'string', maxLength: 120 },
  price_source_at: { label: 'Price source timestamp', type: 'string', maxLength: 40 },
  created_by: { label: 'Created by', type: 'string', maxLength: 60 },
  quotation_reference: { label: 'Quotation reference', type: 'string', maxLength: 40 },
};

/* --------------------------------------------------------------------------
   Step indicator
   -------------------------------------------------------------------------- */
function setStep(node, state) {
  node.classList.toggle('is-complete', state === 'complete');
  if (state === 'current') node.setAttribute('aria-current', 'step');
  else node.removeAttribute('aria-current');
}

/** Reads the current raw values the cheap way - used for the step guide only. */
function rawValues() {
  return {
    name: form.elements.client_name.value.trim(),
    email: form.elements.client_email.value.trim(),
    phone: form.elements.client_phone.value.replace(/[\s\-()]/g, ''),
    location: form.elements.project_location.value.trim(),
    type: form.elements.project_type.value,
    area: Number(areaInput.value),
    floors: Number(floorsInput.value),
    package: form.elements.finish_package.value,
    works: Array.from(form.querySelectorAll('input[name="works_included"]:checked')).map((n) => n.value),
  };
}

function updateSteps() {
  const v = rawValues();
  const clientOk = v.name.length >= 2 && EMAIL_RE.test(v.email) && PHONE_RE.test(v.phone);
  const projectOk = clientOk && v.location.length >= 3 && Boolean(v.type);
  const scopeOk = projectOk
    && Number.isFinite(v.area) && v.area >= 10 && v.area <= 5000
    && Number.isFinite(v.floors) && v.floors >= 1 && v.works.length > 0;

  if (!clientOk) {
    setStep(steps.client, 'current');
    setStep(steps.project, '');
    setStep(steps.scope, '');
    setStep(steps.save, '');
  } else if (!projectOk) {
    setStep(steps.client, 'complete');
    setStep(steps.project, 'current');
    setStep(steps.scope, '');
    setStep(steps.save, '');
  } else if (!scopeOk) {
    setStep(steps.client, 'complete');
    setStep(steps.project, 'complete');
    setStep(steps.scope, 'current');
    setStep(steps.save, '');
  } else {
    setStep(steps.client, 'complete');
    setStep(steps.project, 'complete');
    setStep(steps.scope, 'complete');
    setStep(steps.save, 'current');
  }
}

/* --------------------------------------------------------------------------
   Live estimate panel
   -------------------------------------------------------------------------- */
function showPanelState(options) {
  panelState.innerHTML = stateHtml(options);
  breakdownList.innerHTML = '';
  panelSummary.innerHTML = '';
  totalHint.textContent = options.text || '';
}

function setTotal(value) {
  totalValue.textContent = formatPeso(value);
  totalValue.classList.remove('is-updating');
  // Force the animation to restart on every change.
  void totalValue.offsetWidth;
  totalValue.classList.add('is-updating');
  window.setTimeout(() => totalValue.classList.remove('is-updating'), 700);
}

function renderPanel(breakdown) {
  const area = Number(breakdown.floor_area_sqm) || 0;
  const rate = Number(breakdown.rate_per_sqm_total) || 0;

  panelState.innerHTML = '';
  setTotal(breakdown.total_amount);
  totalHint.textContent = `${formatNumber(area, 0)} sqm × ${formatPeso(rate)} per sqm`
    + ` (${breakdown.items.length} ${breakdown.items.length === 1 ? 'work' : 'works'})`;
  packageRate.textContent = `${formatPeso(rate)} per sqm`;

  breakdownList.innerHTML = breakdown.items.map((item) => `
    <li class="breakdown-list__item">
      <span style="display:flex;flex-direction:column;">
        <span class="breakdown-list__work">${escapeHtml(item.work_label || WORK_LABELS[item.work_type] || item.work_type)}</span>
        <span class="breakdown-list__detail">${escapeHtml(formatPeso(item.rate_per_sqm))} / sqm · ${escapeHtml(item.brand || 'package brand')}</span>
      </span>
      <span class="breakdown-list__amount">${escapeHtml(formatPeso(item.line_total))}</span>
    </li>`).join('');

  const rows = [
    ['Materials and installation', formatPeso(breakdown.subtotal)],
  ];
  if (Number(breakdown.labor_amount) > 0) rows.push(['Labour', formatPeso(breakdown.labor_amount)]);
  if (Number(breakdown.contingency_amount) > 0) rows.push(['Contingency', formatPeso(breakdown.contingency_amount)]);

  panelSummary.innerHTML = `
    ${rows.map(([label, value]) => `
      <div class="quote-summary__row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
    <div class="quote-summary__row quote-summary__row--total">
      <dt>Estimated total</dt><dd>${escapeHtml(formatPeso(breakdown.total_amount))}</dd>
    </div>`;
}

/** The body sent to the preview endpoint - the same shape the save route validates. */
function previewPayload() {
  const v = rawValues();
  return {
    floor_area_sqm: v.area,
    finish_package: v.package,
    works_included: v.works,
    include_labor: true,
    labor_pct: defaultLaborPct,
    contingency_pct: 0,
  };
}

async function refreshPreview({ immediate = false } = {}) {
  window.clearTimeout(previewTimer);

  const run = async () => {
    const payload = previewPayload();

    // Nothing sensible to show yet - guide the user instead of calling the API.
    if (!payload.finish_package) {
      showPanelState({
        iconName: 'tag',
        title: 'Choose a finish package',
        text: 'Pick Standard, Elegant, Luxury or Bare to price the works.',
      });
      return;
    }
    if (!Number.isFinite(payload.floor_area_sqm) || payload.floor_area_sqm < 10) {
      showPanelState({
        iconName: 'sliders',
        title: 'Enter the floor area',
        text: 'A floor area of at least 10 sqm is needed before an estimate can be worked out.',
      });
      return;
    }
    if (!payload.works_included.length) {
      showPanelState({
        iconName: 'clipboard',
        title: 'Tick at least one work',
        text: 'Choose the works this quotation should cover - flooring, ceiling, walls and so on.',
      });
      return;
    }

    const serial = ++previewSerial;
    if (!panelIsLoading) {
      panelIsLoading = true;
      panelState.innerHTML = '<div class="skeleton" style="height:14px;"></div><div class="skeleton" style="width:70%;height:14px;margin-top:10px;"></div>';
      breakdownList.innerHTML = '';
      panelSummary.innerHTML = '';
    }

    try {
      const data = await api.post('/api/quotations/preview/quick', payload);
      if (serial !== previewSerial) return; // a newer request has already landed
      panelIsLoading = false;
      renderPanel(data);
    } catch (error) {
      if (serial !== previewSerial) return;
      panelIsLoading = false;
      showPanelState({
        iconName: 'alert',
        title: 'The estimate could not be worked out',
        text: error?.message || 'Please check the floor area and package, then try again.',
      });
    }
  };

  if (immediate) await run();
  else previewTimer = window.setTimeout(run, 400);
}

/* --------------------------------------------------------------------------
   "Has anything been typed?" - used by Clear Form
   -------------------------------------------------------------------------- */
function signature() {
  return JSON.stringify({
    name: form.elements.client_name.value.trim(),
    email: form.elements.client_email.value.trim(),
    phone: form.elements.client_phone.value.trim(),
    projectName: form.elements.project_name.value.trim(),
    location: form.elements.project_location.value.trim(),
    type: form.elements.project_type.value,
    area: areaInput.value,
    floors: floorsInput.value,
    package: form.elements.finish_package.value,
    works: rawValues().works.join(','),
    start: startDateInput.value,
    remarks: form.elements.remarks.value.trim(),
    file: form.elements.site_plan.files?.[0]?.name || '',
  });
}

function markClean() { cleanSignature = signature(); }
function isDirty() { return signature() !== cleanSignature; }

/* --------------------------------------------------------------------------
   Defaults
   -------------------------------------------------------------------------- */
function applyDefaults() {
  // The project type list comes from the shared vocabulary, so the form still
  // works even if the meta request fails.
  projectTypeSelect.innerHTML = ['<option value="">Select a project type…</option>']
    .concat(PROJECT_TYPES.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`))
    .join('');

  startDateInput.min = todayISO();

  // Hidden fields the server records alongside the quotation.
  form.elements.csrf_token.value = uid('csrf');
  form.elements.created_by.value = currentUser?.id || '';
  form.elements.quotation_reference.value = 'auto';
}

/** Fills the hidden price timestamp and the package blurbs from the live catalogue. */
async function loadMeta() {
  try {
    const meta = await api.get('/api/quotations/meta');
    defaultLaborPct = Number(meta.default_labor_pct) || defaultLaborPct;

    form.elements.price_source_at.value = meta.price_source_at || '';
    priceUpdated.textContent = meta.price_source_at ? formatDateTime(meta.price_source_at) : 'Not recorded yet';

    // Keep the visible package descriptions in step with the catalogue.
    for (const pkg of meta.finish_packages || []) {
      const node = form.querySelector(`[data-package-desc="${CSS.escape(pkg.code)}"]`);
      if (node && pkg.description) node.textContent = pkg.description;
    }
  } catch (error) {
    priceUpdated.textContent = 'Unavailable';
    toastError('Material prices could not be loaded', error?.message || 'You can still fill in the form, but the estimate may not appear.');
  }
}

/* --------------------------------------------------------------------------
   The form itself
   -------------------------------------------------------------------------- */
bindForm(form, {
  rules: QUICK_RULES,
  submitButton: qs('#generate-btn'),
  onSubmit: async (values) => {
    const { site_plan: sitePlan, ...rest } = values;

    const data = await api.postForm(
      '/api/quotations/quick',
      toFormData({ ...rest, site_plan: sitePlan }),
    );

    toastSuccess(
      'Quotation generated',
      `${data.reference_no} for ${values.client_name} — ${formatPeso(data.total_amount)}.`,
    );
    announce(`Quotation ${data.reference_no} generated.`);
    markClean();

    window.location.assign(`/quotation-detail.html?id=${encodeURIComponent(data.id)}`);
  },
});

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */
// The live panel follows every change to the fields it depends on.
['input', 'change'].forEach((eventName) => {
  form.addEventListener(eventName, (event) => {
    updateSteps();
    if (!event.target?.name) return;
    if (['floor_area_sqm', 'finish_package', 'works_included', 'number_of_floors'].includes(event.target.name)) {
      refreshPreview();
    }
  });
});

// Clear Form: ask first when something would actually be lost.
clearButton.addEventListener('click', async (event) => {
  if (!isDirty()) return;
  event.preventDefault();
  const confirmed = await confirmAction({
    title: 'Clear the whole form?',
    message: 'Everything typed here, including a chosen plan, will be lost.',
    confirmLabel: 'Clear form',
    danger: true,
  });
  if (!confirmed) return;

  form.reset();
  window.setTimeout(() => {
    updateSteps();
    markClean();
    refreshPreview({ immediate: true });
    announce('Form cleared.');
  }, 0);
});

// Ctrl + Enter (or Cmd + Enter) generates the quotation from anywhere.
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
  initFileDrops(form);
  initCharCounters(form);
  applyDefaults();
  updateSteps();
  markClean();

  showPanelState({
    iconName: 'bolt',
    title: 'Fill in the form to see an estimate',
    text: 'The estimate appears here as soon as the floor area and package are chosen.',
  });

  await loadMeta();
  await refreshPreview({ immediate: true });
}

init();
