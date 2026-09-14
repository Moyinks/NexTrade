// apps.js
/**
 * NexTrade — App Controller
 *
 * Financial state is fail-closed and server-authoritative:
 * - Spot comes from derive_spot_balance().
 * - Vault cash comes from derive_vault_cash().
 * - cached profile balances are display caches only.
 * - the browser never receives withdrawal-secret internals.
 * - balanceSyncStatus stays "syncing"/"error" until authoritative hydration.
 */

(function () {
  'use strict';

  if (window.App && window.App.initialized) return;

  const CONSTANTS = {
    POLL_INTERVAL: 60000,
    TOAST_DURATION: 3000,
    LOGIN_PAGE: 'login.html'
  };

  const state = {
    initialized: false,
    pollTimer:   null,
    exiting:     false   // set true before intentional signOut to suppress listener re-navigation
  };

  // ============================================
  // 1. AUTHORITATIVE BALANCE DERIVATION
  // ============================================

  async function deriveSpotBalance(userId) {
    if (!window.supabaseClient) throw new Error('Balance authority unavailable');
    const { data, error } = await window.supabaseClient.rpc('derive_spot_balance', { p_user_id: userId });
    if (error) throw error;
    const value = Number(data);
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid Spot balance response');
    return value;
  }

  async function deriveVaultCash(userId) {
    if (!window.supabaseClient) throw new Error('Vault balance authority unavailable');
    const { data, error } = await window.supabaseClient.rpc('derive_vault_cash', { p_user_id: userId });
    if (error) throw error;
    const value = Number(data);
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid Vault cash response');
    return value;
  }

  // ============================================
  // 2. DATA SYNCHRONIZATION
  // ============================================

  async function ensureProfile(user) {
    try {
      if (!window.supabaseClient) throw new Error('Supabase client missing');

      const { data: existing, error: fetchError } = await window.supabaseClient
        .from('profiles')
        .select('id, email, full_name, avatar_url, role, kyc_status, holdings, created_at, updated_at')
        .eq('id', user.id)
        .single();

      // PGRST116 = row not found — expected for new users
      if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

      if (existing) {
        console.log('[APP] ✅ Profile exists');
        return existing;
      }

      // Profile not found — the handle_new_user trigger may still be committing.
      // Wait 1s and retry once before returning a safe default.
      console.log('[APP] ⏳ Profile not found, retrying in 1s…');
      await new Promise(r => setTimeout(r, 1000));

      const { data: retried, error: retryError } = await window.supabaseClient
        .from('profiles')
        .select('id, email, full_name, avatar_url, role, kyc_status, holdings, created_at, updated_at')
        .eq('id', user.id)
        .single();

      if (!retryError && retried) {
        console.log('[APP] ✅ Profile found on retry');
        return retried;
      }

      // Still not found — return a minimal in-memory default so the app can
      // continue. The trigger will create the real row asynchronously; the
      // next background poll will pick it up.
      console.warn('[APP] ⚠️ Profile still not found — using temporary default');
      return {
        id:            user.id,
        email:         user.email,
        full_name:     user.user_metadata?.full_name || '',
        spot_balance:  0,
        vault_balance: 0,
        vault_cash:    0,
        holdings:      {},
        kyc_status:    'none',
        role:          'user',
        created_at:    new Date().toISOString(),
        updated_at:    new Date().toISOString()
      };

    } catch (err) {
      console.error('[APP] ❌ Profile creation/fetch error:', err);
      throw err;
    }
  }

  async function syncProfile(user) {
    try {
      if (!window.supabaseClient) throw new Error('Supabase client missing');
      const profile = await ensureProfile(user);
      if (!profile) throw new Error('Profile unavailable');

      const [spot, vaultCash] = await Promise.all([
        deriveSpotBalance(user.id),
        deriveVaultCash(user.id)
      ]);

      if (window.AppState) {
        await AppState.batch(async () => {
          AppState.set('user', user);
          AppState.set('profile', { ...profile, spot_balance: spot, vault_cash: vaultCash });
          if (profile.holdings && typeof profile.holdings === 'object') {
            AppState.set('holdings', profile.holdings);
          }
          AppState.updateBalances({ spot, vaultCash });
        });
      }
      console.log('[APP] Authoritative balances synchronized');
    } catch (err) {
      console.error('[APP] Profile sync failed:', err);
      if (window.AppState) {
        AppState.set('user', user);
        AppState.set('balanceSyncStatus', 'error');
      }
      // Keep the application usable in an explicit error state. Financial
      // actions independently fail closed when authoritative balance RPCs fail.
      return null;
    }
  }

  async function syncHistory(user) {
    try {
      const { data: txs, error } = await window.supabaseClient
        .from('transactions')
        .select('id, user_id, type, amount, status, description, metadata, created_at, updated_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (window.AppState) {
        AppState.set('transactions', txs || []);
        console.log(`[APP] 📜 History synced: ${(txs || []).length} records`);
      }
    } catch (err) {
      console.error('[APP] ❌ History Sync Error:', err);
      if (window.AppState) AppState.set('transactions', []);
    }
  }

  async function syncInvestments(user) {
    try {
      if (!window.supabaseClient) throw new Error('Supabase client missing');

      const { data: investments, error } = await window.supabaseClient
        .from('investments')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (window.AppState) {
        AppState.set('investments', investments || []);
        console.log(`[APP] 🏦 Investments synced: ${(investments || []).length} records`);
      }
    } catch (err) {
      console.error('[APP] ❌ Investment Sync Error:', err);
      // Do not clear the live list on transient errors; keep the last known
      // positions so the vault balance stays stable until the next successful sync.
    }
  }

  // ============================================
  // 3. INITIALIZATION SEQUENCE
  // ============================================

  async function init() {
    if (state.initialized) return;

    console.log('[APP] 🚀 Starting initialization...');

    try {
      // STEP 1: Bootstraps
      console.log('[APP] Step 1/6: Bootstraps...');
      if (!window.Bootstraps) throw new Error('Bootstraps module not loaded');
      if (typeof Bootstraps.init === 'function') await Bootstraps.init();
      const mainElement = Bootstraps.getMain();
      if (!mainElement) throw new Error('Bootstraps failed to create .app-main');
      console.log('[APP] ✅ Bootstraps ready');

      // STEP 2: Auth check
      console.log('[APP] Step 2/6: Auth...');
      if (!window.supabaseClient) throw new Error('Supabase client not loaded');
      const { data } = await window.supabaseClient.auth.getSession();
      const session  = data?.session;

      if (!session) {
        console.log('[APP] ⚠️ No session — redirecting to login');
        if (!window.location.pathname.includes(CONSTANTS.LOGIN_PAGE)) {
          window.location.replace(CONSTANTS.LOGIN_PAGE);
        }
        return;
      }

      console.log('[APP] ✅ Auth verified:', session.user.id);

      // STEP 3: CacheManager
      console.log('[APP] Step 3/6: CacheManager...');
      if (!window.CacheManager) throw new Error('CacheManager module not loaded');
      CacheManager.init();
      console.log('[APP] ✅ CacheManager ready');

      // STEP 4: Data — profile first (creates row if missing), then parallel.
      // balanceSyncStatus is already 'syncing' from AppState defaults.
      // It remains 'syncing' throughout this block so any premature render
      // (e.g. a subscriber firing mid-fetch) is still gated.
      console.log('[APP] Step 4/6: Loading user data...');
      await syncProfile(session.user);
      await Promise.all([
        syncHistory(session.user),
        syncInvestments(session.user),
        CacheManager.getMarketData()
      ]);
      console.log('[APP] ✅ Data loaded');

      // Safety net: user must be in AppState before router renders pages
      if (window.AppState && !AppState.get('user')) {
        AppState.set('user', session.user);
      }

      // All three sources are resolved. Mark balances as authoritative BEFORE
      // navigate() so Home.render() always receives 'ready' on first render.
      // This is the single moment of truth: spot (ledger-derived), investments
      // (vault), and market data are all in AppState. The hero may now render.
      if (window.AppState) {
        // Only promote to 'ready' if syncProfile did not already set 'error'
        if (AppState.get('balanceSyncStatus') !== 'error') {
          AppState.set('balanceSyncStatus', 'ready');
          console.log('[APP] ✅ Balance sync status: ready');
        }
      }

      // STEP 5: Router
      console.log('[APP] Step 5/6: Router...');
      if (!window.Router) throw new Error('Router module not loaded');
      await Router.init();
      const lastPage = (window.Storage && Storage.getLastPage()) || 'home';
      console.log(`[APP] 📍 Navigating to: ${lastPage}`);
      await navigate(lastPage);
      console.log('[APP] ✅ Router ready');

      // STEP 6: Navbar
      console.log('[APP] Step 6/6: Navbar...');
      if (window.Navbar) {
        Navbar.init();
        if (window.AppState) {
          AppState.subscribe('ui.currentPage', (page) => Navbar.setActive(page));
        }
        console.log('[APP] ✅ Navbar ready');
      }

      state.initialized = true;

      // ── BACK BUTTON EXIT HANDLER ─────────────────────────────────────────
      // Push a history entry so the first hardware/browser back press fires
      // popstate instead of navigating to login.html (which causes the
      // landing → loader flash). If a modal is open, back closes it first.
      window.history.pushState({ ntx: 1 }, '');

      function handleBack() {
        // If a modal is open, close it — re-push so next back still fires popstate
        const openOverlay = document.querySelector('.ntm-overlay.ntm-open');
        if (openOverlay && window.Modal) {
          window.history.pushState({ ntx: 1 }, '');
          Modal.close();
          return;
        }

        // No modal open — ask if the user wants to exit.
        // Do NOT re-push here yet: if user confirms exit we must NOT have an
        // extra history entry queued, otherwise the browser navigates back into
        // the app immediately after location.href = LOGIN_PAGE fires.
        if (window.Modal) {
          Modal.confirm({
            title: 'Leave NexTrade?',
            message: 'Are you sure you want to leave the app?',
            confirmText: 'Exit',
            cancelText: 'Stay'
          }).then(confirmed => {
            if (confirmed) {
              window.removeEventListener('popstate', handleBack);
              // Attempt to close the PWA window — works on Android Chrome standalone.
              // iOS Safari blocks window.close() for windows it didn't open;
              // on iOS the user presses the device home button after this.
              window.close();
              // If close() was blocked (we're still here after one tick),
              // silently re-arm the handler so the app keeps working normally.
              setTimeout(() => {
                window.history.pushState({ ntx: 1 }, '');
                window.addEventListener('popstate', handleBack);
              }, 200);
            } else {
              // Staying — re-push so the next back press fires popstate again
              window.history.pushState({ ntx: 1 }, '');
            }
          });
        } else {
          // Modal unavailable — re-push defensively so back doesn't leave the app
          window.history.pushState({ ntx: 1 }, '');
        }
      }

      window.addEventListener('popstate', handleBack);

      // ── BACKGROUND POLL — keeps balances current after admin approvals ─────
      // pollTimer was declared in state but never started. Wire it up here.
      // Every POLL_INTERVAL ms: re-derive spot balance from the ledger and
      // push fresh balances into AppState so Wallet/Home reflect approvals
      // without requiring a full reload.
      async function backgroundPoll() {
        if (!state.initialized) return;
        try {
          const currentUser = window.AppState ? AppState.get('user') : null;
          if (!currentUser) return;
          await syncHistory(currentUser);
          await syncProfile(currentUser);
          // Re-sync positions every poll so Vault total remains cash + live positions.
          // which bypasses syncVaultData(). Without this call, vault balance
          // shown on Home/Wallet drifts from the computed value after each poll.
          await syncInvestments(currentUser);
          // Re-mark ready after each successful background poll so the hero
          // stays in its rendered state (not flipped back to syncing).
          if (window.AppState && AppState.get('balanceSyncStatus') !== 'error') {
            AppState.set('balanceSyncStatus', 'ready');
          }
          const currentPage = window.Router ? Router.getCurrentPage() : null;
          if (currentPage === 'wallet' && window.Wallet && typeof Wallet.render === 'function') {
            const walletContainer = document.querySelector('.wallet-page');
            if (walletContainer) Wallet.render(walletContainer);
          }
          if (currentPage === 'home' && window.Home && typeof Home.refresh === 'function') {
            Home.refresh();
          }
          console.log('[APP] \u{1F504} Background poll complete');
        } catch (err) {
          console.warn('[APP] \u26a0\ufe0f Background poll error (non-fatal):', err);
        }
      }

      state.pollTimer = setInterval(backgroundPoll, CONSTANTS.POLL_INTERVAL);

      // ── REALTIME LISTENER — instant balance update on transaction approval ─
      try {
        window.supabaseClient
          .channel('tx-approvals-' + session.user.id)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'transactions',
              filter: 'user_id=eq.' + session.user.id
            },
            async (payload) => {
              console.log('[APP] \u{1F514} Transaction change detected:', payload.eventType, payload.new?.status);
              const relevant = payload.eventType === 'INSERT' ||
                (payload.new && (payload.new.status === 'completed' || payload.new.status === 'approved'));
              if (relevant) await backgroundPoll();
            }
          )
          .subscribe();
        console.log('[APP] \u2705 Realtime transaction listener active');
      } catch (rtErr) {
        console.warn('[APP] \u26a0\ufe0f Realtime subscription failed (will rely on poll):', rtErr);
      }

      // Session expiry watcher
      window.supabaseClient.auth.onAuthStateChange((event, session) => {
        // Intentional exit/sign-out is handled by the caller — don't double-navigate
        if (state.exiting) return;

        if (event === 'PASSWORD_RECOVERY') {
          // User clicked reset-password email that pointed at index.html.
          // Send them to login.html which has the reset-password UI.
          window.location.replace(CONSTANTS.LOGIN_PAGE + '?recovery=1');
          return;
        }

        if (event === 'SIGNED_OUT' || (!session && state.initialized)) {
          console.warn('[APP] Session expired — redirecting');
          if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
          if (window.AppState) AppState.clear();
          window.location.replace(CONSTANTS.LOGIN_PAGE);
        }
      });

      console.log('[APP] ✅✅✅ App Fully Initialized ✅✅✅');
      console.log('[APP] 📊 State:', {
        user:             AppState.get('user')?.id,
        balances:         AppState.get('balances'),
        balanceSyncStatus: AppState.get('balanceSyncStatus'),
        transactionCount: (AppState.get('transactions') || []).length,
        investmentCount:  (AppState.get('investments')  || []).length
      });

    } catch (error) {
      console.error('[APP] ❌ Initialization failed:', error);

      const mainElement = document.querySelector('.app-main');
      if (mainElement) {
        mainElement.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:50vh;padding:20px;text-align:center;';
        const icon = document.createElement('i');
        icon.className = 'fas fa-exclamation-triangle';
        icon.style.cssText = 'font-size:48px;color:#ef4444;margin-bottom:20px;opacity:0.5;';
        const title = document.createElement('div');
        title.style.cssText = 'font-size:18px;font-weight:700;color:var(--color-text-primary);margin-bottom:8px;';
        title.textContent = 'Failed to Initialize App';
        const msg = document.createElement('div');
        msg.style.cssText = 'font-size:13px;color:var(--color-text-secondary);margin-bottom:20px;max-width:400px;';
        msg.textContent = error.message || 'An unexpected error occurred.';
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.style.padding = '10px 24px';
        btn.textContent = 'Reload App';
        btn.onclick = () => window.location.reload();
        wrap.appendChild(icon);
        wrap.appendChild(title);
        wrap.appendChild(msg);
        wrap.appendChild(btn);
        mainElement.appendChild(wrap);
      }
    }
  }

  // ============================================
  // 4. UTILITIES
  // ============================================

  async function navigate(pageId) {
    if (!pageId) return;
    console.log(`[APP] 🧭 Navigate: ${pageId}`);
    if (window.AppState) AppState.set('ui.currentPage', pageId);
    if (window.Router)   await window.Router.navigate(pageId);
    if (window.Navbar)   Navbar.setActive(pageId);
    if (window.Storage)  Storage.setLastPage(pageId);
  }

  // ── TOAST SYSTEM ────────────────────────────────────────────────────────────
  // Premium fintech-grade notifications: glassmorphic card, left accent bar,
  // icon badge, title + message, progress bar, stacking, click-to-dismiss.
  // ─────────────────────────────────────────────────────────────────────────────

  const TOAST_CFG = {
    success: { color: '#10B981', bg: 'rgba(16,185,129,0.1)',  icon: 'fa-circle-check',          title: 'Success'     },
    error:   { color: '#EF4444', bg: 'rgba(239,68,68,0.1)',   icon: 'fa-circle-exclamation',     title: 'Error'       },
    warning: { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)',  icon: 'fa-triangle-exclamation',   title: 'Warning'     },
    info:    { color: '#3B82F6', bg: 'rgba(59,130,246,0.1)',  icon: 'fa-circle-info',            title: 'Info'        },
  };

  let _toastStack = [];
  const MAX_VISIBLE_TOASTS = 3;   // hard cap — a burst of toasts can never fill the screen

  function _injectToastStyles() {
    if (document.getElementById('ntm-toast-styles')) return;
    const s = document.createElement('style');
    s.id = 'ntm-toast-styles';
    s.textContent = `
      .ntm-toast-wrap {
        position: fixed;
        top: calc(72px + env(safe-area-inset-top, 0px));
        left: 50%;
        transform: translateX(-50%);
        width: calc(100% - 32px);
        max-width: 400px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      }
      /* In landscape on Face ID iPhones, inset-left/right can be 44px.
         Clamp the wrap so toasts don't overlap the safe zone. */
      @supports (padding: max(0px)) {
        .ntm-toast-wrap {
          width: min(calc(100% - max(32px, calc(env(safe-area-inset-left, 16px) + env(safe-area-inset-right, 16px)))), 400px);
        }
      }
      .ntm-toast {
        position: relative;
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 14px 16px 14px 14px;
        background: rgba(17, 22, 34, 0.96);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 14px;
        box-shadow:
          0 2px 0 rgba(255,255,255,0.05) inset,
          0 16px 48px rgba(0,0,0,0.65),
          0 4px 16px rgba(0,0,0,0.4);
        pointer-events: all;
        cursor: pointer;
        overflow: hidden;
        opacity: 0;
        transform: translateY(-12px) scale(0.97);
        transition: opacity 0.28s cubic-bezier(0.34,1.2,0.64,1),
                    transform 0.28s cubic-bezier(0.34,1.2,0.64,1);
        -webkit-tap-highlight-color: transparent;
      }
      .ntm-toast.show {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      .ntm-toast.hide {
        opacity: 0;
        transform: translateY(-8px) scale(0.97);
        transition: opacity 0.22s ease, transform 0.22s ease;
      }
      .ntm-toast-accent {
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 3px;
        border-radius: 14px 0 0 14px;
      }
      .ntm-toast-icon {
        width: 32px; height: 32px;
        border-radius: 9px;
        display: flex; align-items: center; justify-content: center;
        font-size: 14px;
        flex-shrink: 0;
        margin-top: 1px;
      }
      .ntm-toast-body {
        flex: 1;
        min-width: 0;
        padding-right: 4px;
      }
      .ntm-toast-title {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: -0.1px;
        color: #F1F5F9;
        margin-bottom: 2px;
        font-family: 'DM Sans', sans-serif;
      }
      .ntm-toast-msg {
        font-size: 13px;
        font-weight: 400;
        color: #94A3B8;
        line-height: 1.4;
        font-family: 'DM Sans', sans-serif;
        word-break: break-word;
      }
      .ntm-toast-close {
        flex-shrink: 0;
        width: 20px; height: 20px;
        display: flex; align-items: center; justify-content: center;
        color: rgba(148,163,184,0.5);
        font-size: 11px;
        margin-top: 2px;
        transition: color 0.15s;
      }
      .ntm-toast:hover .ntm-toast-close { color: #94A3B8; }
      .ntm-toast-progress {
        position: absolute;
        bottom: 0; left: 0;
        height: 2px;
        border-radius: 0 0 14px 14px;
        transform-origin: left;
      }
      @keyframes ntm-progress {
        from { transform: scaleX(1); }
        to   { transform: scaleX(0); }
      }
    `;
    document.head.appendChild(s);
  }

  function _getOrCreateWrap() {
    let wrap = document.getElementById('ntm-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'ntm-toast-wrap';
      wrap.className = 'ntm-toast-wrap';
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  function showToast(message, type, title) {
    _injectToastStyles();
    const cfg  = TOAST_CFG[type] || TOAST_CFG.info;
    const dur  = type === 'error' ? 5000 : type === 'success' ? 4500 : (CONSTANTS.TOAST_DURATION || 3500);
    const wrap = _getOrCreateWrap();

    // Build toast via DOM (not innerHTML) so the message text is never
    // interpreted as HTML — prevents XSS if any caller passes user-derived content.
    const toast = document.createElement('div');
    toast.className = 'ntm-toast';

    const accent = document.createElement('div');
    accent.className = 'ntm-toast-accent';
    accent.style.background = cfg.color;

    const iconWrap = document.createElement('div');
    iconWrap.className = 'ntm-toast-icon';
    iconWrap.style.background = cfg.bg;
    iconWrap.style.color = cfg.color;
    const iconEl = document.createElement('i');
    iconEl.className = 'fa-solid ' + cfg.icon;
    iconWrap.appendChild(iconEl);

    const body = document.createElement('div');
    body.className = 'ntm-toast-body';

    const titleEl = document.createElement('div');
    titleEl.className = 'ntm-toast-title';
    titleEl.textContent = (title && String(title)) || cfg.title;

    const msgEl = document.createElement('div');
    msgEl.className = 'ntm-toast-msg';
    msgEl.textContent = String(message || '');   // textContent — never parsed as HTML

    body.appendChild(titleEl);
    body.appendChild(msgEl);

    const closeEl = document.createElement('div');
    closeEl.className = 'ntm-toast-close';
    const closeIcon = document.createElement('i');
    closeIcon.className = 'fa-solid fa-xmark';
    closeEl.appendChild(closeIcon);

    const progress = document.createElement('div');
    progress.className = 'ntm-toast-progress';
    progress.style.background = cfg.color;
    progress.style.opacity = '0.35';
    progress.style.animation = `ntm-progress ${dur}ms linear forwards`;

    toast.appendChild(accent);
    toast.appendChild(iconWrap);
    toast.appendChild(body);
    toast.appendChild(closeEl);
    toast.appendChild(progress);

    wrap.appendChild(toast);
    _toastStack.push(toast);

    // Hard cap: if this push put us over the limit, remove the oldest
    // toast immediately so a burst can never stack up and cover the screen.
    while (_toastStack.length > MAX_VISIBLE_TOASTS) {
      const oldest = _toastStack.shift();
      if (oldest && oldest.parentNode) oldest.parentNode.removeChild(oldest);
    }

    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));

    const dismiss = () => {
      toast.classList.remove('show');
      toast.classList.add('hide');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
        _toastStack = _toastStack.filter(t => t !== toast);
      }, 260);
    };

    toast.addEventListener('click', dismiss);
    setTimeout(dismiss, dur);
  }

  // ============================================
  // 5. EXPORT
  // ============================================

  window.App = {
    init,
    navigate,
    deriveSpotBalance,
    deriveVaultCash,

    /**
     * Called by auth.js after Supabase signIn / signUp succeeds.
     * Marks a fresh-login in sessionStorage so session-manager.js wipes
     * stale AppState on the next load, then redirects to the main app.
     * App.init() on index.html handles all subsequent setup.
     */
    handleLogin() {
      if (window.SessionManager) SessionManager.markFreshLogin();
      window.location.href = 'index.html';
    },

    refreshData: async () => {
      const user = window.AppState ? AppState.get('user') : null;
      if (user) {
        await Promise.all([
          syncProfile(user),
          syncHistory(user),
          syncInvestments(user),
          window.CacheManager ? CacheManager.refresh() : Promise.resolve()
        ]);
      }
    },

    showSuccess: (msg, title) => showToast(msg, 'success', title),
    showError:   (msg, title) => showToast(msg, 'error',   title),
    showWarning: (msg, title) => showToast(msg, 'warning', title),
    showInfo:    (msg, title) => showToast(msg, 'info',    title),

    // Getter wired to internal flag — not a permanently-false literal
    get initialized() { return state.initialized; }
  };

  console.log('[APP] 📦 App module loaded');

})();
