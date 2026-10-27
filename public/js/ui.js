/**
 * Reusable interface pieces: toasts, modals, confirmations, status badges,
 * progress bars, timelines, empty/loading/error states and pagination.
 *
 * Everything here returns either real DOM nodes or an HTML string built from
 * escaped values, so a page can drop a component in with one call.
 */
import { icon } from './icons.js';
import {
  PROJECT_STATUS_LABELS,
  QUOTATION_STATUS_LABELS,
  escapeHtml,
  formatNumber,
} from './util.js';

/* --------------------------------------------------------------------------
   Screen-reader announcements
   -------------------------------------------------------------------------- */
function announcer() {
  let region = document.getElementById('sr-announcer');
  if (!region) {
    region = document.createElement('div');
    region.id = 'sr-announcer';
    region.className = 'sr-only';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.append(region);
  }
  return region;
}

/** Politely announces a message to assistive technology. */
export function announce(message) {
  const region = announcer();
  region.textContent = '';
  window.setTimeout(() => { region.textContent = message; }, 60);
}

/* --------------------------------------------------------------------------
   Toasts
   -------------------------------------------------------------------------- */
function toastRegion() {
  let region = document.getElementById('toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast-region';
    region.className = 'toast-region';
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }
  return region;
}

const TOAST_ICONS = {
  success: 'checkCircle',
  error: 'alert',
  warning: 'alert',
  info: 'info',
};

/**
 * Shows a toast. Errors use role="alert" so they are announced immediately;
 * everything else is polite.
 * @returns {HTMLElement} the toast node (already removed after `timeout`)
 */
export function toast({ title, message = '', type = 'info', timeout = 6000 } = {}) {
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.innerHTML = `
    <span class="toast__icon">${icon(TOAST_ICONS[type] || 'info', { size: 18 })}</span>
    <div class="toast__body">
      ${title ? `<div class="toast__title">${escapeHtml(title)}</div>` : ''}
      ${message ? `<div class="toast__message">${escapeHtml(message)}</div>` : ''}
    </div>
    <button type="button" class="toast__close" aria-label="Dismiss notification">&times;</button>
  `;

  const remove = () => {
    node.classList.add('is-leaving');
    window.setTimeout(() => node.remove(), 220);
  };
  node.querySelector('.toast__close').addEventListener('click', remove);

  toastRegion().append(node);
  if (timeout) window.setTimeout(remove, timeout);
  return node;
}

export const toastSuccess = (title, message) => toast({ title, message, type: 'success' });
export const toastError = (title, message) => toast({ title, message, type: 'error', timeout: 9000 });
export const toastWarning = (title, message) => toast({ title, message, type: 'warning' });

/* --------------------------------------------------------------------------
   Modals and confirmations
   -------------------------------------------------------------------------- */

/**
 * Creates a modal backdrop and returns a small controller.
 * Keyboard support: Escape closes, Tab cycles inside, focus is restored on close.
 */
export function createModal({ title, description = '', size = '' } = {}) {
  const previouslyFocused = document.activeElement;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${size ? `modal--${size}` : ''}" role="dialog" aria-modal="true"
         aria-labelledby="modal-title-${Math.random().toString(36).slice(2, 8)}">
      <div class="modal__header">
        <div>
          <h3 id="modal-title"></h3>
          ${description ? `<p>${escapeHtml(description)}</p>` : ''}
        </div>
        <button type="button" class="icon-button" data-close aria-label="Close dialog">${icon('x', { size: 18 })}</button>
      </div>
      <div class="modal__body"></div>
      <div class="modal__footer"></div>
    </div>
  `;

  const dialog = backdrop.querySelector('.modal');
  const titleEl = backdrop.querySelector('#modal-title');
  const body = backdrop.querySelector('.modal__body');
  const footer = backdrop.querySelector('.modal__footer');
  titleEl.textContent = title || '';
  dialog.setAttribute('aria-labelledby', titleEl.id);

  const focusable = () => Array.from(
    dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  );

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown, true);
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || event.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKeydown, true);

  document.body.append(backdrop);
  window.setTimeout(() => {
    const items = focusable();
    if (items.length) items[0].focus();
  }, 30);

  return { backdrop, body, footer, close };
}

/**
 * Confirmation dialog for destructive actions.
 * @returns {Promise<boolean>}
 */
export function confirmAction({
  title = 'Are you sure?',
  message = 'This action cannot be undone.',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const modal = createModal({ title });
    modal.body.innerHTML = `<p class="text-soft">${escapeHtml(message)}</p>`;
    modal.footer.innerHTML = `
      <button type="button" class="btn btn--secondary" data-cancel>${escapeHtml(cancelLabel)}</button>
      <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm>${escapeHtml(confirmLabel)}</button>
    `;

    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(answer);
    };

    modal.footer.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
    modal.footer.querySelector('[data-confirm]').addEventListener('click', () => finish(true));
    modal.backdrop.addEventListener('click', (event) => {
      if (event.target === modal.backdrop || event.target.closest('[data-close]')) finish(false);
    });
  });
}

/* --------------------------------------------------------------------------
   Status badges and progress bars
   -------------------------------------------------------------------------- */
export function statusBadge(status, label) {
  const key = String(status || '').toLowerCase();
  const text = label || PROJECT_STATUS_LABELS[key] || QUOTATION_STATUS_LABELS[key] || key || '—';
  return `<span class="badge badge--${escapeHtml(key)}">${escapeHtml(text)}</span>`;
}

export function quotationStatusBadge(status) {
  const key = String(status || '').toLowerCase();
  const text = QUOTATION_STATUS_LABELS[key] || key;
  if (key === 'approved') return `<span class="badge badge--completed">${escapeHtml(text)}</span>`;
  if (key === 'rejected') return `<span class="badge badge--danger">${escapeHtml(text)}</span>`;
  if (key === 'expired') return `<span class="badge badge--neutral">${escapeHtml(text)}</span>`;
  if (key === 'sent') return `<span class="badge badge--planning">${escapeHtml(text)}</span>`;
  return `<span class="badge badge--accent">${escapeHtml(text)}</span>`;
}

export function progressBar(percent, status = '', { large = false, showValue = false } = {}) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  const modifier = status ? ` progress--${escapeHtml(status)}` : '';
  const bar = `
    <div class="progress${modifier}${large ? ' progress--lg' : ''}" style="--progress-value:${value}%"
         role="progressbar" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100"
         aria-label="Progress">
      <div class="progress__bar"></div>
    </div>`;
  if (!showValue) return bar;
  return `<div class="progress-row">${bar}<span class="progress-row__value">${value}%</span></div>`;
}

export function progressCell(percent, status) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  const modifier = status ? ` progress--${escapeHtml(status)}` : '';
  return `
    <div class="progress-row">
      <div class="progress${modifier}" style="--progress-value:${value}%"
           role="progressbar" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100"
           aria-label="Progress ${value}%">
        <div class="progress__bar"></div>
      </div>
      <span class="progress-row__value">${value}%</span>
    </div>`;
}

/* --------------------------------------------------------------------------
   Timeline
   -------------------------------------------------------------------------- */
/**
 * @param {Array} items  [{ status, title, meta, body, photoUrl, pct }]
 */
export function timeline(items = []) {
  if (!items.length) return '';
  return `<ol class="timeline">${items.map((item) => `
    <li class="timeline__item timeline__item--${escapeHtml(item.status || 'planning')}">
      <span class="timeline__marker" aria-hidden="true"></span>
      <div class="timeline__head">
        <span class="timeline__title">${escapeHtml(item.title || '')}</span>
        ${item.pct !== undefined && item.pct !== null ? progressBadge(item.pct) : ''}
        ${item.meta ? `<span class="timeline__meta">${escapeHtml(item.meta)}</span>` : ''}
      </div>
      ${item.body ? `<div class="timeline__body">${escapeHtml(item.body)}</div>` : ''}
      ${item.photoUrl ? `<img class="timeline__photo" src="${escapeHtml(item.photoUrl)}" alt="Progress photo for ${escapeHtml(item.title || 'this milestone')}" loading="lazy">` : ''}
    </li>
  `).join('')}</ol>`;
}

function progressBadge(pct) {
  return `<span class="badge badge--navy badge--plain">${formatNumber(pct)}%</span>`;
}

/* --------------------------------------------------------------------------
   Empty / loading / error states
   -------------------------------------------------------------------------- */
export function stateHtml({ iconName = 'empty', title = '', text = '', actionHtml = '' } = {}) {
  return `
    <div class="state">
      <div class="state__icon">${icon(iconName, { size: 26 })}</div>
      ${title ? `<p class="state__title">${escapeHtml(title)}</p>` : ''}
      ${text ? `<p class="state__text">${escapeHtml(text)}</p>` : ''}
      ${actionHtml}
    </div>`;
}

export function emptyRow(colspan, message = 'No records to show yet.') {
  return `<tr><td colspan="${colspan}">${stateHtml({ iconName: 'empty', title: 'Nothing here yet', text: message })}</td></tr>`;
}

export function loadingRows(colspan, count = 5) {
  const cells = Array.from({ length: colspan }, (_, index) => (
    `<td>${index === 0 ? '<div class="skeleton" style="width:70%"></div>' : '<div class="skeleton" style="width:45%"></div>'}</td>`
  )).join('');
  return Array.from({ length: count }, () => `<tr aria-hidden="true">${cells}</tr>`).join('');
}

export function errorRow(colspan, message, retrySelector = '') {
  return `<tr><td colspan="${colspan}">${stateHtml({
    iconName: 'alert',
    title: 'Something went wrong',
    text: message,
    actionHtml: retrySelector
      ? `<button type="button" class="btn btn--secondary btn--sm" ${retrySelector}>Try again</button>`
      : '',
  })}</td></tr>`;
}

/* --------------------------------------------------------------------------
   Pagination
   -------------------------------------------------------------------------- */
/**
 * @param {object} input  { page, totalPages, total, pageSize }
 * @returns {string} markup for the .pagination block
 */
export function paginationHtml({ page = 1, totalPages = 1, total = 0, pageSize = 15 } = {}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  const buttons = [];
  for (let index = start; index <= end; index += 1) {
    buttons.push(`<button type="button" class="page-btn" data-page="${index}"
      ${index === page ? 'aria-current="page"' : ''}
      aria-label="Page ${index}">${index}</button>`);
  }

  return `
    <div class="pagination">
      <p class="pagination__info">Showing <strong>${from}–${to}</strong> of <strong>${total}</strong> ${total === 1 ? 'record' : 'records'}</p>
      <div class="pagination__pages">
        <button type="button" class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">
          ${icon('chevronLeft', { size: 15 })}
        </button>
        ${buttons.join('')}
        <button type="button" class="page-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''} aria-label="Next page">
          ${icon('chevronRight', { size: 15 })}
        </button>
      </div>
    </div>`;
}

/**
 * Delegated click handler for any .pagination inside `root`.
 * @param {HTMLElement} root
 * @param {(page:number) => void} onChange
 */
export function bindPagination(root, onChange) {
  if (!root || root.dataset.paginationBound === 'true') return;
  root.dataset.paginationBound = 'true';
  root.addEventListener('click', (event) => {
    const button = event.target.closest('.page-btn[data-page]');
    if (!button || button.disabled) return;
    const page = Number(button.dataset.page);
    if (Number.isFinite(page) && page >= 1) onChange(page);
  });
}

/* --------------------------------------------------------------------------
   Detail lists
   -------------------------------------------------------------------------- */
/** rows: [[label, value], ...] - value may contain safe HTML. */
export function detailList(rows = []) {
  return `<dl class="detail-list">${rows
    .filter(Boolean)
    .map(([label, value]) => `
      <div class="detail-list__row">
        <dt>${escapeHtml(label)}</dt>
        <dd>${value === null || value === undefined || value === '' ? '&mdash;' : value}</dd>
      </div>`)
    .join('')}</dl>`;
}

/** Copies text to the clipboard and shows a confirmation toast. */
export async function copyToClipboard(text, label = 'Copied to clipboard.') {
  try {
    await navigator.clipboard.writeText(text);
    toastSuccess(label);
  } catch {
    toastError('Copy failed', 'Your browser blocked clipboard access.');
  }
}
