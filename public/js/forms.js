/**
 * Form engine: reading, validating, and reporting errors.
 *
 * The rules here deliberately mirror server/lib/validation.js and the database
 * CHECK constraints so the user sees the same message in the browser that the
 * server would produce. The browser copy exists purely for speed and comfort -
 * the server re-validates everything.
 *
 * Markup convention used by every form in this project:
 *
 *   <div class="field" data-field="client_name">
 *     <label class="field__label" for="client_name">Client full name <span class="req">*</span></label>
 *     <input class="input" id="client_name" name="client_name">
 *     <p class="field__help" id="client_name-help">2-60 characters.</p>
 *     <p class="field__error" data-error-for="client_name" role="alert"></p>
 *   </div>
 */
import { escapeHtml } from './util.js';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/;
export const PHONE_RE = /^(\+639|09)[0-9]{9}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** Today in Manila - the boundary used by notPast / notFuture rules. */
export function todayISO() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isBlank(value) {
  return value === undefined || value === null
    || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0);
}

/* --------------------------------------------------------------------------
   Reading values out of the DOM
   -------------------------------------------------------------------------- */
function nodesFor(form, name) {
  const raw = form.elements[name];
  if (!raw) return [];
  if (typeof raw.length === 'number' && typeof raw.tagName !== 'string') return Array.from(raw);
  return [raw];
}

function readOne(form, name, rule = {}) {
  const nodes = nodesFor(form, name);
  if (!nodes.length) return undefined;

  if (rule.type === 'array') {
    return nodes.filter((node) => node.checked).map((node) => node.value);
  }
  if (rule.type === 'boolean') return Boolean(nodes[0].checked);
  if (rule.type === 'file') return nodes[0].files?.[0] || null;

  const first = nodes[0];
  if (first.type === 'checkbox') return Array.from(nodes).filter((n) => n.checked).map((n) => n.value);
  if (first.type === 'radio') return nodes.find((n) => n.checked)?.value ?? '';
  return first.value;
}

/** Reads every field mentioned in `rules` plus any field in `extraNames`. */
export function readValues(form, rules = {}, extraNames = []) {
  const values = {};
  const names = new Set([...Object.keys(rules), ...extraNames]);
  for (const name of names) values[name] = readOne(form, name, rules[name]);
  return values;
}

/* --------------------------------------------------------------------------
   Validating
   -------------------------------------------------------------------------- */
/**
 * @param {object} values
 * @param {object} rules  { field: { label, required, type, min, max, ... } }
 * @returns {{ valid: boolean, errors: Record<string,string>, value: object }}
 */
export function validateValues(values = {}, rules = {}) {
  const errors = {};
  const value = {};

  for (const [field, rule] of Object.entries(rules)) {
    const label = rule.label || field;
    const raw = values[field];

    if (isBlank(raw)) {
      if (rule.required) {
        errors[field] = `${label} is required.`;
      } else if (rule.default !== undefined) {
        value[field] = rule.default;
      } else if (rule.type === 'array') {
        value[field] = [];
      } else if (rule.type === 'boolean') {
        value[field] = false;
      } else {
        value[field] = null;
      }
      continue;
    }

    const type = rule.type || 'string';

    switch (type) {
      case 'string': {
        const clean = String(raw).trim();
        if (rule.minLength && clean.length < rule.minLength) {
          errors[field] = `${label} must be at least ${rule.minLength} characters.`;
        } else if (rule.maxLength && clean.length > rule.maxLength) {
          errors[field] = `${label} must be ${rule.maxLength} characters or fewer.`;
        } else if (rule.pattern && !rule.pattern.test(clean)) {
          errors[field] = rule.patternMessage || `${label} is not in the expected format.`;
        } else {
          value[field] = clean;
        }
        break;
      }

      case 'email': {
        const clean = String(raw).trim().toLowerCase();
        if (!EMAIL_RE.test(clean)) {
          errors[field] = `${label} must look like an email address, for example name@example.com.`;
        } else if (clean.length > 254) {
          errors[field] = `${label} is too long.`;
        } else {
          value[field] = clean;
        }
        break;
      }

      case 'phone': {
        const clean = String(raw).replace(/[\s\-()]/g, '');
        if (!PHONE_RE.test(clean)) {
          errors[field] = `${label} must be a Philippine mobile number, for example 09171234567 or +639171234567.`;
        } else {
          value[field] = clean;
        }
        break;
      }

      case 'number':
      case 'int': {
        const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw).replace(/,/g, ''));
        if (!Number.isFinite(n)) {
          errors[field] = `${label} must be a number.`;
        } else if (type === 'int' && !Number.isInteger(n)) {
          errors[field] = `${label} must be a whole number.`;
        } else if (rule.min !== undefined && n < rule.min) {
          errors[field] = `${label} must be at least ${rule.min}.`;
        } else if (rule.max !== undefined && n > rule.max) {
          errors[field] = `${label} must be ${rule.max} or less.`;
        } else {
          value[field] = type === 'int' ? Math.round(n) : Number(n.toFixed(rule.decimals ?? 2));
        }
        break;
      }

      case 'date': {
        const clean = String(raw).slice(0, 10);
        if (!isRealDate(clean)) {
          errors[field] = `${label} must be a valid date.`;
        } else if (rule.notPast && clean < todayISO()) {
          errors[field] = `${label} cannot be in the past.`;
        } else if (rule.notFuture && clean > todayISO()) {
          errors[field] = `${label} cannot be in the future.`;
        } else {
          value[field] = clean;
        }
        break;
      }

      case 'time': {
        const clean = String(raw).slice(0, 8);
        if (!TIME_RE.test(clean)) {
          errors[field] = `${label} must be a valid time (HH:MM).`;
        } else {
          value[field] = clean.length === 5 ? `${clean}:00` : clean;
        }
        break;
      }

      case 'enum': {
        const clean = String(raw).trim();
        if (rule.values && !rule.values.includes(clean)) {
          errors[field] = `${label} must be one of: ${rule.values.join(', ')}.`;
        } else {
          value[field] = clean;
        }
        break;
      }

      case 'uuid': {
        const clean = String(raw).trim();
        if (!UUID_RE.test(clean)) errors[field] = `${label} is not a valid reference.`;
        else value[field] = clean;
        break;
      }

      case 'array': {
        const list = Array.isArray(raw) ? raw : [raw];
        const cleaned = list.map((item) => String(item).trim()).filter(Boolean);
        const invalid = rule.values ? cleaned.filter((item) => !rule.values.includes(item)) : [];
        if (invalid.length) {
          errors[field] = `${label} contains an unknown option (${invalid.join(', ')}).`;
        } else if (rule.minItems && cleaned.length < rule.minItems) {
          errors[field] = `Select at least ${rule.minItems} option for ${label.toLowerCase()}.`;
        } else {
          value[field] = cleaned;
        }
        break;
      }

      case 'boolean': {
        value[field] = raw === true || raw === 'true' || raw === 1 || raw === '1';
        break;
      }

      case 'file': {
        const file = raw instanceof File ? raw : null;
        if (!file) {
          value[field] = null;
          break;
        }
        const maxMb = rule.maxFileMb ?? 5;
        if (file.size > maxMb * 1024 * 1024) {
          errors[field] = `${label} must be ${maxMb} MB or smaller (this file is ${(file.size / 1024 / 1024).toFixed(1)} MB).`;
        } else if (rule.accept?.length) {
          const allowed = rule.accept.map((mime) => mime.toLowerCase());
          const nameLower = file.name.toLowerCase();
          const extensionOk = (rule.extensions || []).some((ext) => nameLower.endsWith(ext));
          if (!allowed.includes((file.type || '').toLowerCase()) && !extensionOk) {
            errors[field] = `${label} must be one of: ${(rule.extensions || allowed).join(', ')}.`;
          } else {
            value[field] = file;
          }
        } else {
          value[field] = file;
        }
        break;
      }

      default:
        value[field] = raw;
    }
  }

  // Cross-field rules (password confirmation, date ordering, ...).
  for (const [field, rule] of Object.entries(rules)) {
    if (rule.matches && !errors[field] && value[field] !== value[rule.matches.field]) {
      errors[field] = rule.matches.message || `${rule.label} does not match.`;
    }
    if (rule.after && !errors[field] && value[field] && value[rule.after.field] && value[field] < value[rule.after.field]) {
      errors[field] = rule.after.message || `${rule.label} cannot be earlier than ${rule.after.label}.`;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors, value };
}

/* --------------------------------------------------------------------------
   Reporting errors
   -------------------------------------------------------------------------- */
function fieldWrapper(form, name) {
  try {
    return form.querySelector(`[data-field="${CSS.escape(name)}"]`);
  } catch {
    return null;
  }
}

/** Clears every error message currently shown inside `form`. */
export function clearErrors(form) {
  form.querySelectorAll('.field.has-error').forEach((field) => {
    field.classList.remove('has-error');
    const error = field.querySelector('.field__error');
    if (error) error.textContent = '';
  });
  form.querySelectorAll('[aria-invalid="true"]').forEach((control) => {
    control.removeAttribute('aria-invalid');
  });
  const summary = form.querySelector('.error-summary')
    || document.querySelector('[data-error-summary]');
  if (summary) {
    summary.classList.remove('is-visible');
    summary.innerHTML = '';
  }
}

/** Writes a single message under a field. */
export function setFieldError(form, name, message) {
  const wrapper = fieldWrapper(form, name);
  const nodes = nodesFor(form, name);

  if (!wrapper) return null;
  wrapper.classList.add('has-error');

  const error = wrapper.querySelector('.field__error') || wrapper.querySelector('[data-error-for]');
  if (error) {
    const id = error.id || `${name.replace(/[^a-zA-Z0-9_-]/g, '-')}-error`;
    error.id = id;
    error.textContent = message;
    error.setAttribute('role', 'alert');
    for (const node of nodes) {
      const describedBy = new Set((node.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      describedBy.add(id);
      node.setAttribute('aria-describedby', Array.from(describedBy).join(' '));
      node.setAttribute('aria-invalid', 'true');
    }
  }
  return nodes[0] || null;
}

/**
 * Paints all server or client errors, focuses the first invalid control and
 * renders the summary block at the top of the form.
 */
export function applyErrors(form, errors = {}, rules = {}) {
  clearErrors(form);
  const names = Object.keys(errors);
  if (!names.length) return false;

  let firstControl = null;
  for (const name of names) {
    const control = setFieldError(form, name, errors[name]);
    if (!firstControl && control) firstControl = control;
  }

  const summary = form.querySelector('.error-summary')
    || document.querySelector('[data-error-summary]');
  if (summary) {
    const list = names.map((name) => {
      const label = rules[name]?.label || name;
      return `<li><a href="#${fieldWrapper(form, name)?.querySelector('input,select,textarea')?.id || ''}">
        ${escapeHtml(label)}: ${escapeHtml(errors[name])}</a></li>`;
    }).join('');
    summary.innerHTML = `
      <h3>Please correct ${names.length} ${names.length === 1 ? 'field' : 'fields'} before continuing</h3>
      <ul>${list}</ul>`;
    summary.classList.add('is-visible');
  }

  if (firstControl?.focus) {
    (summary || firstControl).scrollIntoView({ block: 'center', behavior: 'smooth' });
    firstControl.focus({ preventScroll: true });
  }
  return false;
}

/** Highlights a server-side error that is not tied to a single field. */
export function showFormAlert(form, message, type = 'danger') {
  let alert = form.querySelector('[data-form-alert]');
  if (!alert) {
    alert = document.createElement('div');
    alert.setAttribute('data-form-alert', '');
    alert.className = 'alert';
    alert.style.marginBottom = 'var(--space-5)';
    form.prepend(alert);
  } else {
    alert.className = 'alert';
  }
  alert.classList.add(`alert--${type}`);
  alert.innerHTML = `<span class="alert__icon" aria-hidden="true">&#9888;</span>
    <span class="alert__body">${escapeHtml(message)}</span>`;
  alert.setAttribute('role', 'alert');
  alert.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export function clearFormAlert(form) {
  form.querySelector('[data-form-alert]')?.remove();
}

/* --------------------------------------------------------------------------
   Submit-button loading state
   -------------------------------------------------------------------------- */
export function setButtonLoading(button, loading, loadingText) {
  if (!button) return;
  if (loading) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.classList.add('is-loading');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (loadingText) button.setAttribute('aria-label', loadingText);
  } else {
    button.classList.remove('is-loading');
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
  }
}

/* --------------------------------------------------------------------------
   Binding
   -------------------------------------------------------------------------- */
/**
 * Wires validation, submit and reset for a form.
 *
 * @param {HTMLFormElement} form
 * @param {object} options
 * @param {object} options.rules      validation rules keyed by field name
 * @param {Function} options.onSubmit async (values, context) => void
 * @param {Function} [options.onReset]
 * @param {HTMLElement|string} [options.submitButton]
 * @param {boolean} [options.validateOnBlur=true]
 * @returns {{ reset: Function, validate: Function, values: Function, form: HTMLFormElement }}
 */
export function bindForm(form, {
  rules = {},
  onSubmit = async () => {},
  onReset = null,
  submitButton = null,
  validateOnBlur = true,
} = {}) {
  const button = typeof submitButton === 'string' ? form.querySelector(submitButton) : submitButton;

  const validate = () => {
    const values = readValues(form, rules);
    const result = validateValues(values, rules);
    if (!result.valid) applyErrors(form, result.errors, rules);
    else clearErrors(form);
    return result;
  };

  // Re-validate a field as soon as the user has finished with it, so errors
  // clear themselves the moment the input becomes valid.
  if (validateOnBlur) {
    form.addEventListener('focusout', (event) => {
      const name = event.target?.name;
      if (!name || !rules[name]) return;
      const wrapper = fieldWrapper(form, name);
      if (!wrapper?.classList.contains('has-error')) return;
      const { errors } = validateValues(readValues(form, rules), { [name]: rules[name] });
      if (errors[name]) setFieldError(form, name, errors[name]);
      else {
        wrapper.classList.remove('has-error');
        wrapper.querySelector('.field__error')?.replaceChildren();
      }
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormAlert(form);

    const result = validate();
    if (!result.valid) return;

    setButtonLoading(button, true);
    try {
      await onSubmit(result.value, { form, button, rules });
    } catch (error) {
      const fields = error?.fields;
      if (fields && Object.keys(fields).length) applyErrors(form, fields, rules);
      else showFormAlert(form, error?.message || 'The form could not be saved. Please try again.');
    } finally {
      setButtonLoading(button, false);
    }
  });

  form.addEventListener('reset', (event) => {
    if (onReset) {
      // Let the caller decide whether to cancel the native reset.
      const proceed = onReset(event);
      if (proceed === false) event.preventDefault();
    }
    window.setTimeout(() => { clearErrors(form); clearFormAlert(form); }, 0);
  });

  return { form, validate, reset: () => form.reset(), values: () => readValues(form, rules) };
}

/* --------------------------------------------------------------------------
   Small field behaviours
   -------------------------------------------------------------------------- */

/** Live character counters: <span class="char-counter" data-counter-for="remarks"> */
export function initCharCounters(root = document) {
  root.querySelectorAll('[data-counter-for]').forEach((output) => {
    const name = output.dataset.counterFor;
    const control = root.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!control) return;
    const max = Number(control.getAttribute('maxlength')) || Number(output.dataset.max) || 0;
    const update = () => {
      const length = control.value.length;
      output.textContent = max ? `${length} / ${max} characters` : `${length} characters`;
      output.classList.toggle('is-near-limit', max > 0 && length >= max * 0.9 && length <= max);
      output.classList.toggle('is-over-limit', max > 0 && length > max);
    };
    control.addEventListener('input', update);
    update();
  });
}

/** Reflects the chosen file's name inside a .file-drop block. */
export function initFileDrops(root = document) {
  root.querySelectorAll('.file-drop').forEach((drop) => {
    const input = drop.querySelector('input[type="file"]');
    const output = drop.querySelector('[data-file-name]');
    if (!input) return;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      drop.classList.toggle('has-file', Boolean(file));
      if (output) output.textContent = file ? file.name : 'No file chosen';
    });
  });
}

/** Live output for range sliders: <output class="slider-field__value" data-slider-output="contingency_pct"> */
export function initSliders(root = document) {
  root.querySelectorAll('[data-slider-output]').forEach((output) => {
    const name = output.dataset.sliderOutput;
    const input = root.querySelector(`input[type="range"][name="${CSS.escape(name)}"]`);
    if (!input) return;
    const suffix = output.dataset.suffix ?? '%';
    const update = () => { output.textContent = `${input.value}${suffix}`; };
    input.addEventListener('input', update);
    update();
  });
}

/** Hides or shows elements based on the current value of another field. */
export function bindConditionalVisibility(form) {
  const refresh = () => {
    form.querySelectorAll('[data-when]').forEach((node) => {
      const [name, expected] = node.dataset.when.split('=');
      const control = form.elements[name];
      const current = control?.type === 'checkbox'
        ? String(Boolean(control.checked))
        : (control?.value ?? '');
      node.hidden = current !== expected;
    });
  };
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  refresh();
}

/* --------------------------------------------------------------------------
   Serialising for multipart uploads
   -------------------------------------------------------------------------- */
/**
 * Turns validated values into FormData. Arrays repeat the key (which is what
 * multer turns back into an array) and objects are JSON-encoded.
 */
export function toFormData(values = {}, { jsonFields = [], skipKeys = [] } = {}) {
  const data = new FormData();
  const skip = new Set(skipKeys);

  for (const [key, value] of Object.entries(values)) {
    if (skip.has(key) || value === undefined) continue;
    if (value === null) continue;

    if (value instanceof File) {
      data.append(key, value, value.name);
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => data.append(key, String(item)));
      continue;
    }
    if (typeof value === 'object') {
      data.append(key, JSON.stringify(value));
      continue;
    }
    if (typeof value === 'boolean') {
      data.append(key, value ? 'true' : 'false');
      continue;
    }
    data.append(key, String(value));
  }
  return data;
}

/** Re-enables the browser's own "this field looks wrong" hints without blocking submit. */
export function relaxNativeValidation(form) {
  form.setAttribute('novalidate', '');
  return form;
}
