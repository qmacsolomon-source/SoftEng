/**
 * Application shell: sidebar navigation, top bar, user menu, dark-mode toggle
 * and the role guard.
 *
 * Every page calls mountShell() first. It restores the session, refuses entry
 * to pages the signed-in role may not open, then paints the navigation so the
 * admin-only link never appears for a Staff account.
 */
import { api } from './api.js';
import { icon } from './icons.js';
import { session } from './session.js';
import { toastError } from './ui.js';
import { escapeHtml, initials, qs } from './util.js';

const THEME_KEY = 'apa.theme';

/* --------------------------------------------------------------------------
   Navigation
   -------------------------------------------------------------------------- */
export const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard', href: '/index.html', label: 'Dashboard', icon: 'grid' },
    ],
  },
  {
    label: 'Quotations',
    items: [
      { id: 'quotation-quick', href: '/quotation-quick.html', label: 'Quick Quotation', icon: 'bolt' },
      { id: 'quotation-detailed', href: '/quotation-detailed.html', label: 'Customized Quotation', icon: 'sliders' },
      { id: 'quotations', href: '/quotations.html', label: 'Quotation Records', icon: 'file' },
    ],
  },
  {
    label: 'Projects',
    items: [
      { id: 'projects', href: '/projects.html', label: 'Project Tracking', icon: 'hardhat' },
      { id: 'project-status-update', href: '/project-status-update.html', label: 'Status Update', icon: 'flag' },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { id: 'materials', href: '/materials.html', label: 'Materials & Prices', icon: 'tag' },
    ],
  },
  {
    label: 'Administration',
    adminOnly: true,
    items: [
      { id: 'users', href: '/users.html', label: 'User Management', icon: 'users' },
    ],
  },
];

/** Pages that a Staff account may not open. */
const ADMIN_ONLY_PAGES = new Set(['users']);

/* --------------------------------------------------------------------------
   Theme
   -------------------------------------------------------------------------- */
export function applyStoredTheme() {
  let theme = '';
  try { theme = window.localStorage.getItem(THEME_KEY) || ''; } catch { /* noop */ }
  if (!theme) {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { window.localStorage.setItem(THEME_KEY, next); } catch { /* noop */ }
  return next;
}

/* --------------------------------------------------------------------------
   Sidebar
   -------------------------------------------------------------------------- */
function sidebarMarkup(user, activeId) {
  const isAdmin = user?.role === 'admin';

  const groups = NAV_GROUPS.map((group) => {
    if (group.adminOnly && !isAdmin) return '';
    const items = group.items.map((item) => `
      <a class="nav-item" href="${item.href}"
         ${item.id === activeId ? 'aria-current="page"' : ''}>
        <span class="nav-item__icon">${icon(item.icon, { size: 18 })}</span>
        <span class="nav-item__label">${escapeHtml(item.label)}</span>
      </a>`).join('');
    return `<p class="sidebar__group-label">${escapeHtml(group.label)}</p>${items}`;
  }).join('');

  return `
    <div class="sidebar__brand">
      <span class="sidebar__mark" aria-hidden="true">APA</span>
      <div class="sidebar__titles">
        <div class="sidebar__name">APA Engineering</div>
        <div class="sidebar__tagline">Cost &amp; Project System</div>
      </div>
    </div>
    <nav class="sidebar__nav" aria-label="Main">
      ${groups}
    </nav>
    <div class="sidebar__footer">
      <div>Structural design &amp; construction</div>
      <div>Antipolo, Philippines</div>
    </div>`;
}

/* --------------------------------------------------------------------------
   Top bar
   -------------------------------------------------------------------------- */
function topbarMarkup({ title, subtitle, actions = '', user }) {
  return `
    <button type="button" class="icon-button sidebar-toggle" data-sidebar-toggle
            aria-label="Open navigation menu" aria-expanded="false" aria-controls="sidebar">
      ${icon('menu', { size: 18 })}
    </button>
    <div class="topbar__title">
      <h1>${escapeHtml(title || '')}</h1>
      ${subtitle ? `<p class="topbar__subtitle">${escapeHtml(subtitle)}</p>` : ''}
    </div>
    <div class="topbar__actions">
      ${actions}
      <button type="button" class="icon-button" data-theme-toggle aria-label="Switch between light and dark theme">
        ${icon(document.documentElement.getAttribute('data-theme') === 'dark' ? 'sun' : 'moon', { size: 18 })}
      </button>
      <div class="user-menu">
        <button type="button" class="user-menu__trigger" data-user-menu-trigger
                aria-haspopup="menu" aria-expanded="false" aria-controls="user-menu-panel">
          <span class="avatar" aria-hidden="true">${escapeHtml(initials(user?.full_name || user?.email))}</span>
          <span class="user-menu__meta">
            <span class="user-menu__name">${escapeHtml(user?.full_name || 'Staff')}</span>
            <span class="user-menu__role">${user?.role === 'admin' ? 'Administrator' : 'Staff'}</span>
          </span>
          ${icon('chevronDown', { size: 15 })}
        </button>
        <div class="user-menu__panel" id="user-menu-panel" role="menu" hidden>
          <div class="user-menu__header">
            <strong>${escapeHtml(user?.full_name || 'Staff')}</strong>
            <span>${escapeHtml(user?.email || '')}</span>
          </div>
          <a class="menu-item" role="menuitem" href="/profile.html">
            ${icon('user', { size: 16 })} Profile and settings
          </a>
          <button type="button" class="menu-item menu-item--danger" role="menuitem" data-logout>
            ${icon('logout', { size: 16 })} Sign out
          </button>
        </div>
      </div>
    </div>`;
}

/* --------------------------------------------------------------------------
   Behaviour wiring
   -------------------------------------------------------------------------- */
function wireShell({ user, sidebar, topbar }) {
  const app = document.querySelector('.app');
  const scrim = qs('#scrim');

  // Mobile off-canvas sidebar.
  const openSidebar = (open) => {
    if (!app) return;
    app.classList.toggle('sidebar-open', open);
    if (scrim) scrim.hidden = !open;
    sidebar.querySelector('[data-sidebar-toggle]');
    topbar.querySelector('[data-sidebar-toggle]')?.setAttribute('aria-expanded', String(open));
  };

  topbar.querySelector('[data-sidebar-toggle]')?.addEventListener('click', () => {
    openSidebar(!app.classList.contains('sidebar-open'));
  });
  scrim?.addEventListener('click', () => openSidebar(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') openSidebar(false);
  });

  // Collapsing the rail on desktop.
  const COLLAPSE_KEY = 'apa.sidebarCollapsed';
  try {
    if (window.localStorage.getItem(COLLAPSE_KEY) === 'true') app?.classList.add('sidebar-collapsed');
  } catch { /* noop */ }

  // Dark mode.
  topbar.querySelector('[data-theme-toggle]')?.addEventListener('click', (event) => {
    const next = toggleTheme();
    event.currentTarget.innerHTML = icon(next === 'dark' ? 'sun' : 'moon', { size: 18 });
  });

  // User menu.
  const trigger = topbar.querySelector('[data-user-menu-trigger]');
  const panel = topbar.querySelector('#user-menu-panel');
  trigger?.addEventListener('click', () => {
    const isOpen = !panel.hidden;
    panel.hidden = isOpen;
    trigger.setAttribute('aria-expanded', String(!isOpen));
  });
  document.addEventListener('click', (event) => {
    if (!panel || panel.hidden) return;
    if (!event.target.closest('.user-menu')) {
      panel.hidden = true;
      trigger?.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel && !panel.hidden) {
      panel.hidden = true;
      trigger?.setAttribute('aria-expanded', 'false');
      trigger?.focus();
    }
  });

  // Sign out.
  topbar.querySelector('[data-logout]')?.addEventListener('click', async () => {
    await session.logout();
    window.location.replace('/login.html');
  });

  // Name badge on the avatar for assistive technology.
  topbar.querySelector('.user-menu__trigger')?.setAttribute(
    'aria-label',
    `Account menu for ${user?.full_name || user?.email || 'the signed-in user'}`,
  );
}

/* --------------------------------------------------------------------------
   mountShell
   -------------------------------------------------------------------------- */
/**
 * @param {object} options
 * @param {string} options.active     id of the current nav item (for aria-current)
 * @param {string} options.title      top bar heading
 * @param {string} [options.subtitle]
 * @param {string} [options.actions]  extra HTML placed in the top bar (buttons)
 * @param {boolean} [options.requireAdmin]
 * @returns {Promise<{ user: object }>}
 */
export async function mountShell({ active = '', title = '', subtitle = '', actions = '', requireAdmin = false } = {}) {
  applyStoredTheme();

  const sidebar = qs('#sidebar');
  const topbar = qs('#topbar');

  // Restore the session; bounce to the sign-in page when there is none.
  let user = session.user();
  if (!session.getToken()) {
    session.redirectToLogin();
    throw new Error('Redirecting to sign in');
  }

  const hydrated = await session.hydrate();
  if (!hydrated) {
    session.clear();
    session.redirectToLogin();
    throw new Error('Redirecting to sign in');
  }
  user = hydrated;

  // Role guard: staff may not open admin-only pages.
  const needsAdmin = requireAdmin || ADMIN_ONLY_PAGES.has(active);
  if (needsAdmin && user.role !== 'admin') {
    toastError('Not permitted', 'Only an Administrator can open that page.');
    window.setTimeout(() => window.location.replace('/index.html'), 1200);
    throw new Error('Forbidden');
  }

  if (sidebar) sidebar.innerHTML = sidebarMarkup(user, active);
  if (topbar) topbar.innerHTML = topbarMarkup({ title, subtitle, actions, user });

  wireShell({ user, sidebar, topbar });

  document.title = `${title || 'Dashboard'} — APA Engineering Services`;
  return { user };
}

/** Convenience wrapper for admin-only utility actions (price settings, user admin). */
export async function adminPatch(path, body) {
  return api.patch(path, body);
}
