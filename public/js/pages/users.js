/**
 * User management (Administrators only).
 *
 * The whole list is loaded in one request (there is no paging on this endpoint)
 * and filtered in the browser, which keeps the screen instant for a firm with a
 * handful of accounts. Creating, editing, resetting and deleting all require the
 * server-side service role key, so every write goes through the API.
 */
import { mountShell } from '../shell.js';
import { api } from '../api.js';
import { bindForm, setButtonLoading } from '../forms.js';
import { icon } from '../icons.js';
import {
  confirmAction, createModal, emptyRow, errorRow, loadingRows, stateHtml,
  toastError, toastSuccess,
} from '../ui.js';
import {
  debounce, escapeHtml, formatDate, formatDateTime, initials, qs, qsa,
} from '../util.js';

/* --------------------------------------------------------------------------
   Session and shell
   -------------------------------------------------------------------------- */
let currentUser = null;
try {
  ({ user: currentUser } = await mountShell({
    active: 'users',
    title: 'User management',
    subtitle: 'Accounts, roles and sign-in access',
    requireAdmin: true,
  }));
} catch { /* mountShell redirects when there is no session or the role is Staff */ }

/* --------------------------------------------------------------------------
   Page state
   -------------------------------------------------------------------------- */
const state = {
  rows: [],
  keyword: '',
  role: '',
  status: '',
};

const els = {
  body: qs('#users-body'),
  count: qs('#users-count'),
  filters: qs('#user-filters'),
  keyword: qs('#user-keyword'),
  role: qs('#user-role'),
  status: qs('#user-status'),
  addButton: qs('#add-user'),
  statTotal: qs('#stat-total'),
  statAdmins: qs('#stat-admins'),
  statStaff: qs('#stat-staff'),
  statActive: qs('#stat-active'),
};

/* --------------------------------------------------------------------------
   Listing
   -------------------------------------------------------------------------- */
const ROLE_BADGE = {
  admin: '<span class="badge badge--navy">Administrator</span>',
  staff: '<span class="badge badge--neutral">Staff</span>',
};

function userRow(user) {
  const isSelf = currentUser && user.id === currentUser.id;

  return `<tr>
    <td>
      <div class="row row--tight">
        <span class="avatar avatar--sm" aria-hidden="true">${escapeHtml(initials(user.full_name || user.email))}</span>
        <span>
          <span class="table__primary">${escapeHtml(user.full_name || 'Unnamed account')}</span>
          <span class="table__secondary">${escapeHtml(user.position || 'No position set')}</span>
        </span>
      </div>
    </td>
    <td>${escapeHtml(user.email || '—')}</td>
    <td>${escapeHtml(user.phone || '—')}</td>
    <td>${ROLE_BADGE[user.role] || escapeHtml(user.role || '—')}</td>
    <td>${user.is_active
      ? '<span class="badge badge--completed">Active</span>'
      : '<span class="badge badge--neutral">Deactivated</span>'}</td>
    <td>${escapeHtml(user.last_login_at ? formatDateTime(user.last_login_at) : 'Never')}</td>
    <td>${escapeHtml(formatDate(user.created_at))}</td>
    <td class="actions">
      <button type="button" class="btn btn--secondary btn--sm" data-edit="${escapeHtml(user.id)}">Edit</button>
      <button type="button" class="btn btn--secondary btn--sm" data-reset="${escapeHtml(user.id)}">Reset password</button>
      ${isSelf ? '' : `<button type="button" class="btn btn--danger btn--sm" data-delete="${escapeHtml(user.id)}">Delete</button>`}
    </td>
  </tr>`;
}

function filteredRows() {
  const keyword = state.keyword.toLowerCase();
  return state.rows.filter((user) => {
    if (state.role && user.role !== state.role) return false;
    if (state.status === 'active' && !user.is_active) return false;
    if (state.status === 'deactivated' && user.is_active) return false;
    if (keyword) {
      const haystack = `${user.full_name || ''} ${user.email || ''}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

function renderTable() {
  const rows = filteredRows();
  if (!rows.length) {
    els.body.innerHTML = emptyRow(8, 'No accounts match these filters.');
  } else {
    els.body.innerHTML = rows.map(userRow).join('');
  }
  els.count.textContent = `${rows.length} of ${state.rows.length} account${state.rows.length === 1 ? '' : 's'} shown`;
}

function renderStats() {
  const total = state.rows.length;
  els.statTotal.textContent = String(total);
  els.statAdmins.textContent = String(state.rows.filter((user) => user.role === 'admin').length);
  els.statStaff.textContent = String(state.rows.filter((user) => user.role === 'staff').length);
  els.statActive.textContent = String(state.rows.filter((user) => user.is_active).length);
}

async function loadUsers() {
  els.body.innerHTML = loadingRows(8, 5);
  els.count.textContent = 'Loading accounts…';
  try {
    const data = await api.get('/users');
    state.rows = data.rows || [];
    renderStats();
    renderTable();
  } catch (error) {
    els.body.innerHTML = errorRow(8, error?.message || 'The account list could not be loaded.', 'data-retry');
    els.count.textContent = '';
  }
}

function findUser(id) {
  return state.rows.find((user) => user.id === id) || null;
}

/* --------------------------------------------------------------------------
   Shared field pieces
   -------------------------------------------------------------------------- */
function wirePasswordToggles(root) {
  qsa('[data-toggle-password]', root).forEach((button) => {
    button.addEventListener('click', () => {
      const input = button.closest('.input-group')?.querySelector('input');
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      button.textContent = showing ? 'Show' : 'Hide';
      button.setAttribute('aria-pressed', String(!showing));
      button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      input.focus();
    });
  });
}

function passwordField(id, label, helpText, value = '') {
  return `
    <div class="field" data-field="${id}">
      <label class="field__label" for="${id}">${label} <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required, 8–72 characters)</span></label>
      <div class="input-group">
        <input class="input" type="password" id="${id}" name="${id}" value="${escapeHtml(value)}"
               minlength="8" maxlength="72" autocomplete="new-password"
               aria-describedby="${id}-help" required>
        <button type="button" class="input-group__suffix" data-toggle-password
                aria-label="Show password" aria-pressed="false">Show</button>
      </div>
      <p class="field__help" id="${id}-help">${helpText}</p>
      <p class="field__error" data-error-for="${id}" role="alert"></p>
    </div>`;
}

function roleFieldset(prefix, selected) {
  return `
    <fieldset>
      <legend>Role</legend>
      <div class="option-grid">
        <label class="option" for="${prefix}-role-admin">
          <input type="radio" id="${prefix}-role-admin" name="role" value="admin"${selected === 'admin' ? ' checked' : ''}>
          <span class="option__body">
            <span class="option__title">Administrator</span>
            <span class="option__desc">Everything, plus prices and user accounts.</span>
          </span>
        </label>
        <label class="option" for="${prefix}-role-staff">
          <input type="radio" id="${prefix}-role-staff" name="role" value="staff"${selected === 'staff' ? ' checked' : ''}>
          <span class="option__body">
            <span class="option__title">Staff</span>
            <span class="option__desc">Quotations, projects and site updates.</span>
          </span>
        </label>
      </div>
      <p class="field__error" data-error-for="role" role="alert"></p>
    </fieldset>`;
}

/* --------------------------------------------------------------------------
   Add user
   -------------------------------------------------------------------------- */
const ADD_RULES = {
  full_name: { label: 'Full name', required: true, type: 'string', minLength: 2, maxLength: 120 },
  email: { label: 'Email address', required: true, type: 'email' },
  password: { label: 'Temporary password', required: true, type: 'string', minLength: 8, maxLength: 72 },
  role: { label: 'Role', required: true, type: 'enum', values: ['admin', 'staff'] },
  phone: { label: 'Contact number', type: 'phone' },
  position: { label: 'Position', type: 'string', maxLength: 80 },
};

function openAddModal() {
  const modal = createModal({
    title: 'Add a user',
    description: 'Create an account and issue a temporary password.',
    size: 'wide',
  });

  modal.body.innerHTML = `
    <form id="add-user-form" novalidate>
      <div class="error-summary" data-error-summary tabindex="-1" role="alert" aria-live="assertive"></div>
      <div class="form-grid">
        <div class="field span-2" data-field="full_name">
          <label class="field__label" for="add-full_name">Full name <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required, 2–120 characters)</span></label>
          <input class="input" type="text" id="add-full_name" name="full_name" maxlength="120"
                 placeholder="e.g. Juan Dela Cruz" autocomplete="name"
                 aria-describedby="add-full_name-help" required>
          <p class="field__help" id="add-full_name-help">The name shown on quotations and site updates.</p>
          <p class="field__error" data-error-for="full_name" role="alert"></p>
        </div>

        <div class="field" data-field="email">
          <label class="field__label" for="add-email">Email address <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required)</span></label>
          <input class="input" type="email" id="add-email" name="email" inputmode="email"
                 placeholder="name@apaengineering.ph" autocomplete="off"
                 aria-describedby="add-email-help" required>
          <p class="field__help" id="add-email-help">This becomes the sign-in address and cannot be changed later.</p>
          <p class="field__error" data-error-for="email" role="alert"></p>
        </div>

        <div class="field" data-field="phone">
          <label class="field__label" for="add-phone">Contact number</label>
          <input class="input" type="tel" id="add-phone" name="phone" inputmode="tel"
                 placeholder="09171234567" autocomplete="tel" aria-describedby="add-phone-help">
          <p class="field__help" id="add-phone-help">Optional. Accepts 09171234567 or +639171234567.</p>
          <p class="field__error" data-error-for="phone" role="alert"></p>
        </div>

        <div class="field span-2" data-field="password">
          <label class="field__label" for="add-password">Temporary password <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required, 8–72 characters)</span></label>
          <div class="input-group">
            <input class="input" type="password" id="add-password" name="password" minlength="8" maxlength="72"
                   placeholder="A temporary password" autocomplete="new-password"
                   aria-describedby="add-password-help" required>
            <button type="button" class="input-group__suffix" data-toggle-password
                    aria-label="Show password" aria-pressed="false">Show</button>
          </div>
          <p class="field__help" id="add-password-help">Share this with the user; they must change it after the first sign-in.</p>
          <p class="field__error" data-error-for="password" role="alert"></p>
        </div>

        <div class="field span-2" data-field="position">
          <label class="field__label" for="add-position">Position</label>
          <input class="input" type="text" id="add-position" name="position" maxlength="80"
                 placeholder="e.g. Site Engineer" aria-describedby="add-position-help">
          <p class="field__help" id="add-position-help">Optional job title, up to 80 characters.</p>
          <p class="field__error" data-error-for="position" role="alert"></p>
        </div>

        <div class="span-2">${roleFieldset('add', 'staff')}</div>
      </div>
    </form>`;

  modal.footer.innerHTML = `
    <button type="button" class="btn btn--secondary" data-close>Cancel</button>
    <button type="submit" form="add-user-form" class="btn btn--primary">Create account</button>`;

  const form = modal.body.querySelector('#add-user-form');
  wirePasswordToggles(modal.body);

  bindForm(form, {
    rules: ADD_RULES,
    submitButton: modal.footer.querySelector('button[type="submit"]'),
    onSubmit: async (values) => {
      await api.post('/users', values);
      modal.close();
      toastSuccess('Account created', `${values.full_name} can now sign in as ${values.role === 'admin' ? 'an Administrator' : 'Staff'}.`);
      await loadUsers();
    },
  });
}

/* --------------------------------------------------------------------------
   Edit user
   -------------------------------------------------------------------------- */
const EDIT_RULES = {
  full_name: { label: 'Full name', required: true, type: 'string', minLength: 2, maxLength: 120 },
  role: { label: 'Role', required: true, type: 'enum', values: ['admin', 'staff'] },
  phone: { label: 'Contact number', type: 'phone' },
  position: { label: 'Position', type: 'string', maxLength: 80 },
  is_active: { label: 'Active account', type: 'boolean' },
};

function openEditModal(user) {
  const modal = createModal({
    title: `Edit ${user.full_name || user.email}`,
    description: 'Change this account\'s details, role or access.',
    size: 'wide',
  });

  modal.body.innerHTML = `
    <form id="edit-user-form" novalidate>
      <div class="error-summary" data-error-summary tabindex="-1" role="alert" aria-live="assertive"></div>
      <div class="form-grid">
        <div class="field span-2" data-field="full_name">
          <label class="field__label" for="edit-full_name">Full name <span class="req" aria-hidden="true">*</span> <span class="field__required-note">(required, 2–120 characters)</span></label>
          <input class="input" type="text" id="edit-full_name" name="full_name" maxlength="120"
                 value="${escapeHtml(user.full_name || '')}" aria-describedby="edit-full_name-help" required>
          <p class="field__help" id="edit-full_name-help">The name shown across the system.</p>
          <p class="field__error" data-error-for="full_name" role="alert"></p>
        </div>

        <div class="field" data-field="phone">
          <label class="field__label" for="edit-phone">Contact number</label>
          <input class="input" type="tel" id="edit-phone" name="phone" inputmode="tel"
                 value="${escapeHtml(user.phone || '')}" placeholder="09171234567" aria-describedby="edit-phone-help">
          <p class="field__help" id="edit-phone-help">Optional. Accepts 09171234567 or +639171234567.</p>
          <p class="field__error" data-error-for="phone" role="alert"></p>
        </div>

        <div class="field" data-field="position">
          <label class="field__label" for="edit-position">Position</label>
          <input class="input" type="text" id="edit-position" name="position" maxlength="80"
                 value="${escapeHtml(user.position || '')}" placeholder="e.g. Site Engineer" aria-describedby="edit-position-help">
          <p class="field__help" id="edit-position-help">Optional job title, up to 80 characters.</p>
          <p class="field__error" data-error-for="position" role="alert"></p>
        </div>

        <div class="span-2">${roleFieldset('edit', user.role)}</div>

        <div class="field span-2" data-field="is_active">
          <label class="switch" for="edit-is_active">
            <input type="checkbox" id="edit-is_active" name="is_active" role="switch"${user.is_active ? ' checked' : ''}>
            <span class="switch__track" aria-hidden="true"></span>
            <span class="switch__label">Active account
              <span class="switch__hint">Turn off to block this person from signing in.</span>
            </span>
          </label>
          <p class="field__error" data-error-for="is_active" role="alert"></p>
        </div>
      </div>

      <div class="alert alert--warning" role="note">
        <span class="alert__icon" aria-hidden="true">&#9888;</span>
        <span class="alert__body">Deactivating an account blocks sign-in immediately. Saved quotations and
        project records stay intact and can be reassigned later.</span>
      </div>
    </form>`;

  modal.footer.innerHTML = `
    <button type="button" class="btn btn--secondary" data-close>Cancel</button>
    <button type="submit" form="edit-user-form" class="btn btn--primary">Save changes</button>`;

  const form = modal.body.querySelector('#edit-user-form');

  bindForm(form, {
    rules: EDIT_RULES,
    submitButton: modal.footer.querySelector('button[type="submit"]'),
    onSubmit: async (values) => {
      await api.patch(`/users/${user.id}`, values);
      modal.close();
      toastSuccess('Account updated', `${values.full_name} was saved.`);
      await loadUsers();
    },
  });
}

/* --------------------------------------------------------------------------
   Reset password
   -------------------------------------------------------------------------- */
const RESET_RULES = {
  password: { label: 'New temporary password', required: true, type: 'string', minLength: 8, maxLength: 72 },
  confirm_password: {
    label: 'Confirm temporary password', required: true, type: 'string', minLength: 8, maxLength: 72,
    matches: { field: 'password', message: 'The two passwords do not match.' },
  },
};

function openResetModal(user) {
  const modal = createModal({
    title: `Reset password for ${user.full_name || user.email}`,
    description: 'Issue a new temporary password the user must change after signing in.',
  });

  modal.body.innerHTML = `
    <form id="reset-user-form" novalidate>
      <div class="error-summary" data-error-summary tabindex="-1" role="alert" aria-live="assertive"></div>
      ${passwordField('password', 'New temporary password', 'At least 8 and up to 72 characters.')}
      ${passwordField('confirm_password', 'Confirm temporary password', 'Type the same password again.')}
      <div class="alert alert--info" role="note">
        <span class="alert__icon" aria-hidden="true">&#8505;</span>
        <span class="alert__body">Tell the user this password directly. They will be able to change it
        themselves from Profile &amp; settings after signing in.</span>
      </div>
    </form>`;

  modal.footer.innerHTML = `
    <button type="button" class="btn btn--secondary" data-close>Cancel</button>
    <button type="submit" form="reset-user-form" class="btn btn--primary">Reset password</button>`;

  const form = modal.body.querySelector('#reset-user-form');
  wirePasswordToggles(modal.body);

  bindForm(form, {
    rules: RESET_RULES,
    submitButton: modal.footer.querySelector('button[type="submit"]'),
    onSubmit: async (values) => {
      await api.post(`/users/${user.id}/reset-password`, { password: values.password });
      modal.close();
      toastSuccess('Password reset', `A new temporary password was issued for ${user.full_name || user.email}.`);
    },
  });
}

/* --------------------------------------------------------------------------
   Delete
   -------------------------------------------------------------------------- */
async function deleteUser(user) {
  const confirmed = await confirmAction({
    title: 'Delete this account?',
    message: `The account for ${user.full_name || user.email} will be permanently removed and can no longer sign in. Existing records are kept but must be reassigned.`,
    confirmLabel: 'Delete account',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await api.delete(`/users/${user.id}`);
    toastSuccess('Account deleted', `${user.full_name || user.email} was removed.`);
    await loadUsers();
  } catch (error) {
    toastError('Could not delete the account', error?.message);
  }
}

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */
function wireFilters() {
  els.keyword.addEventListener('input', debounce(() => {
    state.keyword = els.keyword.value.trim();
    renderTable();
  }, 180));

  els.role.addEventListener('change', () => {
    state.role = els.role.value;
    renderTable();
  });

  els.status.addEventListener('change', () => {
    state.status = els.status.value;
    renderTable();
  });

  els.filters.addEventListener('reset', (event) => {
    event.preventDefault();
    els.keyword.value = '';
    els.role.value = '';
    els.status.value = '';
    state.keyword = '';
    state.role = '';
    state.status = '';
    renderTable();
  });
}

function init() {
  els.addButton.addEventListener('click', openAddModal);

  els.body.addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit]');
    if (edit) { openEditModal(findUser(edit.dataset.edit)); return; }
    const reset = event.target.closest('[data-reset]');
    if (reset) { openResetModal(findUser(reset.dataset.reset)); return; }
    const remove = event.target.closest('[data-delete]');
    if (remove) { deleteUser(findUser(remove.dataset.delete)); return; }
    if (event.target.closest('[data-retry]')) loadUsers();
  });

  wireFilters();
  return loadUsers();
}

// Booting happens last so every `const` above is initialised first.
if (currentUser) await init();
