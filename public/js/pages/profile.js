/**
 * Profile & settings page.
 *
 * Two small forms that a signed-in user can edit themselves - their own
 * details (PATCH /api/auth/profile) and their password
 * (POST /api/auth/change-password) - plus a dark-mode switch that lives in
 * localStorage under the same key the shell uses, so the choice sticks across
 * every page on this device.
 *
 * There is no "Profile" item in the sidebar, so this page passes no active id.
 */
import { mountShell } from '../shell.js';
import { api } from '../api.js';
import { session } from '../session.js';
import {
  bindForm, clearErrors, setFieldError,
} from '../forms.js';
import { toastSuccess, announce } from '../ui.js';
import { formatDate, initials, qs, qsa } from '../util.js';

/* --------------------------------------------------------------------------
   Page elements
   -------------------------------------------------------------------------- */
const els = {
  avatar: qs('#profile-avatar'),
  name: qs('#profile-name'),
  position: qs('#profile-position'),
  roleBadge: qs('#profile-role-badge'),
  email: qs('#profile-email'),
  since: qs('#profile-since'),

  detailsForm: qs('#details-form'),
  detailEmail: qs('#detail-email'),
  detailRole: qs('#detail-role'),

  passwordForm: qs('#password-form'),
  themeSwitch: qs('#theme-dark'),
};

const THEME_KEY = 'apa.theme';

let currentUser = null;
try {
  const { user } = await mountShell({
    active: '',
    title: 'Profile & settings',
    subtitle: 'Your details, password and appearance',
  });
  currentUser = user;
} catch {
  /* mountShell already redirected to the sign-in page or bounced a Staff
     account that tried to open an Admin-only page - nothing else to do. */
}

/* --------------------------------------------------------------------------
   Identity summary (left card)
   -------------------------------------------------------------------------- */
function roleLabel(user) {
  return user?.role === 'admin' ? 'Administrator' : 'Staff';
}

function renderIdentity(user) {
  const displayName = user?.full_name || user?.email || 'Signed-in user';

  els.avatar.textContent = initials(displayName);
  els.name.textContent = displayName;
  els.position.textContent = user?.position || roleLabel(user);

  // The badge is plain text with a colour modifier chosen per role.
  els.roleBadge.textContent = roleLabel(user);
  els.roleBadge.className = `badge ${user?.role === 'admin' ? 'badge--navy' : 'badge--neutral'}`;

  els.email.textContent = user?.email || '—';

  // The profile endpoint does not return created_at, so fall back to the
  // email address (which the user recognises) rather than showing a blank.
  els.since.textContent = user?.created_at
    ? `Member since ${formatDate(user.created_at)}`
    : (user?.email ? `Signed in as ${user.email}` : 'Account created by your Administrator');

  // The two read-only fields mirror what is stored on the profile.
  if (els.detailEmail) els.detailEmail.value = user?.email || '';
  if (els.detailRole) els.detailRole.value = roleLabel(user);
}

/* --------------------------------------------------------------------------
   Show / hide password buttons
   -------------------------------------------------------------------------- */
// One delegated listener covers every button, so it keeps working for any
// field added later. Each button flips only the input inside its own group.
qsa('[data-toggle-password]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = button.closest('.input-group')?.querySelector('input');
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.textContent = showing ? 'Show' : 'Hide';
    button.setAttribute('aria-pressed', String(!showing));
    const label = button.getAttribute('aria-label') || '';
    button.setAttribute('aria-label', showing ? label.replace(/^Hide/, 'Show') : label.replace(/^Show/, 'Hide'));
    input.focus();
  });
});

/* --------------------------------------------------------------------------
   Your details
   -------------------------------------------------------------------------- */
// The rules mirror server/lib/validation.js so the message a user sees here is
// the same one the server would return.
const DETAIL_RULES = {
  full_name: { label: 'Full name', required: true, type: 'string', minLength: 2, maxLength: 120 },
  phone: { label: 'Contact number', type: 'phone' },
  position: { label: 'Position', type: 'string', maxLength: 80 },
};

function initDetailsForm(user) {
  els.detailsForm.full_name.value = user?.full_name || '';
  els.detailsForm.phone.value = user?.phone || '';
  els.detailsForm.position.value = user?.position || '';

  bindForm(els.detailsForm, {
    rules: DETAIL_RULES,
    submitButton: 'button[type="submit"]',
    onSubmit: async (values) => {
      // The API answers with the fresh profile row; the server ignores any
      // email or role we might send, so only the three editable fields go up.
      const data = await api.patch('/auth/profile', {
        full_name: values.full_name,
        phone: values.phone || '',
        position: values.position || '',
      });

      // Keep the stored session and the visible summary in step.
      if (data?.user) {
        session.updateUser(data.user);
        renderIdentity(data.user);
      }
      toastSuccess('Profile saved', 'Your details were updated.');
      announce('Profile saved.');
    },
  });
}

/* --------------------------------------------------------------------------
   Change your password
   -------------------------------------------------------------------------- */
const PASSWORD_RULES = {
  current_password: { label: 'Current password', required: true, type: 'string', minLength: 8, maxLength: 72 },
  new_password: { label: 'New password', required: true, type: 'string', minLength: 8, maxLength: 72 },
  confirm_password: {
    label: 'Confirm new password',
    required: true,
    type: 'string',
    minLength: 8,
    maxLength: 72,
    matches: { field: 'new_password', message: 'The two new passwords do not match.' },
  },
};

function initPasswordForm() {
  bindForm(els.passwordForm, {
    rules: PASSWORD_RULES,
    submitButton: 'button[type="submit"]',
    onSubmit: async (values) => {
      // Rule the markup cannot express: the new password must be a change.
      if (values.new_password === values.current_password) {
        setFieldError(
          els.passwordForm,
          'new_password',
          'Choose a password that is different from your current one.',
        );
        return;
      }

      await api.post('/auth/change-password', {
        current_password: values.current_password,
        new_password: values.new_password,
        confirm_password: values.confirm_password,
      });

      // Clear the boxes so the old password does not linger on screen.
      els.passwordForm.reset();
      clearErrors(els.passwordForm);
      toastSuccess('Password updated', 'Use your new password the next time you sign in.');
      announce('Password updated.');
    },
  });
}

/* --------------------------------------------------------------------------
   Appearance
   -------------------------------------------------------------------------- */
function initThemeSwitch() {
  // The shell has already applied the stored theme; reflect it on the switch.
  els.themeSwitch.checked = document.documentElement.getAttribute('data-theme') === 'dark';

  els.themeSwitch.addEventListener('change', () => {
    const next = els.themeSwitch.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { window.localStorage.setItem(THEME_KEY, next); } catch { /* storage may be blocked */ }
    announce(next === 'dark' ? 'Dark mode on.' : 'Dark mode off.');
  });
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */
if (currentUser) {
  renderIdentity(currentUser);
  initDetailsForm(currentUser);
  initPasswordForm();
  initThemeSwitch();
}
