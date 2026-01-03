/**
 * NexTrade — App Controller (Institutional Standard)
 * * RESPONSIBILITIES:
 * 1. SAFE INIT: Uses locks & dependency checks to prevent race conditions.
 * 2. AUTHENTICATION: Validates Supabase session before loading UI.
 * 3. HYDRATION: Calls API.loadUserData() to populate AppState from DB.
 * 4. MARKET DATA: Fetches live prices for asset valuation.
 * 5. ROUTING: Centralized navigation handler.
 */

(function () {
  'use strict';

  // 1. Singleton Guard
  if (window.App) {
    console.warn('App already defined — skipping redefinition.');
    return;
  }

  // 2. Internal State
  let initialized = false;
  let initLock = false;

  const CONSTANTS = {
    APP_ROOT: 'app-root',
    NAV_ROOT: 'bottom-nav',
    PRICE_API: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether,solana,cardano,ripple&vs_currencies=usd',
    TIMEOUT: 5000
  };

  // 3. Helpers & Logger
  const log = (...args) => console.log('🚀 NexTrade:', ...args);
  const warn = (...args) => console.warn('🚀 NexTrade:', ...args);
  const fail = (...args) => console.error('🚀 NexTrade:', ...args);

  // Robust Waiter
  async function waitFor(predicateFn, timeout = CONSTANTS.TIMEOUT, interval = 50) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try { if (predicateFn()) return true; } catch (e) {}
      await new Promise(r => setTimeout(r, interval));
    }
    return false;
  }

  function showFatalError(message) {
    fail(message);
    const root = document.getElementById(CONSTANTS.APP_ROOT) || document.body;
    root.innerHTML = `
      <div style="height:100vh; display:flex; align-items:center; justify-content:center; flex-direction:column; color:#ff5555;">
        <h2 style="margin-bottom:1rem;">Initialization Error</h2>
        <p>${message}</p>
        <button onclick="window.location.reload()" style="margin-top:1rem; padding:10px 20px; cursor:pointer;">Retry</button>
      </div>`;
  }

  // 4. Business Logic: Market Data
  async function fetchMarketData() {
    try {
      // Throttle: Max once per minute
      const last = window._lastPriceFetch || 0;
      if (Date.now() - last < 60000 && last !== 0) return;

      const res = await fetch(CONSTANTS.PRICE_API);
      const data = await res.json();
      
      const marketData = [
        { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', current_price: data.bitcoin.usd },
        { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', current_price: data.ethereum.usd },
        { id: 'tether', symbol: 'USDT', name: 'Tether', current_price: data.tether.usd },
        { id: 'solana', symbol: 'SOL', name: 'Solana', current_price: data.solana.usd },
        { id: 'cardano', symbol: 'ADA', name: 'Cardano', current_price: data.cardano.usd },
        { id: 'ripple', symbol: 'XRP', name: 'Ripple', current_price: data.ripple.usd }
      ];

      if (window.AppState) {
        AppState.set('marketData', marketData);
        window._lastPriceFetch = Date.now();
        
        // Live update if Wallet is active
        if (AppState.get('ui.currentPage') === 'wallet' && window.Wallet) {
          Wallet.render(document.getElementById('main-content'));
        }
      }
    } catch (e) {
      warn('Market data fetch failed (using defaults):', e);
      // Fallback defaults so the app doesn't break
      if (!AppState.get('marketData') || AppState.get('marketData').length === 0) {
        AppState.set('marketData', [
          { symbol: 'BTC', current_price: 95000 },
          { symbol: 'ETH', current_price: 3500 },
          { symbol: 'USDT', current_price: 1.00 }
        ]);
      }
    }
  }

  // 5. Business Logic: Auth & Data Hydration
  async function validateSessionAndLoad() {
    if (!window.supabaseClient) {
      warn('Supabase missing. Running in Visitor/Demo mode.');
      return null;
    }

    try {
      // 1. Check Session
      const { data } = await supabaseClient.auth.getSession();
      const session = data?.session;

      if (session?.user) {
        log(`User authenticated: ${session.user.email}`);
        
        // 2. Set User in State
        AppState.setUser(session.user);

        // 3. Hydrate Data via API Module
        if (window.API && typeof API.loadUserData === 'function') {
          await API.loadUserData(session.user.id);
        } else {
          warn('API module missing. Skipping data hydration.');
        }
        return session;
      }
    } catch (e) {
      warn('Session validation failed:', e);
    }
    return null;
  }

  // 6. Router & UI Logic
  function renderShell() {
    const root = document.getElementById(CONSTANTS.APP_ROOT);
    if (!root) return; // Should catch in init

    // Idempotent: Only create if missing
    if (!document.getElementById('main-content')) {
      root.innerHTML = `
        <div id="main-content" style="padding-bottom: 80px; min-height: 100vh;"></div>
        <nav id="${CONSTANTS.NAV_ROOT}" class="bottom-nav"></nav>
      `;
    }
    renderNavbar();
  }

  function renderNavbar() {
    const nav = document.getElementById(CONSTANTS.NAV_ROOT);
    if (!nav) return;

    const current = (window.AppState && AppState.get('ui.currentPage')) || 'home';
    const tabs = [
      { id: 'home', icon: '🏠', label: 'Home' },
      { id: 'market', icon: '📊', label: 'Market' },
      { id: 'vault', icon: '🔒', label: 'Vault' },
      { id: 'wallet', icon: '💼', label: 'Wallet' }
    ];

    nav.innerHTML = tabs.map(tab => `
      <div class="nav-item ${current === tab.id ? 'active' : ''}" onclick="App.navigate('${tab.id}')">
        <div class="nav-icon">${tab.icon}</div>
        <div class="nav-label">${tab.label}</div>
      </div>
    `).join('');
  }

  async function navigate(page) {
    if (!page || typeof page !== 'string') return;

    // 1. Update State
    if (window.AppState) AppState.set('ui.currentPage', page);

    // 2. Update Nav UI
    renderNavbar();

    // 3. Render Module content
    const content = document.getElementById('main-content');
    if (!content) return;
    
    content.innerHTML = ''; // Clean slate

    switch (page) {
      case 'home':
        if (window.Home) Home.render(content);
        else content.innerHTML = '<div style="padding:2rem; text-align:center;">Home Module Loading...</div>';
        break;
      case 'market':
        if (window.Market) Market.render(content);
        else content.innerHTML = '<div style="padding:2rem; text-align:center;">Market Module Loading...</div>';
        break;
      case 'vault':
        if (window.Vault) Vault.render(content);
        else content.innerHTML = '<div style="padding:2rem; text-align:center;">Vault Module Loading...</div>';
        break;
      case 'wallet':
        if (window.Wallet) Wallet.render(content);
        else content.innerHTML = '<div style="padding:2rem; text-align:center;">Wallet Module Loading...</div>';
        break;
      default:
        content.innerHTML = '<div style="padding:2rem; text-align:center;">404: Module Not Found</div>';
    }
  }

  // 7. Main Initialization Sequence
  async function init() {
    if (initialized) { warn('App already initialized.'); return; }
    if (initLock) { warn('App init in progress.'); return; }
    initLock = true;

    log('Initializing...');

    // A. Check Dependencies
    const ready = await waitFor(() => window.AppState && window.supabaseClient && window.API, 4000);
    if (!ready) {
      showFatalError('Critical modules (AppState, API, or Supabase) failed to load.');
      initLock = false;
      return;
    }

    // B. Bind DOM Shell
    renderShell();

    // C. Auth & Data Hydration
    const session = await validateSessionAndLoad();

    // D. Fetch Market Data (and start polling)
    await fetchMarketData();
    setInterval(fetchMarketData, 60000);

    // E. Initial Navigation
    const startPage = AppState.get('ui.currentPage') || 'home';
    await navigate(startPage);

    // F. Finalize
    initialized = true;
    initLock = false;
    
    // Dispatch Ready Event
    window.dispatchEvent(new CustomEvent('nextrade:ready', { detail: { page: startPage } }));
    log('Ready.');
  }

  // 8. Public API
  window.App = {
    init,
    navigate,
    isInitialized: () => initialized,
    
    // Helper to allow modules to trigger toasts via App.showSuccess()
    showSuccess: (msg) => showToast(msg, 'success'),
    showError: (msg) => showToast(msg, 'error')
  };

  // Toast Helper
  function showToast(message, type) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      padding: 12px 24px; border-radius: 8px; color: white;
      font-weight: 600; z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      background: ${type === 'success' ? '#10b981' : '#ef4444'};
      transition: opacity 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
  }

  // 9. Auto-Boot
  document.addEventListener('DOMContentLoaded', init);

})();
