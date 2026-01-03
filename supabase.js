/**
 * NexTrade — App Controller (SINGLE SOURCE OF TRUTH)
 * Full, robust implementation compatible with existing Bootstraps, Router, Navbar, AppState, and API.
 *
 * Responsibilities:
 *  - Idempotent initialization
 *  - Dependency checks
 *  - Bootstraps DOM binding
 *  - Session validation + user load
 *  - Safe Navbar init + Router handoff
 *  - Exposes: window.App.init(), window.App.isInitialized(), window.App.navigate(page)
 */

(function () {
  'use strict';

  // Prevent redeclaration
  if (window.App) {
    console.warn('App already defined — skipping redefinition.');
    return;
  }

  // Internal state
  let initialized = false;
  let initLock = false;

  const DEFAULT_TIMEOUT = 5000;

  // Simple logger
  const log = (...args) => console.log('🚀 NexTrade:', ...args);
  const warn = (...args) => console.warn('🚀 NexTrade:', ...args);
  const fail = (...args) => console.error('🚀 NexTrade:', ...args);

  // Wait helper
  async function waitFor(predicateFn, timeout = DEFAULT_TIMEOUT, interval = 50) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (predicateFn()) return true;
      } catch (e) {
        // ignore transient errors
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, interval));
    }
    return false;
  }

  // Check minimal dependencies that must exist before init
  function checkStaticDependencies() {
    const missing = [];
    if (typeof window.supabaseClient === 'undefined') missing.push('supabaseClient');
    if (typeof window.AppState === 'undefined') missing.push('AppState');
    if (typeof window.API === 'undefined') missing.push('API');
    if (typeof window.Bootstraps === 'undefined') missing.push('Bootstraps');
    if (missing.length) {
      fail('Missing critical modules:', missing);
      return { ok: false, missing };
    }
    return { ok: true };
  }

  // Validate session via Supabase client
  async function validateSession() {
    try {
      if (!window.supabaseClient || !window.supabaseClient.auth || typeof window.supabaseClient.auth.getSession !== 'function') {
        warn('supabaseClient.auth.getSession not available yet');
        return null;
      }
      const { data, error } = await window.supabaseClient.auth.getSession();
      if (error) {
        warn('Supabase session check returned error:', error);
        return null;
      }
      return data?.session || null;
    } catch (err) {
      warn('validateSession error:', err);
      return null;
    }
  }

  // Show fatal error on loading screen if present
  function showFatalError(message) {
    fail(message);
    const screen = document.getElementById('loading-screen');
    if (screen) {
      screen.innerHTML = `
        <div style="color:#ff5555;text-align:center;padding:2rem;">
          <strong>Initialization Error</strong><br>
          ${message}
        </div>
      `;
    } else {
      // fallback alert only if safe
      try { alert(`Initialization Error: ${message}`); } catch (e) { /* ignore */ }
    }
  }

  // Safe AppState setter helpers (defensive)
  function safeSetUser(user) {
    try {
      if (window.AppState && typeof window.AppState.setUser === 'function') {
        window.AppState.setUser(user);
      } else if (window.AppState && typeof window.AppState.set === 'function') {
        const cur = AppState.get('user') || null;
        AppState.set('user', user || cur);
      } else {
        // best-effort
        window.AppState.user = user;
      }
    } catch (e) {
      warn('Failed to set user on AppState:', e);
    }
  }

  function safeEnsureUi() {
    try {
      if (window.AppState && typeof AppState.get === 'function') {
        const ui = AppState.get('ui') || {};
        if (!ui.currentPage) {
          if (typeof AppState.set === 'function') {
            AppState.set('ui', { ...ui, currentPage: 'home' });
          } else if (typeof AppState.setPage === 'function') {
            AppState.setPage('home');
          } else {
            AppState.ui = AppState.ui || {};
            AppState.ui.currentPage = 'home';
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // Initialize Navbar safely if present
  function initNavbarSync() {
    try {
      if (window.Navbar && typeof window.Navbar.init === 'function') {
        // Prefer placing navbar in document.body
        window.Navbar.init(document.body);
      }
    } catch (e) {
      warn('Navbar init failed:', e);
    }
  }

  // Expose navigate that other components can call
  async function navigate(page) {
    if (!page || typeof page !== 'string') return;
    // set AppState first (optimistic)
    try {
      if (window.AppState && typeof AppState.setPage === 'function') {
        AppState.setPage(page);
      } else if (window.AppState && typeof AppState.set === 'function') {
        const ui = AppState.get('ui') || {};
        AppState.set('ui', { ...ui, currentPage: page });
      }
    } catch (e) {
      // ignore
    }

    // if router is available, use it
    try {
      if (typeof window.routerRenderPage === 'function') {
        await window.routerRenderPage(page);
        // sync Navbar active
        if (window.Navbar && typeof window.Navbar.setActive === 'function') {
          window.Navbar.setActive(page);
        }
        return;
      }
    } catch (e) {
      warn('routerRenderPage failed during navigate:', e);
    }

    // fallback: attempt to dispatch custom event for router
    try {
      const ev = new CustomEvent('nextrade:navigate', { detail: { page } });
      window.dispatchEvent(ev);
    } catch (e) {
      warn('Fallback navigate dispatch failed:', e);
    }
  }

  // Main init sequence
  async function init() {
    if (initialized) {
      warn('App already initialized.');
      return;
    }
    if (initLock) {
      warn('App init already in progress.');
      return;
    }
    initLock = true;

    log('NexTrade initializing...');

    // 1. Quick static deps check (Bootstraps might be present but not bound)
    const deps = checkStaticDependencies();
    if (!deps.ok) {
      showFatalError(`Missing modules: ${deps.missing.join(', ')}`);
      initLock = false;
      return;
    }

    // 2. Ensure Bootstraps binds DOM shell (idempotent)
    try {
      if (window.Bootstraps && typeof window.Bootstraps.init === 'function') {
        // Bootstraps.init may throw if shell is broken; capture and abort gracefully
        try {
          await Bootstraps.init();
        } catch (e) {
          showFatalError('Bootstraps failed to bind DOM shell. Check your HTML structure (.app-wrapper/.app-main).');
          initLock = false;
          return;
        }
      }
    } catch (e) {
      warn('Bootstraps init call threw:', e);
      initLock = false;
      return;
    }

    // 3. Wait briefly for AppState and API to be usable
    const ready = await waitFor(() => window.AppState && window.API && window.supabaseClient, 4000);
    if (!ready) {
      showFatalError('Core modules did not become available in time.');
      initLock = false;
      return;
    }

    // 4. Validate user session
    let session = null;
    try {
      session = await validateSession();
      if (!session) {
        warn('No active session found; redirecting to login.');
        try { window.location.href = 'login.html'; } catch (e) { /* ignore */ }
        initLock = false;
        return;
      }
    } catch (e) {
      warn('Session validation failure:', e);
      showFatalError('Failed to validate session.');
      initLock = false;
      return;
    }

    log(`Session validated: ${session.user?.email || 'unknown'}`);

    // 5. Populate AppState.user (defensive)
    safeSetUser(session.user);

    // 6. Ensure UI defaults exist
    safeEnsureUi();

    // 7. Load user-specific data via API if available
    try {
      if (window.API && typeof API.loadUserData === 'function') {
        await API.loadUserData(session.user.id);
        log('API.loadUserData: user data loaded');
      }
    } catch (e) {
      warn('API.loadUserData failed:', e);
    }

    // 8. Initialize Navbar (visual) and sync with AppState
    try { initNavbarSync(); } catch (e) { warn('Navbar sync failed:', e); }

    // 9. Wire navigate onto global App before signaling ready
    window.App = window.App || {};
    window.App.navigate = navigate;

    // 10. Mark initialized and fire ready event that Router listens to
    initialized = true;
    log('%cNexTrade initialized successfully', 'color:#2563eb;font-weight:bold;');

    try {
      const currentPage = (AppState && typeof AppState.get === 'function' && AppState.get('ui')?.currentPage) || 'home';
      const ev = new CustomEvent('nextrade:ready', { detail: { page: currentPage } });
      window.dispatchEvent(ev);
      // If router is present, kick it directly as well
      if (typeof window.routerRenderPage === 'function') {
        // don't await to avoid blocking UI — routerRenderPage is robust and will handle queueing
        try { window.routerRenderPage(currentPage); } catch (e) { /* swallow */ }
      }
    } catch (e) {
      warn('Failed to dispatch nextrade:ready', e);
    }

    initLock = false;
  }

  // Public API
  window.App = {
    init,
    isInitialized: () => !!initialized,
    navigate
  };

})();