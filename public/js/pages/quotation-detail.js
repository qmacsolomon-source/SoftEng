/**
 * Quotation detail - the print-ready document plus the status editor.
 *
 * Reads ?id= and loads GET /api/quotations/:id, then draws a printable
 * `.quote-doc` (stylesheet section 16), a small status card bound to
 * PATCH /api/quotations/:id and, for Administrators only, a delete action.
 */
import { api } from '../api.js';
import { mountShell } from '../shell.js';
import { session } from '../session.js';
import { setButtonLoading } from '../forms.js';
import {
  QUOTATION_STATUS_LABELS,
  QUOTATION_TYPE_LABELS,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPeso,
  getParam,
  qs,
  workLabel,
} from '../util.js';
import {
  announce,
  confirmAction,
  copyToClipboard,
  emptyRow,
  quotationStatusBadge,
  stateHtml,
  toastError,
  toastSuccess,
} from '../ui.js';

// Paint the shell first; it throws after redirecting when there is no session.
try {
  await mountShell({
    active: 'quotations',
    title: 'Quotation',
    subtitle: 'Review, print or update this quotation.',
  });
} catch { /* mountShell redirects to sign in */ }

const root = qs('#quotation-root');
const actionsEl = qs('#detail-actions');
const quotationId = getParam('id');

// Files belonging to this quotation (site plan / attachment), used by the
// signed-URL buttons rendered in the document.
let attachmentFiles = [];

/* --------------------------------------------------------------------------
   States
   -------------------------------------------------------------------------- */
function loadingDocHtml() {
  const metaCells = Array.from({ length: 8 }).map(() => `
    <div>
      <div class="skeleton" style="width:55%;height:11px;"></div>
      <div class="skeleton" style="width:88%;margin-top:7px;"></div>
    </div>`).join('');

  return `
    <div class="quote-doc" aria-busy="true">
      <div class="quote-doc__head">
        <div style="flex:1 1 240px;">
          <div class="skeleton" style="width:230px;height:22px;"></div>
          <div class="skeleton" style="width:300px;margin-top:10px;"></div>
        </div>
        <div style="width:190px;">
          <div class="skeleton" style="width:100%;height:20px;"></div>
          <div class="skeleton" style="width:60%;height:16px;margin-top:10px;margin-left:auto;"></div>
        </div>
      </div>
      <div class="quote-doc__meta">${metaCells}</div>
      <div class="skeleton" style="height:170px;"></div>
    </div>`;
}

function missingIdHtml() {
  return stateHtml({
    iconName: 'empty',
    title: 'No quotation selected',
    text: 'Choose a quotation from the records list to open its details.',
    actionHtml: '<a class="btn btn--primary" href="/quotations.html">Open quotation records</a>',
  });
}

/* --------------------------------------------------------------------------
   Document
   -------------------------------------------------------------------------- */
function metaHtml(quotation) {
  const rows = [
    ['Client', escapeHtml(quotation.client_name || '—')],
    ['Email', quotation.client_email
      ? `<a href="mailto:${escapeHtml(quotation.client_email)}">${escapeHtml(quotation.client_email)}</a>`
      : '—'],
    ['Contact number', escapeHtml(quotation.client_phone || '—')],
    ['Project', escapeHtml(quotation.project_name || '—')],
    ['Location', escapeHtml(quotation.project_location || '—')],
    ['Project type', escapeHtml(quotation.project_type || '—')],
    ['Floor area', quotation.floor_area_sqm != null ? `${formatNumber(quotation.floor_area_sqm)} sqm` : '—'],
    ['Floors', quotation.number_of_floors != null ? formatNumber(quotation.number_of_floors) : '—'],
    ['Target start', formatDate(quotation.target_start_date)],
    ['Valid until', formatDate(quotation.validity_date)],
    ['Prepared by', escapeHtml(quotation.created_by_name || '—')],
    ['Date prepared', formatDateTime(quotation.created_at)],
  ];

  return `<dl class="quote-doc__meta">${rows.map(([label, value]) => `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${value}</dd>
    </div>`).join('')}</dl>`;
}

function itemsRowsHtml(items) {
  if (!items.length) return emptyRow(7, 'This quotation has no line items.');

  return items.map((item) => `
    <tr>
      <td>${escapeHtml(workLabel(item.work_type))}</td>
      <td>
        <span class="table__primary">${escapeHtml(item.description || '—')}</span>
        ${item.brand ? `<span class="table__secondary">Brand: ${escapeHtml(item.brand)}</span>` : ''}
        ${item.style_variant ? `<span class="table__secondary">Style: ${escapeHtml(item.style_variant)}</span>` : ''}
      </td>
      <td>${escapeHtml(item.unit || '—')}</td>
      <td class="num">${formatNumber(item.quantity, 2)}</td>
      <td class="num">${formatPeso(item.unit_price)}</td>
      <td class="num">${formatPeso(item.rate_per_sqm)}</td>
      <td class="num">${formatPeso(item.line_total)}</td>
    </tr>`).join('');
}

function summaryHtml(quotation) {
  return `
    <dl class="quote-summary">
      <div class="quote-summary__row">
        <dt>Subtotal</dt>
        <dd class="numeric">${formatPeso(quotation.subtotal)}</dd>
      </div>
      ${quotation.include_labor ? `
      <div class="quote-summary__row">
        <dt>Labour (${formatNumber(quotation.labor_pct)}%)</dt>
        <dd class="numeric">${formatPeso(quotation.labor_amount)}</dd>
      </div>` : ''}
      <div class="quote-summary__row">
        <dt>Contingency (${formatNumber(quotation.contingency_pct)}%)</dt>
        <dd class="numeric">${formatPeso(quotation.contingency_amount)}</dd>
      </div>
      <div class="quote-summary__row quote-summary__row--total">
        <dt>Total</dt>
        <dd class="numeric">${formatPeso(quotation.total_amount)}</dd>
      </div>
    </dl>`;
}

function attachmentsHtml(quotation) {
  attachmentFiles = [];
  if (quotation.site_plan_path) attachmentFiles.push({ bucket: 'site-plans', path: quotation.site_plan_path, label: 'Site plan' });
  if (quotation.attachment_path) attachmentFiles.push({ bucket: 'attachments', path: quotation.attachment_path, label: 'Attachment' });
  if (!attachmentFiles.length) return '';

  return `
    <div class="quote-doc__note no-print" style="border-left-color: var(--color-primary);">
      <p style="margin:0 0 10px;"><strong>Attachments</strong></p>
      <div class="row row--wrap row--tight">
        ${attachmentFiles.map((file, index) => `
          <button type="button" class="btn btn--secondary btn--sm" data-attachment="${index}">
            Open ${escapeHtml(file.label)}
          </button>`).join('')}
      </div>
      <p class="field__help" id="attachment-feedback" role="status" aria-live="polite" style="margin-top:10px;"></p>
    </div>`;
}

function docHtml(quotation, items) {
  const typeLabel = QUOTATION_TYPE_LABELS[quotation.quotation_type] || quotation.quotation_type || '—';
  const priceUpdated = quotation.price_source_at ? formatDate(quotation.price_source_at) : '—';

  return `
    <div class="quote-doc">
      <div class="quote-doc__head">
        <div>
          <div class="quote-doc__company">APA Engineering Services</div>
          <div class="quote-doc__company-meta">Structural design &amp; construction &middot; Antipolo, Philippines &middot; qmacsolomon@tip.edu.ph</div>
        </div>
        <div class="quote-doc__ref">
          <strong>${escapeHtml(quotation.reference_no || '—')}</strong>
          <div style="margin-top:6px;">
            <span id="quote-status-badge">${quotationStatusBadge(quotation.status)}</span>
            <span class="badge badge--navy badge--plain">${escapeHtml(typeLabel)}</span>
          </div>
        </div>
      </div>

      ${metaHtml(quotation)}

      <div class="table-wrap">
        <table class="table">
          <caption class="sr-only">Line items for quotation ${escapeHtml(quotation.reference_no || '')}</caption>
          <thead>
            <tr>
              <th scope="col">Work</th>
              <th scope="col">Description / specification</th>
              <th scope="col">Unit</th>
              <th scope="col" class="num">Quantity</th>
              <th scope="col" class="num">Unit price</th>
              <th scope="col" class="num">Rate per sqm</th>
              <th scope="col" class="num">Amount</th>
            </tr>
          </thead>
          <tbody>${itemsRowsHtml(items)}</tbody>
          <tfoot>
            <tr>
              <td colspan="6">Materials and installation subtotal</td>
              <td class="num">${formatPeso(quotation.subtotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      ${summaryHtml(quotation)}

      <div class="quote-doc__note">
        <p><strong>Estimate basis:</strong> Fajardo, <em>Simplified Construction Estimate</em> &mdash; floor area &times; rate per square metre. Material prices: Wilcon Depot (last updated ${escapeHtml(priceUpdated)}).</p>
        <p>This is an estimate, not a final contract price. Prices are valid until ${formatDate(quotation.validity_date)} and may change with site conditions and material costs.</p>
        ${quotation.remarks ? `<p><strong>Remarks:</strong> ${escapeHtml(quotation.remarks)}</p>` : ''}
      </div>

      <div class="quote-doc__sign">
        <div class="sign-line">
          Prepared by
          <br><strong>${escapeHtml(quotation.created_by_name || 'APA Engineering Services')}</strong>
        </div>
        <div class="sign-line">
          Conforming / Client acceptance
          <br><strong>Signature over printed name and date</strong>
        </div>
      </div>

      ${attachmentsHtml(quotation)}

      <div class="print-footer">
        ${escapeHtml(quotation.reference_no || '')} &middot; Single-page quotation &middot; APA Engineering Services
      </div>
    </div>`;
}

/* --------------------------------------------------------------------------
   Status editor
   -------------------------------------------------------------------------- */
function statusCardHtml(quotation, project) {
  const options = Object.entries(QUOTATION_STATUS_LABELS).map(([value, label]) =>
    `<option value="${escapeHtml(value)}"${value === quotation.status ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');

  return `
    <div class="card no-print" style="margin-top: var(--space-5);">
      <div class="card__header">
        <div>
          <h3>Quotation status</h3>
          <p>Update where this quotation stands.</p>
        </div>
      </div>
      <div class="card__body">
        <div class="field">
          <label class="field__label" for="status-select">Status</label>
          <select class="select" id="status-select" name="status" aria-describedby="status-help">${options}</select>
          <p class="field__help" id="status-help">Both Staff and Administrators can change the status.</p>
        </div>

        <div class="row row--tight row--wrap" style="margin-top: var(--space-3);">
          <button type="button" class="btn btn--primary" id="save-status">Save status</button>
          ${project ? `<a class="btn btn--secondary" href="/project-detail.html?id=${encodeURIComponent(project.id)}">Open linked project</a>` : ''}
        </div>

        <p class="field__help" id="status-feedback" role="status" aria-live="polite" style="margin-top: var(--space-3);"></p>
      </div>
    </div>`;
}

/* --------------------------------------------------------------------------
   Toolbar actions
   -------------------------------------------------------------------------- */
function renderActions(quotation) {
  actionsEl.innerHTML = `
    <button type="button" class="btn btn--primary" id="print-btn">Print / PDF</button>
    <button type="button" class="btn btn--secondary" id="copy-btn">Copy reference</button>
    <a class="btn btn--ghost" href="/quotations.html">Back to list</a>
    ${session.isAdmin() ? '<button type="button" class="btn btn--danger" id="delete-btn">Delete</button>' : ''}
  `;

  qs('#print-btn').addEventListener('click', () => window.print());
  qs('#copy-btn').addEventListener('click', () => copyToClipboard(quotation.reference_no || '', 'Reference copied to clipboard.'));
  qs('#delete-btn')?.addEventListener('click', () => deleteQuotation(quotation));
}

async function deleteQuotation(quotation) {
  const confirmed = await confirmAction({
    title: 'Delete this quotation?',
    message: `Quotation ${quotation.reference_no} and all of its line items will be permanently removed. This cannot be undone.`,
    confirmLabel: 'Delete quotation',
    danger: true,
  });
  if (!confirmed) return;

  const button = qs('#delete-btn');
  setButtonLoading(button, true);
  try {
    await api.delete(`/api/quotations/${encodeURIComponent(quotation.id)}`);
    toastSuccess('Quotation deleted', `${quotation.reference_no} has been removed.`);
    window.location.replace('/quotations.html');
  } catch (error) {
    toastError('Could not delete', error?.message || 'The quotation could not be deleted. Please try again.');
    setButtonLoading(button, false);
  }
}

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */
function wireStatusEditor(quotation) {
  const select = qs('#status-select');
  const button = qs('#save-status');
  const feedback = qs('#status-feedback');
  if (!select || !button) return;

  button.addEventListener('click', async () => {
    const nextStatus = select.value;
    if (nextStatus === quotation.status) {
      feedback.textContent = 'That is already the current status.';
      announce('That is already the current status.');
      return;
    }

    setButtonLoading(button, true);
    feedback.textContent = '';
    try {
      const result = await api.patch(`/api/quotations/${encodeURIComponent(quotation.id)}`, { status: nextStatus });
      quotation.status = result.status;

      const badgeHost = qs('#quote-status-badge');
      if (badgeHost) badgeHost.innerHTML = quotationStatusBadge(quotation.status);

      const label = QUOTATION_STATUS_LABELS[quotation.status] || quotation.status;
      feedback.textContent = `Status saved: ${label}.`;
      announce(`Quotation status updated to ${label}.`);
      toastSuccess('Status updated', `Quotation ${result.reference_no || quotation.reference_no} is now ${label}.`);
    } catch (error) {
      feedback.textContent = error?.message || 'The status could not be saved.';
      announce('The status could not be saved.');
      toastError('Could not save status', error?.message || 'Please try again.');
    } finally {
      setButtonLoading(button, false);
    }
  });
}

function wireAttachments() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-attachment]');
    if (!button) return;

    const file = attachmentFiles[Number(button.dataset.attachment)];
    if (!file) return;

    const feedback = qs('#attachment-feedback');
    setButtonLoading(button, true);
    try {
      const { url } = await api.signedUrl(file.bucket, file.path);
      window.open(url, '_blank', 'noopener');
      if (feedback) feedback.textContent = `Opened ${file.label}.`;
    } catch (error) {
      if (feedback) feedback.textContent = error?.message || 'The file could not be opened.';
      toastError('Could not open file', error?.message || 'It may have been removed.');
    } finally {
      setButtonLoading(button, false);
    }
  });
}

/* --------------------------------------------------------------------------
   Rendering the page
   -------------------------------------------------------------------------- */
function render({ quotation, items, project }) {
  root.innerHTML = docHtml(quotation, items) + statusCardHtml(quotation, project);
  renderActions(quotation);
  wireStatusEditor(quotation);
}

async function load() {
  root.innerHTML = loadingDocHtml();

  try {
    const data = await api.get(`/api/quotations/${encodeURIComponent(quotationId)}`);
    render({
      quotation: data.quotation,
      items: data.items || [],
      project: data.project || null,
    });
  } catch (error) {
    root.innerHTML = stateHtml({
      iconName: 'alert',
      title: 'Quotation not available',
      text: error?.message || 'That quotation could not be loaded.',
      actionHtml: '<a class="btn btn--secondary" href="/quotations.html">Back to quotation records</a>',
    });
    actionsEl.innerHTML = '';
  }
}

/* --------------------------------------------------------------------------
   Start-up
   -------------------------------------------------------------------------- */
wireAttachments();

if (!quotationId) {
  root.innerHTML = missingIdHtml();
} else {
  await load();
}
