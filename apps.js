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
 *
 * FIXES (v2 → v3):
 * 6. transfer_in / transfer_out registered in CREDIT_TYPES / DEBIT_TYPES.
 *    wallets.js writes these types for internal spot↔vault transfers. Without
 *    registration here, the background poll's deriveSpotBalance call ignores
 *    those ledger entries and restores the pre-transfer spot balance on every
 *    60-second cycle.
 * 7. Pending withdrawals included in derivation. A second query fetches
 *    pending withdrawals and merges them into the ledger rows before reduction.
 *    Previously, the single query (status IN completed,approved) caused pending
 *    withdrawals to be invisible; the background poll restored the
 *    pre-withdrawal balance on every sync, giving users their locked funds back
 *    in the UI until the admin processed the request.
 * 8. hasBaseCredits gate corrected to deposit-only. The gate previously
 *    checked `tx.type === 'deposit' || tx.type === 'claim'`. Including 'claim'
 *    caused the gate to flip from false→true on the user's first claim, which
 *    switched derivation from the seeded-balance path (use storedBalance as
 *    seed) to the zero-sum path (start from 0). For accounts whose balance was
 *    admin-seeded without a deposit transaction, this silently destroyed the
 *    seeded balance. Fixed to check deposit only — matches the gate logic in
 *    trade.js and vault.js.
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

  // FIX (v3 — D1): 'transfer_in' / 'transfer_out' added.
  // wallets.js writes these types when recording internal spot↔vault transfers.
  // Without registration here, deriveSpotBalance ignores those entries and the
  // background poll restores the pre-transfer spot on every 60s cycle.
  const CREDIT_TYPES = new Set(['deposit', 'sell', 'claim', 'transfer_in']);
  const DEBIT_TYPES  = new Set(['withdraw', 'buy', 'investment', 'transfer_out']);

  /**
   * Derive the canonical spot balance by summing completed ledger entries.
   *
   * Falls back to the stored DB value when no deposit tx exists — this
   * handles existing users whose balance was set manually before the ledger
   * architecture was in place. Once the admin portal approves a deposit,
   * the derivation takes over permanently.
   */
  async function deriveSpotBalance(userId, storedBalance) {
    // Query 1: All settled transactions (completed + admin-approved).
    // 'approved' is the terminal status the admin portal writes when it
    // confirms a deposit — it carries the same financial weight as 'completed'.
    // Querying only 'completed' caused approved deposits to be invisible to
    // derivation, so spot balance never updated after admin approval.
    const { data: completedTxs, error: err1 } = await window.supabaseClient
      .from('transactions')
      .select('type, amount')
      .eq('user_id', userId)
      .in('status', ['completed', 'approved']);

    if (err1) throw err1;

    // FIX (v3 — D2): Query 2 — pending withdrawals only.
    // A pending withdrawal means the user requested a payout that admin has
    // not yet processed, but the funds are locked. Counting them as debits
    // here prevents the background-poll balance restoration bug: without this
    // query, the single-query path (status IN completed,approved) ignores the
    // pending withdrawal, and the 60s poll restores the pre-withdrawal amount
    // to AppState and profiles on every cycle.
    // Pending deposits are deliberately excluded — external crypto transfers
    // require admin confirmation before they may be credited.
    const { data: pendingWithdrawals, error: err2 } = await window.supabaseClient
      .from('transactions')
      .select('type, amount')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .in('type', ['withdraw']);

    if (err2) throw err2;

    const rows = [...(completedTxs || []), ...(pendingWithdrawals || [])];

    // FIX (v3 — D3): Gate is deposit-only.
    // Previously: `tx.type === 'deposit' || tx.type === 'claim'`
    // The inclusion of 'claim' caused the gate to flip on the user's first
    // claim, switching derivation from "use storedBalance as seed" to "sum
    // from zero". For accounts whose balance was admin-seeded without a
    // deposit transaction, this silently destroyed the seeded amount.
    // Matches the identical gate logic in trade.js and vault.js.
    const hasDepositTx = (completedTxs || []).some(tx => tx.type === 'deposit');

    if (!hasDepositTx) {
      // No canonical deposit tx: apply all ledger movements against storedBalance
      // as the seed. Correct on first derivation (storedBalance = raw admin seed).
      // Permanent fix: run the migration in vault.js to insert deposit records
      // for all admin-seeded accounts so this path becomes unreachable.
      return Math.max(0, rows.reduce((bal, tx) => {
        const amt = parseFloat(tx.amount) || 0;
        if (CREDIT_TYPES.has(tx.type)) return bal + amt;
        if (DEBIT_TYPES.has(tx.type))  return bal - amt;
        return bal;
      }, Math.max(0, parseFloat(storedBalance) || 0)));
    }

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

      const currentBalances = (window.AppState && typeof AppState.get === 'function')
        ? (AppState.get('balances') || {})
        : {};
      const parsedVault = Number.parseFloat(profile.vault_balance);
      const vaultBalance = Number.isFinite(Number(currentBalances.vault))
        ? Math.max(0, Number(currentBalances.vault) || 0)
        : Math.max(0, Number.isFinite(parsedVault) ? parsedVault : 0);

      const balanceState = {
        spot:  derivedSpot,
        vault: vaultBalance,
        total: derivedSpot + vaultBalance
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
      // Keep the last known balances on transient failures so the UI never
      // flashes to zero while the network or profile row is unavailable.
      if (window.AppState) {
        AppState.set('user', user);
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
            title: 'Exit NexTrade?',
            message: 'Are you sure you want to leave the app?',
            confirmText: 'Exit',
            cancelText: 'Stay'
          }).then(confirmed => {
            if (confirmed) {
              // Exiting — remove the listener so it doesn't re-fire during unload
              window.removeEventListener('popstate', handleBack);
              window.location.href = CONSTANTS.LOGIN_PAGE;
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
        if (event === 'SIGNED_OUT' || (!session && state.initialized)) {
          console.warn('[APP] Session expired — redirecting');
          if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
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

  function showToast(message, type) {
    _injectToastStyles();
    const cfg  = TOAST_CFG[type] || TOAST_CFG.info;
    const dur  = type === 'error' ? 5000 : (CONSTANTS.TOAST_DURATION || 3500);
    const wrap = _getOrCreateWrap();

    const toast = document.createElement('div');
    toast.className = 'ntm-toast';
    toast.innerHTML = `
      <div class="ntm-toast-accent" style="background:${cfg.color};"></div>
      <div class="ntm-toast-icon" style="background:${cfg.bg};color:${cfg.color};">
        <i class="fa-solid ${cfg.icon}"></i>
      </div>
      <div class="ntm-toast-body">
        <div class="ntm-toast-title">${cfg.title}</div>
        <div class="ntm-toast-msg">${message}</div>
      </div>
      <div class="ntm-toast-close"><i class="fa-solid fa-xmark"></i></div>
      <div class="ntm-toast-progress" style="background:${cfg.color};opacity:0.35;animation:ntm-progress ${dur}ms linear forwards;"></div>
    `;

    wrap.appendChild(toast);
    _toastStack.push(toast);

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
    showWarning: (msg) => showToast(msg, 'warning'),
    showInfo:    (msg) => showToast(msg, 'info'),

    // Getter wired to internal flag — not a permanently-false literal
    get initialized() { return state.initialized; }
  };

  console.log('[APP] 📦 App module loaded');

})();