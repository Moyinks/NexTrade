/**
 * NexTrade — State Management Module (Institutional Grade)
 * * CORE ARCHITECTURE:
 * 1. SYNCHRONOUS HYDRATION: Loads persistence immediately to prevent "empty state" overwrites.
 * 2. DERIVED STATE: Vault balance is calculated dynamically from active investments.
 * 3. ATOMIC UPDATES: Every state change triggers a save to 'nextrade_state_v1'.
 */

(function () {
  'use strict';

  // Prevent double-initialization
  if (window.AppState) return;

  // ============================================
  // 1. INITIAL STATE (Defaults)
  // ============================================
  const _state = {
    user: null,
    profile: null,
    
    // Financials
    balances: { spot: 0, vault: 0, total: 0 },
    holdings: {}, // { BTC: 0.5, ETH: 10.0 }
    
    // Data Lists
    investments: [],
    transactions: [],
    activityFeed: [],
    
    // Config & UI
    strategies: [
      { id: 'alpha-scalper', name: 'Alpha Scalper', icon: '⚡', risk: 'medium', apy: 10, lockPeriod: 30, minInvestment: 100, description: 'High-frequency trading strategy with 10% monthly ROI split daily.' },
      { id: 'stable-yield', name: 'Stable Yield', icon: '🛡️', risk: 'low', apy: 8, lockPeriod: 90, minInvestment: 500, description: 'Conservative strategy focused on stable returns.' },
      { id: 'momentum-pro', name: 'Momentum Pro', icon: '🚀', risk: 'high', apy: 35, lockPeriod: 60, minInvestment: 1000, description: 'Aggressive strategy capitalizing on trends.' }
    ],
    ui: {
      currentPage: 'home',
      isLoading: false,
      modalOpen: null,
      selectedStrategy: null
    }
  };

  const keySubscribers = Object.create(null);
  const globalSubscribers = [];
  const PERSIST_KEY = 'nextrade_state_v1';

  // ============================================
  // 2. LOGIC & PERSISTENCE
  // ============================================

  /**
   * Recalculates Vault Balance from Investments.
   * Prevents "Ghost Money" where balance exists without an investment.
   */
  const syncVaultData = () => {
    const active = (_state.investments || []).filter(i => i.status === 'active');
    const vaultTotal = active.reduce((sum, i) => sum + (parseFloat(i.current_value) || parseFloat(i.amount) || 0), 0);
    
    _state.balances.vault = vaultTotal;
    _state.balances.total = (_state.balances.spot || 0) + vaultTotal;
  };

  const saveToStorage = () => {
    try {
      const data = {
        balances: _state.balances,
        holdings: _state.holdings,
        investments: _state.investments,
        transactions: _state.transactions,
        activityFeed: _state.activityFeed,
        profile: _state.profile,
        ui: _state.ui
      };
      localStorage.setItem(PERSIST_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('AppState: Save failed', e);
    }
  };

  const loadFromStorage = () => {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge saved data into state
        if (parsed.balances) _state.balances = parsed.balances;
        if (parsed.holdings) _state.holdings = parsed.holdings;
        if (parsed.investments) _state.investments = parsed.investments;
        if (parsed.transactions) _state.transactions = parsed.transactions;
        if (parsed.activityFeed) _state.activityFeed = parsed.activityFeed;
        if (parsed.profile) _state.profile = parsed.profile;
        if (parsed.ui) _state.ui = { ..._state.ui, ...parsed.ui };
        
        // Ensure consistency immediately
        syncVaultData();
      }
    } catch (e) {
      console.error('AppState: Load failed', e);
    }
  };

  const notify = (key) => {
    if (keySubscribers[key]) {
      const val = AppState.get(key);
      keySubscribers[key].forEach(cb => { try { cb(val); } catch (e) {} });
    }
    if (globalSubscribers.length) {
      const snap = AppState.get();
      globalSubscribers.forEach(cb => { try { cb(snap); } catch (e) {} });
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
        const [parent, child] = key.split('.');
        return _state[parent] ? JSON.parse(JSON.stringify(_state[parent][child])) : undefined;
      }
      return _state[key] ? JSON.parse(JSON.stringify(_state[key])) : undefined;
    },

    set(key, value) {
      // Support deep set
      if (key.includes('.')) {
        const [parent, child] = key.split('.');
        if (_state[parent]) {
          _state[parent][child] = value;
          notify(parent);
        }
      } else {
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
      if (newBalances.spot !== undefined) _state.balances.spot = parseFloat(newBalances.spot);
      // Vault is derived, but we allow manual overrides if needed temporarily
      if (newBalances.vault !== undefined) _state.balances.vault = parseFloat(newBalances.vault);
      
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

    subscribe(arg1, arg2) {
      if (typeof arg1 === 'function') {
        globalSubscribers.push(arg1);
        try { arg1(AppState.get()); } catch(e){}
        return () => { const i = globalSubscribers.indexOf(arg1); if(i>-1) globalSubscribers.splice(i,1); };
      } else {
        if (!keySubscribers[arg1]) keySubscribers[arg1] = [];
        keySubscribers[arg1].push(arg2);
        try { arg2(AppState.get(arg1)); } catch(e){}
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
  console.log('🧠 AppState Initialized & Hydrated');
})();
