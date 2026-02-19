/**
 * NexTrade — State Management Module (Institutional Grade)
 * * CORE ARCHITECTURE:
 * 1. SYNCHRONOUS HYDRATION: Loads persistence immediately to prevent "empty state" overwrites.
 * 2. DERIVED STATE: Vault balance is calculated dynamically from active investments.
 * 3. ATOMIC UPDATES: Every state change triggers a save to 'nextrade_state_v1'.
 * 4. SECURE RESET: Added clear() method to wipe data on logout/signup.
 * 
 * FIXES:
 * - Added defensive checks for missing investment data
 * - syncVaultData() now handles edge cases (empty arrays, invalid dates)
 * - Improved vault balance calculation to prevent NaN errors
 */

(function () {
  'use strict';

  // Prevent double-initialization
  if (window.AppState) return;

  const PERSIST_KEY = 'nextrade_state_v1';
  const keySubscribers = Object.create(null);
  const globalSubscribers = [];

  // ============================================
  // 1. INITIAL STATE FACTORY (Reset Logic)
  // ============================================
  const getDefaults = () => ({
    user: null,
    profile: null,
    
    // Financials
    balances: { spot: 0, vault: 0, total: 0 },
    holdings: {}, 
    
    // Data Lists
    investments: [],
    transactions: [],
    activityFeed: [],
    marketData: [],
    
    // Config & UI
    strategies: [
      { id: 'strat_stable', name: 'USDC Yield Alpha', icon: '⚡', risk: 'Low', apy: 0.12, durationDays: 7, min: 100, description: 'Algorithmic stablecoin arbitrage across DEX liquidity pools.' },
      { id: 'strat_defi', name: 'DeFi Blue Chip', icon: '🛡️', risk: 'Medium', apy: 0.24, durationDays: 30, min: 500, description: 'Automated leverage farming on Aave and Compound.' },
      { id: 'strat_degen', name: 'Meme Momentum', icon: '🚀', risk: 'High', apy: 1.50, durationDays: 3, min: 50, description: 'High-frequency scalping on volatile meme assets.' }
    ],
    ui: {
      currentPage: 'home',
      isLoading: false,
      modalOpen: null,
      selectedStrategy: null
    }
  });

  // Initialize with defaults
  let _state = getDefaults();

  // ============================================
  // 2. LOGIC & PERSISTENCE (FIXED)
  // ============================================

  /**
   * Recalculates Vault Balance from Investments.
   * FIXES:
   * - Handles empty arrays gracefully
   * - Validates dates before calculation
   * - Prevents NaN from invalid investment data
   * - Ensures consistent APY calculation matching Vault.js
   */
  const syncVaultData = () => {
    // Defensive check: ensure investments is an array
    if (!Array.isArray(_state.investments)) {
      console.warn('[STATE] investments is not an array, resetting to []');
      _state.investments = [];
      _state.balances.vault = 0;
      _state.balances.total = (_state.balances.spot || 0);
      return;
    }

    const active = _state.investments.filter(i => i && i.status === 'active');
    
    if (active.length === 0) {
      _state.balances.vault = 0;
      _state.balances.total = (_state.balances.spot || 0);
      return;
    }

    // Calculate current value including accrued interest for visual accuracy
    const vaultTotal = active.reduce((sum, inv) => {
      // Validate investment has required fields
      if (!inv || typeof inv.amount !== 'number' || inv.amount <= 0) {
        console.warn('[STATE] Invalid investment found, skipping:', inv);
        return sum;
      }

      try {
        const now = Date.now();
        const start = new Date(inv.created_at).getTime();
        
        // Validate date
        if (isNaN(start)) {
          console.warn('[STATE] Invalid created_at date:', inv.created_at);
          return sum + inv.amount; // Return principal only
        }

        const durationMs = (inv.duration || inv.durationDays || 30) * 24 * 60 * 60 * 1000;
        const end = start + durationMs;
        const effectiveNow = Math.min(now, end);
        const elapsedYearFraction = (effectiveNow - start) / (365 * 24 * 60 * 60 * 1000);
        
        // Validate APY
        const apy = typeof inv.apy === 'number' ? inv.apy : 0;
        
        // Calculate profit
        const profit = inv.amount * apy * elapsedYearFraction;
        
        // Ensure we don't return NaN
        const currentValue = inv.amount + profit;
        return sum + (isNaN(currentValue) ? inv.amount : currentValue);
        
      } catch (error) {
        console.error('[STATE] Error calculating investment value:', error);
        return sum + inv.amount; // Fallback to principal
      }
    }, 0);
    
    _state.balances.vault = vaultTotal;
    _state.balances.total = (_state.balances.spot || 0) + vaultTotal;
  };

  const saveToStorage = () => {
    try {
      // Security: Only persist if a user is actually logged in to avoid overwriting with empty state
      if (_state.user) {
        const data = {
          balances: _state.balances,
          holdings: _state.holdings,
          investments: _state.investments,
          transactions: _state.transactions,
          activityFeed: (_state.activityFeed || []).slice(0, 20),
          profile: _state.profile,
          marketData: _state.marketData,
          ui: _state.ui
        };
        localStorage.setItem(PERSIST_KEY, JSON.stringify(data));
      }
    } catch (e) {
      console.error('[STATE] Save failed:', e);
    }
  };

  const loadFromStorage = () => {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        
        // Merge saved data into state with validation
        if (parsed.balances && typeof parsed.balances === 'object') {
  _state.balances = {
    spot: Math.max(0, parseFloat(parsed.balances.spot) || 0),
    vault: Math.max(0, parseFloat(parsed.balances.vault) || 0),
    total: Math.max(0, parseFloat(parsed.balances.total) || 0)
  };
}
if (parsed.holdings && typeof parsed.holdings === 'object' && !Array.isArray(parsed.holdings)) {
  _state.holdings = parsed.holdings;
}
if (Array.isArray(parsed.investments)) {
  _state.investments = parsed.investments.filter(i =>
    i && typeof i.amount === 'number' && i.amount > 0 &&
    typeof i.id === 'string' && typeof i.status === 'string'
  );
}
        if (Array.isArray(parsed.transactions)) _state.transactions = parsed.transactions;
        if (Array.isArray(parsed.activityFeed)) _state.activityFeed = parsed.activityFeed;
        if (Array.isArray(parsed.marketData)) _state.marketData = parsed.marketData;
        if (parsed.profile) _state.profile = parsed.profile;
        if (parsed.ui) _state.ui = { ..._state.ui, ...parsed.ui };
        
        // Ensure consistency immediately
        syncVaultData();
      }
    } catch (e) {
      console.error('[STATE] Load failed:', e);
    }
  };

  const notify = (key) => {
    if (key && keySubscribers[key]) {
      const val = AppState.get(key);
      keySubscribers[key].forEach(cb => { try { cb(val); } catch (e) { console.error('[STATE] Subscriber error:', e); } });
    }
    if (globalSubscribers.length) {
      const snap = AppState.get();
      globalSubscribers.forEach(cb => { try { cb(snap); } catch (e) { console.error('[STATE] Global subscriber error:', e); } });
    }
  };

  // ============================================
  // 3. PUBLIC API
  // ============================================
  const AppState = {
    get(key) {
      if (!key) return JSON.parse(JSON.stringify(_state));
      // Support simple dot notation for 1 level deep (e.g. 'ui.isLoading')
      if (key.includes('.')) {
  const parts = key.split('.');
  let val = _state;
  for (const part of parts) {
    if (val == null) return undefined;
    val = val[part];
  }
  return val !== undefined ? JSON.parse(JSON.stringify(val)) : undefined;
}
      return _state[key] ? JSON.parse(JSON.stringify(_state[key])) : undefined;
    },

    set(key, value) {
      // Support deep set
      if (key.includes('.')) {
  const parts = key.split('.');
  let obj = _state;
  for (let i = 0; i < parts.length - 1; i++) {
    if (obj[parts[i]] == null) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
  notify(parts[0]);
}
      else {
        _state[key] = value;
        notify(key);
      }
      
      // Special Triggers
      if (key === 'investments') {
        syncVaultData();
        notify('balances');
      }
      
      saveToStorage();
    },

    /**
     * Specialized: Update Balance safely
     */
    updateBalances(newBalances) {
      if (newBalances.spot !== undefined) _state.balances.spot = parseFloat(newBalances.spot) || 0;
      // Vault is derived, but we allow manual overrides if needed temporarily
      if (newBalances.vault !== undefined) _state.balances.vault = parseFloat(newBalances.vault) || 0;
      
      syncVaultData(); // Force sync to be sure
      saveToStorage();
      notify('balances');
    },

    /**
     * Specialized: Add Transaction (Top of list)
     */
    addTransaction(tx) {
      if (!_state.transactions) _state.transactions = [];
      const entry = { ...tx, created_at: tx.created_at || new Date().toISOString() };
      _state.transactions.unshift(entry);
      saveToStorage();
      notify('transactions');
    },

    /**
     * Specialized: Add Investment
     */
    addInvestment(inv) {
      if (!_state.investments) _state.investments = [];
      _state.investments.unshift(inv);
      syncVaultData();
      saveToStorage();
      notify('investments');
      notify('balances');
    },

    /**
     * CRITICAL: HARD RESET FOR LOGOUT/SIGNUP
     * Completely wipes memory and localStorage to prevent data leakage between users.
     */
    clear() {
      console.log('[STATE] 🧹 Wiping all data...');
      
      // 1. Reset Memory to Fresh Defaults
      _state = getDefaults();
      
      // 2. Nuke Persistence
      localStorage.removeItem(PERSIST_KEY);
      
      // 3. Notify all subscribers that state has changed (to empty)
      notify();
    },

    subscribe(arg1, arg2) {
      if (typeof arg1 === 'function') {
        globalSubscribers.push(arg1);
        try { arg1(AppState.get()); } catch(e){ console.error('[STATE] Subscriber init error:', e); }
        return () => { const i = globalSubscribers.indexOf(arg1); if(i>-1) globalSubscribers.splice(i,1); };
      } else {
        if (!keySubscribers[arg1]) keySubscribers[arg1] = [];
        keySubscribers[arg1].push(arg2);
        try { arg2(AppState.get(arg1)); } catch(e){ console.error('[STATE] Key subscriber init error:', e); }
        return () => { keySubscribers[arg1] = keySubscribers[arg1].filter(f => f!==arg2); };
      }
    },

    getStrategyById: (id) => _state.strategies.find(s => s.id === id),
    setLoading: (v) => AppState.set('ui.isLoading', !!v),
    selectStrategy: (s) => AppState.set('ui.selectedStrategy', s),
    
    // Debug / Manual
    save: saveToStorage,
    reload: loadFromStorage
  };

  // 4. BOOTSTRAP (Execute immediately)
  loadFromStorage();
  window.AppState = AppState;
  console.log('[STATE] 🧠 AppState Initialized & Hydrated');
})();