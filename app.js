/**
 * NexTrade — App Controller (FIXED: Investment Persistence)
 * ══════════════════════════════════════════════════════════════
 * CRITICAL FIX: Added syncInvestments() to load vault data on login
 * ══════════════════════════════════════════════════════════════
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
    pollTimer: null
  };

  // ============================================
  // 1. DATA SYNCHRONIZATION
  // ============================================

  async function syncProfile(user) {
    try {
      if (!window.supabaseClient) throw new Error('Supabase client missing');

      const { data: profile, error } = await window.supabaseClient
        .from('profiles')
        .select('spot_balance, vault_balance, holdings')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      if (profile) {
        const balanceState = {
          spot: parseFloat(profile.spot_balance) || 0,
          vault: parseFloat(profile.vault_balance) || 0,
          total: (parseFloat(profile.spot_balance) || 0) + (parseFloat(profile.vault_balance) || 0)
        };

        if (window.AppState) {
          AppState.set('user', user);
          AppState.set('balances', balanceState);
          if (profile.holdings) AppState.set('holdings', profile.holdings);
        }
        console.log('[APP] 💰 Balance Synced:', balanceState);
      }
    } catch (err) {
      console.error('[APP] ❌ Profile Sync Error:', err);
    }
  }

  async function syncHistory(user) {
    try {
      const { data: txs, error } = await window.supabaseClient
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (txs && window.AppState) {
        AppState.set('transactions', txs);
        console.log(`[APP] 📜 History Synced: ${txs.length} records`);
      }
    } catch (err) {
      console.error('[APP] ❌ History Sync Error:', err);
    }
  }

  // ╔════════════════════════════════════════════════════════════╗
  // ║  🔥 NEW FUNCTION - THIS IS WHAT WAS MISSING!              ║
  // ╚════════════════════════════════════════════════════════════╝
  async function syncInvestments(user) {
    try {
      if (!window.supabaseClient) throw new Error('Supabase client missing');

      const { data: investments, error } = await window.supabaseClient
        .from('investments')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (investments && window.AppState) {
        AppState.set('investments', investments);
        console.log(`[APP] 🏦 Investments Synced: ${investments.length} records`);
      }
    } catch (err) {
      console.error('[APP] ❌ Investment Sync Error:', err);
    }
  }

  // ============================================
  // 2. INITIALIZATION SEQUENCE
  // ============================================

  async function init() {
    if (state.initialized) return;

    console.log('[APP] 🚀 Starting initialization sequence...');

    try {
      // STEP 1: Bootstraps
      console.log('[APP] Step 1/6: Bootstraps...');
      if (!window.Bootstraps) throw new Error('Bootstraps module not loaded');
      if (typeof Bootstraps.init === 'function') {
        await Bootstraps.init();
        console.log('[APP] ✅ Bootstraps ready');
      }

      const mainElement = Bootstraps.getMain();
      if (!mainElement) throw new Error('Bootstraps failed to create .app-main');

      // STEP 2: Auth Check
      console.log('[APP] Step 2/6: Auth...');
      if (!window.supabaseClient) throw new Error('Supabase client not loaded');
      
      const { data } = await window.supabaseClient.auth.getSession();
      const session = data?.session;

      if (!session) {
        console.log('[APP] ⚠️ No session, redirecting to login...');
        if (!window.location.pathname.includes(CONSTANTS.LOGIN_PAGE)) {
          window.location.href = CONSTANTS.LOGIN_PAGE;
        }
        return;
      }

      console.log('[APP] ✅ Auth verified');

      // STEP 3: CacheManager
      console.log('[APP] Step 3/6: CacheManager...');
      if (!window.CacheManager) throw new Error('CacheManager module not loaded');
      CacheManager.init();
      console.log('[APP] ✅ CacheManager initialized');

      // ╔════════════════════════════════════════════════════════════╗
      // ║  STEP 4: Data Loading (🔥 NOW INCLUDES INVESTMENTS!)      ║
      // ╚════════════════════════════════════════════════════════════╝
      console.log('[APP] Step 4/6: Loading user data...');
      
      await Promise.all([
        syncProfile(session.user),
        syncHistory(session.user),
        syncInvestments(session.user), // 🔥 THIS LINE IS NEW!
        CacheManager.getMarketData()
      ]);

      console.log('[APP] ✅ Data loaded');

      // STEP 5: Router
      console.log('[APP] Step 5/6: Router...');
      if (!window.Router) throw new Error('Router module not loaded');
      await Router.init();
      console.log('[APP] ✅ Router initialized');

      const lastPage = (window.Storage && Storage.getLastPage()) || 'home';
      console.log(`[APP] 📍 Navigating to: ${lastPage}`);
      await navigate(lastPage);

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
      console.log('[APP] ✅✅✅ App Fully Initialized ✅✅✅');

    } catch (error) {
      console.error('[APP] ❌ Initialization failed:', error);
      
      const mainElement = document.querySelector('.app-main');
      if (mainElement) {
        mainElement.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 50vh; padding: 20px; text-align: center;">
            <div style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;">
              <i class="fas fa-exclamation-triangle" style="color: #ef4444;"></i>
            </div>
            <div style="font-size: 18px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 8px;">
              Failed to Initialize App
            </div>
            <div style="font-size: 13px; color: var(--color-text-secondary); margin-bottom: 20px; max-width: 400px;">
              ${error.message || 'An unexpected error occurred during startup.'}
            </div>
            <button onclick="window.location.reload()" class="btn btn-primary" style="padding: 10px 24px;">
              Reload App
            </button>
          </div>
        `;
      }
    }
  }

  // ============================================
  // 3. UTILITIES & API
  // ============================================

  async function navigate(pageId) {
    if (!pageId) return;
    console.log(`[APP] 🧭 Navigate called: ${pageId}`);
    if (window.AppState) AppState.set('ui.currentPage', pageId);
    if (window.Router) await window.Router.navigate(pageId);
    if (window.Navbar) Navbar.setActive(pageId);
    if (window.Storage) Storage.setLastPage(pageId);
  }

  function showToast(message, type) {
    const el = document.createElement('div');
    el.textContent = message;
    const bgColor = type === 'error' ? '#ef4444' : '#10b981';
    
    el.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      background: ${bgColor}; color: white; padding: 12px 24px; border-radius: 8px;
      font-weight: 600; font-family: sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 99999; opacity: 0; transition: opacity 0.3s ease; pointer-events: none;
    `;

    document.body.appendChild(el);
    requestAnimationFrame(() => el.style.opacity = '1');
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, CONSTANTS.TOAST_DURATION);
  }

  // ============================================
  // 4. EXPORT
  // ============================================

  window.App = {
    init,
    navigate,
    refreshData: async () => {
      const user = AppState.get('user');
      if (user) {
        await Promise.all([
          syncProfile(user), 
          syncHistory(user),
          syncInvestments(user), // 🔥 ALSO REFRESH INVESTMENTS
          CacheManager.refresh()
        ]);
      }
    },
    showSuccess: (msg) => showToast(msg, 'success'),
    showError: (msg) => showToast(msg, 'error'),
    initialized: false
  };

  console.log('[APP] 📦 App module loaded');

})();