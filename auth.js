/**
 * NexTrade — Auth Module
 * login.html is the view only. This module owns all auth business logic.
 * Loaded after config.js. DOM is ready at this point (end of body).
 *
 * No profiles.upsert() — profile bootstrap is DB-trigger + app.js only.
 */
(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────────────────────────── */
  let mode          = 'signup';
  let termsAccepted = false;
  let pendingEmail  = '';

  const ALL_FORMS = ['signupForm','loginForm','otpForm','forgotForm','forgotOtpForm','recoveryForm'];

  /* ── Button state machine ──────────────────────────────────────────────── */
  function setBtn(text, disabled, loading) {
    const btn = document.getElementById('submitBtn');
    if (!btn) return;
    btn.textContent = text;
    btn.disabled    = disabled;
    btn.classList.toggle('loading', loading);
  }
  function resetBtn(label) { setBtn(label, false, false); }

  /* ── DOM helpers ───────────────────────────────────────────────────────── */
  function hideAllForms() {
    ALL_FORMS.forEach(id => document.getElementById(id)?.classList.add('hidden'));
  }

  function updateAuthSwitch(m) {
    const sw = document.getElementById('authSwitch');
    if (!sw) return;
    if (m === 'login')  sw.innerHTML = 'No account? <button class="auth-switch-link" onclick="window.showSignup()">Create one \u2192</button>';
    else if (m === 'signup') sw.innerHTML = 'Already have an account? <button class="auth-switch-link" onclick="window.showLogin()">Sign in \u2192</button>';
    else sw.innerHTML = '';
  }

  /* ── Toast ─────────────────────────────────────────────────────────────── */
  window.showToast = function (msg, type) {
    type = type || 'danger';
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    if (type === 'danger') {
      t.style.background  = 'var(--danger-bg)';
      t.style.borderColor = 'var(--danger)';
      t.style.color       = 'var(--danger)';
    } else {
      t.style.background  = 'var(--live-bg)';
      t.style.borderColor = 'var(--live)';
      t.style.color       = 'var(--live)';
    }
    t.classList.remove('show');
    void t.offsetWidth;
    t.style.display = 'block';
    t.classList.add('show');
    if (t._timer) clearTimeout(t._timer);
    t._timer = setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.style.display = 'none'; }, 200);
    }, 4500);
  };

  /* ── Password toggle ───────────────────────────────────────────────────── */
  window.togglePw = function (inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const icon = btn.querySelector('i');
    if (icon) icon.className = show ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  };

  /* ── Legal modal ───────────────────────────────────────────────────────── */
  window.openLegal = function () {
    const m = document.getElementById('legalModal');
    if (m) { m.style.display = 'flex'; m.classList.add('open'); }
  };
  window.confirmLegal = function () {
    termsAccepted = true;
    const box = document.getElementById('customCheck');
    if (box) { box.classList.add('checked'); box.setAttribute('aria-checked','true'); }
    const m = document.getElementById('legalModal');
    if (m) { m.style.display = 'none'; m.classList.remove('open'); }
  };
  (function () {
    const m = document.getElementById('legalModal');
    if (m) m.addEventListener('click', function (e) {
      if (e.target === m) { m.style.display = 'none'; m.classList.remove('open'); }
    });
  })();

  /* ── View transitions ──────────────────────────────────────────────────── */
  window.enterAuth = function (newMode) {
    mode = newMode;
    const landing = document.getElementById('landing');
    landing.classList.add('exit');
    const btn = document.getElementById('submitBtn');
    btn.disabled = false; btn.classList.remove('loading');
    hideAllForms();
    if (mode === 'login') {
      document.getElementById('formTitle').textContent    = 'Welcome Back';
      document.getElementById('formSubtitle').textContent = 'Enter your credentials to continue.';
      document.getElementById('loginForm').classList.remove('hidden');
      resetBtn('SIGN IN'); updateAuthSwitch('login');
      setTimeout(function () { document.getElementById('logEmail')?.focus(); }, 310);
    } else {
      document.getElementById('formTitle').textContent    = 'Create Account';
      document.getElementById('formSubtitle').textContent = 'Let\u2019s get your portfolio started.';
      document.getElementById('signupForm').classList.remove('hidden');
      resetBtn('CREATE ACCOUNT'); updateAuthSwitch('signup');
      setTimeout(function () { document.getElementById('regName')?.focus(); }, 310);
    }
    setTimeout(function () {
      landing.style.display = 'none';
      document.getElementById('auth').classList.add('visible');
    }, 260);
  };

  window.resetView = function () {
    sessionStorage.removeItem('saved_auth_mode');
    sessionStorage.removeItem('saved_auth_email');
    sessionStorage.removeItem('reset_email');
    location.reload();
  };

  window.showLogin = function () {
    mode = 'login';
    sessionStorage.removeItem('saved_auth_mode'); sessionStorage.removeItem('reset_email');
    hideAllForms();
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('formTitle').textContent    = 'Welcome Back';
    document.getElementById('formSubtitle').textContent = 'Enter your credentials to continue.';
    document.getElementById('submitBtn').style.display = '';
    resetBtn('SIGN IN'); updateAuthSwitch('login');
    setTimeout(function () { document.getElementById('logEmail')?.focus(); }, 200);
  };

  window.showSignup = function () {
    mode = 'signup';
    sessionStorage.removeItem('saved_auth_mode'); sessionStorage.removeItem('reset_email');
    hideAllForms();
    document.getElementById('signupForm').classList.remove('hidden');
    document.getElementById('formTitle').textContent    = 'Create Account';
    document.getElementById('formSubtitle').textContent = 'Let\u2019s get your portfolio started.';
    document.getElementById('submitBtn').style.display = '';
    resetBtn('CREATE ACCOUNT'); updateAuthSwitch('signup');
    setTimeout(function () { document.getElementById('regName')?.focus(); }, 200);
  };

  /* ── Forgot password ───────────────────────────────────────────────────── */
  window.handleForgotPassword = function () {
    const prefill = document.getElementById('logEmail')?.value?.trim() || '';
    window.showForgotForm(prefill);
  };

  window.showForgotForm = function (prefillEmail) {
    mode = 'forgot';
    hideAllForms();
    document.getElementById('forgotForm').classList.remove('hidden');
    document.getElementById('formTitle').textContent    = 'Reset Password';
    document.getElementById('formSubtitle').textContent = 'We\u2019ll send a 6-digit code to your email.';
    document.getElementById('submitBtn').style.display = '';
    resetBtn('SEND CODE'); updateAuthSwitch(null);
    const ei = document.getElementById('forgotEmail');
    if (prefillEmail) ei.value = prefillEmail;
    setTimeout(function () { ei.focus(); }, 300);
  };

  function showForgotOtp(email) {
    mode = 'forgot-otp';
    hideAllForms();
    document.getElementById('forgotOtpForm').classList.remove('hidden');
    document.getElementById('forgotOtpEmail').textContent = email;
    document.getElementById('formTitle').textContent    = 'Check Your Email';
    document.getElementById('formSubtitle').textContent = 'Enter the 6-digit reset code.';
    document.getElementById('submitBtn').style.display = '';
    resetBtn('VERIFY CODE'); updateAuthSwitch(null);
    const inputs = document.querySelectorAll('#forgotOtpInputs input');
    inputs.forEach(function (x) { x.value = ''; x.classList.remove('filled'); });
    setTimeout(function () { inputs[0]?.focus(); }, 300);
  }

  function showRecovery(session) {
    mode = 'recovery';
    const email = (session && session.user && session.user.email)
      || sessionStorage.getItem('saved_auth_email') || '';
    document.getElementById('recoveryEmail').textContent = email;
    document.getElementById('landing').style.display = 'none';
    document.getElementById('auth').classList.add('visible');
    hideAllForms();
    document.getElementById('recoveryForm').classList.remove('hidden');
    document.getElementById('formTitle').textContent    = 'Set New Password';
    document.getElementById('formSubtitle').textContent = 'Choose a strong password for your account.';
    document.getElementById('submitBtn').style.display = '';
    resetBtn('UPDATE PASSWORD'); updateAuthSwitch(null);
    setTimeout(function () { document.getElementById('newPassword')?.focus(); }, 300);
  }

  /* ── OTP input wiring ──────────────────────────────────────────────────── */
  function wireOtpGroup(inputs, onComplete) {
    inputs.forEach(function (input, i) {
      input.addEventListener('input', function (e) {
        const raw = e.target.value.replace(/[^0-9]/g, '');
        if (raw.length > 1) {
          raw.split('').forEach(function (ch, idx) {
            if (inputs[idx]) { inputs[idx].value = ch; inputs[idx].classList.add('filled'); }
          });
          const next = Array.from(inputs).findIndex(function (x) { return !x.value; });
          (next !== -1 ? inputs[next] : inputs[inputs.length - 1]).focus();
          if (inputs.every(function (x) { return x.value.length === 1; })) onComplete();
          return;
        }
        e.target.value = raw;
        if (raw) { e.target.classList.add('filled'); if (i < inputs.length - 1) inputs[i+1].focus(); }
        else e.target.classList.remove('filled');
        if (inputs.every(function (x) { return x.value.length === 1; })) onComplete();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !e.target.value && i > 0) {
          inputs[i-1].value = ''; inputs[i-1].classList.remove('filled'); inputs[i-1].focus();
        }
      });
      input.addEventListener('paste', function (e) {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g,'');
        pasted.split('').forEach(function (ch, idx) {
          if (inputs[idx]) { inputs[idx].value = ch; inputs[idx].classList.add('filled'); }
        });
        inputs[Math.min(pasted.length, inputs.length - 1)]?.focus();
        if (inputs.every(function (x) { return x.value.length === 1; })) onComplete();
      });
    });
  }

  wireOtpGroup(Array.from(document.querySelectorAll('#otpInputs input')),       function () { window.handleAction(); });
  wireOtpGroup(Array.from(document.querySelectorAll('#forgotOtpInputs input')), function () { window.handleAction(); });

  /* ── Resend ────────────────────────────────────────────────────────────── */
  window.handleResendOtp = async function () {
    try {
      const { error } = await window.supabaseClient.auth.resend({ type: 'signup', email: pendingEmail });
      if (error) throw error;
      showToast('New code sent. Check your inbox.', 'success');
      const inputs = document.querySelectorAll('#otpInputs input');
      inputs.forEach(function (x) { x.value = ''; x.classList.remove('filled'); });
      inputs[0]?.focus();
    } catch (err) { showToast(err.message || 'Could not resend code. Please try again.'); }
  };

  window.handleResendResetOtp = async function () {
    const email = sessionStorage.getItem('reset_email') || '';
    if (!email) { showToast('Session expired. Please start again.'); window.showForgotForm(''); return; }
    try {
      const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email);
      if (error) throw error;
      showToast('New code sent. Check your inbox.', 'success');
      const inputs = document.querySelectorAll('#forgotOtpInputs input');
      inputs.forEach(function (x) { x.value = ''; x.classList.remove('filled'); });
      inputs[0]?.focus();
    } catch (err) { showToast(err.message || 'Could not resend code. Please try again.'); }
  };

  /* ── Main action ───────────────────────────────────────────────────────── */
  window.handleAction = async function () {
    const btn = document.getElementById('submitBtn');
    if (!btn || btn.disabled) return;
    const origText = btn.textContent;
    setBtn('PROCESSING\u2026', true, true);

    try {
      if (!window.supabaseClient) throw new Error('Connection error. Please refresh.');

      /* SIGN UP */
      if (mode === 'signup') {
        if (!termsAccepted) throw new Error('Please accept the Risk Disclosure first.');
        const name     = document.getElementById('regName').value.trim();
        const email    = document.getElementById('regEmail').value.trim().toLowerCase();
        const password = document.getElementById('regPassword').value;
        if (!name)                         throw new Error('Please enter your full name.');
        if (!email || !email.includes('@')) throw new Error('Please enter a valid email address.');
        if (password.length < 8)           throw new Error('Password must be at least 8 characters.');
        const { data, error } = await window.supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (error) throw error;
        if (data.user && data.user.identities && data.user.identities.length === 0)
          throw new Error('This email is already registered. Please sign in instead.');
        if (data.session) { sessionStorage.setItem('yelda_fresh_login','true'); window.location.replace('index.html'); return; }
        pendingEmail = email; mode = 'otp';
        sessionStorage.setItem('saved_auth_mode','otp'); sessionStorage.setItem('saved_auth_email', email);
        document.getElementById('displayEmail').textContent = email;
        hideAllForms(); document.getElementById('otpForm').classList.remove('hidden');
        document.getElementById('formTitle').textContent    = 'Verify Email';
        document.getElementById('formSubtitle').textContent = 'Check your inbox for the 6-digit code.';
        resetBtn('VERIFY CODE');
        document.querySelector('#otpInputs input')?.focus();
        return;
      }

      /* SIGN IN */
      if (mode === 'login') {
        const email    = document.getElementById('logEmail').value.trim().toLowerCase();
        const password = document.getElementById('logPassword').value;
        if (!email || !password) throw new Error('Please enter both email and password.');
        const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        sessionStorage.setItem('yelda_fresh_login','true');
        setBtn('\u2713 SIGNED IN', false, false);
        window.location.replace('index.html');
        return;
      }

      /* OTP VERIFY (signup) */
      if (mode === 'otp') {
        const token = Array.from(document.querySelectorAll('#otpInputs input')).map(function(x){return x.value;}).join('');
        if (token.length !== 6) throw new Error('Please enter the complete 6-digit code.');
        const { error } = await window.supabaseClient.auth.verifyOtp({ email: pendingEmail, token, type: 'signup' });
        if (error) throw error;
        let ready = false, att = 0;
        while (!ready && att < 12) {
          await new Promise(function(r){setTimeout(r,500);});
          const { data: sd } = await window.supabaseClient.auth.getSession();
          if (sd && sd.session) ready = true; att++;
        }
        if (!ready) throw new Error('Session timeout. Please sign in manually.');
        sessionStorage.removeItem('saved_auth_mode'); sessionStorage.removeItem('saved_auth_email');
        sessionStorage.setItem('yelda_fresh_login','true'); localStorage.setItem('nex_onboarded','false');
        showToast('Account verified. Welcome to NexTrade.', 'success');
        setBtn('\u2713 VERIFIED', false, false);
        setTimeout(function(){window.location.replace('index.html');}, 700);
        return;
      }

      /* FORGOT — send reset code */
      if (mode === 'forgot') {
        const email = document.getElementById('forgotEmail').value.trim().toLowerCase();
        if (!email || !email.includes('@')) throw new Error('Please enter a valid email address.');
        const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email);
        if (error) throw error;
        sessionStorage.setItem('reset_email', email);
        sessionStorage.setItem('saved_auth_mode','forgot-otp');
        showForgotOtp(email);
        return;
      }

      /* FORGOT-OTP — verify reset code */
      if (mode === 'forgot-otp') {
        const email = sessionStorage.getItem('reset_email') || document.getElementById('forgotOtpEmail').textContent.trim();
        const token = Array.from(document.querySelectorAll('#forgotOtpInputs input')).map(function(x){return x.value;}).join('').trim();
        if (token.length !== 6) throw new Error('Please enter the complete 6-digit code.');
        const { data: vData, error: vErr } = await window.supabaseClient.auth.verifyOtp({ email, token, type: 'recovery' });
        if (vErr) throw vErr;
        sessionStorage.setItem('saved_auth_email', email);
        sessionStorage.removeItem('saved_auth_mode'); sessionStorage.removeItem('reset_email');
        showRecovery(vData && vData.session ? vData.session : null);
        return;
      }

      /* RECOVERY — set new password */
      if (mode === 'recovery') {
        const newPw  = document.getElementById('newPassword').value;
        const confPw = document.getElementById('confirmPassword').value;
        if (newPw.length < 8) throw new Error('Password must be at least 8 characters.');
        if (newPw !== confPw)  throw new Error('Passwords do not match.');
        const { error } = await window.supabaseClient.auth.updateUser({ password: newPw });
        if (error) throw error;
        showToast('Password updated. Signing you in\u2026', 'success');
        setBtn('\u2713 UPDATED', false, false);
        sessionStorage.setItem('yelda_fresh_login','true');
        setTimeout(function(){window.location.replace('index.html');}, 700);
        return;
      }

      throw new Error('Unknown form state. Please refresh the page.');

    } catch (err) {
      showToast(err.message || 'Something went wrong. Please try again.');
      resetBtn(origText);
    }
  };

  /* ── Keyboard nav ──────────────────────────────────────────────────────── */
  document.addEventListener('keyup', function (e) {
    if (e.key !== 'Enter') return;
    const a = document.activeElement;
    if (!a) return;
    if (a.id === 'regName')       document.getElementById('regEmail')?.focus();
    else if (a.id === 'regEmail') document.getElementById('regPassword')?.focus();
    else if (a.id === 'logEmail') document.getElementById('logPassword')?.focus();
    else if (a.id === 'regPassword' || a.id === 'logPassword') { a.blur(); window.handleAction(); }
  });

  /* ── Init ──────────────────────────────────────────────────────────────── */
  async function init() {
    try {
      let att = 0;
      while (!window.supabaseClient && att < 20) { await new Promise(function(r){setTimeout(r,100);}); att++; }
      if (!window.supabaseClient) { showToast('Configuration error. Check config.js.'); document.getElementById('landing').classList.add('ready'); return; }

      const { data } = await window.supabaseClient.auth.getSession();
      if (data && data.session) { sessionStorage.setItem('yelda_fresh_login','true'); window.location.replace('index.html'); return; }

      const savedMode = sessionStorage.getItem('saved_auth_mode');

      if (savedMode === 'otp') {
        pendingEmail = sessionStorage.getItem('saved_auth_email') || '';
        mode = 'otp';
        document.getElementById('landing').style.display = 'none';
        document.getElementById('auth').classList.add('visible');
        hideAllForms(); document.getElementById('otpForm').classList.remove('hidden');
        document.getElementById('formTitle').textContent    = 'Verify Email';
        document.getElementById('formSubtitle').textContent = 'Check your inbox for the 6-digit code.';
        document.getElementById('displayEmail').textContent = pendingEmail;
        resetBtn('VERIFY CODE');
        setTimeout(function(){ var inp=Array.from(document.querySelectorAll('#otpInputs input')); (inp.find(function(x){return !x.value;})||inp[0])?.focus(); },350);
        return;
      }

      if (savedMode === 'forgot-otp') {
        const email = sessionStorage.getItem('reset_email') || '';
        mode = 'forgot-otp';
        document.getElementById('landing').style.display = 'none';
        document.getElementById('auth').classList.add('visible');
        hideAllForms(); document.getElementById('forgotOtpForm').classList.remove('hidden');
        document.getElementById('forgotOtpEmail').textContent = email;
        document.getElementById('formTitle').textContent    = 'Check Your Email';
        document.getElementById('formSubtitle').textContent = 'Enter the 6-digit reset code.';
        resetBtn('VERIFY CODE');
        setTimeout(function(){ var inp=Array.from(document.querySelectorAll('#forgotOtpInputs input')); (inp.find(function(x){return !x.value;})||inp[0])?.focus(); },350);
        return;
      }

      document.getElementById('landing').classList.add('ready');
    } catch (err) {
      console.error('[AUTH] init error:', err);
      document.getElementById('landing').classList.add('ready');
    }
  }

  init();
})();
