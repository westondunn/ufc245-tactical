/**
 * public/js/auth.js — Auth UI (sign-in / sign-up modal + top-bar indicator).
 *
 * All requests use credentials:'include' so the better-auth session cookie
 * round-trips. The legacy x-user-id header path stays working for the existing
 * picks code until Phase 10 cleans it up.
 *
 * Designed to be self-contained — does not touch the main app.js IIFE.
 * Loads BEFORE app.js so window.__ufcAuth is available globally.
 */
(() => {
  const $ = (id) => document.getElementById(id);

  /* ---- API client (thin wrapper over /api/auth/*) ---- */
  const api = {
    async getSession() {
      const r = await fetch('/api/auth/get-session', { credentials: 'include' });
      if (!r.ok) return null;
      return r.json();
    },
    async signUp({ email, password, name }) {
      const r = await fetch('/api/auth/sign-up/email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || `Sign up failed (${r.status})`);
      return body;
    },
    async signIn({ email, password }) {
      const r = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || `Sign in failed (${r.status})`);
      return body;
    },
    async signOut() {
      await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    },
    async requestPasswordReset({ email, redirectTo }) {
      const r = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectTo }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || `Reset request failed (${r.status})`);
      return body;
    },
    async resetPassword({ token, newPassword }) {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || `Password reset failed (${r.status})`);
      return body;
    },
    async getGuestPickCount(guestId) {
      try {
        const r = await fetch('/api/picks/guest-count/' + encodeURIComponent(guestId));
        if (!r.ok) return 0;
        const body = await r.json();
        return Number(body && body.count) || 0;
      } catch (_) { return 0; }
    },
    async claimGuest(guestId) {
      const r = await fetch('/api/picks/claim-guest', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || body.error || `Claim failed (${r.status})`);
      return body;
    },
  };

  /* ---- Legacy guest detection ---- */
  // The pre-auth picks system stored { id, display_name, avatar_key } at this key.
  // Snapshot it RIGHT NOW (synchronously, at script-load time) — app.js loads
  // after us and clears the key when it can't validate the id against the new
  // `users` table. By then we've already captured what we need.
  const LEGACY_KEY = 'ufc_user';
  const _legacyGuestSnapshot = (() => {
    try { const r = localStorage.getItem(LEGACY_KEY); return r ? JSON.parse(r) : null; }
    catch (_) { return null; }
  })();
  function readLegacyGuest() { return _legacyGuestSnapshot; }
  function clearLegacyGuest() {
    try { localStorage.removeItem(LEGACY_KEY); } catch (_) { /* ignore */ }
  }

  /* ---- State ---- */
  let session = null; // { user, session } or null

  /**
   * Bridge: sync the cookie-session user into the legacy `ufc_user`
   * localStorage entry so app.js (which still sends `x-user-id` headers for
   * picks) keeps working without modification. The server's requireUser
   * middleware prefers the cookie over the header anyway, so this is just a
   * compatibility shim until app.js is migrated to credentials:'include'.
   */
  function syncSessionToLegacyStorage() {
    if (!session || !session.user) {
      try { localStorage.removeItem(LEGACY_KEY); } catch (_) {}
      return;
    }
    try {
      const u = session.user;
      localStorage.setItem(LEGACY_KEY, JSON.stringify({
        id: u.id,
        display_name: u.display_name || u.name || u.email || 'User',
        avatar_key: u.avatar_key || null,
      }));
    } catch (_) { /* ignore quota errors */ }
  }

  /* ---- Top-bar indicator ---- */
  function renderIndicator() {
    const el = $('authIndicator');
    if (!el) return;
    if (session && session.user) {
      const u = session.user;
      const label = u.name || u.email || 'Account';
      el.innerHTML = `
        <span class="auth-ind__email" title="${escapeAttr(u.email || '')}">${escapeHtml(label)}</span>
        <button class="auth-ind__btn" id="authSignOutBtn" type="button">Sign out</button>
      `;
      $('authSignOutBtn').addEventListener('click', async () => {
        await api.signOut();
        session = null;
        syncSessionToLegacyStorage();
        renderIndicator();
        // Reload so app.js drops the now-stale picks state.
        setTimeout(() => location.reload(), 100);
      });
    } else {
      el.innerHTML = `
        <button class="auth-ind__btn" id="authOpenSignIn" type="button">Sign in</button>
        <button class="auth-ind__btn auth-ind__btn--primary" id="authOpenSignUp" type="button">Create account</button>
      `;
      $('authOpenSignIn').addEventListener('click', () => openModal('signin'));
      $('authOpenSignUp').addEventListener('click', () => openModal('signup'));
    }
  }

  /* ---- Modal show/hide + tab swap ---- */
  function openModal(mode) {
    const m = $('authModal');
    if (!m) return;
    m.style.display = 'flex';
    m.setAttribute('aria-hidden', 'false');
    setMode(mode || 'signin');
    setTimeout(() => $('authEmail') && $('authEmail').focus(), 30);
  }
  function closeModal() {
    const m = $('authModal');
    if (!m) return;
    m.style.display = 'none';
    m.setAttribute('aria-hidden', 'true');
    clearError();
    $('authForm').reset();
  }
  /**
   * Modes:
   *   signin  — email + password, "forgot password?" link
   *   signup  — name + email + password
   *   forgot  — email only ("Send reset link")
   *   reset   — new password only (token comes from URL)
   */
  function setMode(mode, extra) {
    const f = $('authForm');
    f.dataset.mode = mode;
    clearError();
    clearNotice();

    const isSignin = mode === 'signin';
    const isSignup = mode === 'signup';
    const isForgot = mode === 'forgot';
    const isReset  = mode === 'reset';

    // Tab visibility — hidden in forgot/reset modes (back button instead)
    const showTabs = isSignin || isSignup;
    $('authTabSignIn').style.display = showTabs ? 'flex' : 'none';
    $('authTabSignUp').style.display = showTabs ? 'flex' : 'none';
    $('authTabSignIn').classList.toggle('active', isSignin);
    $('authTabSignUp').classList.toggle('active', isSignup);

    // Field visibility — and `required` must follow visibility, otherwise
    // HTML5 validation refuses to submit on hidden-but-required fields.
    const showName = isSignup;
    const showEmail = !isReset;
    const showPw = !isForgot;
    $('authNameRow').style.display     = showName ? 'block' : 'none';
    $('authEmailRow').style.display    = showEmail ? 'block' : 'none';
    $('authPasswordRow').style.display = showPw ? 'block' : 'none';
    $('authForgotRow').style.display   = isSignin ? 'block' : 'none';
    $('authEmail').required = showEmail;
    $('authPassword').required = showPw;

    // Field tweaks per mode
    const pwLabel = $('authPasswordLabel');
    const pwInput = $('authPassword');
    if (isReset) {
      pwLabel.textContent = 'New password';
      pwInput.placeholder = 'At least 8 characters';
      pwInput.autocomplete = 'new-password';
    } else if (isSignup) {
      pwLabel.textContent = 'Password';
      pwInput.placeholder = 'At least 8 characters';
      pwInput.autocomplete = 'new-password';
    } else {
      pwLabel.textContent = 'Password';
      pwInput.placeholder = 'At least 8 characters';
      pwInput.autocomplete = 'current-password';
    }

    // Title + subtitle
    const title = $('authModalTitle');
    const sub = document.querySelector('#authModal .profile-modal__sub');
    if (isForgot) {
      title.textContent = 'Reset your password';
      sub.textContent = "Enter your email and we'll send you a reset link.";
    } else if (isReset) {
      title.textContent = 'Set a new password';
      sub.textContent = 'Enter the new password for your account.';
    } else {
      title.textContent = 'Sign in or create an account';
      sub.textContent = 'Your picks travel with your account, on any device.';
    }

    // Submit / back buttons
    $('authSubmitBtn').textContent =
      isSignup ? 'Create account' :
      isForgot ? 'Send reset link' :
      isReset  ? 'Set new password' :
                 'Sign in';
    const showBack = isForgot || isReset;
    $('authBackBtn').style.display = showBack ? 'block' : 'none';
    $('authCancelBtn').style.display = showBack ? 'none' : 'block';

    // Pre-fill notice if we got an email back from the reset request
    if (extra && extra.notice) showNotice(extra.notice);
  }
  function showNotice(msg) {
    const el = $('authNotice');
    el.textContent = msg;
    el.style.display = 'block';
  }
  function clearNotice() {
    const el = $('authNotice');
    if (el) { el.style.display = 'none'; el.textContent = ''; }
  }
  function showError(msg) {
    const el = $('authError');
    el.textContent = msg;
    el.style.display = 'block';
  }
  function clearError() {
    const el = $('authError');
    if (el) { el.style.display = 'none'; el.textContent = ''; }
  }

  /* ---- Form submit ---- */
  let _resetToken = null;

  const SUBMIT_LABELS = {
    signin: { idle: 'Sign in',         busy: 'Signing in…' },
    signup: { idle: 'Create account',  busy: 'Creating…' },
    forgot: { idle: 'Send reset link', busy: 'Sending…' },
    reset:  { idle: 'Set new password', busy: 'Saving…' },
  };

  async function handleSubmit(ev) {
    ev.preventDefault();
    clearError();
    clearNotice();
    const mode = $('authForm').dataset.mode || 'signin';
    const email = $('authEmail').value.trim();
    const pw = $('authPassword').value;
    const name = $('authName').value.trim();
    const btn = $('authSubmitBtn');
    const labels = SUBMIT_LABELS[mode] || SUBMIT_LABELS.signin;
    btn.disabled = true;
    btn.textContent = labels.busy;
    try {
      if (mode === 'signup') {
        if (!name) throw new Error('Name is required');
        if (pw.length < 8) throw new Error('Password must be at least 8 characters');
        await api.signUp({ email, password: pw, name });
        session = await api.getSession();
        syncSessionToLegacyStorage();
        renderIndicator();
        closeModal();
        maybePromptClaim();
      } else if (mode === 'signin') {
        await api.signIn({ email, password: pw });
        session = await api.getSession();
        syncSessionToLegacyStorage();
        renderIndicator();
        closeModal();
        maybePromptClaim();
      } else if (mode === 'forgot') {
        await api.requestPasswordReset({
          email,
          redirectTo: location.origin + location.pathname + '?reset=1',
        });
        // Always show the same generic message — server hides whether the
        // address exists, and so should the UI.
        showNotice("If that email exists, a reset link is on its way. Check your inbox.");
        // Clear the email field so the user can dismiss naturally.
        $('authEmail').value = '';
      } else if (mode === 'reset') {
        if (!_resetToken) throw new Error('Missing reset token. Open the link from your email again.');
        if (pw.length < 8) throw new Error('Password must be at least 8 characters');
        await api.resetPassword({ token: _resetToken, newPassword: pw });
        // Strip token from URL, prompt sign-in with the new password.
        try {
          const u = new URL(location.href);
          u.searchParams.delete('token');
          u.searchParams.delete('reset');
          history.replaceState({}, '', u.toString());
        } catch (_) {}
        _resetToken = null;
        setMode('signin');
        showNotice('Password updated. Sign in with your new password.');
      }
    } catch (err) {
      showError(err.message || 'Something went wrong');
    } finally {
      btn.disabled = false;
      // Re-read mode in case it changed (e.g., reset → signin)
      const newMode = $('authForm').dataset.mode || 'signin';
      btn.textContent = (SUBMIT_LABELS[newMode] || SUBMIT_LABELS.signin).idle;
    }
  }

  /** Detect ?token=...&reset=1 in URL and auto-open the reset modal. */
  function maybeOpenResetFromUrl() {
    try {
      const u = new URL(location.href);
      const token = u.searchParams.get('token');
      const reset = u.searchParams.get('reset');
      if (token && reset) {
        _resetToken = token;
        openModal('reset');
        return true;
      }
    } catch (_) {}
    return false;
  }

  /* ---- Claim flow ---- */
  let _pendingGuest = null;

  async function maybePromptClaim() {
    const legacy = readLegacyGuest();
    if (!legacy || !legacy.id) return;
    if (session && session.user && legacy.id === session.user.id) {
      // Same id (rare — but means they've already linked or never were a guest).
      clearLegacyGuest();
      return;
    }
    const count = await api.getGuestPickCount(legacy.id);
    if (count <= 0) {
      // Nothing to claim — clear the stale localStorage entry to stop nagging.
      clearLegacyGuest();
      return;
    }
    _pendingGuest = legacy;
    showClaimModal(legacy, count);
  }

  function showClaimModal(legacy, count) {
    const m = $('claimModal');
    if (!m) return;
    const noun = count === 1 ? 'pick' : 'picks';
    $('claimModalSub').textContent = `We found ${count} ${noun} from when you used this site as a guest.`;
    $('claimModalDetail').innerHTML =
      `Guest profile: <strong>${escapeHtml(legacy.display_name || '(unnamed)')}</strong>` +
      ` — <code style="font-size:10px;color:var(--muted)">${escapeHtml(legacy.id)}</code>` +
      `<br><span style="color:var(--muted-dim);font-size:11px">` +
      `Picks under that guest will move to your account permanently. This can't be undone.` +
      `</span>`;
    $('claimModalError').style.display = 'none';
    m.style.display = 'flex';
    m.setAttribute('aria-hidden', 'false');
  }

  function hideClaimModal() {
    const m = $('claimModal');
    if (!m) return;
    m.style.display = 'none';
    m.setAttribute('aria-hidden', 'true');
    _pendingGuest = null;
  }

  async function handleClaimConfirm() {
    if (!_pendingGuest) return hideClaimModal();
    const btn = $('claimConfirmBtn');
    const skip = $('claimSkipBtn');
    btn.disabled = true; skip.disabled = true;
    btn.textContent = 'Claiming…';
    try {
      const res = await api.claimGuest(_pendingGuest.id);
      clearLegacyGuest();
      hideClaimModal();
      // If the app exposes a refresh hook, ping it; otherwise reload to surface
      // the newly-claimed picks in the existing tabs.
      if (window.refreshPicks) { try { window.refreshPicks(); } catch (_) {} }
      else { setTimeout(() => location.reload(), 200); }
      console.log('[claim] migrated', res.claimed_picks, 'picks');
    } catch (err) {
      const el = $('claimModalError');
      el.textContent = err.message || 'Claim failed';
      el.style.display = 'block';
      btn.disabled = false; skip.disabled = false;
      btn.textContent = 'Claim picks';
    }
  }

  function handleClaimSkip() {
    // Skipping is destructive (we drop the pointer to the guest profile).
    clearLegacyGuest();
    hideClaimModal();
  }

  /* ---- Helpers ---- */
  function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }

  /* ---- Init ---- */
  async function init() {
    // Wire form
    const form = $('authForm');
    if (form) form.addEventListener('submit', handleSubmit);
    // Tab switches
    if ($('authTabSignIn')) $('authTabSignIn').addEventListener('click', () => setMode('signin'));
    if ($('authTabSignUp')) $('authTabSignUp').addEventListener('click', () => setMode('signup'));
    // Forgot password link → forgot mode
    if ($('authForgotLink')) $('authForgotLink').addEventListener('click', (ev) => {
      ev.preventDefault(); setMode('forgot');
    });
    // Back button → signin (used in forgot/reset modes)
    if ($('authBackBtn')) $('authBackBtn').addEventListener('click', () => setMode('signin'));
    // Close handlers (scrim + close button)
    document.querySelectorAll('[data-auth-close]').forEach((el) => el.addEventListener('click', closeModal));

    // Claim modal wiring
    document.querySelectorAll('[data-claim-close]').forEach((el) => el.addEventListener('click', handleClaimSkip));
    if ($('claimConfirmBtn')) $('claimConfirmBtn').addEventListener('click', handleClaimConfirm);
    if ($('claimSkipBtn')) $('claimSkipBtn').addEventListener('click', handleClaimSkip);

    // Load current session, render indicator
    try { session = await api.getSession(); } catch (_) { session = null; }
    renderIndicator();
    // If user arrived from a password-reset email link, pop the reset form.
    if (maybeOpenResetFromUrl()) return;
    // If the user was already signed in on a previous session and a legacy
    // guest is still in localStorage, prompt to claim now. The snapshot was
    // captured synchronously at IIFE load, so it survives the bridge write.
    if (session && session.user) {
      await maybePromptClaim();
      // After the claim flow has had a chance to fire (or no-op), bridge the
      // session id into the legacy `ufc_user` so app.js's existing fetches
      // route to the right account.
      syncSessionToLegacyStorage();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for app.js / debugging
  window.__ufcAuth = {
    api,
    get session() { return session; },
    openModal, closeModal,
    maybePromptClaim,
  };
})();
