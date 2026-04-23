/**
 * NexTrade — State Management
 * ══════════════════════════════════════════════════════════════════════════════
 * FIX: Removed `strategies` from AppState entirely.
 *
 * The old `strategies` array (USDC Yield Alpha / DeFi Blue Chip / Meme Momentum)
 * was dead code — a different product definition that was never updated when
 * vault.js was rebuilt with Steady Accumulator / Alpha Seeker. Having two
 * different strategy lists with different IDs, different APY formats (decimal
 * fraction vs annual percent), and different names is worse than having none.
 * vault.js is the single source of truth for strategies.
 *
 * Everything else preserved: dot-notation get/set, localStorage persistence,
 * vault balance derivation from active investments, clear() on logout.
 */

(function () {
  'use strict';

  if (window.AppState) return;

  const PERSIST_KEY      = 'nextrade_state_v1';
  const keySubscribers   = Object.create(null);
  const globalSubscribers = [];
  let _batchDepth = 0;
  const _pendingNotifyKeys = new Set();

  // ============================================
  // 1. INITIAL STATE FACTORY
  // ============================================

  const getDefaults = () => ({
    user:    null,
    profile: null,

    // Financials
    balances: { spot: 0, vault: 0, total: 0 },
    holdings: {},

    // Data lists
    investments:  [],
    transactions: [],
    activityFeed: [],
    marketData:   [],

    // UI
    ui: {
      currentPage:      'home',
      isLoading:        false,
      modalOpen:        null,
      selectedStrategy: null
    }
  });

  let _state = getDefaults();

  // ============================================
  // 2. VAULT BALANCE DERIVATION
  // ============================================

  /**
   * Vault balance is always computed from active investments — never stored
   * directly by the client. This keeps it consistent with the ledger model:
   * the client does not send raw balance numbers, it derives them.
   */
  const syncVaultData = () => {
    if (!Array.isArray(_state.investments)) {
      console.warn('[STATE] investments is not an array, resetting');
      _state.investments = [];
      _state.balances.vault = 0;
      _state.balances.total = _state.balances.spot || 0;
      return;
    }

    const active = _state.investments.filter(i => i && i.status === 'active');

    if (active.length === 0) {
      _state.balances.vault = 0;
      _state.balances.total = _state.balances.spot || 0;
      return;
    }

    const vaultTotal = active.reduce((sum, inv) => {
      if (!inv) {
        return sum;
      }
      try {
        const principal = parseFloat(inv.amount);
        if (!Number.isFinite(principal) || principal <= 0) {
          console.warn('[STATE] Invalid investment, skipping:', inv);
          return sum;
        }

        const now      = Date.now();
        const start    = new Date(inv.created_at).getTime();
        if (isNaN(start)) return sum + principal;

        const durationMs    = (inv.duration || inv.durationDays || 30) * 24 * 60 * 60 * 1000;
        const end           = start + durationMs;
        const effectiveNow  = Math.min(now, end);
        const elapsedYearFraction = (effectiveNow - start) / (365 * 24 * 60 * 60 * 1000);

        // vault.js stores apy as an integer percent (e.g. 22 = 22%).
        // Convert to decimal fraction for calculation.
        const rawApy = parseFloat(inv.apy);
        const apy    = Number.isFinite(rawApy) ? (rawApy > 1 ? rawApy / 100 : rawApy) : 0;

        const profit       = principal * apy * elapsedYearFraction;
        const currentValue = principal + profit;
        return sum + (isNaN(currentValue) ? principal : currentValue);
      } catch (err) {
        console.error('[STATE] Error computing investment value:', err);
        return sum + (parseFloat(inv.amount) || 0);
      }
    }, 0);

    _state.balances.vault = vaultTotal;
    _state.balances.total = (_state.balances.spot || 0) + vaultTotal;
  };

  const emit = (key) => {
    if (!key) return;
    if (_batchDepth > 0) {
      _pendingNotifyKeys.add(key);
      return;
    }
    notify(key);
  };

  const flushPendingNotifications = () => {
    if (_batchDepth > 0 || _pendingNotifyKeys.size === 0) return;
    const keys = Array.from(_pendingNotifyKeys);
    _pendingNotifyKeys.clear();
    const seen = new Set();
    keys.forEach(key => {
      if (seen.has(key)) return;
      seen.add(key);
      notify(key);
    });
  };

  // ============================================
  // 3. PERSISTENCE
  // ============================================

  const saveToStorage = () => {
    try {
      if (_state.user) {
        const data = {
          balances:    _state.balances,
          holdings:    _state.holdings,
          investments: _state.investments,
          transactions: _state.transactions,
          activityFeed: (_state.activityFeed || []).slice(0, 20),
          profile:     _state.profile,
          marketData:  _state.marketData,
          ui:          _state.ui
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
      if (!raw) return;
      const parsed = JSON.parse(raw);

      if (parsed.balances && typeof parsed.balances === 'object') {
        _state.balances = {
          spot:  Math.max(0, parseFloat(parsed.balances.spot)  || 0),
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
      if (Array.isArray(parsed.marketData))   _state.marketData   = parsed.marketData;
      if (parsed.profile)                     _state.profile      = parsed.profile;
      if (parsed.ui)                          _state.ui           = { ..._state.ui, ...parsed.ui };

      syncVaultData();
    } catch (e) {
      console.error('[STATE] Load failed:', e);
    }
  };

  const notify = (key) => {
    if (key && keySubscribers[key]) {
      const val = AppState.get(key);
      keySubscribers[key].forEach(cb => {
        try { cb(val); } catch (e) { console.error('[STATE] Subscriber error:', e); }
      });
    }
    if (globalSubscribers.length) {
      const snap = AppState.get();
      globalSubscribers.forEach(cb => {
        try { cb(snap); } catch (e) { console.error('[STATE] Global subscriber error:', e); }
      });
    }
  };

  // ============================================
  // 4. PUBLIC API
  // ============================================

  const AppState = {
    get(key) {
      if (!key) return JSON.parse(JSON.stringify(_state));
      if (key.includes('.')) {
        const parts = key.split('.');
        let val = _state;
        for (const part of parts) {
          if (val == null) return undefined;
          val = val[part];
        }
        return val !== undefined ? JSON.parse(JSON.stringify(val)) : undefined;
      }
      return _state[key] !== undefined ? JSON.parse(JSON.stringify(_state[key])) : undefined;
    },

    set(key, value) {
      if (key.includes('.')) {
        const parts = key.split('.');
        let obj = _state;
        for (let i = 0; i < parts.length - 1; i++) {
          if (obj[parts[i]] == null) obj[parts[i]] = {};
          obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
        emit(parts[0]);
      } else {
        _state[key] = value;
        emit(key);
      }

      if (key === 'investments') {
        syncVaultData();
        emit('balances');
      }

      saveToStorage();
    },

    updateBalances(newBalances) {
      if (newBalances.spot  !== undefined) _state.balances.spot  = parseFloat(newBalances.spot)  || 0;
      if (newBalances.vault !== undefined) _state.balances.vault = parseFloat(newBalances.vault) || 0;
      syncVaultData();
      saveToStorage();
      emit('balances');
    },

    addTransaction(tx) {
      if (!_state.transactions) _state.transactions = [];
      const entry = { ...tx, created_at: tx.created_at || new Date().toISOString() };
      _state.transactions.unshift(entry);
      saveToStorage();
      emit('transactions');
    },

    addInvestment(inv) {
      if (!_state.investments) _state.investments = [];
      _state.investments.unshift(inv);
      syncVaultData();
      saveToStorage();
      emit('investments');
      emit('balances');
    },

    /**
     * Hard reset — called on sign-out and fresh login.
     * Wipes memory and localStorage to prevent data leakage between sessions.
     */
    clear() {
      console.log('[STATE] 🧹 Wiping all state...');
      _state = getDefaults();
      localStorage.removeItem(PERSIST_KEY);
      notify();
    },

    subscribe(arg1, arg2) {
      if (typeof arg1 === 'function') {
        globalSubscribers.push(arg1);
        try { arg1(AppState.get()); } catch (e) { console.error('[STATE] Subscriber init error:', e); }
        return () => {
          const i = globalSubscribers.indexOf(arg1);
          if (i > -1) globalSubscribers.splice(i, 1);
        };
      } else {
        if (!keySubscribers[arg1]) keySubscribers[arg1] = [];
        keySubscribers[arg1].push(arg2);
        try { arg2(AppState.get(arg1)); } catch (e) { console.error('[STATE] Key subscriber init error:', e); }
        return () => {
          keySubscribers[arg1] = keySubscribers[arg1].filter(f => f !== arg2);
        };
      }
    },

    setLoading:     (v) => AppState.set('ui.isLoading', !!v),
    selectStrategy: (s) => AppState.set('ui.selectedStrategy', s),

    async batch(fn) {
      _batchDepth += 1;
      try {
        return await fn();
      } finally {
        _batchDepth = Math.max(0, _batchDepth - 1);
        if (_batchDepth === 0) flushPendingNotifications();
      }
    },

    // Manual debug hooks
    save:   saveToStorage,
    reload: loadFromStorage
  };

  // Bootstrap
  loadFromStorage();
  window.AppState = AppState;
  console.log('[STATE] 🧠 AppState initialized');

})();
