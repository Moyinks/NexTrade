/**
 * NexTrade — App Controller
 * ══════════════════════════════════════════════════════════════════════════════
 * FIXES:
 * 1. deriveSpotBalance() — balance derived from completed transaction ledger,
 *    not from the stored profiles.spot_balance column. This is the ledger-first
 *    guarantee: the column is a cache that is recomputed on every login.
 * 2. syncProfile() uses derived balance and writes it back to DB.
 * 3. App.handleLogin() exported — auth.js calls this after Supabase signIn/signUp.
 *    It marks a fresh-login flag and redirects; App.init() on index.html does
 *    the actual setup. Clean separation.
 * 4. App.initialized is a getter wired to the internal state flag, not a
 *    permanently-false literal.
 * 5. Removed duplicate `if (createError) throw createError` in ensureProfile.
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
    pollTimer:   null
  };

  // ============================================
  // 1. LEDGER-FIRST BALANCE DERIVATION
  // ============================================

  // These are the only transaction types that exist in the system.
  // Credits increase spot balance; debits decrease it.
  // Pending transactions are excluded — only 'completed' rows are summed.
  const CREDIT_TYPES = new Set(['deposit', 'sell', 'claim']);
  const DEBIT_TYPES  = new Set(['withdraw', 'buy', 'investment']);

  /**
   * Derive the canonical spot balance by summing completed ledger entries.
   *
   * Falls back to the stored DB value when no completed credits exist — this
   * handles existing users whose balance was set manually before the ledger
   * architecture was in place. Once the admin portal approves a deposit (Phase 4),
   * the derivation takes over permanently.
   *
   * The reconciliation test query will reveal any delta between stored and derived.
   */
  async function deriveSpotBalance(userId, storedBalance) {
    const { data: txs, error } = await window.supabaseClient
      .from('transactions')
      .select('type, amount')
      .eq('user_id', userId)
      .eq('status', 'completed');

    if (error) throw error;

    const rows = txs || [];
    // Only treat the ledger as authoritative when there are completed deposit or
    // claim entries. Sell credits are internal — they presuppose a deposit that
    // funded the original buy. Without a completed deposit/claim, the stored DB
    // value is the source of truth (covers existing accounts seeded manually).
    const hasBaseCredits = rows.some(tx => tx.type === 'deposit' || tx.type === 'claim');
    if (!hasBaseCredits) return Math.max(0, parseFloat(storedBalance) || 0);

    return Math.max(0, rows.reduce((bal, tx) => {
      const amt = parseFloat(tx.amount) || 0;
      if (CREDIT_TYPES.has(tx.type)) return bal + amt;
      if (DEBIT_TYPES.has(tx.type))  return bal - amt;
      return bal;
    }, 0));
  }

  // ============================================
  // 2. DATA SYNCHRONIZATION
  // ============================================

  async function ensureProfile(user) {
    try {
      if (!window.supabaseClient) throw new Error('Supabase client missing');

      const { data: existing, error: fetchError } = await window.supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      // PGRST116 = row not found — expected for new users
      if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

      if (existing) {
        console.log('[APP] ✅ Profile exists');
        return existing;
      }

      console.log('[APP] 📝 Creating new profile for user:', user.id);

      const newProfile = {
        id:          user.id,
        email:       user.email,
        spot_balance: 0,
        vault_balance: 0,
        holdings:    {},
        created_at:  new Date().toISOString(),
        updated_at:  new Date().toISOString()
      };

      const { data: created, error: createError } = await window.supabaseClient
        .from('profiles')
        .upsert(newProfile, { onConflict: 'id', ignoreDuplicates: false })
        .select()
        .single();

      if (createError) throw createError;

      console.log('[APP] ✅ Profile created');
      return created;

    } catch (err) {
      console.error('[APP] ❌ Profile creation/fetch error:', err);
      throw err;
    }
  }

  async function syncProfile(user) {
    try {
      if (!window.supabaseClient) throw new Error('Supabase client missing');

      const profile = await ensureProfile(user);
      if (!profile) return;

      // Derive spot balance from ledger (source of truth)
      const derivedSpot = await deriveSpotBalance(user.id, profile.spot_balance);

      // Write derived balance back to profiles if it differs (self-healing)
      const storedSpot = parseFloat(profile.spot_balance) || 0;
      if (Math.abs(derivedSpot - storedSpot) > 0.001) {
        console.log(`[APP] 🔧 Correcting spot_balance: stored=${storedSpot} derived=${derivedSpot}`);
        await window.supabaseClient
          .from('profiles')
          .update({ spot_balance: derivedSpot, updated_at: new Date().toISOString() })
          .eq('id', user.id);
      }

      const balanceState = {
        spot:  derivedSpot,
        vault: parseFloat(profile.vault_balance) || 0,
        total: derivedSpot + (parseFloat(profile.vault_balance) || 0)
      };

      if (window.AppState) {
        AppState.set('user',     user);
        AppState.set('profile',  { ...profile, spot_balance: derivedSpot });
        AppState.set('balances', balanceState);
        if (profile.holdings) AppState.set('holdings', profile.holdings);
      }

      console.log('[APP] 💰 Ledger-derived balance:', balanceState);

    } catch (err) {
      console.error('[APP] ❌ Profile Sync Error:', err);
      // Don't block the app — set user at minimum so navigation works
      if (window.AppState) {
        AppState.set('user',     user);
        AppState.set('balances', { spot: 0, vault: 0, total: 0 });
        AppState.set('holdings', {});
      }
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
      if (window.AppState) AppState.set('investments', []);
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
          window.location.href = CONSTANTS.LOGIN_PAGE;
        }
        return;
      }

      console.log('[APP] ✅ Auth verified:', session.user.id);

      // STEP 3: CacheManager
      console.log('[APP] Step 3/6: CacheManager...');
      if (!window.CacheManager) throw new Error('CacheManager module not loaded');
      CacheManager.init();
      console.log('[APP] ✅ CacheManager ready');

      // STEP 4: Data — profile first (creates row if missing), then parallel
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
        // Re-push immediately so the next back press also fires popstate
        window.history.pushState({ ntx: 1 }, '');

        // If a modal is open, close it and do nothing else
        const openOverlay = document.querySelector('.ntm-overlay.ntm-open');
        if (openOverlay && window.Modal) {
          Modal.close();
          return;
        }

        // No modal open — ask if the user wants to exit
        if (window.Modal) {
          Modal.confirm({
            title: 'Exit NexTrade?',
            message: 'Are you sure you want to leave the app?',
            confirmText: 'Exit',
            cancelText: 'Stay'
          }).then(confirmed => {
            if (confirmed) {
              window.removeEventListener('popstate', handleBack);
              window.location.href = CONSTANTS.LOGIN_PAGE;
            }
          });
        }
      }

      window.addEventListener('popstate', handleBack);

      // Session expiry watcher
      window.supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || (!session && state.initialized)) {
          console.warn('[APP] Session expired — redirecting');
          if (window.AppState) AppState.clear();
          window.location.href = CONSTANTS.LOGIN_PAGE;
        }
      });

      console.log('[APP] ✅✅✅ App Fully Initialized ✅✅✅');
      console.log('[APP] 📊 State:', {
        user:             AppState.get('user')?.id,
        balances:         AppState.get('balances'),
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

  function showToast(message, type) {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = `
      position:fixed;top:20px;left:50%;transform:translateX(-50%);
      background:${type === 'error' ? '#ef4444' : '#10b981'};color:white;
      padding:12px 24px;border-radius:8px;font-weight:600;font-family:sans-serif;
      box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:99999;
      opacity:0;transition:opacity 0.3s ease;pointer-events:none;
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => (el.style.opacity = '1'));
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, CONSTANTS.TOAST_DURATION);
  }

  // ============================================
  // 5. EXPORT
  // ============================================

  window.App = {
    init,
    navigate,

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

    showSuccess: (msg) => showToast(msg, 'success'),
    showError:   (msg) => showToast(msg, 'error'),

    // Getter wired to internal flag — not a permanently-false literal
    get initialized() { return state.initialized; }
  };

  console.log('[APP] 📦 App module loaded');

})();
