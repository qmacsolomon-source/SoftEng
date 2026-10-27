/**
 * Server-side validation and sanitisation.
 *
 * The browser validates too (for a fast, friendly experience) but the server
 * NEVER trusts it - every route re-validates with the same rules so that a
 * crafted request cannot bypass the checks. Database CHECK constraints are the
 * third and final line of defence.
 */

export const WORK_TYPES = [
  'flooring',
  'ceiling',
  'walls',
  'roofing',
  'doors_windows',
  'toilet_bath',
  'kitchen',
  'electrical_lighting',
];

export const WORK_LABELS = {
  flooring: 'Flooring',
  ceiling: 'Ceiling',
  walls: 'Walls',
  roofing: 'Roofing',
  doors_windows: 'Doors and Windows',
  toilet_bath: 'Toilet and Bath',
  kitchen: 'Kitchen',
  electrical_lighting: 'Electrical and Lighting',
};

export const QUOTATION_STATUSES = ['draft', 'sent', 'approved', 'rejected', 'expired'];
export const QUOTATION_TYPES = ['quick', 'detailed'];
export const PROJECT_STATUSES = ['planning', 'ongoing', 'completed'];
export const PROJECT_TYPES = [
  'Residential - New Build',
  'Residential - Renovation',
  'Residential - Extension',
  'Commercial - Fit-out',
  'Commercial - New Build',
  'Industrial / Warehouse',
  'Institutional',
  'Other',
];

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/;
/** Accepts 09XXXXXXXXX or +639XXXXXXXXX */
export const PHONE_RE = /^(\+639|09)[0-9]{9}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

/** Trims, collapses repeated whitespace and removes control characters. */
export function sanitizeString(value, { maxLength = 5000, trim = true } = {}) {
  if (value === null || value === undefined) return '';
  let out = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (trim) out = out.trim();
  return out.slice(0, maxLength);
}

/** True when the string is a real calendar date in YYYY-MM-DD form. */
export function isRealDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Today in the Philippines (UTC+8) as YYYY-MM-DD. */
export function todayManila() {
  const now = new Date();
  const manila = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return manila.toISOString().slice(0, 10);
}

/**
 * Rule-driven validator.
 *
 * validate(payload, {
 *   email: { label: 'Email address', required: true, type: 'email' },
 *   floor_area_sqm: { label: 'Floor area', required: true, type: 'number', min: 10, max: 5000 },
 * })
 *   -> { valid, errors: { field: 'plain-language message' }, value: { clean fields } }
 */
export function validate(payload = {}, rules = {}) {
  const errors = {};
  const value = {};

  for (const [field, rule] of Object.entries(rules)) {
    const label = rule.label || field;
    const raw = payload?.[field];
    const isBlank =
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && raw.trim() === '') ||
      (Array.isArray(raw) && raw.length === 0);

    if (isBlank) {
      if (rule.required) {
        errors[field] = `${label} is required.`;
      } else if (rule.default !== undefined) {
        value[field] = rule.default;
      } else if (rule.type === 'array' || rule.type === 'boolean') {
        value[field] = rule.type === 'array' ? [] : false;
      } else {
        value[field] = null;
      }
      continue;
    }

    const type = rule.type || 'string';

    switch (type) {
      case 'string': {
        const clean = sanitizeString(raw, { maxLength: rule.maxLength ?? 2000 });
        if (rule.minLength && clean.length < rule.minLength) {
          errors[field] = `${label} must be at least ${rule.minLength} characters.`;
        } else if (rule.maxLength && clean.length > rule.maxLength) {
          errors[field] = `${label} must be ${rule.maxLength} characters or fewer.`;
        } else {
          value[field] = clean;
        }
        break;
      }

      case 'email': {
        const clean = sanitizeString(raw, { maxLength: 254 }).toLowerCase();
        if (!EMAIL_RE.test(clean)) {
          errors[field] = `${label} must look like an email address, for example name@example.com.`;
        } else {
          value[field] = clean;
        }
        break;
      }

      case 'phone': {
        const clean = sanitizeString(raw, { maxLength: 20 }).replace(/[\s\-()]/g, '');
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
        const clean = sanitizeString(raw, { maxLength: 10 });
        if (!isRealDate(clean)) {
          errors[field] = `${label} must be a valid date (YYYY-MM-DD).`;
        } else if (rule.notPast && clean < todayManila()) {
          errors[field] = `${label} cannot be in the past.`;
        } else if (rule.notFuture && clean > todayManila()) {
          errors[field] = `${label} cannot be in the future.`;
        } else {
          value[field] = clean;
        }
        break;
      }

      case 'time': {
        const clean = sanitizeString(raw, { maxLength: 8 });
        if (!TIME_RE.test(clean)) {
          errors[field] = `${label} must be a valid time (HH:MM).`;
        } else {
          value[field] = clean.length === 5 ? `${clean}:00` : clean;
        }
        break;
      }

      case 'enum': {
        const clean = sanitizeString(raw, { maxLength: 60 });
        if (!rule.values.includes(clean)) {
          errors[field] = `${label} must be one of: ${rule.values.join(', ')}.`;
        } else {
          value[field] = clean;
        }
        break;
      }

      case 'uuid': {
        const clean = sanitizeString(raw, { maxLength: 40 });
        if (!isUuid(clean)) {
          errors[field] = `${label} is not a valid reference.`;
        } else {
          value[field] = clean;
        }
        break;
      }

      case 'array': {
        const list = Array.isArray(raw) ? raw : [raw];
        const cleaned = list.map((item) => sanitizeString(item, { maxLength: 60 })).filter(Boolean);
        const invalid = cleaned.filter((item) => rule.values && !rule.values.includes(item));
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

      default:
        value[field] = raw;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors, value };
}

/** Normalises optional filter values coming from query strings. */
export function readFilters(query = {}) {
  return {
    keyword: sanitizeString(query.keyword ?? query.q ?? '', { maxLength: 80 }),
    status: sanitizeString(query.status ?? '', { maxLength: 30 }),
    type: sanitizeString(query.type ?? '', { maxLength: 30 }),
    package: sanitizeString(query.package ?? '', { maxLength: 30 }),
    from: isRealDate(query.from ?? '') ? query.from : '',
    to: isRealDate(query.to ?? '') ? query.to : '',
  };
}

/**
 * Escapes a value for use inside a PostgREST `.or()` filter so that a keyword
 * containing a comma or parenthesis cannot break the query.
 */
export function escapePostgrestTerm(term) {
  return String(term).replace(/[,()*\\]/g, ' ').trim();
}
