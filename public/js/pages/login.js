/**
 * SUPPORTING FORM 1 - Sign in.
 *
 * Authenticates against POST /api/auth/login (the server holds the Supabase
 * keys), then stores the returned tokens. Common failure modes - wrong
 * password, wrong role, deactivated account, lockout - all surface as a single
 * generic banner so the form never tells an attacker which part was wrong.
 */
import { api } from '../api.js';
import {
  bindForm, clearErrors, clearFormAlert, setButtonLoading, showFormAlert,
} from '../forms.js';
import { createModal, toastSuccess } from '../ui.js';
import { session } from '../session.js';
import { applyStoredTheme } from '../shell.js';
import { getParam, qs } from '../util.js';
import { initMockForm } from '../forms.js';


applyStoredTheme();

const form = qs('#login-form');
const csrfField = qs('#csrf_token');
const timestampField = qs('#login_timestamp');
const passwordInput = qs('#password');
const toggleButton = qs('[data-toggle-password]');
const rememberInput = qs('#remember');
const forgotLink = qs('#forgot-link');

/* --------------------------------------------------------------------------
   Hidden fields
   -------------------------------------------------------------------------- */
// A per-page-load nonce. The API is token based and same-origin only; this
// value is submitted with the form so a cross-site POST from another page is
// missing it and is rejected by the server-side origin check in the middleware.
csrfField.value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
timestampField.value = new Date().toISOString();

/* --------------------------------------------------------------------------
   Already signed in? Go straight through.
   -------------------------------------------------------------------------- */
const safeNext = () => {
  const next = getParam('next');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/index.html';
};

if (session.getToken()) {
  const user = await session.hydrate();
  if (user) window.location.replace(safeNext());
}

/* --------------------------------------------------------------------------
   Small behaviours
   -------------------------------------------------------------------------- */
// Show / hide the password.
toggleButton.addEventListener('click', () => {
  const showing = passwordInput.type === 'text';
  passwordInput.type = showing ? 'password' : 'text';
  toggleButton.textContent = showing ? 'Show' : 'Hide';
  toggleButton.setAttribute('aria-pressed', String(!showing));
  toggleButton.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  passwordInput.focus();
});

// Pre-select the role last used on this device.
const lastRole = session.lastRole();
if (lastRole === 'admin' || lastRole === 'staff') {
  const radio = form.querySelector(`input[name="role"][value="${lastRole}"]`);
  if (radio) radio.checked = true;
}
try {
  rememberInput.checked = window.localStorage.getItem('apa.remember') === 'true';
} catch { /* noop */ }

/* --------------------------------------------------------------------------
   Validation and submit
   -------------------------------------------------------------------------- */
const RULES = {
  email: { label: 'Email address', required: true, type: 'email' },
  password: { label: 'Password', required: true, type: 'string', minLength: 8, maxLength: 72 },
  role: { label: 'Role', required: true, type: 'enum', values: ['admin', 'staff'] },
};

bindForm(form, {
  rules: RULES,
  submitButton: 'button[type="submit"]',
  validateOnBlur: false,
  onReset: () => {
    clearErrors(form);
    clearFormAlert(form);
    return true;
  },
  onSubmit: async (values) => {
    clearFormAlert(form);
    const remember = rememberInput.checked;

    // The role radio is the last field the user sees; read it fresh.
    const role = form.querySelector('input[name="role"]:checked')?.value || values.role;

    const data = await api.post('/api/auth/login', {
      email: values.email,
      password: values.password,
      role,
      csrf_token: csrfField.value,
      login_timestamp: timestampField.value,
    });

    session.save(data, remember);
    try { window.localStorage.setItem('apa.remember', String(remember)); } catch { /* noop */ }

    toastSuccess(
      `Welcome back, ${data.user?.full_name || data.user?.email}.`,
      role === 'admin' ? 'Signed in as Administrator.' : 'Signed in as Staff.',
    );

    window.location.replace(safeNext());
  },
});

/* --------------------------------------------------------------------------
   Forgot password
   -------------------------------------------------------------------------- */
forgotLink.addEventListener('click', (event) => {
  event.preventDefault();
  const modal = createModal({
    title: 'Reset your password',
    description: 'We will email a reset link if the address matches an account.',
  });

  modal.body.innerHTML = `
    <div class="field" data-field="reset_email">
      <label class="field__label" for="reset_email">Email address <span class="req" aria-hidden="true">*</span></label>
      <input class="input" type="email" id="reset_email" name="reset_email"
             autocomplete="email" placeholder="you@apaengineering.ph"
             aria-describedby="reset_email-help" required>
      <p class="field__help" id="reset_email-help">Enter the address you sign in with.</p>
      <p class="field__error" data-error-for="reset_email"></p>
    </div>
    <div class="alert alert--info" role="note">
      <span class="alert__icon" aria-hidden="true">&#8505;</span>
      <span class="alert__body">For security, this form always shows the same confirmation whether or not the address exists.</span>
    </div>
  `;

  modal.footer.innerHTML = `
    <button type="button" class="btn btn--secondary" data-close>Cancel</button>
    <button type="button" class="btn btn--primary" data-send>Send reset link</button>
  `;

  const emailInput = modal.body.querySelector('#reset_email');
  const sendButton = modal.footer.querySelector('[data-send]');

  sendButton.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email) {
      modal.body.querySelector('[data-field="reset_email"]').classList.add('has-error');
      modal.body.querySelector('[data-error-for="reset_email"]').textContent = 'Email address is required.';
      emailInput.setAttribute('aria-invalid', 'true');
      emailInput.focus();
      return;
    }

    setButtonLoading(sendButton, true);
    try {
      const result = await api.post('/api/auth/forgot-password', { email });
      modal.close();
      toastSuccess('Check your inbox', result?.message || 'If that address matches an account, a reset link is on its way.');
    } catch (error) {
      const wrapper = modal.body.querySelector('[data-field="reset_email"]');
      wrapper.classList.add('has-error');
      wrapper.querySelector('.field__error').textContent = error?.message || 'The request could not be sent.';
    } finally {
      setButtonLoading(sendButton, false);
    }
  });
});

// Move focus to the field that is actually wrong when the server reports fields.
form.addEventListener('focus', () => clearFormAlert(form), { once: true });

document.addEventListener('DOMContentLoaded', () => {
  initMockForm('loginForm', (data) => {
    console.log('Mock Login Success! Data captured:', data);
    
    // Store dummy session info in localStorage
    localStorage.setItem('user', JSON.stringify({ email: data.email, role: 'Admin' }));
    
    alert('Mock Login Successful! Redirecting to dashboard...');
    window.location.href = '/quotation-detail.html'; // Redirect to your page
  });
});