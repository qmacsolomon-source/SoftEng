/**
 * APA Engineering Services - shared front-end helpers.
 *
 * Formatting, small DOM utilities and the vocabulary (the eight works,
 * project types, statuses) shared by every page. Keeping the vocabulary in one
 * place guarantees the Quick Quotation, the Customized Quotation and the
 * Projects screens all speak the same language as the database.
 */

export const PH_TIMEZONE = 'Asia/Manila';

/* --------------------------------------------------------------------------
   Vocabulary - kept in step with server/lib/validation.js and 01_schema.sql
   -------------------------------------------------------------------------- */
export const WORK_ORDER = [
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

export const PROJECT_STATUS_ORDER = ['planning', 'ongoing', 'completed'];

export const PROJECT_STATUS_LABELS = {
  planning: 'Planning',
  ongoing: 'Ongoing',
  completed: 'Completed',
};

export const QUOTATION_STATUS_LABELS = {
  draft: 'Draft',
  sent: 'Sent',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
};

export const QUOTATION_TYPE_LABELS = {
  quick: 'Quick (Generalized)',
  detailed: 'Customized (Detailed)',
};

/** Units accepted by the materials table (mirrors the CHECK constraint). */
export const UNITS = [
  'pc', 'sqm', 'sqft', 'lm', 'm', 'bag', 'kg', 'set', 'roll',
  'gal', 'ltr', 'box', 'length', 'sheet', 'cu.m', 'lot',
];

export const PACKAGE_LABELS = {
  standard: 'Standard',
  elegant: 'Elegant',
  luxury: 'Luxury',
  bare: 'Bare',
};

export const workLabel = (code) => WORK_LABELS[code] || titleCase(code || '');

/* --------------------------------------------------------------------------
   Text
   -------------------------------------------------------------------------- */

/** Escapes text before it is placed inside innerHTML. Never skip this. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "doors_windows" -> "Doors Windows" (used only as a last-resort fallback). */
export function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Two-letter initials for the avatar circles. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function truncate(value, max = 60) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* --------------------------------------------------------------------------
   Numbers, money and dates
   -------------------------------------------------------------------------- */

/**
 * Philippine peso string. formatPeso(1234.5) -> "PHP 1,234.50"
 * Pass { symbol: true } to get the short "₱1,234.50" form used in tables.
 */
export function formatPeso(amount, { symbol = false, decimals = 2 } = {}) {
  const value = Number(amount || 0);
  const text = value.toLocaleString('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return symbol ? `₱${text}` : `PHP ${text}`;
}

/** Short peso used inside dense tables: ₱1.2M, ₱845.0k. */
export function formatPesoShort(amount) {
  const value = Number(amount || 0);
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `₱${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `₱${(value / 1_000).toFixed(1)}k`;
  return `₱${value.toFixed(2)}`;
}

export function formatNumber(value, decimals = 0) {
  return Number(value || 0).toLocaleString('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // A bare "YYYY-MM-DD" is treated as a calendar date, not UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value, { fallback = '—' } = {}) {
  const date = toDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: PH_TIMEZONE,
  });
}

export function formatDateTime(value, { fallback = '—' } = {}) {
  const date = toDate(value);
  if (!date) return fallback;
  return date.toLocaleString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: PH_TIMEZONE,
  });
}

export function formatTime(value, { fallback = '—' } = {}) {
  if (!value) return fallback;
  const [h, m] = String(value).split(':').map(Number);
  if (Number.isNaN(h)) return fallback;
  const date = new Date();
  date.setHours(h, m || 0, 0, 0);
  return date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
}

/** "3 hours ago", "2 days ago"; falls back to a plain date beyond 30 days. */
export function relativeTime(value) {
  const date = toDate(value);
  if (!date) return '—';
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  const units = [
    ['year', 60 * 24 * 365],
    ['month', 60 * 24 * 30],
    ['week', 60 * 24 * 7],
    ['day', 60 * 24],
    ['hour', 60],
    ['minute', 1],
  ];
  for (const [unit, minutes] of units) {
    if (Math.abs(diffMinutes) >= minutes) return formatter.format(Math.round(diffMinutes / minutes), unit);
  }
  return 'Just now';
}

/** Today in Manila as YYYY-MM-DD - used as the min for date inputs. */
export function todayISO() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

export function addDaysISO(days, from = new Date()) {
  const date = new Date(from.getTime() + 8 * 60 * 60 * 1000);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function nowTimeValue() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().slice(11, 16);
}

export function bytesToSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

/* --------------------------------------------------------------------------
   DOM
   -------------------------------------------------------------------------- */

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Creates an element: el('div', { class: 'card' }, [childNode]). */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function debounce(fn, wait = 250) {
  let timer = null;
  return function debounced(...args) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn.apply(this, args), wait);
  };
}

export function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function getParam(name, url = window.location.href) {
  return new URL(url).searchParams.get(name) || '';
}

/** Rewrites the address bar without reloading the page (filter state). */
export function setParams(patch, { replace = true } = {}) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === '' || value === null || value === undefined) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
  return url;
}

/** Triggers a browser download for a same-origin URL that already has a token. */
export function downloadBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const link = el('a', { href, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 4000);
}

/** Converts "PHP 1,234.00" style input back into a number. */
export function toNumber(value) {
  const n = Number.parseFloat(String(value ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}
