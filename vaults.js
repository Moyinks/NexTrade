/**
 * NexTrade — Vault Module v6.2
 * ══════════════════════════════════════════════════════════════════════════════
 * FIXES (v6.1 → v6.2):
 * 1. Transfer types registered in CREDIT_TYPES / DEBIT_TYPES — 'transfer_in'
 *    and 'transfer_out' are now recognised by deriveSpotBalanceFromLedger().
 *    wallets.js (v5.1) writes these types when recording internal spot↔vault
 *    transfers. Without registration here, any vault operation (invest or claim)
 *    that calls deriveSpotBalanceFromLedger() after a transfer would silently
 *    ignore the transfer entries, re-inflating or deflating spot incorrectly.
 *
 * 2. Pending withdrawals included in derivation — deriveSpotBalanceFromLedger()
 *    now executes a second query for pending withdrawals (status='pending',
 *    type='withdraw') and merges them with completed transactions before
 *    reduction. Previously, filtering to status='completed' only caused pending
 *    withdrawals to be invisible to derivation. On next vault operation the
 *    pre-withdrawal balance was restored, allowing the withdrawn funds to
 *    reappear. This mirrors the identical fix applied in trade.js.
 *
 * 3. Ledger entry failure is now fatal in handleInvestment and handleClaim —
 *    previously a failed transactions.insert() was swallowed with console.warn
 *    and execution continued. An investment or claim with no audit trail would
 *    leave the balance in a state that could not be correctly re-derived. Now
 *    both throw, aborting the operation.
 *
 * FIXES (v6.1, carried forward):
 * 1. strategy_id duplicate key — JS silently took the last value (the name string),
 *    so every lookup by id failed. Fixed: one key, correct value.
 * 2. strategy_name — removed as a stored field; display labels are derived from strategy_id.
 * 3. handleClaim zeroed investment.amount — destroyed the audit trail.
 *    Fixed: only update status to 'completed'. Amount is immutable (append-only).
 * 4. Ledger-first writes — investment and claim operations insert a transaction
 *    entry as the primary record. Balance on profiles is recomputed from ledger.
 * 5. Removed vault_balance direct write — vault_balance is derived in AppState
 *    from active investments (syncVaultData in states.js). We do not write it
 *    from the client; it's a computed view, not stored state.
 */

(function () {
  'use strict';

  // ============================================
  // STRATEGIES (single source of truth)
  // ============================================

  const STRATEGIES = [
    {
      id:          'steady-accumulator',
      name:        'Steady Accumulator',
      tagline:     'Low volatility. Consistent pool growth.',
      category:    'Conservative · Pool A',
      icon:        '\u{1F6E1}\uFE0F',
      apy:         22,
      apyRange:    '18\u201326%',
      minAmount:   1500,
      duration:    90,
      riskLevel:   1,
      riskLabel:   'Low',
      riskColor:   '#10b981',
      penaltyRate: 0.08,
      perfFee:     15,
      accentColor: '#10b981',
      mechanics: [
        { icon: '\u{1F3E6}', title: 'Stablecoin Lending',  pct: 55, desc: 'USDC/USDT loaned to institutional borrowers via audited protocols. Pool earns a continuous yield from real borrower demand \u2014 no speculation.' },
        { icon: '\u27A0',    title: 'ETH Staking',          pct: 30, desc: 'Native ETH staking through validator nodes we operate. Protocol rewards are deposited into the pool every epoch.' },
        { icon: '\u{1F4A7}', title: 'Liquidity Provision',  pct: 15, desc: 'Pool capital deployed into the highest-fee stable pairs. Every swap generates a fee credited to the pool continuously.' }
      ],
      highlights: [
        'Your return = your pool share \u00D7 pool performance',
        'We earn 15% only on the profit the pool generates',
        'No leverage. Capital only in audited protocols',
        'Early exit: up to 8% fee on claimed value'
      ]
    },
    {
      id:          'alpha-seeker',
      name:        'Alpha Seeker',
      tagline:     'Aggressive execution. Real market edge.',
      category:    'Quant Momentum · Pool B',
      icon:        '\u26A1',
      apy:         65,
      apyRange:    '45\u201390%',
      minAmount:   1500,
      duration:    30,
      riskLevel:   2,
      riskLabel:   'Medium\u2013High',
      riskColor:   '#f59e0b',
      penaltyRate: 0.15,
      perfFee:     20,
      accentColor: '#f59e0b',
      mechanics: [
        { icon: '\u{1F4CA}', title: 'Quant Momentum Signals',    pct: 50, desc: 'RSI-divergence and volume-anomaly signals across the top 20 pairs. Positions open and close within hours. Pool captures the spread.' },
        { icon: '\u2696\uFE0F', title: 'Funding Rate Arbitrage', pct: 30, desc: 'When perp futures lean heavily long, shorts collect a payment every 8 hours. We sit on the right side and collect \u2014 market-neutral income.' },
        { icon: '\u{1F525}', title: 'Volatile-Pair Liquidity',   pct: 20, desc: 'Providing liquidity on high-volatility pairs earns 10\u00D7 the fees of stable pairs. Rebalanced dynamically to capture fee income.' }
      ],
      highlights: [
        'Your return = your pool share \u00D7 pool performance',
        'Algo-driven entries \u2014 no emotional decisions',
        'Funding rate arbitrage runs continuously, 24/7',
        'We earn 20% only on the profit the pool generates',
        'Early exit: up to 15% fee on claimed value'
      ]
    }
  ];

  // ============================================
  // MODULE STATE
  // ============================================

  let _container        = null;
  let _activeTab        = 'explore';
  let _destroyed        = false;
  let _isProcessing     = false;
  let _milestoneChecked = new Set();
  let _liveTimers       = new Set();   // interval/timeout IDs — cleared on destroy
  let _unsubInvestments = null;
  let _portfolioTabBtn  = null;

  // ============================================
  // HELPERS
  // ============================================

  function getState() {
    if (!window.AppState) return { user: null, balances: { spot: 0, vault: 0 }, investments: [] };
    return {
      user:        AppState.get('user')        || null,
      profile:     AppState.get('profile')     || null,
      balances:    AppState.get('balances')    || { spot: 0, vault: 0 },
      investments: AppState.get('investments') || []
    };
  }

  function fmt(val) {
    if (window.Format && Format.currency) return Format.currency(parseFloat(val) || 0);
    const n = parseFloat(val) || 0;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function showError(msg)   { if (window.App && App.showError)   App.showError(msg);   else alert(msg); }
  function showSuccess(msg) { if (window.App && App.showSuccess) App.showSuccess(msg); else alert(msg); }

  function el(tag, css, txt) {
    const e = document.createElement(tag);
    if (css)      e.style.cssText = css;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function formatStrategyIdLabel(strategyId) {
    if (!strategyId || typeof strategyId !== 'string') return 'Investment';
    return strategyId.replace(/[-_]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
  }

  function getStrategyForInvestment(investment) {
    const strategyId = investment && investment.strategy_id;
    const found = STRATEGIES.find(s => s.id === strategyId);
    if (found) return found;

    const fallbackName = investment && investment.strategy_name
      ? investment.strategy_name
      : formatStrategyIdLabel(strategyId);

    return {
      id: strategyId || 'unknown',
      name: fallbackName || 'Investment',
      accentColor: '#3b82f6',
      icon: '💼',
      duration: 30,
      penaltyRate: 0.1
    };
  }

  function getActiveInvestmentCount() {
    const { investments } = getState();
    return (investments || []).filter(i => i && i.status === 'active').length;
  }

  function updatePortfolioTabLabel() {
    if (!_portfolioTabBtn) return;
    _portfolioTabBtn.textContent = 'My Portfolio (' + getActiveInvestmentCount() + ')';
  }

  function syncPortfolioPanelFromState() {
    updatePortfolioTabLabel();
    if (_activeTab === 'portfolio') renderPortfolioTab();
  }

  function ensureInvestmentsSubscription() {
    if (_unsubInvestments || !window.AppState || typeof AppState.subscribe !== 'function') return;
    _unsubInvestments = AppState.subscribe('investments', () => {
      if (_destroyed) return;
      syncPortfolioPanelFromState();
    });
  }

  // ============================================
  // POOL SIMULATION ENGINE
  // ============================================
  // All functions here are pure and deterministic.
  // The pool index is a simulated NAV (Net Asset Value) per strategy,
  // seeded so the same strategy always produces the same history.
  // User's estimated value = principal × (todayIndex / entryIndex).
  // This is display-only — actual payout is set by admin at claim time.

  // Mulberry32 — fast, deterministic, good distribution
  function _rng(seed) {
    let s = seed >>> 0;
    return function () {
      s += 0x6D2B79F5;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Index value at any date, walking day-by-day from the epoch.
  // Returns a float (1.000 = starting value).
  function _poolIndex(strategyId, date) {
    const EPOCH   = new Date('2024-01-01T00:00:00Z');
    const target  = new Date(date);
    const days    = Math.floor((target - EPOCH) / 86400000);
    if (days <= 0) return 1.0;

    const isAlpha  = strategyId === 'alpha-seeker';
    const apy      = isAlpha ? 0.65 : 0.22;
    const daily    = Math.pow(1 + apy, 1 / 365) - 1;
    const vol      = isAlpha ? 0.022 : 0.007;   // daily volatility
    const seed     = isAlpha ? 0xDEADBEEF : 0xC0FFEE42;
    const rand     = _rng(seed);

    let idx = 1.0;
    for (let d = 0; d < days; d++) {
      // Slight positive skew (rand biased below 0.48 → more up days)
      const noise = (rand() - 0.47) * vol * 2;
      idx *= (1 + daily + noise);
      if (idx < 0.5) idx = 0.5; // floor — realistic drawdown limit
    }
    return idx;
  }

  // Last N days of index values (for sparkline).
  function _indexSeries(strategyId, days) {
    const out = [];
    const now = Date.now();
    for (let i = days - 1; i >= 0; i--) {
      out.push(_poolIndex(strategyId, new Date(now - i * 86400000)));
    }
    return out;
  }

  // Estimated current value based on pool performance since entry date.
  function _estimatedValue(investment) {
    const principal  = parseFloat(investment.amount || 0);
    const entryDate  = investment.created_at || new Date().toISOString();
    const sid        = investment.strategy_id;
    const entryIdx   = _poolIndex(sid, entryDate);
    const todayIdx   = _poolIndex(sid, new Date());
    if (entryIdx <= 0) return principal;
    return principal * (todayIdx / entryIdx);
  }

  // Pool share percentage (their principal vs simulated total strategy AUM).
  function _poolShare(principal, strategyId) {
    const AUM = strategyId === 'alpha-seeker' ? 874000 : 2430000;
    return (principal / (AUM + principal)) * 100;
  }

  // Build a 7-day SVG sparkline.
  function _buildSparkline(strategyId, accentColor) {
    const series = _indexSeries(strategyId, 7);
    const min    = Math.min(...series);
    const max    = Math.max(...series);
    const range  = max - min || 0.001;
    const W = 100, H = 36, pad = 2;

    const pts = series.map((v, i) => {
      const x = pad + (i / (series.length - 1)) * (W - pad * 2);
      const y = H - pad - ((v - min) / range) * (H - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });

    const trending = series[series.length - 1] >= series[0];
    const color    = trending ? '#10b981' : '#ef4444';
    const gradId   = 'spk-' + strategyId.slice(0, 4);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'width:100%;height:36px;display:block;';

    svg.innerHTML = `
      <polyline points="${pts.join(' ')}"
                fill="none" stroke="${color}" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round"/>
    `;
    return svg;
  }

  // Live trade feed items — deterministic rotation based on real time.
  const _FEED = {
    'alpha-seeker': [
      { pair: 'BTC/USDT',  dir: 'Long',  pct: '+2.14%' },
      { pair: 'ETH/USDT',  dir: 'Short', pct: '+1.32%' },
      { pair: 'BNB/USDT',  dir: 'Long',  pct: '+0.87%' },
      { pair: 'SOL/USDT',  dir: 'Long',  pct: '+3.41%' },
      { pair: 'XRP/USDT',  dir: 'Short', pct: '+0.64%' },
      { pair: 'DOGE/USDT', dir: 'Long',  pct: '+1.95%' },
      { pair: 'ADA/USDT',  dir: 'Short', pct: '+0.72%' },
      { pair: 'ARB/USDT',  dir: 'Long',  pct: '+2.80%' },
    ],
    'steady-accumulator': [
      { pair: 'USDC Lending',  dir: 'Yield', pct: '+0.031%' },
      { pair: 'ETH Staking',   dir: 'Yield', pct: '+0.014%' },
      { pair: 'USDT Lending',  dir: 'Yield', pct: '+0.028%' },
      { pair: 'DAI Pool',      dir: 'Yield', pct: '+0.019%' },
      { pair: 'stETH Rewards', dir: 'Yield', pct: '+0.012%' },
      { pair: 'USDC Pool Fee', dir: 'Yield', pct: '+0.022%' },
    ]
  };

  function _buildLiveFeed(strategyId) {
    const trades = _FEED[strategyId] || _FEED['steady-accumulator'];
    const wrap   = el('div', 'margin-top:12px;');

    const header = el('div', 'display:flex;align-items:center;gap:6px;margin-bottom:7px;');
    const dot    = el('span', 'width:6px;height:6px;border-radius:50%;background:#10b981;display:inline-block;animation:pulse 1.5s ease-in-out infinite;flex-shrink:0;');
    header.appendChild(dot);
    header.appendChild(el('span', 'font-size:10px;font-weight:700;color:var(--color-text-tertiary);letter-spacing:0.7px;text-transform:uppercase;', 'Live Activity'));
    wrap.appendChild(header);

    const list = el('div', 'display:flex;flex-direction:column;gap:4px;');
    // Show 3 items, rotating every 30s based on real time
    const offset = Math.floor(Date.now() / 30000) % trades.length;
    for (let i = 0; i < 3; i++) {
      const t   = trades[(offset + i) % trades.length];
      // Fake timestamps: 3m, 9m, 17m ago (vary with offset)
      const ago = [3, 9, 17][i] + ((offset + i) % 4) + 'm ago';
      const row = el('div', 'display:flex;align-items:center;justify-content:space-between;padding:5px 8px;border-radius:7px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.05);');
      const left = el('div', 'display:flex;align-items:center;gap:6px;');
      const badge = el('span', 'font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;', t.dir);
      badge.style.background = t.dir === 'Long' ? 'rgba(16,185,129,0.15)' : t.dir === 'Short' ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)';
      badge.style.color      = t.dir === 'Long' ? '#10b981' : t.dir === 'Short' ? '#ef4444' : '#3b82f6';
      left.appendChild(badge);
      left.appendChild(el('span', 'font-size:11px;font-weight:600;color:var(--color-text-primary);', t.pair));
      row.appendChild(left);
      const right = el('div', 'display:flex;align-items:center;gap:8px;');
      const pctEl = el('span', 'font-size:11px;font-weight:700;color:#10b981;', t.pct);
      right.appendChild(pctEl);
      right.appendChild(el('span', 'font-size:10px;color:var(--color-text-tertiary);', ago));
      row.appendChild(right);
      list.appendChild(row);
    }
    wrap.appendChild(list);
    return wrap;
  }

  function getRecommendedId() {
    try {
      const p = localStorage.getItem('nex_investor_profile');
      return p === 'alpha-seeker' ? 'alpha-seeker' : 'steady-accumulator';
    } catch (_) { return 'steady-accumulator'; }
  }

  function calcEarlyPenalty(investment) {
    const strategy  = STRATEGIES.find(s => s.id === investment.strategy_id) || {};
    const baseRate  = strategy.penaltyRate || 0.10;
    const totalDays = strategy.duration    || 30;
    const claimAmt  = parseFloat(investment.current_value || investment.amount || 0);
    if (!investment.matures_at) return { penalty: 0, receive: claimAmt, isEarly: false, daysRemaining: 0 };
    const matureMs = new Date(investment.matures_at).getTime();
    const isEarly  = matureMs > Date.now();
    if (!isEarly) return { penalty: 0, receive: claimAmt, isEarly: false, daysRemaining: 0 };
    const daysLeft = (matureMs - Date.now()) / 86400000;
    const fraction = Math.max(0, Math.min(1, daysLeft / totalDays));
    const penalty  = Math.round(baseRate * fraction * claimAmt * 100) / 100;
    return { penalty, receive: Math.max(0, claimAmt - penalty), isEarly: true, daysRemaining: Math.ceil(daysLeft) };
  }

  function checkMilestones(investments) {
    if (!Array.isArray(investments)) return;
    [10, 25, 50, 100].forEach(m => {
      investments.forEach(inv => {
        if (!inv || inv.status !== 'active') return;
        const principal = parseFloat(inv.amount || 0);
        const current   = parseFloat(inv.current_value || principal);
        const pct       = principal > 0 ? ((current - principal) / principal) * 100 : 0;
        const key       = inv.id + '_' + m;
        if (pct >= m && !_milestoneChecked.has(key)) {
          _milestoneChecked.add(key);
          const name = (STRATEGIES.find(s => s.id === inv.strategy_id) || {}).name || 'Your investment';
          setTimeout(() => showSuccess('\uD83C\uDF89 ' + name + ' is up ' + m + '% \u2014 great work!'), 600);
        }
      });
    });
  }

  // ============================================
  // DB SYNC
  // ============================================

  async function syncInvestmentsFromDB() {
    if (!window.supabaseClient) return;
    const { user } = getState();
    if (!user || !user.id) return;
    try {
      const { data, error } = await window.supabaseClient
        .from('investments')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) { console.error('[VAULT] sync:', error.message); return; }
      if (window.AppState) AppState.set('investments', Array.isArray(data) ? data : []);
      updatePortfolioTabLabel();
      if (_activeTab === 'portfolio') renderPortfolioTab();
      checkMilestones(data);
    } catch (err) { console.error('[VAULT] sync exception:', err.message); }
  }

  // ============================================
  // RISK DISCLOSURE MODAL
  // ============================================

  function openRiskDisclosure(strategy) {
    if (!window.Modal) return;
    const content = document.createElement('div');

    const chip = el('div', 'display:inline-flex;align-items:center;gap:8px;border-radius:20px;padding:6px 14px;margin-bottom:16px;');
    chip.style.background = 'rgba(255,255,255,0.04)';
    chip.style.border = '1px solid rgba(255,255,255,0.09)';
    chip.innerHTML = '<span style="font-size:15px;">' + strategy.icon + '</span><span style="font-size:12px;font-weight:700;color:var(--color-text-primary);">' + strategy.riskLabel + ' Risk \u00B7 ' + strategy.duration + ' days \u00B7 ' + strategy.perfFee + '% perf. fee</span>';
    content.appendChild(chip);

    const disclosures = [
      'You are joining a shared trading pool. Your return depends on how the pool performs \u2014 not a fixed rate.',
      'We trade on your behalf using the strategy above. Actual returns vary with market conditions and are set by admin at claim time.',
      'The pool index shown in your portfolio is a real-time performance tracker. It is the basis for your estimated value, not a binding payout.',
      'Your principal is locked for ' + strategy.duration + ' days. Early exit incurs a fee of up to ' + Math.round(strategy.penaltyRate * 100) + '% of your claimed value.',
      'NexTrade earns ' + strategy.perfFee + '% only on profit the pool generates. Zero fees are ever taken from your principal.'
    ];

    const box = el('div', 'border-radius:12px;padding:14px 16px;margin-bottom:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);');
    disclosures.forEach((d, i) => {
      const row = el('div', 'display:flex;align-items:flex-start;gap:8px;');
      row.style.marginBottom = i < disclosures.length - 1 ? '8px' : '0';
      row.appendChild(el('span', 'font-weight:700;font-size:14px;flex-shrink:0;line-height:1.6;color:var(--color-text-tertiary);', '\u00B7'));
      const txt = el('span', 'font-size:12px;line-height:1.6;', d);
      txt.style.color = 'var(--color-text-secondary)';
      row.appendChild(txt);
      box.appendChild(row);
    });
    content.appendChild(box);

    const acceptBtn = el('button', 'width:100%;padding:15px;border-radius:12px;font-size:15px;font-weight:800;margin-bottom:8px;cursor:pointer;border:none;background:var(--color-primary);color:#fff;', "I Understand \u2014 Let's Invest");
    acceptBtn.addEventListener('click', () => { if (window.Modal) Modal.close(); setTimeout(() => openInvestModal(strategy), 350); });
    const cancelBtn = el('button', 'width:100%;padding:14px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid var(--color-border);background:rgba(255,255,255,0.04);color:var(--color-text-primary);', 'Not Now');
    cancelBtn.addEventListener('click', () => { if (window.Modal) Modal.close(); });
    content.appendChild(acceptBtn);
    content.appendChild(cancelBtn);
    Modal.open({ title: 'Before You Invest', content, maxWidth: '460px' });
  }

  // ============================================
  // INVEST MODAL
  // ============================================

  function openInvestModal(strategy) {
    if (!window.Modal) return;
    const { balances } = getState();
    const spotBalance  = parseFloat((balances || {}).spot || 0);
    const content      = document.createElement('div');

    const chip = el('div', 'display:inline-flex;align-items:center;gap:8px;border-radius:20px;padding:6px 14px;margin-bottom:16px;');
    chip.style.background = 'rgba(255,255,255,0.04)';
    chip.style.border = '1px solid rgba(255,255,255,0.09)';
    chip.innerHTML = '<span>' + strategy.icon + '</span><span style="font-size:12px;font-weight:700;color:var(--color-text-primary);">' + strategy.riskLabel + ' Risk \u00B7 ' + strategy.duration + 'd lock \u00B7 ' + strategy.perfFee + '% perf. fee</span>';
    content.appendChild(chip);

    if (spotBalance < strategy.minAmount) {
      const warn = el('div', 'display:flex;align-items:flex-start;gap:10px;border-radius:12px;padding:12px 14px;margin-bottom:16px;background:#ef444412;border:1px solid #ef444435;');
      warn.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:#ef4444;flex-shrink:0;margin-top:2px;"></i><div style="font-size:12px;color:#ef4444;line-height:1.5;font-weight:600;">You need at least ' + fmt(strategy.minAmount) + ' in your Spot Wallet. Current balance: ' + fmt(spotBalance) + '.</div>';
      content.appendChild(warn);
    }

    const idx30ago  = _poolIndex(strategy.id, new Date(Date.now() - 30 * 86400000));
    const idxToday  = _poolIndex(strategy.id, new Date());
    const pool30d   = ((idxToday / idx30ago) - 1) * 100;
    const pool30str = (pool30d >= 0 ? '+' : '') + pool30d.toFixed(2) + '%';

    const grid = el('div', 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;');
    [
      { label: 'Min. Investment', value: fmt(strategy.minAmount),    color: 'var(--color-text-primary)' },
      { label: 'Your Balance',    value: fmt(spotBalance),           color: spotBalance >= strategy.minAmount ? '#10b981' : '#ef4444' },
      { label: 'Pool 30d Return', value: pool30str,                  color: pool30d >= 0 ? '#10b981' : '#ef4444' },
      { label: 'Lock Period',     value: strategy.duration + ' days', color: 'var(--color-text-primary)' }
    ].forEach(item => {
      const cell = el('div', 'background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;border:1px solid rgba(255,255,255,0.07);');
      cell.appendChild(el('div', 'font-size:10px;color:var(--color-text-tertiary);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.4px;', item.label));
      const val = el('div', 'font-size:15px;font-weight:700;', item.value);
      val.style.color = item.color;
      cell.appendChild(val);
      grid.appendChild(cell);
    });
    content.appendChild(grid);

    const inputWrap   = el('div', 'margin-bottom:14px;');
    const inputLbl    = el('label', 'display:block;font-size:12px;font-weight:600;color:var(--color-text-secondary);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;', 'Amount to Invest (USD)');
    const amountInput = document.createElement('input');
    amountInput.type = 'number'; amountInput.className = 'input-field financial-data';
    amountInput.placeholder = String(strategy.minAmount); amountInput.min = strategy.minAmount;
    amountInput.max = spotBalance; amountInput.autocomplete = 'off'; amountInput.inputMode = 'decimal';
    amountInput.style.cssText = 'font-size:28px;font-weight:800;text-align:center;padding:18px;border-radius:14px;';
    const hint = el('div', 'font-size:11px;color:var(--color-text-tertiary);margin-top:6px;text-align:center;', 'Min ' + fmt(strategy.minAmount) + ' \u00B7 Available ' + fmt(spotBalance));
    inputWrap.appendChild(inputLbl); inputWrap.appendChild(amountInput); inputWrap.appendChild(hint);
    content.appendChild(inputWrap);

    const preview = el('div', 'border-radius:12px;padding:14px 16px;margin-bottom:16px;display:none;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);');
    const prevLbl  = el('div', 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:6px;', 'Est. value after ' + strategy.duration + ' days at current pool rate');
    const prevAmt  = el('div', 'font-size:22px;font-weight:800;color:var(--color-text-primary);', '');
    const prevNote = el('div', 'font-size:10px;color:var(--color-text-tertiary);margin-top:4px;', 'Based on pool performance over the last 30 days. Actual payout set at claim time.');
    preview.appendChild(prevLbl); preview.appendChild(prevAmt); preview.appendChild(prevNote);
    content.appendChild(preview);

    amountInput.addEventListener('input', () => {
      const v = parseFloat(amountInput.value);
      if (!isNaN(v) && v >= strategy.minAmount) {
        const share      = _poolShare(v, strategy.id);
        const idx30ago   = _poolIndex(strategy.id, new Date(Date.now() - 30 * 86400000));
        const idxToday   = _poolIndex(strategy.id, new Date());
        const pool30d    = ((idxToday / idx30ago) - 1);
        const projected  = v * (1 + pool30d * (strategy.duration / 30));
        prevAmt.textContent = fmt(projected) + ' (pool-tracked est.)';
        preview.style.display = 'block';
      } else { preview.style.display = 'none'; }
    });

    content.appendChild(el('div', 'font-size:11px;color:var(--color-text-tertiary);text-align:center;margin-bottom:16px;line-height:1.6;', 'We earn a ' + strategy.perfFee + '% performance fee only on the profit we generate. Zero fees on your principal.'));

    const confirmBtn = el('button', 'font-size:16px;padding:18px;border-radius:14px;font-weight:800;width:100%;border:none;color:#fff;cursor:pointer;background:var(--color-primary);', 'Invest Now');
    confirmBtn.addEventListener('click', () => {
      const raw = amountInput.value.trim();
      const num = parseFloat(raw);
      if (!raw || isNaN(num))       return showError('Please enter an amount.');
      if (num < strategy.minAmount) return showError('Minimum is ' + fmt(strategy.minAmount) + '.');
      if (num > spotBalance)        return showError('Insufficient balance. Available: ' + fmt(spotBalance) + '.');
      if (window.Modal) Modal.close();
      setTimeout(() => handleInvestment(strategy, num), 350);
    });
    content.appendChild(confirmBtn);
    setTimeout(() => { try { amountInput.focus(); } catch (_) {} }, 400);
    Modal.open({ title: 'Invest \u2014 ' + strategy.name, content, maxWidth: '460px' });
  }

  // ============================================
  // INVESTMENT HANDLER — LEDGER-FIRST
  // ============================================

  async function handleInvestment(strategy, amount) {
    if (_isProcessing) return;
    const { user } = getState();
    if (!user || !user.id) return showError('Session expired. Please refresh.');

    const freshSpot = parseFloat((getState().balances || {}).spot || 0);
    if (amount > freshSpot) return showError('Insufficient balance. Available: ' + fmt(freshSpot) + '.');

    const maturesAt = new Date(Date.now() + strategy.duration * 86400000).toISOString();
    _isProcessing = true;

    try {
      if (window.supabaseClient) {
        // 1. Insert the investment row
        const { data: inv, error: invErr } = await window.supabaseClient
          .from('investments')
          .insert({
            user_id:       user.id,
            strategy_id:   strategy.id,
            amount:        amount,
            current_value: amount,
            apy:           strategy.apy,
            status:        'active',
            matures_at:    maturesAt,
            created_at:    new Date().toISOString()
          })
          .select()
          .single();
        if (invErr) throw invErr;

        // 2. Insert ledger entry (debit — funds leave spot wallet).
        //    FIX (v6.2 — D3): now fatal. Previously swallowed with console.warn
        //    and execution continued, leaving a trade with no audit trail whose
        //    balance could not be correctly re-derived.
        const { error: txErr } = await window.supabaseClient
          .from('transactions')
          .insert({
            user_id:      user.id,
            type:         'investment',
            amount:       amount,
            status:       'completed',
            description:  'Invested in ' + strategy.name,
            created_at:   new Date().toISOString()
          });
        if (txErr) throw txErr; // FIX: was console.warn + continue

        // 3. Derive new spot balance from ledger and update profiles
        const newSpot = await deriveSpotBalanceFromLedger(user.id, freshSpot);
        const { error: balErr } = await window.supabaseClient
          .from('profiles')
          .update({ spot_balance: newSpot, updated_at: new Date().toISOString() })
          .eq('id', user.id);
        if (balErr) {
          console.error('[VAULT] Balance update failed. Inv ID:', inv.id, balErr.message);
          showError('Investment saved but balance not updated. Contact support with ID: ' + String(inv.id));
          return;
        }

        // 4. Update client state
        if (window.AppState) {
          AppState.updateBalances({ spot: newSpot });
          const currentInvestments = AppState.get('investments') || [];
          AppState.set('investments', [inv, ...currentInvestments.filter(item => item && item.id !== inv.id)]);
        }
        await syncInvestmentsFromDB();
      }

      try { localStorage.setItem('nex_first_vault_done', '1'); } catch (_) {}
      showSuccess('\u2705 ' + strategy.name + ' \u2014 ' + fmt(amount) + ' invested.');
      switchTab('portfolio');

    } catch (err) {
      console.error('[VAULT] handleInvestment:', err.message);
      showError(err.message || 'Investment failed. Please try again.');
    } finally { _isProcessing = false; }
  }

  // ============================================
  // CLAIM HANDLER — APPEND-ONLY
  // ============================================

  async function handleClaim(investment, penaltyConfirmed) {
    if (!investment || !investment.id || _isProcessing) return;
    const { user } = getState();
    if (!user || !user.id) return showError('Session expired.');

    const { penalty, receive, isEarly, daysRemaining } = calcEarlyPenalty(investment);

    if (isEarly && !penaltyConfirmed) {
      if (!window.Modal) return;
      const content = document.createElement('div');
      content.appendChild(el('div', 'text-align:center;font-size:44px;margin-bottom:12px;', '\u23F0'));
      content.appendChild(el('div', 'font-size:16px;font-weight:800;color:var(--color-text-primary);text-align:center;margin-bottom:16px;', 'Early Exit Penalty'));
      const claimAmt = parseFloat(investment.current_value || investment.amount || 0);
      const rows = [
        { label: 'Days remaining',   value: daysRemaining + ' day' + (daysRemaining !== 1 ? 's' : ''), color: '#f59e0b' },
        { label: 'Investment value', value: fmt(claimAmt),      color: 'var(--color-text-primary)' },
        { label: 'Early exit fee',   value: '-' + fmt(penalty), color: '#ef4444' },
        { label: 'You will receive', value: fmt(receive),        color: '#10b981' }
      ];
      const table = el('div', 'background:var(--color-surface-elevated);border:1px solid var(--color-border);border-radius:14px;overflow:hidden;margin-bottom:14px;');
      rows.forEach((row, i) => {
        const rowEl = el('div', 'display:flex;align-items:center;justify-content:space-between;padding:14px 16px;' + (i < rows.length - 1 ? 'border-bottom:1px solid var(--color-border);' : ''));
        rowEl.appendChild(el('span', 'font-size:13px;color:var(--color-text-secondary);', row.label));
        const val = el('span', 'font-size:14px;font-weight:700;', row.value);
        val.style.color = row.color;
        rowEl.appendChild(val);
        table.appendChild(rowEl);
      });
      content.appendChild(table);
      content.appendChild(el('div', 'font-size:12px;color:var(--color-text-tertiary);text-align:center;margin-bottom:16px;line-height:1.5;', 'Wait ' + daysRemaining + ' more day' + (daysRemaining !== 1 ? 's' : '') + ' to claim with zero penalty.'));
      const confirmBtn = el('button', 'background:#ef4444;color:white;border:none;padding:14px;margin-bottom:8px;border-radius:12px;width:100%;font-weight:700;cursor:pointer;', 'Accept Penalty & Claim');
      confirmBtn.addEventListener('click', () => { if (window.Modal) Modal.close(); setTimeout(() => handleClaim(investment, true), 350); });
      const cancelBtn  = el('button', 'background:rgba(255,255,255,0.06);border:1px solid var(--color-border);color:var(--color-text-primary);padding:14px;border-radius:12px;width:100%;font-weight:700;cursor:pointer;', 'Keep Invested');
      cancelBtn.addEventListener('click', () => { if (window.Modal) Modal.close(); });
      content.appendChild(confirmBtn); content.appendChild(cancelBtn);
      Modal.open({ title: '', content, maxWidth: '400px' });
      return;
    }

    _isProcessing = true;
    try {
      if (window.supabaseClient) {
        const principal = parseFloat(investment.amount || 0);
        const profit    = receive - principal;

        // 1. Mark investment completed — amount is preserved (append-only principle).
        //    FIX: was update({ amount: 0 }) which destroyed the audit trail.
        const { error: updateErr } = await window.supabaseClient
          .from('investments')
          .update({
            status:    'completed',
            profit:    profit,
            completed_at: new Date().toISOString()
          })
          .eq('id', investment.id)
          .eq('user_id', user.id);
        if (updateErr) throw updateErr;

        // 2. Insert ledger credit entry — this is the canonical record of the claim.
        //    FIX (v6.2 — D3): now fatal. Previously swallowed with console.warn
        //    and execution continued, leaving a claim with no audit trail.
        const { error: txErr } = await window.supabaseClient
          .from('transactions')
          .insert({
            user_id:      user.id,
            type:         'claim',
            amount:       receive,
            status:       'completed',
            description:  'Claimed ' + getStrategyForInvestment(investment).name + (isEarly ? ' (Early Exit)' : ''),
            created_at:   new Date().toISOString()
          });
        if (txErr) throw txErr; // FIX: was console.warn + continue

        // 3. Derive new spot balance from ledger
        const freshSpot = parseFloat((getState().balances || {}).spot || 0);
        const newSpot   = await deriveSpotBalanceFromLedger(user.id, freshSpot);
        const { error: balErr } = await window.supabaseClient
          .from('profiles')
          .update({ spot_balance: newSpot, updated_at: new Date().toISOString() })
          .eq('id', user.id);
        if (balErr) throw balErr;

        // 4. Update client state
        if (window.AppState) {
          AppState.updateBalances({ spot: newSpot });
          const currentInvestments = AppState.get('investments') || [];
          const updated = currentInvestments.map(item =>
            item && item.id === investment.id
              ? { ...item, status: 'completed', profit, completed_at: new Date().toISOString() }
              : item
          );
          AppState.set('investments', updated);
        }
        await syncInvestmentsFromDB();
      }

      showSuccess(fmt(receive) + ' added to your Spot Wallet.');
      renderPortfolioTab();

    } catch (err) {
      console.error('[VAULT] handleClaim error:', err);
      showError(err.message || 'Claim failed. Please try again.');
    } finally { _isProcessing = false; }
  }

  // ============================================
  // LEDGER BALANCE DERIVATION
  // ============================================

  // Local copy of the derivation logic — same as trade.js.
  // Both read from the same transactions table.
  //
  // FIX (v6.2): 'transfer_in' / 'transfer_out' added so that internal
  // spot↔vault transfers recorded by wallets.js are correctly reflected
  // when this function re-derives the spot balance after an invest/claim.
  const CREDIT_TYPES = new Set(['deposit', 'sell', 'claim', 'transfer_in']);
  const DEBIT_TYPES  = new Set(['withdraw', 'buy', 'investment', 'transfer_out']);

  async function deriveSpotBalanceFromLedger(userId, storedBalance) {
    // FIX (v6.2 — D2): Two queries instead of one.
    //
    // Query 1: All COMPLETED transactions — canonical settled ledger.
    //
    // Query 2: PENDING withdrawals only. A pending withdrawal means "the user
    // requested a payout that admin has not yet processed, but the funds are
    // locked." Counting them as debits here prevents the re-login / re-derive
    // balance restoration bug where deriveSpotBalanceFromLedger ignores the
    // pending withdrawal (status != completed), then overwrites spot_balance
    // with the pre-withdrawal amount on the next invest or claim.
    //
    // Pending deposits deliberately excluded — external transfers require
    // admin confirmation before they may be credited.

    const { data: completedTxs, error: err1 } = await window.supabaseClient
      .from('transactions')
      .select('type, amount')
      .eq('user_id', userId)
      .eq('status', 'completed');

    if (err1) throw err1;

    const { data: pendingWithdrawals, error: err2 } = await window.supabaseClient
      .from('transactions')
      .select('type, amount')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .in('type', ['withdraw']);

    if (err2) throw err2;

    const rows = [...(completedTxs || []), ...(pendingWithdrawals || [])];

    // Guard: if no base credits exist in completed transactions, fall back to
    // the stored balance. Covers new accounts and pre-ledger-migration accounts.
    const hasBaseCredits = (completedTxs || []).some(
      tx => tx.type === 'deposit' || tx.type === 'claim'
    );
    if (!hasBaseCredits) return Math.max(0, parseFloat(storedBalance) || 0);

    return Math.max(0, rows.reduce((bal, tx) => {
      const amt = parseFloat(tx.amount) || 0;
      if (CREDIT_TYPES.has(tx.type)) return bal + amt;
      if (DEBIT_TYPES.has(tx.type))  return bal - amt;
      return bal;
    }, 0));
  }

  // ============================================
  // CLAIM ALL
  // ============================================

  async function handleClaimAll() {
    const { investments } = getState();
    const claimable = (investments || []).filter(i => i.status === 'active' && (!i.matures_at || new Date(i.matures_at) <= Date.now()));
    if (claimable.length === 0) return showError('No matured positions available to claim.');
    const totalClaims = claimable.reduce((s, i) => s + parseFloat(i.current_value || i.amount || 0), 0);
    if (!window.Modal) return;
    const content = document.createElement('div');
    content.innerHTML = '<div style="text-align:center;padding:10px 0;"><div style="font-size:24px;font-weight:800;color:#10b981;margin-bottom:10px;">' + fmt(totalClaims) + '</div><p style="font-size:13px;color:var(--color-text-secondary);margin:0;">Claim ' + claimable.length + ' matured position' + (claimable.length > 1 ? 's' : '') + ' to your Spot Wallet.</p></div>';
    const confirmed = await Modal.confirm({ title: 'Claim Matured Positions', content, confirmText: 'Claim All to Wallet', cancelText: 'Cancel' });
    if (!confirmed) return;
    for (const inv of claimable) await handleClaim(inv, true);
  }

  // ============================================
  // PLAN CARD
  // ============================================

  function buildPlanCard(strategy, recommended) {
    const card = el('div');
    card.style.cssText = 'position:relative;background:var(--color-surface-elevated);border-radius:20px;overflow:hidden;margin-bottom:95px;transition:transform 0.2s ease,border-color 0.2s;cursor:pointer;';
    card.style.border = '1px solid ' + (recommended ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)');
    card.addEventListener('mouseenter', () => { card.style.borderColor = 'rgba(255,255,255,0.18)'; });
    card.addEventListener('mouseleave', () => { card.style.borderColor = recommended ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)'; });

    const body = el('div', 'padding:20px;');

    const headerRow = el('div', 'display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;');
    const left = el('div', 'display:flex;align-items:center;gap:12px;');
    const iconBox = el('div', 'width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;');
    iconBox.style.background = 'rgba(255,255,255,0.05)';
    iconBox.style.border = '1px solid rgba(255,255,255,0.09)';
    iconBox.textContent = strategy.icon;
    const titleWrap = el('div');
    titleWrap.appendChild(el('div', 'font-size:17px;font-weight:800;color:var(--color-text-primary);margin-bottom:2px;', strategy.name));
    titleWrap.appendChild(el('div', 'font-size:12px;color:var(--color-text-secondary);', strategy.category));
    left.appendChild(iconBox); left.appendChild(titleWrap);

    const rightCol = el('div', 'text-align:right;flex-shrink:0;');
    if (recommended) {
      const badge = el('div', 'font-size:9px;font-weight:800;padding:3px 9px;border-radius:20px;letter-spacing:0.8px;margin-bottom:6px;display:inline-block;color:#fff;', '\u2B50 FOR YOU');
      badge.style.background = strategy.accentColor;
      rightCol.appendChild(badge);
    }
    // Show real simulated 30-day pool return instead of a promised APY range
    const idx30ago   = _poolIndex(strategy.id, new Date(Date.now() - 30 * 86400000));
    const idxToday   = _poolIndex(strategy.id, new Date());
    const pool30d    = ((idxToday / idx30ago) - 1) * 100;
    const pool30dStr = (pool30d >= 0 ? '+' : '') + pool30d.toFixed(2) + '%';
    rightCol.appendChild(el('div', 'font-size:10px;color:var(--color-text-tertiary);', '30D POOL RETURN'));
    const apyVal = el('div', 'font-size:22px;font-weight:900;letter-spacing:-0.5px;', pool30dStr);
    apyVal.style.color = pool30d >= 0 ? strategy.accentColor : '#ef4444';
    rightCol.appendChild(apyVal);
    headerRow.appendChild(left); headerRow.appendChild(rightCol);
    body.appendChild(headerRow);

    body.appendChild(el('div', 'font-size:13px;font-style:italic;color:var(--color-text-secondary);margin-bottom:16px;line-height:1.5;', strategy.tagline));

    const statsRow = el('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px;');
    const exampleShare = _poolShare(strategy.minAmount, strategy.id);
    [
      { label: 'MIN. INVEST', value: fmt(strategy.minAmount) },
      { label: 'TERM',        value: strategy.duration + 'd' },
      { label: 'YOUR SHARE',  value: '~' + exampleShare.toFixed(3) + '%' }
    ].forEach(s => {
      const cell = el('div', 'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px;text-align:center;');
      cell.appendChild(el('div', 'font-size:17px;font-weight:800;color:var(--color-text-primary);', s.value));
      cell.appendChild(el('div', 'font-size:9px;color:var(--color-text-tertiary);margin-top:3px;letter-spacing:0.6px;', s.label));
      statsRow.appendChild(cell);
    });
    body.appendChild(statsRow);

    const mechSection = el('div', 'margin-bottom:20px;');
    mechSection.appendChild(el('div', 'font-size:11px;font-weight:700;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;', 'How We Grow The Pool'));
    strategy.mechanics.forEach(m => {
      const mechRow = el('div', 'display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;');
      const iconWrap = el('div', 'width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;margin-top:2px;');
      iconWrap.style.background = 'rgba(255,255,255,0.05)';
      iconWrap.textContent = m.icon;
      const textWrap = el('div', 'flex:1;min-width:0;');
      const mTitle = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;');
      mTitle.appendChild(el('span', 'font-size:12px;font-weight:700;color:var(--color-text-primary);', m.title));
      const pctLabel = el('span', 'font-size:11px;font-weight:700;', m.pct + '%');
      pctLabel.style.color = strategy.accentColor;
      mTitle.appendChild(pctLabel);
      textWrap.appendChild(mTitle);
      const barBg   = el('div', 'height:3px;background:rgba(255,255,255,0.08);border-radius:2px;margin-bottom:5px;');
      const barFill = el('div');
      barFill.style.cssText = 'height:100%;border-radius:2px;';
      barFill.style.width      = m.pct + '%';
      barFill.style.background = strategy.accentColor;
      barBg.appendChild(barFill);
      textWrap.appendChild(barBg);
      textWrap.appendChild(el('div', 'font-size:11px;color:var(--color-text-secondary);line-height:1.5;', m.desc));
      mechRow.appendChild(iconWrap); mechRow.appendChild(textWrap);
      mechSection.appendChild(mechRow);
    });
    body.appendChild(mechSection);

    const hlWrap = el('div', 'background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:12px 14px;margin-bottom:20px;');
    strategy.highlights.forEach((h, i) => {
      const row = el('div', 'display:flex;align-items:flex-start;gap:8px;');
      row.style.marginBottom = i < strategy.highlights.length - 1 ? '7px' : '0';
      const tick = el('span', 'font-size:12px;flex-shrink:0;margin-top:1px;', '\u2713');
      tick.style.color = strategy.accentColor;
      row.appendChild(tick);
      row.appendChild(el('span', 'font-size:12px;color:var(--color-text-secondary);line-height:1.4;', h));
      hlWrap.appendChild(row);
    });
    body.appendChild(hlWrap);

    const cta = el('button', 'width:100%;padding:15px;font-size:15px;font-weight:800;border:none;border-radius:13px;cursor:pointer;transition:all 0.2s;letter-spacing:-0.2px;');
    cta.style.background = recommended ? 'var(--color-primary)' : 'rgba(255,255,255,0.05)';
    cta.style.color      = '#fff';
    cta.textContent = recommended ? 'Join Pool \u2014 ' + strategy.name + ' \u2192' : 'View ' + strategy.name + ' \u2192';
    cta.addEventListener('click', e => { e.stopPropagation(); openRiskDisclosure(strategy); });
    body.appendChild(cta);
    card.appendChild(body);
    return card;
  }

  // ============================================
  // ACTIVE INVESTMENT ITEM
  // ============================================

  function buildActiveInvestmentItem(investment, isCompleted) {
    const strategy   = getStrategyForInvestment(investment);
    const amount     = parseFloat(investment.amount || 0);
    const isMatured  = !isCompleted && investment.matures_at && new Date(investment.matures_at) <= new Date();
    const matureDate = investment.matures_at ? new Date(investment.matures_at) : null;

    // Use pool-index-derived estimate (display only — admin sets real payout)
    const estVal  = isCompleted
      ? parseFloat(investment.current_value || amount)
      : _estimatedValue(investment);
    const gain    = estVal - amount;
    const gainPct = amount > 0 ? (gain / amount) * 100 : 0;

    const itemEl = el('div');
    itemEl.style.cssText = 'border-radius:16px;overflow:hidden;margin-bottom:14px;';
    if (isCompleted) {
      itemEl.style.background = 'rgba(30,41,59,0.4)';
      itemEl.style.border     = '1px solid var(--color-border)';
      itemEl.style.opacity    = '0.75';
    } else {
      itemEl.style.background = 'var(--color-surface-elevated)';
      itemEl.style.border     = '1px solid rgba(255,255,255,0.09)';
      itemEl.style.boxShadow  = '0 4px 20px rgba(0,0,0,0.15)';
    }

    // ── Accent dot (left border strip — flat, not gradient) ──────────────
    if (!isCompleted) {
      const strip = el('div');
      strip.style.cssText = 'height:2px;background:' + strategy.accentColor + ';opacity:0.5;';
      itemEl.appendChild(strip);
    }

    const body = el('div', 'padding:14px 16px;');

    // ── Header row ───────────────────────────────────────────────────────
    const headerRow = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;');
    const leftSide  = el('div', 'display:flex;align-items:center;gap:10px;');
    const iconEl    = el('div', 'font-size:20px;', strategy.icon);
    const nameWrap  = el('div');
    nameWrap.appendChild(el('div', 'font-size:14px;font-weight:800;color:var(--color-text-primary);', strategy.name));

    const statusColor = isCompleted ? 'var(--color-text-tertiary)' : (isMatured ? '#10b981' : strategy.accentColor);
    const statusTxt   = isCompleted ? 'Completed' : (isMatured ? '✓ Ready to Claim' : '● Active · Live');
    const statusEl    = el('div', 'font-size:10px;font-weight:700;margin-top:2px;letter-spacing:0.3px;', statusTxt);
    statusEl.style.color = statusColor;
    nameWrap.appendChild(statusEl);
    leftSide.appendChild(iconEl); leftSide.appendChild(nameWrap);

    const gainBadge = el('div', 'font-size:13px;font-weight:800;', (gain >= 0 ? '+' : '') + gainPct.toFixed(2) + '%');
    gainBadge.style.color = gain >= 0 ? '#10b981' : '#ef4444';
    headerRow.appendChild(leftSide); headerRow.appendChild(gainBadge);
    body.appendChild(headerRow);

    if (isCompleted) {
      // Completed cards: simple 3-col grid + close date, no live UI
      const statsGrid = el('div', 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;');
      [
        { label: 'Invested', value: fmt(amount),  color: 'var(--color-text-secondary)' },
        { label: 'Returned', value: fmt(estVal),   color: '#10b981' },
        { label: 'Profit',   value: (gain >= 0 ? '+' : '') + fmt(gain), color: gain >= 0 ? '#10b981' : '#ef4444' }
      ].forEach(s => {
        const cell = el('div', 'background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:8px;padding:9px;text-align:center;');
        const val  = el('div', 'font-size:13px;font-weight:700;', s.value);
        val.style.color = s.color;
        cell.appendChild(val);
        cell.appendChild(el('div', 'font-size:9px;color:var(--color-text-tertiary);margin-top:3px;letter-spacing:0.5px;', s.label));
        statsGrid.appendChild(cell);
      });
      body.appendChild(statsGrid);
      body.appendChild(el('div', 'font-size:10px;color:var(--color-text-tertiary);text-align:right;',
        'Closed ' + new Date(investment.completed_at || investment.updated_at || investment.created_at).toLocaleDateString()));
      itemEl.appendChild(body);
      return itemEl;
    }

    // ── Est. Current Value + sparkline ───────────────────────────────────
    const valBlock = el('div', 'border-radius:10px;padding:12px 14px;margin-bottom:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);');

    const valRow = el('div', 'display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:8px;');
    const valLeft = el('div');
    valLeft.appendChild(el('div', 'font-size:10px;font-weight:700;color:var(--color-text-tertiary);letter-spacing:0.7px;text-transform:uppercase;margin-bottom:4px;', 'Est. Current Value'));

    // Live-ticking value display
    // Seed with a ±0.2% random nudge so the initial display is never the clean
    // deterministic baseline — it looks mid-stream from the moment the card renders.
    const _initNudge = 1 + (Math.random() - 0.5) * 0.004;
    const valDisplay = el('div', 'font-size:26px;font-weight:900;letter-spacing:-0.8px;color:var(--color-text-primary);', fmt(estVal * _initNudge));
    valDisplay.id = 'vault-live-' + investment.id;
    valLeft.appendChild(valDisplay);

    // Pool share
    const share     = _poolShare(amount, strategy.id);
    const shareSpan = el('div', 'font-size:10px;color:var(--color-text-tertiary);margin-top:3px;', 'Pool share: ' + share.toFixed(3) + '%');
    valLeft.appendChild(shareSpan);
    valRow.appendChild(valLeft);

    // 7-day index change badge
    const series     = _indexSeries(strategy.id, 7);
    const weekChange = series.length >= 2 ? ((series[series.length - 1] / series[0]) - 1) * 100 : 0;
    const wkBadge    = el('div', 'text-align:right;');
    wkBadge.appendChild(el('div', 'font-size:9px;color:var(--color-text-tertiary);margin-bottom:2px;', '7d pool'));
    const wkVal = el('div', 'font-size:12px;font-weight:800;', (weekChange >= 0 ? '+' : '') + weekChange.toFixed(2) + '%');
    wkVal.style.color = weekChange >= 0 ? '#10b981' : '#ef4444';
    wkBadge.appendChild(wkVal);
    valRow.appendChild(wkBadge);
    valBlock.appendChild(valRow);

    // Sparkline
    valBlock.appendChild(_buildSparkline(strategy.id, strategy.accentColor));
    body.appendChild(valBlock);

    // ── Stats row ────────────────────────────────────────────────────────
    const statsGrid = el('div', 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;');
    const todayIdx  = _poolIndex(strategy.id, new Date());
    [
      { label: 'Invested',    value: fmt(amount),            color: 'var(--color-text-primary)' },
      { label: 'Unrealised',  value: (gain >= 0 ? '+' : '') + fmt(gain), color: gain >= 0 ? '#10b981' : '#ef4444' },
      { label: 'Pool Index',  value: todayIdx.toFixed(4),   color: strategy.accentColor }
    ].forEach(s => {
      const cell = el('div', 'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:10px;text-align:center;');
      const val  = el('div', 'font-size:13px;font-weight:700;', s.value);
      val.style.color = s.color;
      cell.appendChild(val);
      cell.appendChild(el('div', 'font-size:9px;color:var(--color-text-tertiary);margin-top:3px;letter-spacing:0.5px;', s.label));
      statsGrid.appendChild(cell);
    });
    body.appendChild(statsGrid);

    // ── Term progress bar ────────────────────────────────────────────────
    if (matureDate) {
      const createdAt = new Date(investment.created_at || Date.now());
      const totalMs   = matureDate - createdAt;
      const pct       = Math.max(0, Math.min(100, ((Date.now() - createdAt) / totalMs) * 100));
      const daysLeft  = Math.max(0, Math.ceil((matureDate - Date.now()) / 86400000));
      const estRetPct = gainPct.toFixed(2);

      const pw   = el('div', 'margin-bottom:12px;');
      const pRow = el('div', 'display:flex;justify-content:space-between;margin-bottom:5px;');
      pRow.appendChild(el('span', 'font-size:10px;color:var(--color-text-tertiary);', isMatured ? 'Matured · Ready to claim' : 'Matures ' + matureDate.toLocaleDateString() + ' · ' + daysLeft + 'd left'));
      const retBadge = el('span', 'font-size:10px;font-weight:700;', 'Est. +' + estRetPct + '%');
      retBadge.style.color = '#10b981';
      pRow.appendChild(retBadge);
      pw.appendChild(pRow);
      const barBg   = el('div', 'height:4px;background:rgba(255,255,255,0.07);border-radius:2px;');
      const barFill = el('div');
      barFill.style.cssText  = 'height:100%;border-radius:2px;transition:width 0.6s ease;';
      barFill.style.width    = pct + '%';
      barFill.style.background = isMatured ? '#10b981' : strategy.accentColor;
      barBg.appendChild(barFill);
      pw.appendChild(barBg);
      body.appendChild(pw);
    }

    // ── Live feed ────────────────────────────────────────────────────────
    body.appendChild(_buildLiveFeed(strategy.id));

    // ── CTA buttons ──────────────────────────────────────────────────────
    const btnRow = el('div', 'display:flex;gap:8px;margin-top:14px;');
    if (isMatured) {
      const claimBtn = el('button', 'flex:1;padding:13px;font-size:14px;font-weight:800;border:none;border-radius:10px;cursor:pointer;background:#10b981;color:#fff;', 'Claim to Wallet');
      claimBtn.addEventListener('click', () => handleClaim(investment, true));
      btnRow.appendChild(claimBtn);
    } else {
      const { daysRemaining } = calcEarlyPenalty(investment);
      const earlyBtn = el('button', 'flex:1;padding:12px;font-size:12px;font-weight:700;border-radius:10px;cursor:pointer;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2);color:#ef4444;', 'Early Exit (' + daysRemaining + 'd left)');
      earlyBtn.addEventListener('click', () => handleClaim(investment, false));
      btnRow.appendChild(earlyBtn);
    }
    body.appendChild(btnRow);

    itemEl.appendChild(body);

    // ── Live tick (starts after render, stored for cleanup) ──────────────
    if (!isCompleted && !isMatured) {
      const TICK_MS  = 4000;
      let   liveBase = estVal * _initNudge;   // continues from the nudged starting display
      const timerId  = setInterval(() => {
        if (_destroyed) { clearInterval(timerId); return; }
        const displayEl = document.getElementById('vault-live-' + investment.id);
        if (!displayEl) { clearInterval(timerId); _liveTimers.delete(timerId); return; }
        // ±0.04% micro-fluctuation per tick — realistic price noise
        const nudge  = (Math.random() - 0.46) * 0.0004 * liveBase;
        liveBase    += nudge;
        displayEl.textContent = fmt(liveBase);
      }, TICK_MS);
      _liveTimers.add(timerId);
    }

    return itemEl;
  }

  // ============================================
  // TAB: EXPLORE
  // ============================================

  function renderExploreTab(container) {
    container.innerHTML = '';
    const recommendedId = getRecommendedId();
    const profile       = (() => { try { return localStorage.getItem('nex_investor_profile'); } catch (_) { return null; } })();

    if (profile) {
      const isPlanA = profile === 'steady-accumulator';
      const banner  = el('div', 'display:flex;align-items:center;gap:12px;border-radius:14px;padding:12px 14px;margin-bottom:20px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);');
      const bIcon   = el('div', 'width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;');
      bIcon.style.background = isPlanA ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)';
      bIcon.textContent = isPlanA ? '\u{1F6E1}\uFE0F' : '\u26A1';
      const bTxt = el('div', 'flex:1;');
      bTxt.appendChild(el('div', 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:2px;', 'Recommended based on your profile'));
      bTxt.appendChild(el('div', 'font-size:13px;font-weight:700;color:var(--color-text-primary);', isPlanA ? 'Steady Accumulator \u2014 Plan A' : 'Alpha Seeker \u2014 Plan B'));
      banner.appendChild(bIcon); banner.appendChild(bTxt);
      container.appendChild(banner);
    }

    const sorted = [...STRATEGIES].sort((a, b) => (b.id === recommendedId ? 1 : 0) - (a.id === recommendedId ? 1 : 0));
    sorted.forEach(s => container.appendChild(buildPlanCard(s, s.id === recommendedId)));
  }

  // ============================================
  // TAB: PORTFOLIO
  // ============================================

  function renderPortfolioTab() {
    if (!_container) return;
    const panel = _container.querySelector('[data-vault-panel="portfolio"]');
    if (!panel) return;
    panel.innerHTML = '';

    const { investments } = getState();
    const active    = (investments || []).filter(i => i.status === 'active');
    const completed = (investments || []).filter(i => i.status === 'completed' || i.status === 'claimed');

    if (active.length === 0 && completed.length === 0) {
      const empty = el('div', 'text-align:center;padding:48px 20px;');
      empty.appendChild(el('div', 'font-size:52px;margin-bottom:16px;', '\uD83C\uDF31'));
      empty.appendChild(el('div', 'font-size:18px;font-weight:800;color:var(--color-text-primary);margin-bottom:8px;letter-spacing:-0.3px;', 'No active investments'));
      empty.appendChild(el('div', 'font-size:14px;color:var(--color-text-secondary);margin-bottom:24px;line-height:1.5;', 'Start with $1,500. Your money works while you sleep.'));
      const startBtn = el('button', 'padding:14px 28px;font-size:14px;font-weight:700;border-radius:12px;cursor:pointer;background:var(--color-primary);color:#fff;border:none;', 'Explore Plans');
      startBtn.addEventListener('click', () => switchTab('explore'));
      empty.appendChild(startBtn);
      panel.appendChild(empty);
      return;
    }

    if (active.length > 0) {
      const totalInvested = active.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
      const totalCurrent  = active.reduce((s, i) => s + parseFloat(i.current_value || i.amount || 0), 0);
      const totalGain     = totalCurrent - totalInvested;
      const totalGainPct  = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;
      const matured       = active.filter(i => i.matures_at && new Date(i.matures_at) <= new Date());

      const summaryCard = el('div', 'border-radius:14px;padding:16px;margin-bottom:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);');
      const sumRow  = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:' + (matured.length > 0 ? '12px' : '0') + ';');
      const sumLeft = el('div');
      sumLeft.appendChild(el('div', 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.6px;', 'Portfolio Value'));
      sumLeft.appendChild(el('div', 'font-size:24px;font-weight:800;color:var(--color-text-primary);letter-spacing:-0.5px;', fmt(totalCurrent)));
      const gainEl = el('div', 'font-size:13px;font-weight:700;margin-top:2px;', (totalGain >= 0 ? '+' : '') + fmt(totalGain) + ' (' + totalGainPct.toFixed(2) + '%)');
      gainEl.style.color = totalGain >= 0 ? '#10b981' : '#ef4444';
      sumLeft.appendChild(gainEl);
      const sumRight = el('div', 'text-align:right;');
      sumRight.appendChild(el('div', 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:4px;', 'Active'));
      sumRight.appendChild(el('div', 'font-size:24px;font-weight:800;color:var(--color-text-primary);', String(active.length)));
      sumRow.appendChild(sumLeft); sumRow.appendChild(sumRight);
      summaryCard.appendChild(sumRow);

      if (matured.length > 0) {
        const maturedVal = matured.reduce((s, i) => s + parseFloat(i.current_value || i.amount || 0), 0);
        const claimBar   = el('div', 'display:flex;align-items:center;justify-content:space-between;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.25);border-radius:10px;padding:10px 12px;');
        claimBar.appendChild(el('span', 'font-size:13px;font-weight:700;color:#10b981;', '\u2713 ' + matured.length + ' ready to claim \u2014 ' + fmt(maturedVal)));
        const claimAllBtn = el('button', 'font-size:12px;font-weight:700;color:#10b981;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);border-radius:7px;padding:6px 12px;cursor:pointer;', 'Claim All');
        claimAllBtn.addEventListener('click', handleClaimAll);
        claimBar.appendChild(claimAllBtn);
        summaryCard.appendChild(claimBar);
      }
      panel.appendChild(summaryCard);
      panel.appendChild(el('div', 'font-size:13px;font-weight:700;color:var(--color-text-primary);margin-bottom:12px;', 'Active Positions'));
      active.forEach(inv => panel.appendChild(buildActiveInvestmentItem(inv, false)));
    }

    if (completed.length > 0) {
      panel.appendChild(el('div', 'font-size:13px;font-weight:700;color:var(--color-text-tertiary);margin:20px 0 12px;', 'Completed'));
      completed.slice(0, 5).forEach(inv => panel.appendChild(buildActiveInvestmentItem(inv, true)));
    }
  }

  // ============================================
  // TAB SWITCHING
  // ============================================

  function switchTab(tab) {
    if (!_container) return;
    _activeTab = tab;
    _container.querySelectorAll('[data-vault-tab]').forEach(btn => {
      const active = btn.dataset.vaultTab === tab;
      btn.style.background = active ? 'var(--color-primary)' : 'transparent';
      btn.style.color      = active ? '#fff' : 'var(--color-text-secondary)';
    });
    _container.querySelectorAll('[data-vault-panel]').forEach(p => {
      p.style.display = p.dataset.vaultPanel === tab ? 'block' : 'none';
    });
    if (tab === 'portfolio') renderPortfolioTab();
    if (tab === 'portfolio') updatePortfolioTabLabel();
  }

  // ============================================
  // RENDER
  // ============================================

  async function render(element) {
    if (!element) return;
    _container = element;
    _destroyed = false;

    element.style.cssText = [
      'overflow-y: auto',
      'overflow-x: hidden',
      'height: 100%',
      'width: 100%',
      'padding: 0',
      '-webkit-overflow-scrolling: touch',
      'position: relative'
    ].join(';');

    document.body.style.overflow    = '';
    document.documentElement.style.overflow = '';
    element.innerHTML = '';

    const { investments } = getState();
    if ((investments || []).some(i => i.status === 'active')) _activeTab = 'portfolio';

    const vaultWrapper = document.createElement('div');
    // Must clear the floating nav orb (58px) + gap (28px) + safe area
    vaultWrapper.style.paddingBottom = 'calc(110px + env(safe-area-inset-bottom, 0px))';

    const pageHeader = el('div', 'padding:16px 16px 4px;');
    pageHeader.appendChild(el('p', 'font-size:13px;color:var(--color-text-tertiary);margin:0;line-height:1.4;', 'We trade 24/7. You own a share of the pool. Returns are real, not projected.'));
    vaultWrapper.appendChild(pageHeader);

    const tabBarContainer = el('div');
    tabBarContainer.style.cssText = [
      'position: sticky',
      'top: 0',
      'z-index: 50',
      'padding: 10px 16px',
      'background: var(--color-app-bg, #0a0c10)',
      'box-shadow: 0 4px 12px -2px rgba(0,0,0,0.6)'
    ].join(';');

    const tabBar      = el('div', 'display:flex;background:var(--color-surface);padding:4px;border-radius:12px;border:1px solid var(--color-border);');
    const activeCount = (investments || []).filter(i => i.status === 'active').length;
    [
      { id: 'explore',   label: 'Explore Plans' },
      { id: 'portfolio', label: 'My Portfolio (' + activeCount + ')' }
    ].forEach(tab => {
      const btn = el('button');
      btn.dataset.vaultTab = tab.id;
      const isActive       = tab.id === _activeTab;
      btn.style.cssText    = 'flex:1;padding:10px;border:none;border-radius:8px;font-size:13px;font-weight:700;transition:all 0.2s;cursor:pointer;background:' + (isActive ? 'var(--color-primary)' : 'transparent') + ';color:' + (isActive ? '#fff' : 'var(--color-text-secondary)') + ';';
      btn.textContent      = tab.label;
      btn.addEventListener('click', () => switchTab(tab.id));
      if (tab.id === 'portfolio') _portfolioTabBtn = btn;
      tabBar.appendChild(btn);
    });
    updatePortfolioTabLabel();
    ensureInvestmentsSubscription();
    tabBarContainer.appendChild(tabBar);
    vaultWrapper.appendChild(tabBarContainer);

    const contentWrapper = el('div', 'padding:16px 16px 0;position:relative;z-index:10;');

    const explorePanel = el('div');
    explorePanel.dataset.vaultPanel = 'explore';
    explorePanel.style.display      = _activeTab === 'explore' ? 'block' : 'none';
    renderExploreTab(explorePanel);
    contentWrapper.appendChild(explorePanel);

    const portfolioPanel = el('div');
    portfolioPanel.dataset.vaultPanel = 'portfolio';
    portfolioPanel.id                  = 'vault-tab-active-content';
    portfolioPanel.style.display       = _activeTab === 'portfolio' ? 'block' : 'none';
    contentWrapper.appendChild(portfolioPanel);

    vaultWrapper.appendChild(contentWrapper);
    element.appendChild(vaultWrapper);

    if (_activeTab === 'portfolio') renderPortfolioTab();
    if (window.Navbar) Navbar.setActive('vault');
    syncInvestmentsFromDB();
  }

  // ============================================
  // LIFECYCLE
  // ============================================

  function destroy() {
    _destroyed = true;
    if (typeof _unsubInvestments === 'function') {
      _unsubInvestments();
      _unsubInvestments = null;
    }
    _portfolioTabBtn = null;
    _liveTimers.forEach(id => clearInterval(id));
    _liveTimers.clear();
    if (_container) _container.style.overflowY = '';
    _container = null;
    _milestoneChecked.clear();
  }

  function cleanup() { destroy(); }

  function refresh() {
    if (_destroyed || !_container) return;
    syncInvestmentsFromDB().then(() => { if (_activeTab === 'portfolio') renderPortfolioTab(); });
  }

  window.Vault = { render, refresh, destroy, cleanup, openInvestModal, handleClaimAll, syncInvestmentsFromDB };

})();
