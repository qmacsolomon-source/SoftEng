/**
 * DASHBOARD - the landing screen for both Administrators and Staff.
 *
 * One request to GET /api/dashboard/summary returns everything this page shows:
 * quotation and project tallies, a six-month quotation series, and the most
 * recent quotations, projects, activity events and milestone updates. The page
 * paints skeleton placeholders first and then swaps in the real numbers, so the
 * screen never flashes empty for the two people who use it.
 */
import { mountShell } from '../shell.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import {
  announce,
  loadingRows,
  progressCell,
  quotationStatusBadge,
  stateHtml,
  statusBadge,
} from '../ui.js';
import {
  QUOTATION_TYPE_LABELS,
  escapeHtml,
  formatDate,
  formatNumber,
  formatPeso,
  formatPesoShort,
  initials,
  qs,
  relativeTime,
} from '../util.js';

const page = qs('#page');

/* --------------------------------------------------------------------------
   Shell first - handles the session and the sign-in redirect for us.
   -------------------------------------------------------------------------- */
let currentUser = null;
try {
  const { user } = await mountShell({
    active: 'dashboard',
    title: 'Dashboard',
    subtitle: 'Quotations, projects and site activity at a glance.',
    requireAdmin: false,
  });
  currentUser = user;
} catch {
  /* mountShell redirects to /login.html (or an allowed page) and throws. */
}

if (currentUser) await load();

/* --------------------------------------------------------------------------
   Page header - title, the signed-in identity and the two quick actions.
   -------------------------------------------------------------------------- */
function headerHtml() {
  const roleLabel = currentUser.role === 'admin' ? 'Administrator' : 'Staff';
  return `
    <div class="page-header">
      <div class="page-header__text">
        <h2>Dashboard</h2>
        <p>Signed in as ${escapeHtml(currentUser.full_name || currentUser.email)} &middot; ${escapeHtml(roleLabel)}</p>
      </div>
      <div class="page-header__actions">
        <a class="btn btn--primary" href="/quotation-quick.html">${icon('bolt', { size: 16 })} New quick quotation</a>
        <a class="btn btn--secondary" href="/quotation-detailed.html">${icon('sliders', { size: 16 })} New customized quotation</a>
      </div>
    </div>`;
}

/* --------------------------------------------------------------------------
   Small builders reused across the cards.
   -------------------------------------------------------------------------- */

/** One statistic tile. `value` is already formatted (safe text). */
function statCard({ variant = '', iconName, label, value, hint }) {
  return `
    <div class="stat-card${variant ? ` stat-card--${variant}` : ''}">
      <span class="stat-card__icon" aria-hidden="true">${icon(iconName, { size: 18 })}</span>
      <span class="stat-card__label">${escapeHtml(label)}</span>
      <span class="stat-card__value">${value}</span>
      <span class="stat-card__hint">${escapeHtml(hint)}</span>
    </div>`;
}

/** A column of shimmering bars used inside a card while data is on its way. */
function skeletonLines(count = 3) {
  return `<div class="stack stack--sm">${'<div class="skeleton" style="height:38px"></div>'.repeat(count)}</div>`;
}

/* --------------------------------------------------------------------------
   Loading state - mirrors the final layout so nothing jumps into place.
   -------------------------------------------------------------------------- */
function renderLoading() {
  const statSkeleton = `
    <div class="stat-card">
      <span class="skeleton" style="width:55%;height:12px"></span>
      <span class="skeleton" style="width:75%;height:30px"></span>
      <span class="skeleton" style="width:45%;height:12px"></span>
    </div>`;

  page.innerHTML = `${headerHtml()}

    <div class="grid grid--4">${statSkeleton.repeat(4)}</div>

    <div class="grid grid--2 mt-5">
      <section class="card">
        <div class="card__header"><h3>Quotations in the last six months</h3></div>
        <div class="card__body"><div class="skeleton" style="height:150px"></div></div>
      </section>
      <section class="card">
        <div class="card__header"><h3>Latest milestone updates</h3></div>
        <div class="card__body">${skeletonLines(3)}</div>
      </section>
    </div>

    <div class="grid grid--2 mt-5">
      <section class="card">
        <div class="card__header"><h3>Recent quotations</h3></div>
        <div class="table-wrap">
          <table class="table table--compact">
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Client</th>
                <th scope="col">Type</th>
                <th scope="col" class="num">Total</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>${loadingRows(6, 4)}</tbody>
          </table>
        </div>
      </section>
      <section class="card">
        <div class="card__header"><h3>Recent projects</h3></div>
        <div class="table-wrap">
          <table class="table table--compact">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Project</th>
                <th scope="col">Status</th>
                <th scope="col">Progress</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>${loadingRows(5, 4)}</tbody>
          </table>
        </div>
      </section>
    </div>

    <div class="mt-5">
      <section class="card">
        <div class="card__header"><h3>Recent activity</h3></div>
        <div class="card__body">${skeletonLines(4)}</div>
      </section>
    </div>`;
}

/* --------------------------------------------------------------------------
   Error state - the whole summary failed, so the whole body explains why.
   -------------------------------------------------------------------------- */
function renderError(error) {
  page.innerHTML = `${headerHtml()}
    <div class="card">
      <div class="card__body" role="alert">
        ${stateHtml({
          iconName: 'alert',
          title: 'We could not load the dashboard',
          text: error?.message || 'Please try again in a moment.',
          actionHtml: '<button type="button" class="btn btn--secondary" data-retry>Try again</button>',
        })}
      </div>
    </div>`;

  qs('[data-retry]', page).addEventListener('click', () => { load(); });
}

/* --------------------------------------------------------------------------
   Cards
   -------------------------------------------------------------------------- */

/** Six-month quotation bar chart plus the combined peso value under it. */
function chartCard(series) {
  const counts = series.map((row) => Number(row.count) || 0);
  const max = counts.length ? Math.max(...counts) : 0;
  const totalValue = series.reduce((sum, row) => sum + Number(row.value || 0), 0);

  // The chart is a decorative graphic for screen readers: the summary below is
  // the only thing assistive technology needs to read.
  const summary = series.map((row) => `${row.label} ${formatNumber(row.count)}`).join(', ');

  const bars = series.map((row) => {
    const count = Number(row.count) || 0;
    const pct = max > 0 ? Math.round((count / max) * 100) : 0;
    return `
      <div class="bar-chart__col">
        <span class="bar-chart__value">${formatNumber(count)}</span>
        <div class="bar-chart__bar" style="height: ${pct}%"></div>
        <span class="bar-chart__label">${escapeHtml(row.label)}</span>
      </div>`;
  }).join('');

  const body = series.length
    ? `
      <div class="bar-chart" role="img" aria-label="Quotations created per month. ${escapeHtml(summary)}">
        ${bars}
      </div>
      <p class="text-muted text-sm mt-3 mb-0">Total quoted value over these six months: ${formatPesoShort(totalValue)}</p>`
    : stateHtml({ iconName: 'file', title: 'No quotations yet', text: 'Create a quotation to see the monthly trend here.' });

  return `
    <section class="card">
      <div class="card__header"><h3>Quotations in the last six months</h3></div>
      <div class="card__body">${body}</div>
    </section>`;
}

/** The five most recent site progress updates. */
function milestonesCard(milestones) {
  const body = milestones.length
    ? `<ul class="activity-list">${milestones.map((row) => `
        <li class="activity-item">
          <span class="avatar avatar--sm" aria-hidden="true">${escapeHtml(initials(row.updated_by_name))}</span>
          <div class="activity-item__body">
            <div class="activity-item__text">
              <span class="sr-only">Updated by ${escapeHtml(row.updated_by_name || 'a team member')}. </span>
              ${escapeHtml(row.milestone_name)} ${statusBadge(row.status)} ${progressCell(row.progress_pct, row.status)}
            </div>
            <div class="activity-item__time">
              ${formatDate(row.milestone_date)} &middot;
              <a href="/project-detail.html?id=${encodeURIComponent(row.project_id)}">View project</a>
            </div>
          </div>
        </li>`).join('')}</ul>`
    : stateHtml({ iconName: 'flag', title: 'No milestones logged yet', text: 'Progress updates added from site will appear here.' });

  return `
    <section class="card">
      <div class="card__header"><h3>Latest milestone updates</h3></div>
      <div class="card__body">${body}</div>
    </section>`;
}

/** The five newest quotations. */
function recentQuotationsCard(rows) {
  const body = rows.length
    ? `<div class="table-wrap">
        <table class="table table--compact">
          <caption class="sr-only">The five most recent quotations</caption>
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Client</th>
              <th scope="col">Type</th>
              <th scope="col" class="num">Total</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>${rows.map((row) => {
            const href = `/quotation-detail.html?id=${encodeURIComponent(row.id)}`;
            return `
              <tr data-href="${href}" style="cursor:pointer">
                <td><a class="font-mono" href="${href}">${escapeHtml(row.reference_no)}</a></td>
                <td>
                  <span class="table__primary">${escapeHtml(row.client_name)}</span>
                  ${row.project_name ? `<span class="table__secondary">${escapeHtml(row.project_name)}</span>` : ''}
                </td>
                <td>${escapeHtml(QUOTATION_TYPE_LABELS[row.quotation_type] || row.quotation_type || '—')}</td>
                <td class="num">${formatPeso(row.total_amount)}</td>
                <td>${quotationStatusBadge(row.status)}</td>
                <td>${relativeTime(row.created_at)}</td>
              </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`
    : `<div class="card__body">${stateHtml({ iconName: 'file', title: 'No quotations yet', text: 'Quotations you create will appear here.' })}</div>`;

  return `
    <section class="card">
      <div class="card__header"><h3>Recent quotations</h3></div>
      ${body}
      <div class="card__footer"><a class="btn btn--secondary btn--sm" href="/quotations.html">View all quotations</a></div>
    </section>`;
}

/** The five projects touched most recently. */
function recentProjectsCard(rows) {
  const body = rows.length
    ? `<div class="table-wrap">
        <table class="table table--compact">
          <caption class="sr-only">The five most recently updated projects</caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Project</th>
              <th scope="col">Status</th>
              <th scope="col">Progress</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>${rows.map((row) => {
            const href = `/project-detail.html?id=${encodeURIComponent(row.id)}`;
            return `
              <tr data-href="${href}" style="cursor:pointer">
                <td><a class="font-mono" href="${href}">${escapeHtml(row.project_code)}</a></td>
                <td>
                  <span class="table__primary">${escapeHtml(row.name)}</span>
                  ${row.client_name ? `<span class="table__secondary">${escapeHtml(row.client_name)}</span>` : ''}
                </td>
                <td>${statusBadge(row.status)}</td>
                <td>${progressCell(row.progress_pct, row.status)}</td>
                <td>${relativeTime(row.updated_at)}</td>
              </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`
    : `<div class="card__body">${stateHtml({ iconName: 'hardhat', title: 'No projects yet', text: 'Projects you add will appear here.' })}</div>`;

  return `
    <section class="card">
      <div class="card__header"><h3>Recent projects</h3></div>
      ${body}
      <div class="card__footer"><a class="btn btn--secondary btn--sm" href="/projects.html">View all projects</a></div>
    </section>`;
}

/** The ten newest audit events. */
function activityCard(rows) {
  const body = rows.length
    ? `<div class="card__body">
        <ul class="activity-list">${rows.map((row) => {
          const text = row.summary || `${row.action || ''} ${row.entity_type || ''}`.trim() || 'Activity recorded';
          return `
            <li class="activity-item">
              <span class="avatar avatar--sm" aria-hidden="true">${escapeHtml(initials(row.actor_name))}</span>
              <div class="activity-item__body">
                <div class="activity-item__text">
                  <span class="sr-only">${escapeHtml(row.actor_name || 'Someone')}: </span>
                  ${escapeHtml(text)}
                </div>
                <div class="activity-item__time">${relativeTime(row.created_at)}</div>
              </div>
            </li>`;
        }).join('')}</ul>
      </div>`
    : `<div class="card__body">${stateHtml({ iconName: 'clock', title: 'No activity yet', text: 'Actions taken in the system will be listed here.' })}</div>`;

  return `
    <section class="card">
      <div class="card__header"><h3>Recent activity</h3></div>
      ${body}
      <div class="card__footer" style="justify-content:flex-start;">
        <p class="text-muted text-sm mb-0">Showing the 10 most recent events.</p>
      </div>
    </section>`;
}

/* --------------------------------------------------------------------------
   Full render
   -------------------------------------------------------------------------- */
function renderData(data) {
  const quotations = data.quotations || {};
  const projects = data.projects || {};

  page.innerHTML = `${headerHtml()}

    <div class="grid grid--4">
      ${statCard({
        variant: 'accent',
        iconName: 'clipboard',
        label: 'Total quotations',
        value: formatNumber(quotations.total),
        hint: `${formatNumber(quotations.last_30_days)} in the last 30 days`,
      })}
      ${statCard({
        variant: 'blue',
        iconName: 'wallet',
        label: 'Quoted value',
        value: formatPeso(quotations.quoted_value),
        hint: `${formatPesoShort(quotations.approved_value)} approved`,
      })}
      ${statCard({
        variant: 'amber',
        iconName: 'hardhat',
        label: 'Active projects',
        value: formatNumber(projects.active),
        hint: `${formatNumber(projects.planning)} planning · ${formatNumber(projects.ongoing)} ongoing`,
      })}
      ${statCard({
        variant: 'green',
        iconName: 'checkCircle',
        label: 'Completed projects',
        value: formatNumber(projects.completed),
        hint: `of ${formatNumber(projects.total)} projects`,
      })}
      ${statCard({
        iconName: 'trendUp',
        label: 'Contract value',
        value: formatPeso(projects.contract_value),
        hint: `average progress ${formatNumber(projects.average_progress)}%`,
      })}
    </div>

    <div class="grid grid--2 mt-5">
      ${chartCard(data.series || [])}
      ${milestonesCard(data.upcoming_milestones || [])}
    </div>

    <div class="grid grid--2 mt-5">
      ${recentQuotationsCard(data.recent_quotations || [])}
      ${recentProjectsCard(data.recent_projects || [])}
    </div>

    <div class="mt-5">
      ${activityCard(data.recent_activity || [])}
    </div>`;

  wireRowLinks();
}

/** A mouse click anywhere on a table row follows that row's link. */
function wireRowLinks() {
  page.querySelectorAll('tr[data-href]').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('a, button')) return;
      window.location.href = row.dataset.href;
    });
  });
}

/* --------------------------------------------------------------------------
   Load
   -------------------------------------------------------------------------- */
async function load() {
  renderLoading();
  try {
    const data = await api.get('/dashboard/summary');
    renderData(data || {});
    announce('Dashboard loaded.');
  } catch (error) {
    renderError(error);
  }
}
