/**
 * NexTrade — Auth Module
 * ══════════════════════════════════════════════════════════════════════════════
 * NOTE: This module is NOT loaded by login.html or index.html.
 * The active auth system is the inline JS in login.html which calls
 * window.supabaseClient.auth directly. This file is a secondary implementation
 * that was abandoned when login.html was refactored. Kept here in case a
 * future refactor wants to extract auth into its own module.
 *
 * FIXES applied (previously broken even if loaded):
 * - SupabaseClient.signIn/signUp → window.supabaseClient.auth.*
 * - Loader.show/hide → removed (Loader not in scope on login page)
 * - Modal.alert → Modal.open (alert method doesn't exist on Modal)
 * - App.handleLogin(user) → App.handleLogin() (no argument needed)
 */

const Auth = (() => {
  'use strict';

  // ============================================
  // STATE
  // ============================================

  let container = null;
  let currentView = 'login'; // 'login' or 'signup'

  // ============================================
  // RENDER FUNCTIONS
  // ============================================

  function render(element) {
    if (!element) {
      console.error('Auth container not found');
      return;
    }

    container = element;
    container.className = 'auth-page';

    const authContainer = document.createElement('div');
    authContainer.className = 'auth-container';

    const logo = createLogo();
    authContainer.appendChild(logo);

    const authCard = document.createElement('div');
    authCard.className = 'auth-card';
    authCard.id = 'auth-card';

    renderLoginForm(authCard);

    authContainer.appendChild(authCard);
    container.appendChild(authContainer);
  }

  function createLogo() {
    const logo = document.createElement('div');
    logo.className = 'auth-logo';

    const logoText = document.createElement('h1');
    logoText.className = 'auth-logo-text';
    logoText.textContent = 'NexTrade';

    logo.appendChild(logoText);
    return logo;
  }

  function renderLoginForm(card) {
    card.innerHTML = '';
    currentView = 'login';

    const title = document.createElement('h2');
    title.className = 'auth-title';
    title.textContent = 'Welcome Back';

    const subtitle = document.createElement('p');
    subtitle.className = 'auth-subtitle';
    subtitle.textContent = 'Sign in to your account to continue';

    card.appendChild(title);
    card.appendChild(subtitle);

    const form = createLoginForm();
    card.appendChild(form);

    const footer = document.createElement('div');
    footer.className = 'auth-footer';
    footer.innerHTML = `
      Don't have an account? 
      <span class="auth-link" id="show-signup">Sign up</span>
    `;

    card.appendChild(footer);

    document.getElementById('show-signup').addEventListener('click', () => {
      renderSignupForm(card);
    });
  }

  function createLoginForm() {
    const form = document.createElement('form');
    form.className = 'auth-form';
    form.id = 'login-form';

    const emailGroup = document.createElement('div');
    emailGroup.className = 'input-group';

    const emailLabel = document.createElement('label');
    emailLabel.className = 'input-label';
    emailLabel.textContent = 'Email';

    const emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.className = 'input-field';
    emailInput.id = 'login-email';
    emailInput.placeholder = 'Enter your email';
    emailInput.required = true;

    const emailError = document.createElement('span');
    emailError.className = 'input-error-message';
    emailError.id = 'login-email-error';
    emailError.style.display = 'none';

    emailGroup.appendChild(emailLabel);
    emailGroup.appendChild(emailInput);
    emailGroup.appendChild(emailError);

    const passwordGroup = document.createElement('div');
    passwordGroup.className = 'input-group';

    const passwordLabel = document.createElement('label');
    passwordLabel.className = 'input-label';
    passwordLabel.textContent = 'Password';

    const passwordInput = document.createElement('input');
    passwordInput.type = 'password';
    passwordInput.className = 'input-field';
    passwordInput.id = 'login-password';
    passwordInput.placeholder = 'Enter your password';
    passwordInput.required = true;

    const passwordError = document.createElement('span');
    passwordError.className = 'input-error-message';
    passwordError.id = 'login-password-error';
    passwordError.style.display = 'none';

    passwordGroup.appendChild(passwordLabel);
    passwordGroup.appendChild(passwordInput);
    passwordGroup.appendChild(passwordError);

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn btn-primary btn-full';
    submitBtn.textContent = 'Sign In';
    submitBtn.id = 'login-submit';

    form.appendChild(emailGroup);
    form.appendChild(passwordGroup);
    form.appendChild(submitBtn);

    form.addEventListener('submit', handleLoginSubmit);

    return form;
  }

  function renderSignupForm(card) {
    card.innerHTML = '';
    currentView = 'signup';

    const title = document.createElement('h2');
    title.className = 'auth-title';
    title.textContent = 'Create Account';

    const subtitle = document.createElement('p');
    subtitle.className = 'auth-subtitle';
    subtitle.textContent = 'Start your investment journey today';

    card.appendChild(title);
    card.appendChild(subtitle);

    const form = createSignupForm();
    card.appendChild(form);

    const footer = document.createElement('div');
    footer.className = 'auth-footer';
    footer.innerHTML = `
      Already have an account? 
      <span class="auth-link" id="show-login">Sign in</span>
    `;

    card.appendChild(footer);

    document.getElementById('show-login').addEventListener('click', () => {
      renderLoginForm(card);
    });
  }

  function createSignupForm() {
    const form = document.createElement('form');
    form.className = 'auth-form';
    form.id = 'signup-form';

    const emailGroup = document.createElement('div');
    emailGroup.className = 'input-group';

    const emailLabel = document.createElement('label');
    emailLabel.className = 'input-label';
    emailLabel.textContent = 'Email';

    const emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.className = 'input-field';
    emailInput.id = 'signup-email';
    emailInput.placeholder = 'Enter your email';
    emailInput.required = true;

    const emailError = document.createElement('span');
    emailError.className = 'input-error-message';
    emailError.id = 'signup-email-error';
    emailError.style.display = 'none';

    emailGroup.appendChild(emailLabel);
    emailGroup.appendChild(emailInput);
    emailGroup.appendChild(emailError);

    const passwordGroup = document.createElement('div');
    passwordGroup.className = 'input-group';

    const passwordLabel = document.createElement('label');
    passwordLabel.className = 'input-label';
    passwordLabel.textContent = 'Password';

    const passwordInput = document.createElement('input');
    passwordInput.type = 'password';
    passwordInput.className = 'input-field';
    passwordInput.id = 'signup-password';
    passwordInput.placeholder = 'Create a password (min. 8 characters)';
    passwordInput.required = true;

    const passwordError = document.createElement('span');
    passwordError.className = 'input-error-message';
    passwordError.id = 'signup-password-error';
    passwordError.style.display = 'none';

    passwordGroup.appendChild(passwordLabel);
    passwordGroup.appendChild(passwordInput);
    passwordGroup.appendChild(passwordError);

    const confirmGroup = document.createElement('div');
    confirmGroup.className = 'input-group';

    const confirmLabel = document.createElement('label');
    confirmLabel.className = 'input-label';
    confirmLabel.textContent = 'Confirm Password';

    const confirmInput = document.createElement('input');
    confirmInput.type = 'password';
    confirmInput.className = 'input-field';
    confirmInput.id = 'signup-confirm';
    confirmInput.placeholder = 'Confirm your password';
    confirmInput.required = true;

    const confirmError = document.createElement('span');
    confirmError.className = 'input-error-message';
    confirmError.id = 'signup-confirm-error';
    confirmError.style.display = 'none';

    confirmGroup.appendChild(confirmLabel);
    confirmGroup.appendChild(confirmInput);
    confirmGroup.appendChild(confirmError);

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn btn-primary btn-full';
    submitBtn.textContent = 'Create Account';
    submitBtn.id = 'signup-submit';

    form.appendChild(emailGroup);
    form.appendChild(passwordGroup);
    form.appendChild(confirmGroup);
    form.appendChild(submitBtn);

    form.addEventListener('submit', handleSignupSubmit);

    return form;
  }

  // ============================================
  // FORM HANDLERS (with Loader integration)
  // ============================================

  async function handleLoginSubmit(e) {
    e.preventDefault();

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    clearErrors('login');

    const emailValidation = Validation.email(email);
    if (!emailValidation.isValid) {
      showError('login-email', emailValidation.error);
      return;
    }

    if (!password) {
      showError('login-password', 'Password is required');
      return;
    }

    const submitBtn = document.getElementById('login-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    try {
      if (!window.supabaseClient) throw new Error('Connection error. Please refresh.');
      const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.session) {
        if (window.App) App.handleLogin();
      } else {
        showError('login-password', 'Login failed. Please try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    } catch (error) {
      console.error('Login error:', error);
      showError('login-password', error.message || 'An error occurred. Please try again.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  }

  async function handleSignupSubmit(e) {
    e.preventDefault();

    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;

    clearErrors('signup');

    const emailValidation = Validation.email(email);
    if (!emailValidation.isValid) {
      showError('signup-email', emailValidation.error);
      return;
    }

    const passwordValidation = Validation.password(password);
    if (!passwordValidation.isValid) {
      showError('signup-password', passwordValidation.error);
      return;
    }

    const matchValidation = Validation.passwordMatch(password, confirm);
    if (!matchValidation.isValid) {
      showError('signup-confirm', matchValidation.error);
      return;
    }

    const submitBtn = document.getElementById('signup-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account...';

    try {
      if (!window.supabaseClient) throw new Error('Connection error. Please refresh.');
      const { data, error } = await window.supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      // If identities is empty, the email is already registered
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        throw new Error('This email is already registered. Please sign in.');
      }
      if (data.session) {
        // Email confirmation disabled — go straight to app
        if (window.App) App.handleLogin();
      } else {
        // Email confirmation required — show message via Modal.open (not Modal.alert which doesn't exist)
        if (window.Modal) {
          const msg = document.createElement('p');
          msg.style.cssText = 'color:var(--color-text-secondary);font-size:14px;line-height:1.6;margin:0;';
          msg.textContent = 'Account created. Check your email and click the verification link to continue.';
          Modal.open({ title: 'Check Your Email', content: msg });
        }
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account';
      }
    } catch (error) {
      console.error('Signup error:', error);
      showError('signup-confirm', error.message || 'An error occurred. Please try again.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account';
    }
  }

  // ============================================
  // ERROR HANDLING
  // ============================================

  function showError(fieldId, message) {
    const errorElement = document.getElementById(`${fieldId}-error`);
    const inputElement = document.getElementById(fieldId);

    if (errorElement && inputElement) {
      errorElement.textContent = message;
      errorElement.style.display = 'block';
      inputElement.classList.add('error');
    }
  }

  function clearErrors(formType) {
    const fields = formType === 'login' 
      ? ['login-email', 'login-password']
      : ['signup-email', 'signup-password', 'signup-confirm'];

    fields.forEach(fieldId => {
      const errorElement = document.getElementById(`${fieldId}-error`);
      const inputElement = document.getElementById(fieldId);

      if (errorElement) {
        errorElement.style.display = 'none';
      }

      if (inputElement) {
        inputElement.classList.remove('error');
      }
    });
  }

  // ============================================
  // EXPORT PUBLIC API
  // ============================================

  return {
    render
  };
})();

// ============================================
// EXPORT FOR OTHER MODULES
// ============================================

if (typeof window !== 'undefined') {
  window.Auth = Auth;
}