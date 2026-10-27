/**
 * Reset password (standalone page - no shell).
 *
 * The "Forgot password?" flow emails a link that returns here with a recovery
 * token in the URL hash (#access_token=...) or, on some projects, a ?code=...
 * query parameter. We read whichever is present, hand it to
 * POST /api/auth/reset-password together with the new password, then send the
 * user back to the sign-in screen.
 *
 * If neither is present the link is missing or spent, so we explain that and
 * disable the form instead of letting the user fill it in for nothing.
 */
import { api } from '../api.js';
import { bindForm } from '../forms.js';
import { stateHtml, toastSuccess } from '../ui.js';
import { applyStoredTheme } from '../shell.js';
import { getParam, qs, qsa } from '../util.js';

applyStoredTheme();

const form = qs('#reset-form');
const formCard = form.closest('.card');
const statusRegion = qs('#reset-status');
const tokenField = qs('#access_token');
const codeField = qs('#code');

/* --------------------------------------------------------------------------
   Pull the recovery token out of the URL
   -------------------------------------------------------------------------- */
// The hash is not sent to the server, so read it here before doing anything.
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const accessToken = hashParams.get('access_token') || '';
const code = getParam('code') || '';

// Strip the token from the address bar so it does not linger in history or get
// copied when the user shares the tab.
if (window.location.hash || code) {
  window.history.replaceState(null, '', window.location.pathname);
}

tokenField.value = accessToken;
codeField.value = code;

const hasToken = Boolean(accessToken || code);

/* --------------------------------------------------------------------------
   Missing or spent link
   -------------------------------------------------------------------------- */
if (!hasToken) {
  formCard.hidden = true;
  statusRegion.innerHTML = stateHtml({
    iconName: 'lock',
    title: 'This reset link is missing or has expired',
    text: 'Reset links can only be used once and they time out quickly. Request a new one from the sign-in screen.',
    actionHtml: '<a class="btn btn--primary" href="/login.html">Back to sign in</a>',
  });
}

/* --------------------------------------------------------------------------
   Show / hide password buttons
   -------------------------------------------------------------------------- */
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
   Validation and submit
   -------------------------------------------------------------------------- */
// Same rules as the server (8-72 characters, and the two boxes must match).
const RULES = {
  new_password: { label: 'New password', required: true, type: 'string', minLength: 8, maxLength: 72 },
  confirm_password: {
    label: 'Confirm new password',
    required: true,
    type: 'string',
    minLength: 8,
    maxLength: 72,
    matches: { field: 'new_password', message: 'The two passwords do not match.' },
  },
};

if (hasToken) {
  bindForm(form, {
    rules: RULES,
    submitButton: 'button[type="submit"]',
    validateOnBlur: false,
    onSubmit: async (values) => {
      // Send whichever form of token the link carried; the server picks the one
      // it recognises. Nothing happens if the token was already used.
      await api.post('/api/auth/reset-password', {
        access_token: accessToken || undefined,
        code: code || undefined,
        new_password: values.new_password,
        confirm_password: values.confirm_password,
      });

      formCard.hidden = true;
      statusRegion.innerHTML = stateHtml({
        iconName: 'checkCircle',
        title: 'Your password has been updated',
        text: 'You can now sign in with your new password.',
        actionHtml: '<a class="btn btn--primary" href="/login.html">Go to sign in</a>',
      });
      toastSuccess('Password updated', 'Taking you back to the sign-in screen…');

      // Nudge the user along after they have had a moment to read the message.
      window.setTimeout(() => window.location.replace('/login.html'), 2500);
    },
  });
}
