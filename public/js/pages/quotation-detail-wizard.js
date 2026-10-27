/**
 * Three-step quotation wizard.
 *
 * The live figure on screen is a quick on-device estimate. Confirming posts the
 * form to POST /api/quotations/quick, which re-validates every field, prices it
 * from the database rates and stores the quotation (and site plan).
 */
import { mountShell } from '../shell.js';
import { EMAIL_RE, PHONE_RE, setButtonLoading, toFormData } from '../forms.js';
import { api } from '../api.js';
import { escapeHtml, formatPeso, todayISO } from '../util.js';
import { announce, toastSuccess } from '../ui.js';

try {
  await mountShell({
    active: 'quotations',
    title: 'New Quotation',
    subtitle: 'Build and review a quotation in three guided steps.',
  });
} catch { /* mountShell redirects to sign in */ }

const form = document.querySelector('#quotation-wizard');
const panels = Array.from(document.querySelectorAll('[data-step-panel]'));
const indicators = Array.from(document.querySelectorAll('[data-step-indicator]'));
const previousButton = document.querySelector('#previous-step');
const nextButton = document.querySelector('#next-step');
const submitButton = document.querySelector('#review-submit');
const summary = document.querySelector('#step-error-summary');
const dialog = document.querySelector('#summary-modal');
const modalSummary = document.querySelector('#modal-summary');
const confirmButton = document.querySelector('#confirm-submit');
const laborToggle = form.elements.include_labor;
const laborInput = form.elements.labor_pct;
const totalOutput = document.querySelector('#live-estimate');
const reviewTotal = document.querySelector('#review-total');
const reviewSummary = document.querySelector('#review-summary');

const STEP_FIELDS = [
  ['client_name', 'client_email', 'client_phone', 'project_name', 'project_location', 'project_type', 'floor_area_sqm', 'number_of_floors', 'target_start_date'],
  ['finish_package', 'works_included', 'contingency_pct', 'labor_pct'],
  ['validity_date', 'site_plan', 'remarks'],
];

const WORK_RATES = {
  flooring: 3200,
  ceiling: 1450,
  walls: 2100,
  roofing: 2800,
  doors_windows: 1900,
  toilet_bath: 1750,
  kitchen: 1600,
  electrical_lighting: 1250,
};

const PACKAGE_MULTIPLIERS = { bare: 0.82, standard: 1, elegant: 1.18, luxury: 1.42 };
const WORK_NAMES = {
  flooring: 'Flooring',
  ceiling: 'Ceiling',
  walls: 'Walls',
  roofing: 'Roofing',
  doors_windows: 'Doors and Windows',
  toilet_bath: 'Toilet and Bath',
  kitchen: 'Kitchen',
  electrical_lighting: 'Electrical and Lighting',
};
const PACKAGE_NAMES = { bare: 'Bare', standard: 'Standard', elegant: 'Elegant', luxury: 'Luxury' };
const ALLOWED_FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const ALLOWED_FILE_EXTENSIONS = /\.(pdf|jpe?g|png)$/i;

let currentStep = 0;
let submitted = false;

function value(name) {
  return String(form.elements[name]?.value || '').trim();
}

function checkedWorks() {
  return Array.from(form.querySelectorAll('input[name="works_included"]:checked'))
    .map((input) => input.value);
}

function fieldNode(name) {
  return form.querySelector(`[data-field="${name}"]`);
}

function fieldControls(name) {
  const control = form.elements[name];
  if (!control) return [];
  if (control instanceof RadioNodeList || Array.isArray(control)) return Array.from(control);
  return [control];
}

function setFieldError(name, message = '') {
  const field = fieldNode(name);
  const error = form.querySelector(`[data-error-for="${name}"]`);
  if (field) field.classList.toggle('has-error', Boolean(message));
  if (error) error.textContent = message;
  for (const control of fieldControls(name)) {
    if (control instanceof HTMLElement) {
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    }
  }
}

function validateField(name) {
  const raw = value(name);
  const number = Number(raw);
  const selectedFile = form.elements.site_plan.files?.[0];
  let message = '';

  switch (name) {
    case 'client_name':
      if (raw.length < 2 || raw.length > 60) message = 'Enter a name between 2 and 60 characters.';
      break;
    case 'client_email':
      if (!raw) message = 'Enter an email address.';
      else if (!EMAIL_RE.test(raw)) message = 'Enter a valid email address.';
      break;
    case 'client_phone': {
      const normalized = raw.replace(/[\s\-()]/g, '');
      if (!raw) message = 'Enter a contact number.';
      else if (!PHONE_RE.test(normalized)) message = 'Use 09 followed by 9 digits, or +639 followed by 9 digits.';
      break;
    }
    case 'project_name':
      if (raw.length > 160) message = 'Project name cannot exceed 160 characters.';
      break;
    case 'project_location':
      if (raw.length < 3 || raw.length > 160) message = 'Enter a location between 3 and 160 characters.';
      break;
    case 'project_type':
      if (!raw) message = 'Choose a project type.';
      break;
    case 'floor_area_sqm':
      if (!raw || !Number.isFinite(number) || number < 10 || number > 5000) message = 'Enter a floor area from 10 to 5,000 sqm.';
      break;
    case 'number_of_floors':
      if (!raw || !Number.isInteger(number) || number < 1 || number > 20) message = 'Enter a whole number of floors from 1 to 20.';
      break;
    case 'target_start_date':
    case 'validity_date':
      if (raw && raw < todayISO()) message = 'The date cannot be in the past.';
      break;
    case 'finish_package':
      if (!form.querySelector('input[name="finish_package"]:checked')) message = 'Choose a finish package.';
      break;
    case 'works_included':
      if (!checkedWorks().length) message = 'Select at least one work item.';
      break;
    case 'contingency_pct':
      if (!raw || !Number.isFinite(number) || number < 0 || number > 20) message = 'Enter a contingency from 0% to 20%.';
      break;
    case 'labor_pct':
      if (laborToggle.checked && (!raw || !Number.isFinite(number) || number < 0 || number > 100)) {
        message = 'Enter a labour percentage from 0% to 100%.';
      }
      break;
    case 'site_plan':
      if (selectedFile) {
        const validType = !selectedFile.type || ALLOWED_FILE_TYPES.has(selectedFile.type);
        const validExtension = ALLOWED_FILE_EXTENSIONS.test(selectedFile.name);
        if (selectedFile.size > 5 * 1024 * 1024) message = 'The attachment must be 5 MB or smaller.';
        else if (!validType || !validExtension) message = 'Choose a PDF, JPG or PNG file.';
      }
      break;
    case 'remarks':
      if (raw.length > 300) message = 'Remarks cannot exceed 300 characters.';
      break;
    default:
      break;
  }

  setFieldError(name, message);
  return message;
}

function clearSummary() {
  summary.classList.remove('is-visible');
  summary.replaceChildren();
}

function validateStep(index) {
  const errors = [];
  for (const name of STEP_FIELDS[index]) {
    const message = validateField(name);
    if (message) errors.push({ name, message });
  }
  if (!errors.length) {
    clearSummary();
    return true;
  }

  summary.innerHTML = `<h3>Please fix the following before continuing:</h3><ul>${errors
    .map(({ name, message }) => `<li><a href="#${escapeHtml(name)}">${escapeHtml(message)}</a></li>`)
    .join('')}</ul>`;
  summary.classList.add('is-visible');
  summary.focus();
  const firstControl = fieldControls(errors[0].name)[0];
  if (firstControl instanceof HTMLElement) firstControl.focus();
  announce(`There ${errors.length === 1 ? 'is' : 'are'} ${errors.length} field${errors.length === 1 ? '' : 's'} to correct.`);
  return false;
}

function renderStep() {
  panels.forEach((panel, index) => { panel.hidden = index !== currentStep; });
  indicators.forEach((indicator, index) => {
    indicator.classList.toggle('is-complete', index < currentStep);
    if (index === currentStep) indicator.setAttribute('aria-current', 'step');
    else indicator.removeAttribute('aria-current');
  });
  previousButton.hidden = currentStep === 0;
  nextButton.hidden = currentStep === panels.length - 1;
  submitButton.hidden = currentStep !== panels.length - 1;
  clearSummary();
  panels[currentStep].querySelector('h3')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function estimate() {
  const area = Number(value('floor_area_sqm'));
  const packageName = form.querySelector('input[name="finish_package"]:checked')?.value;
  const multiplier = PACKAGE_MULTIPLIERS[packageName] || 1;
  const baseRate = checkedWorks().reduce((sum, work) => sum + WORK_RATES[work], 0);
  const subtotal = Number.isFinite(area) && area > 0 ? area * baseRate * multiplier : 0;
  const labor = laborToggle.checked ? subtotal * (Number(value('labor_pct')) || 0) / 100 : 0;
  const contingency = (subtotal + labor) * (Number(value('contingency_pct')) || 0) / 100;
  return { subtotal, labor, contingency, total: subtotal + labor + contingency };
}

function detailRow(label, content) {
  return `<div class="wizard-summary__row"><dt>${escapeHtml(label)}</dt><dd>${content}</dd></div>`;
}

function summaryMarkup() {
  const estimateValues = estimate();
  const works = checkedWorks().map((work) => WORK_NAMES[work] || work).join(', ');
  const file = form.elements.site_plan.files?.[0];
  const projectName = value('project_name') || '—';
  return `
    <dl class="wizard-summary">
      ${detailRow('Client', escapeHtml(value('client_name')))}
      ${detailRow('Email', escapeHtml(value('client_email')))}
      ${detailRow('Contact number', escapeHtml(value('client_phone')))}
      ${detailRow('Project', escapeHtml(projectName))}
      ${detailRow('Location', escapeHtml(value('project_location')))}
      ${detailRow('Project type', escapeHtml(value('project_type')))}
      ${detailRow('Floor area', `${escapeHtml(value('floor_area_sqm'))} sqm · ${escapeHtml(value('number_of_floors'))} floor(s)`)}
      ${detailRow('Target start', escapeHtml(value('target_start_date') || '—'))}
      ${detailRow('Finish package', escapeHtml(PACKAGE_NAMES[form.querySelector('input[name="finish_package"]:checked')?.value] || '—'))}
      ${detailRow('Works included', escapeHtml(works || '—'))}
      ${detailRow('Subtotal', escapeHtml(formatPeso(estimateValues.subtotal)))}
      ${detailRow('Labour', escapeHtml(laborToggle.checked ? `${value('labor_pct')}% · ${formatPeso(estimateValues.labor)}` : 'Not included'))}
      ${detailRow('Contingency', `${escapeHtml(value('contingency_pct'))}% · ${escapeHtml(formatPeso(estimateValues.contingency))}`)}
      ${detailRow('Estimated total', `<strong>${escapeHtml(formatPeso(estimateValues.total))}</strong>`)}
      ${detailRow('Valid until', escapeHtml(value('validity_date') || '—'))}
      ${detailRow('Attachment', escapeHtml(file?.name || 'None'))}
      ${detailRow('Remarks', escapeHtml(value('remarks') || '—'))}
    </dl>`;
}

function refreshEstimate() {
  const total = formatPeso(estimate().total);
  totalOutput.textContent = total;
  reviewTotal.textContent = total;
  reviewSummary.innerHTML = summaryMarkup();
}

function openSummary() {
  modalSummary.innerHTML = `${summaryMarkup()}<p class="wizard-mock-note">Demo mode: confirming will only show a local success message. No data or files will be sent.</p>`;
  dialog.showModal();
  confirmButton.focus();
}

function serverErrors(error) {
  const fields = error?.fields || {};
  const entries = Object.entries(fields).filter(([name]) => form.elements[name]);
  entries.forEach(([name, message]) => setFieldError(name, String(message)));
  return entries;
}

async function confirmSubmit() {
  if (submitted) return;
  setButtonLoading(confirmButton, true, 'Saving…');
  try {
    const payload = {
      client_name: value('client_name'),
      client_email: value('client_email'),
      client_phone: value('client_phone').replace(/[\s\-()]/g, ''),
      project_name: value('project_name'),
      project_location: value('project_location'),
      project_type: value('project_type'),
      floor_area_sqm: value('floor_area_sqm'),
      number_of_floors: value('number_of_floors'),
      target_start_date: value('target_start_date'),
      finish_package: form.querySelector('input[name="finish_package"]:checked')?.value,
      works_included: checkedWorks(),
      include_labor: laborToggle.checked,
      labor_pct: laborToggle.checked ? value('labor_pct') : '',
      contingency_pct: value('contingency_pct'),
      validity_date: value('validity_date'),
      remarks: value('remarks'),
      site_plan: form.elements.site_plan.files?.[0] || null,
    };
    const data = await api.postForm('/api/quotations/quick', toFormData(payload));
    submitted = true;
    dialog.close();
    submitButton.disabled = true;
    toastSuccess('Quotation generated', `${data.reference_no} - ${formatPeso(data.total_amount)}.`);
    announce(`Quotation ${data.reference_no} generated.`);
    window.location.assign(`/quotation-detail.html?id=${encodeURIComponent(data.id)}`);
  } catch (error) {
    dialog.close();
    const bad = serverErrors(error);
    if (bad.length) {
      currentStep = STEP_FIELDS.findIndex((names) => names.includes(bad[0][0]));
      renderStep();
    }
    summary.innerHTML = `<h3>${escapeHtml(error?.message || 'The quotation could not be saved.')}</h3>`;
    summary.classList.add('is-visible');
    summary.focus();
  } finally {
    setButtonLoading(confirmButton, false);
  }
}

nextButton.addEventListener('click', () => {
  if (!validateStep(currentStep)) return;
  currentStep += 1;
  renderStep();
  refreshEstimate();
});

previousButton.addEventListener('click', () => {
  if (currentStep === 0) return;
  currentStep -= 1;
  renderStep();
  refreshEstimate();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (submitted || !validateStep(currentStep)) return;
  openSummary();
});

document.querySelector('#close-summary').addEventListener('click', () => dialog.close());
document.querySelector('#edit-quotation').addEventListener('click', () => {
  dialog.close();
  form.elements.validity_date.focus();
});
confirmButton.addEventListener('click', confirmSubmit);

form.addEventListener('input', (event) => {
  const name = event.target.name;
  if (name) setFieldError(name, '');
  clearSummary();
  if (name === 'include_labor') {
    laborInput.disabled = !laborToggle.checked;
    setFieldError('labor_pct', '');
  }
  if (name === 'remarks') document.querySelector('#remarks-count').textContent = String(event.target.value.length);
  refreshEstimate();
});

form.addEventListener('change', (event) => {
  const name = event.target.name;
  if (name) setFieldError(name, '');
  clearSummary();
  refreshEstimate();
});

form.addEventListener('focusout', (event) => {
  const name = event.target.name;
  if (name && STEP_FIELDS[currentStep].includes(name)) validateField(name);
});

laborInput.disabled = !laborToggle.checked;
form.elements.target_start_date.min = todayISO();
form.elements.validity_date.min = todayISO();
refreshEstimate();
