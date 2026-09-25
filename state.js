/**
 * NexTrade — application state
 *
 * Authoritative money values are fetched from server-side derivation RPCs.
 * Local storage is only a warm cache and is never considered spendable until
 * balanceSyncStatus becomes "ready" for the current authenticated session.
 */
(function () {
  'use strict';
  if (window.AppState) return;

  const PERSIST_KEY = 'nextrade_state_v2';
  const keySubscribers = Object.create(null);
  const globalSubscribers = [];
  let batchDepth = 0;
  const pendingKeys = new Set();

  const defaults = () => ({
    user: null,
    profile: null,
    balances: { spot: 0, vault: 0, total: 0 },
    // Uninvested cash allocated to Vault. Active positions are added on top.
    vaultCash: 0,
    holdings: {},
    balanceSyncStatus: 'syncing',
    // Presentation readiness is independent from transaction authority.
    // A warm cache may be shown while ledger authority revalidates.
    presentationReady: false,
    investments: [],
    transactions: [],
    activityFeed: [],
    marketData: [],
    ui: {
      currentPage: 'home',
      isLoading: false,
      modalOpen: null,
      selectedStrategy: null
    }
  });

  let state = defaults();

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function nonNegative(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function estimatePosition(inv) {
    if (window.FinanceMath && typeof FinanceMath.investmentEstimate === 'function') {
      return nonNegative(FinanceMath.investmentEstimate(inv).value);
    }
    return nonNegative(inv && (inv.current_value ?? inv.amount));
  }

  function syncVaultData() {
    if (!Array.isArray(state.investments)) state.investments = [];
    const positionValue = state.investments
      .filter((inv) => inv && inv.status === 'active')
      .reduce((sum, inv) => sum + estimatePosition(inv), 0);

    state.vaultCash = nonNegative(state.vaultCash);
    state.balances.spot = nonNegative(state.balances.spot);
    state.balances.vault = state.vaultCash + positionValue;
    state.balances.total = state.balances.spot + state.balances.vault;
  }

  function notify(key) {
    if (key && keySubscribers[key]) {
      const value = AppState.get(key);
      keySubscribers[key].forEach((cb) => {
        try { cb(value); } catch (error) { console.error('[STATE] subscriber:', error); }
      });
    }
    if (globalSubscribers.length) {
      const snapshot = AppState.get();
      globalSubscribers.forEach((cb) => {
        try { cb(snapshot); } catch (error) { console.error('[STATE] global subscriber:', error); }
      });
    }
  }

  function emit(key) {
    if (!key) return;
    if (batchDepth > 0) {
      pendingKeys.add(key);
      return;
    }
    notify(key);
  }

  function flush() {
    if (batchDepth > 0) return;
    const keys = Array.from(pendingKeys);
    pendingKeys.clear();
    keys.forEach(notify);
  }

  function save() {
    try {
      if (!state.user) return;
      localStorage.setItem(PERSIST_KEY, JSON.stringify({
        balances: state.balances,
        vaultCash: state.vaultCash,
        holdings: state.holdings,
        investments: state.investments,
        transactions: state.transactions,
        activityFeed: (state.activityFeed || []).slice(0, 20),
        profile: state.profile,
        marketData: state.marketData,
        ui: state.ui,
        presentationReady: state.presentationReady === true
        // user + balanceSyncStatus deliberately excluded.
      }));
    } catch (error) {
      console.warn('[STATE] cache save failed:', error);
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.balances) state.balances.spot = nonNegative(parsed.balances.spot);
        state.vaultCash = nonNegative(parsed.vaultCash);
        if (parsed.holdings && !Array.isArray(parsed.holdings)) state.holdings = parsed.holdings;
        if (Array.isArray(parsed.investments)) state.investments = parsed.investments;
        if (Array.isArray(parsed.transactions)) state.transactions = parsed.transactions;
        if (Array.isArray(parsed.activityFeed)) state.activityFeed = parsed.activityFeed;
        if (Array.isArray(parsed.marketData)) state.marketData = parsed.marketData;
        if (parsed.profile) state.profile = parsed.profile;
        if (parsed.ui) state.ui = { ...state.ui, ...parsed.ui };
      }
      // Cached values remain non-authoritative, but a cache written by a prior
      // authenticated session is valid presentation data during revalidation.
      // The explicit flag supports new caches; the balances-key check upgrades
      // existing v2 caches without discarding their last-known workspace.
      state.presentationReady = parsed.presentationReady === true ||
        Object.prototype.hasOwnProperty.call(parsed, 'balances');
      state.balanceSyncStatus = 'syncing';
      syncVaultData();
    } catch (error) {
      console.warn('[STATE] cache load failed; clearing corrupt cache:', error);
      localStorage.removeItem(PERSIST_KEY);
      state = defaults();
    }
  }

  const AppState = {
    get(key) {
      if (!key) return clone(state);
      if (!key.includes('.')) return clone(state[key]);
      let value = state;
      for (const part of key.split('.')) {
        if (value == null) return undefined;
        value = value[part];
      }
      return clone(value);
    },

    set(key, value) {
      if (key.includes('.')) {
        const parts = key.split('.');
        let target = state;
        for (let i = 0; i < parts.length - 1; i += 1) {
          if (!target[parts[i]] || typeof target[parts[i]] !== 'object') target[parts[i]] = {};
          target = target[parts[i]];
        }
        target[parts[parts.length - 1]] = value;
        emit(parts[0]);
      } else {
        state[key] = value;
        emit(key);
      }

      if (key === 'investments' || key === 'vaultCash') {
        syncVaultData();
        emit('balances');
      }
      save();
    },

    updateBalances(next) {
      if (!next || typeof next !== 'object') return;
      if (next.spot !== undefined) state.balances.spot = nonNegative(next.spot);
      if (next.vaultCash !== undefined) state.vaultCash = nonNegative(next.vaultCash);
      // Legacy callers may pass vault. Do not allow that to override authoritative
      // position math; only use it when no investments and no vaultCash are known.
      if (next.vault !== undefined && state.investments.length === 0 && next.vaultCash === undefined) {
        state.vaultCash = nonNegative(next.vault);
      }
      syncVaultData();
      save();
      emit('balances');
      emit('vaultCash');
    },

    addTransaction(tx) {
      if (!tx || !tx.id) return;
      if (state.transactions.some((item) => item && item.id === tx.id)) return;
      state.transactions.unshift({ ...tx, created_at: tx.created_at || new Date().toISOString() });
      save();
      emit('transactions');
    },

    addInvestment(inv) {
      if (!inv || !inv.id) return;
      if (!state.investments.some((item) => item && item.id === inv.id)) state.investments.unshift(inv);
      syncVaultData();
      save();
      emit('investments');
      emit('balances');
    },

    clear() {
      state = defaults();
      try { localStorage.removeItem(PERSIST_KEY); } catch (_) {}
      notify();
    },

    subscribe(arg1, arg2) {
      if (typeof arg1 === 'function') {
        globalSubscribers.push(arg1);
        try { arg1(AppState.get()); } catch (_) {}
        return () => {
          const index = globalSubscribers.indexOf(arg1);
          if (index >= 0) globalSubscribers.splice(index, 1);
        };
      }
      if (!keySubscribers[arg1]) keySubscribers[arg1] = [];
      keySubscribers[arg1].push(arg2);
      try { arg2(AppState.get(arg1)); } catch (_) {}
      return () => {
        keySubscribers[arg1] = (keySubscribers[arg1] || []).filter((fn) => fn !== arg2);
      };
    },

    setLoading(value) { AppState.set('ui.isLoading', !!value); },
    selectStrategy(value) { AppState.set('ui.selectedStrategy', value); },

    async batch(fn) {
      batchDepth += 1;
      try { return await fn(); }
      finally {
        batchDepth = Math.max(0, batchDepth - 1);
        flush();
      }
    },

    save,
    reload: load
  };

  load();
  window.AppState = AppState;
})();
