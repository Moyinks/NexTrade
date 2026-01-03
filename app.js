/**
 * NexTrade — App Controller (Production Grade)
 * * RESPONSIBILITIES:
 * 1. SINGLETON ORCHESTRATION: Manages Bootstraps, Auth, State, and Routing.
 * 2. HYBRID DATA SYNC: Bridges SQL columns (spot_balance) with AppState JSON.
 * 3. REACTIVE MARKET DATA: Centralized price polling.
 * 4. ERROR BOUNDARIES: Prevents startup crashes and handles auth failures gracefully.
 */

(function () {
  'use strict';

  // 1. Singleton Guard
  if (window.App) {
    console.warn('⚠️ NexTrade: App already defined. Skipping re-init.');
    return;
  }

  // 2. Internal Configuration
  const CONSTANTS = {
    PRICE_API: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether,solana,cardano,ripple&vs_currencies=usd',
    POLL_INTERVAL: 60000, // 1 minute
    INIT_TIMEOUT: 10000
  };

  let initialized = false;
  let pollIntervalId = null;

  // 3. Logger
  const log = (msg, data) => console.log(`🚀 App: ${msg}`, data || '');
  const error = (msg, err) => console.error(`❌ App: ${msg}`, err || '');

  // ============================================
  // CORE LOGIC: DATA SYNC (The Fix)
  // ============================================

  /**
   * Fetches user profile ensuring alignment between DB columns and AppState.
   * Handles the 'Hybrid' schema: spot_balance (Numeric) vs balances (JSON).
   */
  async function syncUserData(user) {
    try {
      if (!window.supabaseClient) throw new Error('Supabase client missing');

      // 1. Fetch Hybrid Data Source
      const { data: profile, error: dbErr } = await supabaseClient
        .from('profiles')
        .select('spot_balance, vault_balance, balances, holdings')
        .eq('id', user.id)
        .single();

      if (dbErr) throw dbErr;

      if (profile) {
        // 2. Reconciliation Logic (Priority: Numeric Column -> JSON Fallback)
        const spot = Number(profile.spot_balance) || Number(profile.balances?.spot) || 0;
        const vault = Number(profile.vault_balance) || Number(profile.balances?.vault) || 0;

        // 3. Atomic State Update
        // This triggers all subscribers (Wallet, Navbar, Home) via AppState
        AppState.set('user', user);
        AppState.set('balances', { 
          spot: spot, 
          vault: vault, 
          total: spot + vault 
        });

        if (profile.holdings) {
          AppState.set('holdings', profile.holdings);
        }

        log('State synced with DB', { spot, vault });
      }
    } catch (e) {
      error('Data sync failed', e);
      // Fallback: Use whatever is in local storage to prevent UI flash
      // AppState hydrates from storage automatically on load
    }
  }

  /**
   * Centralized Market Data Polling
   * Updates AppState.marketData which Wallet/Market modules subscribe to.
   */
  async function fetchMarketData() {
    try {
      const res = await fetch(CONSTANTS.PRICE_API);
      if (!res.ok) throw new Error('API Error');
      const data = await res.json();
      
      const marketData = [
        { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', current_price: data.bitcoin.usd },
        { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', current_price: data.ethereum.usd },
        { id: 'tether', symbol: 'USDT', name: 'Tether', current_price: data.tether.usd },
        { id: 'solana', symbol: 'SOL', name: 'Solana', current_price: data.solana.usd },
        { id: 'cardano', symbol: 'ADA', name: 'Cardano', current_price: data.cardano.usd },
        { id: 'ripple', symbol: 'XRP', name: 'Ripple', current_price: data.ripple.usd }
      ];

      AppState.set('marketData', marketData);
      
      // Force specific UI updates if needed, though Subscription is preferred
      if (window.Wallet && AppState.get('ui.currentPage') === 'wallet') {
        // Optional: Trigger specific refresh if Wallet doesn't auto-subscribe (it does in your file)
      }
    } catch (e) {
      console.warn('⚠️ Market data fetch failed. Using defaults.');
      // Keep existing data or set defaults if empty
      const current = AppState.get('marketData');
      if (!current || current.length === 0) {
        AppState.set('marketData', [
          { symbol: 'BTC', current_price: 95000 },
          { symbol: 'ETH', current_price: 3500 },
          { symbol: 'USDT', current_price: 1.00 }
        ]);
      }
    }
  }

  // ============================================
  // INITIALIZATION SEQUENCE
  // ============================================

  async function init() {
    if (initialized) return;

    // A. Wait for Bootstraps (DOM Authority)
    if (window.Bootstraps && typeof Bootstraps.init === 'function') {
      await Bootstraps.init();
    }

    log('Initializing...');

    // B. Validate Dependencies
    if (!window.AppState || !window.supabaseClient || !window.Router) {
      document.body.innerHTML = '<h2 style="color:red; text-align:center; margin-top:50px;">Critical Error: Modules missing.</h2>';
      return;
    }

    try {
      // C. Authentication Check
      const { data } = await supabaseClient.auth.getSession();
      const session = data?.session;

      if (!session) {
        log('No session, redirecting to login');
        if (!window.location.pathname.includes('login.html')) {
          window.location.href = 'login.html';
        }
        return;
      }

      // D. Critical Data Load (Block UI until ready)
      await syncUserData(session.user);
      await fetchMarketData();

      // E. Start Background Polling
      pollIntervalId = setInterval(fetchMarketData, CONSTANTS.POLL_INTERVAL);

      // F. Routing & Navigation
      if (window.Router) {
        window.Router.init(); // Bind Nav events
        
        // Restore last page or default to 'home'
        const lastPage = (window.Storage && Storage.getLastPage()) || 'home';
        navigate(lastPage);
      }

      // G. Render Shell UI (Navbar)
      renderNavbar();

      initialized = true;
      log('Ready.');

    } catch (e) {
      error('Initialization crashed', e);
    }
  }

  // ============================================
  // NAVIGATION & UI
  // ============================================

  function renderNavbar() {
    if (!window.Bootstraps) return;
    const navRoot = document.getElementById('bottom-nav') || document.querySelector('.app-footer');
    if (!navRoot) return;

    // Subscribe to page changes to update active tab
    AppState.subscribe('ui.currentPage', (page) => {
      if (window.Navbar && typeof Navbar.setActive === 'function') {
        Navbar.setActive(page);
      }
    });

    // Initial Render call if Navbar module exists
    if (window.Navbar && typeof Navbar.init === 'function') {
      Navbar.init(window.Bootstraps.getWrapper());
    }
  }

  /**
   * Universal Navigation Handler
   * Updates State -> Router -> UI -> Persistence
   */
  async function navigate(pageId) {
    if (!pageId) return;

    // 1. Update Global State
    AppState.set('ui.currentPage', pageId);

    // 2. Delegate Rendering to Router
    if (window.Router) {
      window.Router.go(pageId);
    }

    // 3. Persist Selection
    if (window.Storage) {
      Storage.setLastPage(pageId);
    }
  }

  // ============================================
  // PUBLIC API
  // ============================================

  window.App = {
    init,
    navigate,
    refreshData: async () => {
      const user = AppState.get('user');
      if (user) await syncUserData(user);
    },
    
    // UI Helpers exposed for Modules
    showSuccess: (msg) => showToast(msg, 'success'),
    showError: (msg) => showToast(msg, 'error')
  };

  // Toast System (Dependency-free)
  function showToast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    el.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      background: ${type === 'error' ? '#ef4444' : '#10b981'};
      color: white; padding: 12px 24px; border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 10000;
      font-weight: 500; opacity: 0; transition: opacity 0.3s;
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.style.opacity = '1');
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  // Auto-Start via Index.html defer script, but listener added for safety
  document.addEventListener('DOMContentLoaded', () => {
    // If index.html didn't trigger it, we do it here
    if (!initialized && window.Bootstraps) init();
  });

})();
