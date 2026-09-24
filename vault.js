/**
 * NexTrade — Vault
 *
 * Product rules:
 * - Strategy return figures are gross per-cycle targets, not APY and not guarantees.
 * - FinanceMath mirrors the server claim formula for all monetary previews.
 * - Postgres RPCs are the only authority for investment creation and claims.
 * - The modeled pool index/activity feed is presentation context only; it never
 *   determines a user's claimable balance or mutates financial state.
 * - Completed investment principal remains immutable for auditability.
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
      tagline:     'Start with $100. 90-day cycle. Low volatility, consistent pool growth.',
      category:    'Conservative · Strategy A',
      icon:        '\u{1F6E1}\uFE0F',
      apy:         22,
      apyRange:    '18\u201326% per 90-day cycle',
      minAmount:   100,
      duration:    90,
      riskLevel:   1,
      riskLabel:   'Low',
      riskColor:   '#10b981',
      penaltyRate: 0.08,
      perfFee:     15,
      mechanics: [
        { icon: '\u{1F3E6}', title: 'Stablecoin Lending',  pct: 55, desc: 'Target allocation to USDC/USDT lending through vetted institutional-grade protocols, with yield intended to come from borrower demand rather than directional speculation.' },
        { icon: '\u27A0',    title: 'ETH Staking',          pct: 30, desc: 'Designed allocation to native ETH staking infrastructure, with protocol rewards accruing to the strategy pool.' },
        { icon: '\u{1F4A7}', title: 'Liquidity Provision',  pct: 15, desc: 'Designed allocation to selected stable-pair liquidity venues, where swap fees contribute to pool performance.' }
      ],
      highlights: [
        'Your return = your pool share \u00D7 pool performance',
        'We earn 15% only on the profit the pool generates',
        'No leverage in the Steady strategy design · protocol due diligence required',
        'Early exit: up to 8% fee on claimed value'
      ]
    },
    {
      id:          'alpha-seeker',
      name:        'Surge Pool',
      tagline:     'More capital, faster cycle. The algorithm scales with what you put in. Target: +67% per 30-day cycle.',
      category:    'Quant Momentum · Strategy B',
      icon:        '\u26A1',
      apy:         67,
      apyRange:    '+55\u201380% per 30-day cycle',
      minAmount:   1500,
      duration:    30,
      riskLevel:   2,
      riskLabel:   'High · Max Return',
      riskColor:   '#f59e0b',
      penaltyRate: 0.15,
      perfFee:     20,
      mechanics: [
        { icon: '\u{1F4CA}', title: 'Quant Momentum Signals',    pct: 50, desc: 'Strategy design uses RSI-divergence and volume-anomaly signals across a defined liquid-asset universe, with short-duration positions intended to capture momentum and spread opportunities.' },
        { icon: '\u2696\uFE0F', title: 'Funding Rate Arbitrage', pct: 30, desc: 'Strategy design monitors perpetual-futures funding imbalances and targets hedged positions intended to capture funding payments while limiting directional exposure.' },
        { icon: '\u{1F525}', title: 'Volatile-Pair Liquidity',   pct: 20, desc: 'Target allocation to selected volatile-pair liquidity venues, dynamically rebalanced with the goal of capturing higher fee income while controlling inventory risk.' }
      ],
      highlights: [
        'Target: $1,500 \u2192 $2,505 in 30 days at current pool rate',
        'Algo-driven entries \u2014 no emotional decisions, 24/7',
        'Funding-rate arbitrage + momentum signals designed for continuous monitoring',
        'We earn 20% only on the profit. Zero fees on your principal.',
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
  let _milestoneChecked = new Set();   // in-card "smart context" render dedupe ONLY — unrelated to toasts, unchanged, still cleared in destroy()
  let _lastInvestHash   = '';             // flicker guard — skip re-render if data unchanged
  let _liveTimers       = new Set();   // interval/timeout IDs — cleared on destroy
  let _toastShown       = new Set();   // toast dedupe — persisted, NOT cleared on destroy (see below)
  let _milestoneTimers  = new Set();   // pending setTimeout ids for scheduled toasts — cleared on destroy so a toast can never fire on a panel the user has already left
  let _unsubInvestments = null;
  let _portfolioTabBtn  = null;

  // ============================================
  // TOAST MILESTONE PERSISTENCE
  // ── Toasts must fire at most once per investment, forever — not once per
  // Vault visit. Previously the toast dedupe shared the same in-memory Set
  // as the in-card render check, which was wiped on every destroy() (i.e.
  // every time the user left the Vault panel) — so re-entering Vault
  // replayed every milestone toast the investment had already passed.
  // Toasts now use their own store, backed by Storage, so it survives
  // navigation and reloads. The in-card render dedupe (_milestoneChecked)
  // is untouched and keeps its original per-session behavior.
  // ============================================

  const TOAST_STORE_KEY = 'vault_milestone_toasts_shown';

  function _loadMilestoneStore() {
    if (_toastShown.size > 0) return; // already hydrated this session
    try {
      const saved = window.Storage ? Storage.get(TOAST_STORE_KEY, []) : [];
      (saved || []).forEach(k => _toastShown.add(k));
    } catch (_) { /* non-fatal — worst case a milestone toast repeats once */ }
  }

  function _persistMilestoneStore() {
    try {
      if (window.Storage) Storage.set(TOAST_STORE_KEY, Array.from(_toastShown));
    } catch (_) { /* non-fatal */ }
  }

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

  function showError(msg)   { if (window.App && App.showError)   App.showError(String(msg));   else console.error('[VAULT] Error:', msg); }
  function showSuccess(msg, title) { if (window.App && App.showSuccess) App.showSuccess(String(msg), title); else console.log('[VAULT] Success:', msg); }

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
      riskColor: '#3b82f6',
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

  // ============================================
  // MODELED STRATEGY CONTEXT
  // ============================================
  // This helper is used only for explanatory projections/milestones. Monetary
  // position values always come from FinanceMath/_estimatedValue so the UI and
  // claim RPC share one deterministic formula.
  function _strategyCycleParams(strategyId) {
    const strategy = STRATEGIES.find(s => s.id === strategyId) || {};
    const isAlpha = strategyId === 'alpha-seeker';
    const totalReturn = (strategy.apy || (isAlpha ? 67 : 22)) / 100;
    const durationDays = strategy.duration || (isAlpha ? 30 : 90);
    return { totalReturn, durationSec: durationDays * 86400 };
  }

  // Index value at any date, walking day-by-day from the epoch.
  // Returns a float (1.000 = starting value).
  function _poolIndex(strategyId, date) {
    const EPOCH   = new Date('2024-01-01T00:00:00Z');
    const target  = new Date(date);
    const days    = Math.floor((target - EPOCH) / 86400000);
    if (days <= 0) return 1.0;

    const isAlpha  = strategyId === 'alpha-seeker';
    const strategy = STRATEGIES.find(s => s.id === strategyId) || {};
    // Daily rate derived from the strategy's own cycle target/length —
    // compounding this rate for `strategy.duration` days lands exactly on
    // `strategy.apy`%. Previously Steady's daily rate was derived from
    // (1+0.22)^(1/365)-1 — treating apy=22 as an ANNUAL rate and
    // re-deriving a 365-day compounding rate from it — which compounds to
    // only ~5% over the real 90-day cycle instead of the intended ~22%
    // (apy and duration are both per-cycle values in STRATEGIES, not
    // annual/prorated). Alpha's old rate (0.01620) was a separate
    // hand-tuned constant rather than derived from its own apy/duration.
    const cycleDays = strategy.duration || (isAlpha ? 30 : 90);
    const cycleApy  = (strategy.apy || (isAlpha ? 67 : 22)) / 100;
    const daily    = Math.pow(1 + cycleApy, 1 / cycleDays) - 1;
    const vol      = isAlpha ? 0.018 : 0.007;   // daily volatility
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
  // Capped at entryDate + strategy.duration — matches claim_investment's
  // server-side cap (least(now(), matures_at)) so the displayed estimate
  // never outpaces what the RPC will actually pay out at claim time.
  function _estimatedValue(investment) {
    const strategy = getStrategyForInvestment(investment);
    const snapshot = {
      ...investment,
      apy: investment.apy ?? strategy.apy,
      perf_fee: investment.perf_fee ?? strategy.perfFee,
      penalty_rate: investment.penalty_rate ?? strategy.penaltyRate,
      duration_days: investment.duration_days ?? investment.duration ?? strategy.duration
    };
    if (window.FinanceMath) return FinanceMath.investmentEstimate(snapshot).value;
    return Math.max(0, Number(investment.current_value || investment.amount || 0));
  }

  function _positionValue(investment) {
    if (!investment) return 0;
    if (investment.status === 'active') return _estimatedValue(investment);
    return Math.max(0, Number(investment.current_value || investment.amount || 0));
  }

  // Pool share percentage (their principal vs simulated total strategy AUM).
  function _poolShare(principal, strategyId) {
    const AUM = strategyId === 'alpha-seeker' ? 874000 : 2430000;
    return (principal / (AUM + principal)) * 100;
  }

  // Build a 7-day SVG sparkline.
  function _buildSparkline(strategyId) {
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
    header.appendChild(el('span', 'font-size:10px;font-weight:700;color:var(--color-text-tertiary);letter-spacing:0.7px;text-transform:uppercase;', 'Illustrative Activity'));
    wrap.appendChild(header);

    const list = el('div', 'display:flex;flex-direction:column;gap:4px;');
    // Show 3 items, rotating every 30s based on real time
    const offset = Math.floor(Date.now() / 30000) % trades.length;
    for (let i = 0; i < 3; i++) {
      const t   = trades[(offset + i) % trades.length];
      // Illustrative timestamps used only for the modeled activity feed.
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
      const p = localStorage.getItem('nextrade_investor_profile');
      return p === 'alpha-seeker' ? 'alpha-seeker' : 'steady-accumulator';
    } catch (_) { return 'steady-accumulator'; }
  }

  function calcEarlyPenalty(investment) {
    const strategy = getStrategyForInvestment(investment);
    const snapshot = {
      ...investment,
      apy: investment.apy ?? strategy.apy,
      perf_fee: investment.perf_fee ?? strategy.perfFee,
      penalty_rate: investment.penalty_rate ?? strategy.penaltyRate,
      duration_days: investment.duration_days ?? investment.duration ?? strategy.duration
    };
    if (window.FinanceMath) {
      const result = FinanceMath.earlyExit(snapshot, snapshot.penalty_rate);
      const matureMs = investment.matures_at ? Date.parse(investment.matures_at) : NaN;
      const daysRemaining = Number.isFinite(matureMs) ? Math.max(0, Math.ceil((matureMs - Date.now()) / 86400000)) : 0;
      return { value: result.value, penalty: result.penalty, receive: result.received, isEarly: result.isEarly, daysRemaining };
    }
    const claimAmt = Math.max(0, Number(investment.current_value || investment.amount || 0));
    return { value: claimAmt, penalty: 0, receive: claimAmt, isEarly: false, daysRemaining: 0 };
  }

  function checkMilestones(investments) {
    if (!Array.isArray(investments)) return;
    _loadMilestoneStore();

    // Collect everything newly-qualified in this pass first, then decide how
    // to present it as a single scheduled toast batch — never one setTimeout
    // per milestone, which is what let toasts stack up and cover the screen.
    const pending = [];

    investments.forEach(inv => {
      if (!inv || inv.status !== 'active') return;
      const principal  = parseFloat(inv.amount || 0);
      const current    = _estimatedValue(inv);
      const pct        = principal > 0 ? ((current - principal) / principal) * 100 : 0;
      const name       = (STRATEGIES.find(s => s.id === inv.strategy_id) || {}).name || 'Your investment';

      // Standard gain milestones
      [10, 25, 50, 100].forEach(m => {
        const key = inv.id + '_gain' + m;
        if (pct >= m && !_toastShown.has(key)) {
          _toastShown.add(key);
          pending.push({ message: '🎉 ' + name + ' is up ' + m + '% — great work!' });
        }
      });

      // Day-15 toast: fires once when the investment is in the 13.5–16.5d window.
      // The in-card smart context renders separately; this is the ambient notification.
      if (inv.created_at && inv.matures_at) {
        const elapsedDays = (Date.now() - new Date(inv.created_at).getTime()) / 86400000;
        const toastKey    = inv.id + '_d15toast';
        if (elapsedDays >= 13.5 && elapsedDays <= 16.5 && !_toastShown.has(toastKey)) {
          _toastShown.add(toastKey);
          const { totalReturn } = _strategyCycleParams(inv.strategy_id);
          const invStrategy = getStrategyForInvestment(inv);
          const feeRate = Number(inv.perf_fee ?? invStrategy.perfFee ?? 0) / 100;
          const projFinal = principal + (principal * totalReturn * (1 - feeRate));
          const remaining = Math.max(0, Math.ceil(
            (new Date(inv.matures_at).getTime() - Date.now()) / 86400000
          ));
          pending.push({ message:
            '📈 Halfway milestone — ' + name + ' is on track. ' +
            fmt(projFinal) + ' projected at maturity. ' + remaining + 'd remaining.'
          });
        }
      }
    });

    if (pending.length === 0) return;
    _persistMilestoneStore();

    // One toast if there's only one thing to say; a single grouped toast
    // (not N stacked cards) if several milestones landed in the same pass.
    const fire = () => {
      if (_destroyed) return; // panel was left before this had a chance to show — don't leak onto whatever the user navigated to
      if (pending.length === 1) {
        showSuccess(pending[0].message);
      } else {
        showSuccess(pending.length + ' portfolio milestones reached — tap Portfolio to see them.', 'Milestones');
      }
    };
    const timerId = setTimeout(fire, 600);
    _milestoneTimers.add(timerId);
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
      const incoming = Array.isArray(data) ? data : [];
      // Only re-render portfolio if something meaningful changed.
      // Hashing id+status+current_value catches claims, new investments, and admin payouts.
      const incomingHash = incoming.map(i => i.id + ':' + i.status + ':' + (i.current_value || 0)).join('|');
      const changed = incomingHash !== _lastInvestHash;
      _lastInvestHash = incomingHash;
      if (window.AppState) AppState.set('investments', incoming);
      updatePortfolioTabLabel();
      if (changed && _activeTab === 'portfolio') renderPortfolioTab();
      checkMilestones(data);
    } catch (err) { console.error('[VAULT] sync exception:', err.message); }
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
      { label: 'Illustrative 30d', value: pool30str,                  color: pool30d >= 0 ? '#10b981' : '#ef4444' },
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
    const prevLbl  = el('div', 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:6px;', 'Illustrative net value at full target after ' + strategy.duration + ' days');
    const prevAmt  = el('div', 'font-size:22px;font-weight:800;color:var(--color-text-primary);', '');
    const prevNote = el('div', 'font-size:10px;color:var(--color-text-tertiary);margin-top:4px;', 'Illustrative estimate using the strategy target less the stated performance fee. Not a guaranteed return.');
    preview.appendChild(prevLbl); preview.appendChild(prevAmt); preview.appendChild(prevNote);
    content.appendChild(preview);

    amountInput.addEventListener('input', () => {
      const v = parseFloat(amountInput.value);
      if (!isNaN(v) && v >= strategy.minAmount) {
        const targetRate = Number(strategy.apy || 0) / 100;
        const feeRate = Number(strategy.perfFee || 0) / 100;
        const projected = v + (v * targetRate * (1 - feeRate));
        prevAmt.textContent = fmt(projected) + ' net target estimate';
        preview.style.display = 'block';
      } else { preview.style.display = 'none'; }
    });

    content.appendChild(el('div', 'font-size:11px;color:var(--color-text-tertiary);text-align:center;margin-bottom:16px;line-height:1.6;', 'We earn a ' + strategy.perfFee + '% performance fee only on the profit we generate. Zero fees on your principal.'));

    const confirmBtn = el('button', 'font-size:16px;padding:18px;border-radius:14px;font-weight:800;width:100%;border:none;color:var(--color-on-accent);cursor:pointer;background:var(--color-primary);', 'Invest Now');
    confirmBtn.addEventListener('click', async () => {
      if (confirmBtn.disabled) return;
      const raw = amountInput.value.trim();
      const num = parseFloat(raw);
      if (!raw || isNaN(num))       return showError('Please enter an amount.');
      if (num < strategy.minAmount) return showError('Minimum is ' + fmt(strategy.minAmount) + '.');
      if (num > spotBalance)        return showError('Insufficient balance. Available: ' + fmt(spotBalance) + '.');
      // Keep modal open with loading state so user knows processing is in flight
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;font-size:14px;"></i>Investing...';
      try {
        await handleInvestment(strategy, num);
        if (window.Modal) Modal.close();
      } catch (_) {
        // handleInvestment already called showError internally
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Invest Now';
      }
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

    _isProcessing = true;
    try {
      if (!window.supabaseClient) throw new Error('Secure investment service unavailable');
      let rpcRow = null;
      {
        if (!window.RequestId) throw new Error('Secure request identifier unavailable');
        const investmentFingerprint = `${strategy.id}|${Number(amount).toFixed(8)}`;
        const investmentKey = RequestId.get('investment', investmentFingerprint);
        const { data, error } = await window.supabaseClient.rpc('create_investment', {
          p_strategy_id: strategy.id,
          p_amount: amount,
          p_idempotency_key: investmentKey
        });
        if (error) throw error;
        rpcRow = Array.isArray(data) ? data[0] : data;
        if (!rpcRow || !rpcRow.investment_id || !rpcRow.tx_id) throw new Error('Investment authority returned an invalid response');
        RequestId.clear('investment', investmentKey);
      }

      if (window.AppState && rpcRow) {
        if (typeof rpcRow.spot_balance !== 'undefined' || typeof rpcRow.vault_cash !== 'undefined') {
          AppState.updateBalances({
            spot: Number(rpcRow.spot_balance),
            vaultCash: Number(rpcRow.vault_cash)
          });
        }
        if (rpcRow.tx_id) {
          AppState.addTransaction({
            id:          rpcRow.tx_id,
            type:        'investment',
            amount:      amount,
            status:      'completed',
            description: 'Invested in ' + strategy.name,
            created_at:  new Date().toISOString()
          });
        }
      }

      if (window.App) await App.refreshData();
      await syncInvestmentsFromDB();
      showSuccess(fmt(amount) + ' invested in ' + strategy.name + '.');
      return true;
    } catch (err) {
      console.error('[VAULT] handleInvestment error:', err);
      showError(err.message || 'Investment failed. Please try again.');
      throw err;
    } finally { _isProcessing = false; }
  }

  async function handleClaim(investment, penaltyConfirmed) {
    if (!investment || !investment.id || _isProcessing) return;
    const { user } = getState();
    if (!user || !user.id) return showError('Session expired. Please refresh.');

    const { value: claimValue, penalty, receive, isEarly, daysRemaining } = calcEarlyPenalty(investment);

    if (isEarly && !penaltyConfirmed) {
      if (!window.Modal) return;
      const content = document.createElement('div');
      content.appendChild(el('div', 'text-align:center;font-size:44px;margin-bottom:12px;', '⏰'));
      content.appendChild(el('div', 'font-size:16px;font-weight:800;color:var(--color-text-primary);text-align:center;margin-bottom:16px;', 'Early Exit Penalty'));
      const claimAmt = claimValue;
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
      const confirmBtn = el('button', 'background:#ef4444;color:var(--color-on-accent);border:none;padding:14px;margin-bottom:8px;border-radius:12px;width:100%;font-weight:700;cursor:pointer;', 'Accept Penalty & Claim');
      confirmBtn.addEventListener('click', () => { if (window.Modal) Modal.close(); setTimeout(() => handleClaim(investment, true), 350); });
      const cancelBtn  = el('button', 'background:rgba(255,255,255,0.06);border:1px solid var(--color-border);color:var(--color-text-primary);padding:14px;border-radius:12px;width:100%;font-weight:700;cursor:pointer;', 'Keep Invested');
      cancelBtn.addEventListener('click', () => { if (window.Modal) Modal.close(); });
      content.appendChild(confirmBtn); content.appendChild(cancelBtn);
      Modal.open({ title: '', content, maxWidth: '400px' });
      return;
    }

    _isProcessing = true;
    try {
      if (!window.supabaseClient) throw new Error('Secure claim service unavailable');
      let rpcRow = null;
      {
        if (!window.RequestId) throw new Error('Secure request identifier unavailable');
        const claimFingerprint = `${investment.id}|${penaltyConfirmed ? 'early-ok' : 'mature'}`;
        const claimKey = RequestId.get('claim', claimFingerprint);
        const { data, error } = await window.supabaseClient.rpc('claim_investment', {
          p_investment_id: investment.id,
          p_penalty_confirmed: !!penaltyConfirmed,
          p_idempotency_key: claimKey
        });
        if (error) throw error;
        rpcRow = Array.isArray(data) ? data[0] : data;
        if (!rpcRow || !rpcRow.tx_id) throw new Error('Claim authority returned an invalid response');
        RequestId.clear('claim', claimKey);
      }

      if (window.AppState && rpcRow) {
        if (typeof rpcRow.spot_balance !== 'undefined' || typeof rpcRow.vault_cash !== 'undefined') {
          AppState.updateBalances({
            spot: Number(rpcRow.spot_balance),
            vaultCash: Number(rpcRow.vault_cash)
          });
        }
        if (rpcRow.tx_id) {
          AppState.addTransaction({
            id:          rpcRow.tx_id,
            type:        'claim',
            amount:      parseFloat(rpcRow.received) || receive,
            status:      'completed',
            description: 'Claimed ' + getStrategyForInvestment(investment).name + (isEarly ? ' (Early Exit)' : ''),
            created_at:  new Date().toISOString()
          });
        }
      }

      if (window.App) await App.refreshData();
      await syncInvestmentsFromDB();

      showSuccess(fmt(parseFloat(rpcRow && rpcRow.received != null ? rpcRow.received : receive)) + ' added to your Spot Wallet.');
      renderPortfolioTab();
      return true;
    } catch (err) {
      console.error('[VAULT] handleClaim error:', err);
      showError(err.message || 'Claim failed. Please try again.');
      throw err;
    } finally { _isProcessing = false; }
  }

  // ============================================
  // AUTHORITATIVE SPOT DERIVATION
  // ============================================
  // Client-side callers delegate to App, which calls the Postgres
  // derive_spot_balance RPC. Cached profile balances are never authority.

  async function deriveSpotBalanceFromLedger(userId) {
    if (window.App && typeof App.deriveSpotBalance === 'function') {
      return App.deriveSpotBalance(userId);
    }
    throw new Error('Balance authority unavailable');
  }

  // ============================================
  // CLAIM ALL
  // ============================================

  async function handleClaimAll() {
    const { investments } = getState();
    const claimable = (investments || []).filter(i => i.status === 'active' && (!i.matures_at || new Date(i.matures_at) <= Date.now()));
    if (claimable.length === 0) return showError('No matured positions available to claim.');
    const totalClaims = claimable.reduce((s, i) => s + _estimatedValue(i), 0);
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

  // ============================================
  // COMPACT STRATEGY CARD
  // ============================================
  // Shows key metrics at a glance. Full detail (mechanics, highlights,
  // risk disclosures, invest CTA) lives in openStrategyDetail().

  function buildPlanCard(strategy, recommended) {
    const card = el('div');
    card.className = 'vault-strategy-card';
    card.style.cssText = 'position:relative;background:var(--color-surface-elevated);border-radius:16px;overflow:hidden;margin-bottom:12px;transition:transform 0.15s ease,border-color 0.2s;cursor:pointer;';
    card.style.border  = '1px solid ' + (recommended ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)');
    card.addEventListener('mouseenter', () => { card.style.borderColor = 'rgba(255,255,255,0.2)'; card.style.transform = 'translateY(-1px)'; });
    card.addEventListener('mouseleave', () => { card.style.borderColor = recommended ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)'; card.style.transform = ''; });
    card.addEventListener('click', () => openStrategyDetail(strategy));

    const body = el('div', 'padding:16px;');

    // ── Header: icon + name/category + return ──
    const headerRow = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;');
    const left      = el('div', 'display:flex;align-items:center;gap:10px;flex:1;min-width:0;');
    const iconBox   = el('div', 'width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0;');
    iconBox.style.background = 'rgba(255,255,255,0.05)';
    iconBox.style.border     = '1px solid rgba(255,255,255,0.08)';
    iconBox.textContent      = strategy.icon;

    const titleWrap = el('div', 'min-width:0;');
    const nameRow   = el('div', 'display:flex;align-items:center;gap:6px;margin-bottom:1px;flex-wrap:wrap;');
    nameRow.appendChild(el('span', 'font-size:15px;font-weight:800;color:var(--color-text-primary);', strategy.name));
    if (recommended) {
      const badge = el('span', 'font-size:9px;font-weight:800;padding:2px 7px;border-radius:20px;letter-spacing:0.6px;color:var(--color-on-accent);background:var(--color-primary);', '\u2605 FOR YOU');
      nameRow.appendChild(badge);
    }
    titleWrap.appendChild(nameRow);
    titleWrap.appendChild(el('div', 'font-size:11px;color:var(--color-text-tertiary);', strategy.category));
    left.appendChild(iconBox); left.appendChild(titleWrap);

    const rightCol  = el('div', 'text-align:right;flex-shrink:0;');
    const idx30ago  = _poolIndex(strategy.id, new Date(Date.now() - 30 * 86400000));
    const idxToday  = _poolIndex(strategy.id, new Date());
    const pool30d   = ((idxToday / idx30ago) - 1) * 100;
    const returnEl  = el('div', 'font-size:20px;font-weight:900;letter-spacing:-0.5px;', (pool30d >= 0 ? '+' : '') + pool30d.toFixed(1) + '%');
    returnEl.style.color = pool30d >= 0 ? strategy.riskColor : '#ef4444';
    rightCol.appendChild(returnEl);
    rightCol.appendChild(el('div', 'font-size:9px;color:var(--color-text-tertiary);letter-spacing:0.4px;', '30D RETURN'));
    headerRow.appendChild(left); headerRow.appendChild(rightCol);
    body.appendChild(headerRow);

    // ── Stats: minimum · term · risk ──
    const statsRow = el('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px;');
    statsRow.className = 'vault-strategy-metrics';
    [
      { label: 'MINIMUM', value: fmt(strategy.minAmount), color: 'var(--color-text-primary)' },
      { label: 'TERM',    value: strategy.duration + 'd', color: 'var(--color-text-primary)' },
      { label: 'RISK',    value: strategy.riskLabel,      color: strategy.riskColor }
    ].forEach(s => {
      const cell = el('div', 'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:8px;text-align:center;');
      cell.className = 'vault-strategy-metric';
      const valEl = el('div', 'font-size:13px;font-weight:700;', s.value);
      valEl.style.color = s.color;
      cell.appendChild(valEl);
      cell.appendChild(el('div', 'font-size:9px;color:var(--color-text-tertiary);margin-top:2px;letter-spacing:0.5px;', s.label));
      statsRow.appendChild(cell);
    });
    body.appendChild(statsRow);

    // ── Tagline ──
    body.appendChild(el('div', 'font-size:12px;color:var(--color-text-secondary);line-height:1.4;margin-bottom:14px;', strategy.tagline));

    // ── CTA ──
    const cta = el('button', 'width:100%;padding:12px;font-size:13px;font-weight:700;border-radius:10px;cursor:pointer;transition:all 0.2s;letter-spacing:-0.1px;color:var(--color-on-accent);');
    cta.className = 'vault-strategy-cta';
    cta.dataset.recommended = String(recommended);
    cta.style.background = recommended ? 'var(--color-primary)' : 'rgba(255,255,255,0.05)';
    cta.style.border     = recommended ? 'none' : '1px solid rgba(255,255,255,0.1)';
    cta.textContent      = 'View Strategy \u2192';
    cta.addEventListener('click', e => { e.stopPropagation(); openStrategyDetail(strategy); });
    body.appendChild(cta);

    card.appendChild(body);
    return card;
  }

  // ============================================
  // STRATEGY DETAIL SHEET
  // ============================================
  // Full mechanics + highlights + risk disclosures + invest CTA.
  // Replaces the old two-step (openRiskDisclosure → openInvestModal).

  function openStrategyDetail(strategy) {
    if (!window.Modal) return;
    const content = document.createElement('div');
    content.className = 'vault-detail-content';

    // Header chip
    const chip = el('div', 'display:inline-flex;align-items:center;gap:8px;border-radius:20px;padding:6px 14px;margin-bottom:16px;');
    chip.className = 'vault-detail-chip';
    chip.style.background = 'rgba(255,255,255,0.04)';
    chip.style.border     = '1px solid rgba(255,255,255,0.09)';
    chip.innerHTML = '<span style="font-size:15px;">' + strategy.icon + '</span>' +
                     '<span style="font-size:12px;font-weight:700;color:var(--color-text-primary);">' +
                     strategy.riskLabel + ' Risk \u00B7 ' + strategy.duration + 'd lock \u00B7 Min ' + fmt(strategy.minAmount) + '</span>';
    content.appendChild(chip);

    // Key metrics grid
    const idx30ago  = _poolIndex(strategy.id, new Date(Date.now() - 30 * 86400000));
    const idxToday  = _poolIndex(strategy.id, new Date());
    const pool30d   = ((idxToday / idx30ago) - 1) * 100;
    const pool30str = (pool30d >= 0 ? '+' : '') + pool30d.toFixed(2) + '%';

    const metaGrid = el('div', 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px;');
    metaGrid.className = 'vault-detail-metrics';
    [
      { label: 'Target Return',  value: strategy.apyRange,                              color: strategy.riskColor },
      { label: '30D Pool Return',value: pool30str,                                       color: pool30d >= 0 ? '#10b981' : '#ef4444' },
      { label: 'Lock Period',    value: strategy.duration + ' days',                     color: 'var(--color-text-primary)' },
      { label: 'Early Exit Fee', value: Math.round(strategy.penaltyRate * 100) + '%',    color: '#f59e0b' }
    ].forEach(item => {
      const cell = el('div', 'background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;border:1px solid rgba(255,255,255,0.07);');
      cell.className = 'vault-detail-metric';
      cell.appendChild(el('div', 'font-size:10px;color:var(--color-text-tertiary);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.4px;', item.label));
      const val = el('div', 'font-size:15px;font-weight:700;', item.value);
      val.style.color = item.color;
      cell.appendChild(val);
      metaGrid.appendChild(cell);
    });
    content.appendChild(metaGrid);

    // Mechanics
    const mechSection = el('div', 'margin-bottom:20px;');
    strategy.mechanics.forEach(m => {
      const mechRow = el('div', 'display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;');
      mechRow.className = 'vault-detail-mechanic';
      const iconWrap = el('div', 'width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;margin-top:2px;');
      iconWrap.className = 'vault-detail-mechanic__icon';
      iconWrap.style.background = 'rgba(255,255,255,0.05)';
      iconWrap.textContent = m.icon;
      const textWrap = el('div', 'flex:1;min-width:0;');
      const mTitle   = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;');
      mTitle.appendChild(el('span', 'font-size:12px;font-weight:700;color:var(--color-text-primary);', m.title));
      const pctLabel = el('span', 'font-size:11px;font-weight:700;', m.pct + '%');
      pctLabel.style.color = strategy.riskColor;
      mTitle.appendChild(pctLabel);
      textWrap.appendChild(mTitle);
      const barBg   = el('div', 'height:3px;background:rgba(255,255,255,0.08);border-radius:2px;margin-bottom:5px;');
      const barFill = el('div');
      barFill.style.cssText = 'height:100%;border-radius:2px;width:' + m.pct + '%;background:' + strategy.riskColor + ';';
      barBg.appendChild(barFill);
      textWrap.appendChild(barBg);
      textWrap.appendChild(el('div', 'font-size:11px;color:var(--color-text-secondary);line-height:1.5;', m.desc));
      mechRow.appendChild(iconWrap); mechRow.appendChild(textWrap);
      mechSection.appendChild(mechRow);
    });
    content.appendChild(mechSection);

    // Highlights
    const hlWrap = el('div', 'background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:12px 14px;margin-bottom:20px;');
    strategy.highlights.forEach((h, i) => {
      const row  = el('div', 'display:flex;align-items:flex-start;gap:8px;');
      row.style.marginBottom = i < strategy.highlights.length - 1 ? '7px' : '0';
      const tick = el('span', 'font-size:12px;flex-shrink:0;margin-top:1px;', '\u2713');
      tick.style.color = strategy.riskColor;
      row.appendChild(tick);
      row.appendChild(el('span', 'font-size:12px;color:var(--color-text-secondary);line-height:1.4;', h));
      hlWrap.appendChild(row);
    });
    content.appendChild(hlWrap);

    // Thin divider before disclosures
    const divider = el('div', 'height:1px;background:rgba(255,255,255,0.07);margin-bottom:16px;');
    content.appendChild(divider);
    const disclosures = [
      'You are joining a shared trading pool. Returns depend on how the pool performs over the cycle — not a guaranteed rate.',
      'The return figure shown — ' + strategy.apyRange + ' — is a gross strategy target, not a guaranteed payout. A ' + strategy.perfFee + '% performance fee is deducted from positive profit at claim.',
      'Your principal is locked for ' + strategy.duration + ' days. Early exit incurs a penalty of up to ' + Math.round(strategy.penaltyRate * 100) + '% of claimed value. This is disclosed again before any early withdrawal is confirmed.',
      'If the pool generates zero profit in your cycle, our performance fee is zero. We charge nothing on your original deposit, ever.'
    ];
    const discBox = el('div', 'border-radius:12px;padding:12px 14px;margin-bottom:20px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);');
    disclosures.forEach((d, i) => {
      const row = el('div', 'display:flex;align-items:flex-start;gap:8px;');
      row.style.marginBottom = i < disclosures.length - 1 ? '8px' : '0';
      row.appendChild(el('span', 'font-weight:700;font-size:14px;flex-shrink:0;line-height:1.6;color:var(--color-text-tertiary);', '\u00B7'));
      const txt = el('span', 'font-size:12px;line-height:1.6;color:var(--color-text-secondary);', d);
      row.appendChild(txt);
      discBox.appendChild(row);
    });
    content.appendChild(discBox);

    // Invest CTA
    const investBtn = el('button', 'width:100%;padding:15px;border-radius:12px;font-size:15px;font-weight:800;margin-bottom:8px;cursor:pointer;border:none;background:var(--color-primary);color:var(--color-on-accent);', 'Invest \u2014 ' + strategy.name + ' \u2192');
    investBtn.addEventListener('click', () => { if (window.Modal) Modal.close(); setTimeout(() => openInvestModal(strategy), 350); });
    const cancelBtn = el('button', 'width:100%;padding:12px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid var(--color-border);background:rgba(255,255,255,0.03);color:var(--color-text-secondary);', 'Close');
    cancelBtn.addEventListener('click', () => { if (window.Modal) Modal.close(); });
    content.appendChild(investBtn);
    content.appendChild(cancelBtn);

    Modal.open({ title: strategy.name, content, maxWidth: '460px' });
  }

  // ============================================
  // ACTIVE INVESTMENT ITEM
  // ============================================

  function buildActiveInvestmentItem(investment, isCompleted) {
    const strategy   = getStrategyForInvestment(investment);
    const amount     = parseFloat(investment.amount || 0);
    const isMatured  = !isCompleted && investment.matures_at && new Date(investment.matures_at) <= new Date();
    const matureDate = investment.matures_at ? new Date(investment.matures_at) : null;

    // Display estimate mirrors the deterministic server claim formula.
    const estVal  = isCompleted
      ? _positionValue(investment)
      : _estimatedValue(investment);
    const gain    = estVal - amount;
    const gainPct = amount > 0 ? (gain / amount) * 100 : 0;

    const itemEl = el('div');
    itemEl.style.cssText = 'border-radius:16px;overflow:hidden;margin-bottom:14px;animation:ntm-item-in 0.22s ease both;';
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
      strip.style.cssText = 'height:2px;background:' + strategy.riskColor + ';opacity:0.5;';
      itemEl.appendChild(strip);
    }

    const body = el('div', 'padding:14px 16px;');

    // ── Header row ───────────────────────────────────────────────────────
    const headerRow = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;');
    const leftSide  = el('div', 'display:flex;align-items:center;gap:10px;');
    const iconEl    = el('div', 'font-size:20px;', strategy.icon);
    const nameWrap  = el('div');
    nameWrap.appendChild(el('div', 'font-size:14px;font-weight:800;color:var(--color-text-primary);', strategy.name));

    const statusColor = isCompleted ? 'var(--color-text-tertiary)' : (isMatured ? '#10b981' : '#3b82f6');
    const statusTxt   = isCompleted ? 'Completed' : (isMatured ? '✓ Ready to Claim' : '● Active · Estimated');
    const statusEl    = el('div', 'font-size:10px;font-weight:700;margin-top:2px;letter-spacing:0.3px;', statusTxt);
    statusEl.style.color = statusColor;
    nameWrap.appendChild(statusEl);
    leftSide.appendChild(iconEl); leftSide.appendChild(nameWrap);

    const gainBadge = el('div', 'font-size:13px;font-weight:800;', (gain >= 0 ? '+' : '') + gainPct.toFixed(2) + '%');
    gainBadge.style.color = gain >= 0 ? 'var(--color-success,#10b981)' : 'var(--color-danger,#ef4444)';
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
    // Today's gain = value moved since start of today
    const todayStartIdx  = _poolIndex(investment.strategy_id, new Date(new Date().setHours(0,0,0,0)));
    const todayEndIdx    = _poolIndex(investment.strategy_id, new Date());
    const todayGainPct   = todayEndIdx > 0 ? ((todayEndIdx / todayStartIdx) - 1) * 100 : 0;
    const todayGainAmt   = amount * (todayGainPct / 100);
    const todayGainStr   = 'Modeled pool move: ' + (todayGainPct >= 0 ? '+' : '') + todayGainPct.toFixed(2) + '% (' + (todayGainAmt >= 0 ? '+' : '') + fmt(todayGainAmt) + ')';
    const todayEl = el('div', 'font-size:10px;font-weight:700;margin-bottom:5px;', todayGainStr);
    todayEl.style.color = todayGainPct >= 0 ? '#10b981' : '#ef4444';
    valLeft.appendChild(todayEl);
    valLeft.appendChild(el('div', 'font-size:10px;font-weight:700;color:var(--color-text-tertiary);letter-spacing:0.7px;text-transform:uppercase;margin-bottom:4px;', 'Estimated Claim Value'));

    // Monetary estimate mirrors the server claim formula. The modeled pool
    // index below is explanatory context only and cannot change this value.
    const valDisplay = el('div', 'font-size:26px;font-weight:900;letter-spacing:-0.8px;color:var(--color-text-primary);', fmt(estVal));
    valDisplay.id = 'vault-live-full-' + investment.id;
    valLeft.appendChild(valDisplay);

    // Pool share
    const share     = _poolShare(amount, strategy.id);
    const shareSpan = el('div', 'font-size:10px;color:var(--color-text-tertiary);margin-top:3px;', 'Illustrative pool share: ' + share.toFixed(3) + '%');
    valLeft.appendChild(shareSpan);
    valRow.appendChild(valLeft);

    // 7-day index change badge
    const series     = _indexSeries(strategy.id, 7);
    const weekChange = series.length >= 2 ? ((series[series.length - 1] / series[0]) - 1) * 100 : 0;
    const wkBadge    = el('div', 'text-align:right;');
    wkBadge.appendChild(el('div', 'font-size:9px;color:var(--color-text-tertiary);margin-bottom:2px;', '7d sim.'));
    const wkVal = el('div', 'font-size:12px;font-weight:800;', (weekChange >= 0 ? '+' : '') + weekChange.toFixed(2) + '%');
    wkVal.style.color = weekChange >= 0 ? '#10b981' : '#ef4444';
    wkBadge.appendChild(wkVal);
    valRow.appendChild(wkBadge);
    valBlock.appendChild(valRow);

    // Sparkline
    valBlock.appendChild(_buildSparkline(strategy.id));
    body.appendChild(valBlock);

    // ── 30-day projected trajectory curve ────────────────────────────────
    // Shows the pool's daily compounding path from entry to target.
    // Canvas is drawn once on mount; the "today" dot is updated by the live
    // ticker so users see their position moving each tick.
    if (strategy.id === 'alpha-seeker') {
      const curveBlock = el('div', [
        'border-radius:10px;padding:12px 14px;margin-bottom:12px;',
        'background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);'
      ].join(''));

      const curveHeader = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;');
      curveHeader.appendChild(el('span', 'font-size:10px;font-weight:700;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.5px;', '30-Day Trajectory'));
      const targetLbl = el('span', 'font-size:10px;font-weight:700;color:#10b981;', 'Target ×1.67');
      curveHeader.appendChild(targetLbl);
      curveBlock.appendChild(curveHeader);

      const curveCanvas = document.createElement('canvas');
      curveCanvas.style.cssText = 'width:100%;display:block;border-radius:6px;';
      curveCanvas.id = 'trajectory-' + investment.id;
      curveBlock.appendChild(curveCanvas);

      // Day label below curve
      const curveFoot = el('div', 'display:flex;justify-content:space-between;margin-top:6px;');
      const dayLbl    = el('span', 'font-size:10px;color:var(--color-text-tertiary);', '');
      dayLbl.id = 'traj-day-' + investment.id;
      const projLbl   = el('span', 'font-size:10px;font-weight:700;color:#10b981;', '');
      projLbl.id = 'traj-proj-' + investment.id;
      curveFoot.appendChild(dayLbl);
      curveFoot.appendChild(projLbl);
      curveBlock.appendChild(curveFoot);
      body.appendChild(curveBlock);

      // Draw curve after DOM insertion (needs offsetWidth)
      requestAnimationFrame(() => {
        const DPR   = window.devicePixelRatio || 1;
        const W     = curveCanvas.offsetWidth  || 280;
        const H     = 96;
        curveCanvas.width  = W * DPR;
        curveCanvas.height = H * DPR;
        curveCanvas.style.height = H + 'px';
        const ctx = curveCanvas.getContext('2d');
        ctx.scale(DPR, DPR);

        const DAYS  = strategy.duration || 30;
        const entryDate = new Date(investment.created_at || Date.now());

        // Build daily index values for the full cycle
        const dailyVals = [];
        for (let d = 0; d <= DAYS; d++) {
          const dt = new Date(entryDate); dt.setDate(dt.getDate() + d);
          dailyVals.push(_poolIndex(strategy.id, dt));
        }
        const startIdx = dailyVals[0];
        const endIdx   = dailyVals[DAYS];

        // Y range: 0.95 to target +5%
        const yMin = startIdx * 0.95;
        const yMax = endIdx   * 1.05;

        const PAD = { top: 10, right: 8, bottom: 4, left: 8 };
        const cW  = W - PAD.left - PAD.right;
        const cH  = H - PAD.top  - PAD.bottom;

        const toX = (d) => PAD.left + (d / DAYS) * cW;
        const toY = (v) => PAD.top  + cH - ((v - yMin) / (yMax - yMin)) * cH;

        // Target dashed line at endIdx
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(16,185,129,0.25)';
        ctx.lineWidth = 1;
        const ty = toY(endIdx);
        ctx.beginPath(); ctx.moveTo(PAD.left, ty); ctx.lineTo(W - PAD.right, ty);
        ctx.stroke();
        ctx.restore();

        // Determine today's position
        const msPerDay  = 86400000;
        const rawDay    = (Date.now() - entryDate.getTime()) / msPerDay;
        const todayDay  = Math.max(0, Math.min(DAYS, rawDay));
        const todayIdx  = _poolIndex(strategy.id, new Date());

        // Gradient fill under curve (only up to today)
        const todayX = toX(todayDay);
        const grad = ctx.createLinearGradient(0, PAD.top, 0, H);
        grad.addColorStop(0, 'rgba(16,185,129,0.18)');
        grad.addColorStop(1, 'rgba(16,185,129,0)');

        // Draw filled region up to today
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(dailyVals[0]));
        for (let d = 1; d <= Math.ceil(todayDay); d++) {
          const di = Math.min(d, dailyVals.length - 1);
          const x1 = toX(d - 1); const y1 = toY(dailyVals[di - 1] || dailyVals[0]);
          const x2 = toX(d);     const y2 = toY(dailyVals[di]);
          const mx = (x1 + x2) / 2;
          ctx.quadraticCurveTo(mx, y1, x2, y2);
        }
        ctx.lineTo(todayX, H - PAD.bottom);
        ctx.lineTo(toX(0), H - PAD.bottom);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();

        // Future dotted path (today → end)
        ctx.save();
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = 'rgba(16,185,129,0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const startFutureDay = Math.floor(todayDay);
        if (startFutureDay < DAYS) {
          ctx.moveTo(toX(startFutureDay), toY(dailyVals[startFutureDay] || todayIdx));
          for (let d = startFutureDay + 1; d <= DAYS; d++) {
            const x1 = toX(d - 1); const y1 = toY(dailyVals[d - 1]);
            const x2 = toX(d);     const y2 = toY(dailyVals[d]);
            ctx.quadraticCurveTo((x1 + x2) / 2, y1, x2, y2);
          }
        }
        ctx.stroke();
        ctx.restore();

        // Solid curve up to today
        ctx.save();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(dailyVals[0]));
        for (let d = 1; d <= Math.ceil(todayDay); d++) {
          const di = Math.min(d, dailyVals.length - 1);
          const x1 = toX(d - 1); const y1 = toY(dailyVals[Math.max(0, di - 1)]);
          const x2 = toX(d);     const y2 = toY(dailyVals[di]);
          ctx.quadraticCurveTo((x1 + x2) / 2, y1, x2, y2);
        }
        ctx.stroke();
        ctx.restore();

        // Today dot — glowing
        const dotX   = toX(todayDay);
        const dotY   = toY(todayIdx);
        // Outer glow ring
        ctx.save();
        ctx.beginPath();
        ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(16,185,129,0.2)';
        ctx.fill();
        ctx.restore();
        // Inner dot
        ctx.save();
        ctx.beginPath();
        ctx.arc(dotX, dotY, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#10b981';
        ctx.fill();
        ctx.restore();

        // Update foot labels
        const dayNum  = Math.max(1, Math.floor(todayDay) + 1);
        const projVal = amount * (todayIdx / startIdx);
        const dayEl   = document.getElementById('traj-day-' + investment.id);
        const prEl    = document.getElementById('traj-proj-' + investment.id);
        if (dayEl) dayEl.textContent = 'Day ' + dayNum + ' of ' + DAYS;
        if (prEl)  prEl.textContent  = fmt(projVal);
      });
    }

    // ── Stats row ────────────────────────────────────────────────────────
    const statsGrid = el('div', 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;');
    const todayIdx  = _poolIndex(strategy.id, new Date());
    [
      { label: 'Invested',    value: fmt(amount),            color: 'var(--color-text-primary)' },
      { label: 'Unrealised',  value: (gain >= 0 ? '+' : '') + fmt(gain), color: gain >= 0 ? '#10b981' : '#ef4444' },
      { label: 'Pool Index',  value: todayIdx.toFixed(4),   color: 'var(--color-text-secondary)' }
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
      barFill.style.background = isMatured ? '#10b981' : '#3b82f6';
      barBg.appendChild(barFill);
      pw.appendChild(barBg);
      body.appendChild(pw);
    }

    // ── Live feed ────────────────────────────────────────────────────────
    const feedEl = _buildLiveFeed(strategy.id);
    feedEl.dataset.vaultFeed = '1';
    body.appendChild(feedEl);

    // ── CTA buttons ──────────────────────────────────────────────────────
    const btnRow = el('div', 'display:flex;gap:8px;margin-top:14px;');
    if (isMatured) {
      const claimBtn = el('button', 'flex:1;padding:13px;font-size:14px;font-weight:800;border:none;border-radius:10px;cursor:pointer;background:#10b981;color:var(--color-on-accent);transition:opacity 0.15s;', 'Claim to Wallet');
      claimBtn.addEventListener('click', async () => {
        if (claimBtn.disabled) return;
        claimBtn.disabled = true;
        claimBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;font-size:12px;"></i>Processing...';
        try {
          await handleClaim(investment, true);
        } catch (_) {
          claimBtn.disabled = false;
          claimBtn.textContent = 'Claim to Wallet';
        }
      });
      btnRow.appendChild(claimBtn);
    } else {
      const { daysRemaining } = calcEarlyPenalty(investment);
      const earlyBtn = el('button', 'flex:1;padding:12px;font-size:12px;font-weight:700;border-radius:10px;cursor:pointer;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2);color:#ef4444;transition:opacity 0.15s;', 'Early Exit (' + daysRemaining + 'd left)');
      earlyBtn.addEventListener('click', async () => {
        if (earlyBtn.disabled) return;
        earlyBtn.disabled = true;
        earlyBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;font-size:11px;"></i>Processing...';
        try {
          await handleClaim(investment, false);
        } catch (_) {
          earlyBtn.disabled = false;
          earlyBtn.textContent = 'Early Exit (' + daysRemaining + 'd left)';
        }
      });
      btnRow.appendChild(earlyBtn);
    }
    body.appendChild(btnRow);

    itemEl.appendChild(body);

    // ── Canonical value refresh + Day-15 strategy context ───────────────
    if (!isCompleted && !isMatured) {
      const createdMs = Date.parse(investment.created_at || '');
      const elapsedDays = Number.isFinite(createdMs) ? Math.max(0, (Date.now() - createdMs) / 86400000) : 0;

      // ── Day-15 Smart Context Card ──────────────────────────────────────
      // Fires once when elapsed time is between 13.5 and 16.5 days.
      // Shows mid-cycle progress, projects final value, and invites the
      // user to compound while keeping modeled activity separate from authoritative claim math.
      const midWindowKey = investment.id + '_day15ctx';
      if (elapsedDays >= 13.5 && elapsedDays <= 16.5 && !_milestoneChecked.has(midWindowKey)) {
        _milestoneChecked.add(midWindowKey);
        const { totalReturn, durationSec } = _strategyCycleParams(investment.strategy_id);
        const midGain      = estVal - amount;
        const midGainPct   = amount > 0 ? (midGain / amount) * 100 : 0;
        const daysLeft     = Math.max(0, Math.ceil(
          (new Date(investment.matures_at).getTime() - Date.now()) / 86400000
        ));
        const feeRate = Number(strategy.perfFee || 0) / 100;
        const projectedFinal = amount + (amount * totalReturn * (1 - feeRate));
        const projectedRemain = Math.max(0, projectedFinal - estVal);

        const ctx = el('div');
        ctx.style.cssText = [
          'border-radius:12px;padding:14px 16px;margin-bottom:12px;',
          'background:linear-gradient(135deg,rgba(59,130,246,0.10),rgba(16,185,129,0.08));',
          'border:1px solid rgba(59,130,246,0.25);position:relative;overflow:hidden;'
        ].join('');

        // Glow stripe at top
        const glow = el('div');
        glow.style.cssText = 'position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#3b82f6,#10b981);';
        ctx.appendChild(glow);

        const ctxHead = el('div', 'display:flex;align-items:center;gap:8px;margin-bottom:10px;');
        const pulse   = el('span');
        pulse.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#3b82f6;display:inline-block;animation:pulse 1.5s ease-in-out infinite;flex-shrink:0;';
        ctxHead.appendChild(pulse);
        ctxHead.appendChild(el('span','font-size:11px;font-weight:800;color:#3b82f6;text-transform:uppercase;letter-spacing:0.8px;','Smart Update · Day ~15'));
        ctx.appendChild(ctxHead);

        const ctxTitle = el('div','font-size:14px;font-weight:800;color:var(--color-text-primary);margin-bottom:6px;line-height:1.3;',
          '📈 You\'re tracking right on target.');
        ctx.appendChild(ctxTitle);

        const ctxBody = el('div','font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin-bottom:12px;');
        ctxBody.innerHTML = 'Your position is up <strong style="color:#10b981;">+'
          + midGainPct.toFixed(2) + '%</strong> at the halfway mark. '
          + 'At this rate, the pool projects <strong style="color:var(--color-text-primary);">'
          + fmt(projectedFinal) + '</strong> at maturity — '
          + '<strong style="color:#10b981;">+' + fmt(projectedRemain) + '</strong> still to grow over '
          + daysLeft + ' days.';
        ctx.appendChild(ctxBody);

        // Mini stats row
        const ctxStats = el('div','display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px;');
        [
          { label: 'Current gain',  val: '+' + midGainPct.toFixed(2) + '%', color: '#10b981'  },
          { label: 'Days left',     val: daysLeft + 'd',                     color: '#f59e0b'  },
          { label: 'Projected end', val: fmt(projectedFinal),                color: '#3b82f6'  }
        ].forEach(s => {
          const c = el('div','background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:8px;text-align:center;');
          const v = el('div','font-size:11px;font-weight:800;', s.val);
          v.style.color = s.color;
          c.appendChild(v);
          c.appendChild(el('div','font-size:9px;color:var(--color-text-tertiary);margin-top:2px;letter-spacing:0.3px;', s.label));
          ctxStats.appendChild(c);
        });
        ctx.appendChild(ctxStats);

        const ctxCta = el('button',
          'width:100%;padding:11px;border-radius:9px;font-size:12px;font-weight:800;border:none;cursor:pointer;background:var(--color-primary);color:var(--color-on-accent);',
          '⚡ Lock More In — Compound Your Return');
        ctxCta.addEventListener('click', () => {
          const s = STRATEGIES.find(st => st.id === investment.strategy_id) || STRATEGIES[0];
          openStrategyDetail(s);
        });
        ctx.appendChild(ctxCta);

        body.insertBefore(ctx, body.querySelector('[data-vault-feed]') || body.lastChild);
      }

      // Refresh the monetary estimate from the same deterministic formula the
      // claim modal uses. No cosmetic random walk is allowed to change money.
      const displayTimer = setInterval(() => {
        if (_destroyed) { clearInterval(displayTimer); return; }
        const displayEl = document.getElementById('vault-live-full-' + investment.id);
        if (!displayEl) { clearInterval(displayTimer); _liveTimers.delete(displayTimer); return; }
        displayEl.textContent = fmt(_estimatedValue(investment));
      }, 4000);
      _liveTimers.add(displayTimer);
    }

    return itemEl;
  }

  // ============================================
  // TAB: EXPLORE
  // ============================================

  function renderExploreTab(container) {
    container.innerHTML = '';
    const recommendedId = getRecommendedId();
    const profile       = (() => { try { return localStorage.getItem('nextrade_investor_profile'); } catch (_) { return null; } })();

    if (profile) {
      const isPlanA = profile === 'steady-accumulator';
      const banner  = el('div', 'display:flex;align-items:center;gap:12px;border-radius:14px;padding:12px 14px;margin-bottom:20px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);');
      const bIcon   = el('div', 'width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;');
      bIcon.style.background = isPlanA ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)';
      bIcon.textContent = isPlanA ? '\u{1F6E1}\uFE0F' : '\u26A1';
      const bTxt = el('div', 'flex:1;');
      bTxt.appendChild(el('div', 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:2px;', 'Recommended based on your profile'));
      bTxt.appendChild(el('div', 'font-size:13px;font-weight:700;color:var(--color-text-primary);', isPlanA ? 'Steady Accumulator \u2014 Strategy A' : 'Surge Pool \u2014 Strategy B'));
      banner.appendChild(bIcon); banner.appendChild(bTxt);
      container.appendChild(banner);
    }

    const sorted = [...STRATEGIES].sort((a, b) => (b.id === recommendedId ? 1 : 0) - (a.id === recommendedId ? 1 : 0));
    sorted.forEach(s => container.appendChild(buildPlanCard(s, s.id === recommendedId)));
  }

  // ============================================
  // TAB: PORTFOLIO
  // ============================================

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

    // ── Empty state ──
    if (active.length === 0 && completed.length === 0) {
      const empty = el('div', 'text-align:center;padding:48px 20px;');
      empty.appendChild(el('div', 'font-size:48px;margin-bottom:16px;', '\uD83C\uDF31'));
      empty.appendChild(el('div', 'font-size:18px;font-weight:800;color:var(--color-text-primary);margin-bottom:8px;letter-spacing:-0.3px;', 'No active investments'));
      empty.appendChild(el('div', 'font-size:14px;color:var(--color-text-secondary);margin-bottom:24px;line-height:1.5;', 'Start from $100. Your money works while you sleep.'));
      const startBtn = el('button', 'padding:14px 28px;font-size:14px;font-weight:700;border-radius:12px;cursor:pointer;background:var(--color-primary);color:var(--color-on-accent);border:none;', 'View Strategies');
      startBtn.addEventListener('click', () => switchTab('explore'));
      empty.appendChild(startBtn);
      panel.appendChild(empty);
      return;
    }

    // ── Overall summary header ──
    if (active.length > 0) {
      const totalInvested = active.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
      const totalEst      = active.reduce((s, i) => {
        return s + _estimatedValue(i);
      }, 0);
      const totalGain    = totalEst - totalInvested;
      const totalGainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;
      const matured      = active.filter(i => i.matures_at && new Date(i.matures_at) <= new Date());

      const summaryCard = el('div', 'border-radius:14px;padding:16px;margin-bottom:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);');
      const sumRow      = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:' + (matured.length > 0 ? '12px' : '0') + ';');

      const sumLeft = el('div');
      sumLeft.appendChild(el('div', 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.6px;', 'Total Deployed'));
      sumLeft.appendChild(el('div', 'font-size:24px;font-weight:800;color:var(--color-text-primary);letter-spacing:-0.5px;', fmt(totalInvested)));
      const gainEl = el('div', 'font-size:13px;font-weight:700;margin-top:2px;', (totalGain >= 0 ? '+' : '') + fmt(totalGain) + ' unrealised (' + totalGainPct.toFixed(1) + '%)');
      gainEl.style.color = totalGain >= 0 ? '#10b981' : '#ef4444';
      sumLeft.appendChild(gainEl);

      const sumRight = el('div', 'text-align:right;');
      sumRight.appendChild(el('div', 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:4px;', 'Positions'));
      sumRight.appendChild(el('div', 'font-size:24px;font-weight:800;color:var(--color-text-primary);', String(active.length)));
      sumRow.appendChild(sumLeft); sumRow.appendChild(sumRight);
      summaryCard.appendChild(sumRow);

      // Claim bar
      if (matured.length > 0) {
        const maturedVal  = matured.reduce((s, i) => s + _estimatedValue(i), 0);
        const claimBar    = el('div', 'display:flex;align-items:center;justify-content:space-between;background:rgba(16,185,129,0.10);border:1px solid rgba(16,185,129,0.22);border-radius:10px;padding:10px 12px;');
        claimBar.appendChild(el('span', 'font-size:13px;font-weight:700;color:#10b981;', '\u2713 ' + matured.length + ' ready to claim \u2014 ' + fmt(maturedVal)));
        const claimAllBtn = el('button', 'font-size:12px;font-weight:700;color:#10b981;background:rgba(16,185,129,0.14);border:1px solid rgba(16,185,129,0.28);border-radius:7px;padding:6px 12px;cursor:pointer;transition:opacity 0.15s;', 'Claim All');
        claimAllBtn.addEventListener('click', async () => {
          if (claimAllBtn.disabled) return;
          claimAllBtn.disabled = true;
          claimAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;font-size:11px;"></i>Claiming\u2026';
          try { await handleClaimAll(); }
          catch (_) { claimAllBtn.disabled = false; claimAllBtn.textContent = 'Claim All'; }
        });
        claimBar.appendChild(claimAllBtn);
        summaryCard.appendChild(claimBar);
      }
      panel.appendChild(summaryCard);

      // ── Strategy groups ──
      // Group active positions by strategy_id
      const groups = {};
      active.forEach(inv => {
        const sid = inv.strategy_id || 'unknown';
        if (!groups[sid]) groups[sid] = [];
        groups[sid].push(inv);
      });

      Object.keys(groups).forEach(sid => {
        panel.appendChild(buildStrategyGroup(sid, groups[sid]));
      });
    }

    // ── Completed history ──
    if (completed.length > 0) {
      const histHeader = el('div', 'font-size:13px;font-weight:700;color:var(--color-text-tertiary);margin:20px 0 12px;', 'Closed Positions');
      panel.appendChild(histHeader);
      completed.slice(0, 6).forEach(inv => panel.appendChild(buildActiveInvestmentItem(inv, true)));
    }
  }

  // ── Strategy Group Card ──────────────────────────────────────────────────
  // Shows summary for all positions under one strategy.
  // Tap header to expand/collapse the position list.

  function buildStrategyGroup(strategyId, positions) {
    const strategy = STRATEGIES.find(s => s.id === strategyId) || {
      id: strategyId, name: strategyId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      icon: '\uD83D\uDCC8', riskColor: 'var(--color-text-primary)', category: 'Vault Strategy'
    };

    const totalInvested = positions.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
    const totalEst      = positions.reduce((s, i) => s + _estimatedValue(i), 0);
    const totalGain    = totalEst - totalInvested;
    const gainPct      = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;
    const maturedCount = positions.filter(i => i.matures_at && new Date(i.matures_at) <= new Date()).length;

    let expanded = false;
    const wrapper = el('div', 'margin-bottom:12px;');

    // Header card (always visible)
    const header = el('div', 'border-radius:14px;padding:14px 16px;background:var(--color-surface-elevated);border:1px solid rgba(255,255,255,0.09);cursor:pointer;transition:border-color 0.2s;');
    if (maturedCount > 0) header.style.borderColor = 'rgba(16,185,129,0.3)';

    const headerTop = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:12px;');

    // Left: icon + name + position count
    const hLeft = el('div', 'display:flex;align-items:center;gap:10px;flex:1;min-width:0;');
    const iconBox = el('div', 'width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;');
    iconBox.style.background = 'rgba(255,255,255,0.05)';
    iconBox.style.border     = '1px solid rgba(255,255,255,0.08)';
    iconBox.textContent      = strategy.icon;
    const hNameWrap = el('div', 'min-width:0;');
    hNameWrap.appendChild(el('div', 'font-size:14px;font-weight:800;color:var(--color-text-primary);', strategy.name));
    const subRow = el('div', 'display:flex;align-items:center;gap:8px;margin-top:2px;');
    const posCountPill = el('span', 'font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:rgba(255,255,255,0.07);color:var(--color-text-secondary);', positions.length + ' position' + (positions.length > 1 ? 's' : ''));
    subRow.appendChild(posCountPill);
    if (maturedCount > 0) {
      const maturePill = el('span', 'font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:rgba(16,185,129,0.15);color:#10b981;', '\u2713 ' + maturedCount + ' ready');
      subRow.appendChild(maturePill);
    }
    hNameWrap.appendChild(subRow);
    hLeft.appendChild(iconBox); hLeft.appendChild(hNameWrap);

    // Right: total + gain + chevron
    const hRight = el('div', 'text-align:right;flex-shrink:0;display:flex;align-items:center;gap:12px;');
    const valWrap = el('div');
    valWrap.appendChild(el('div', 'font-size:15px;font-weight:800;color:var(--color-text-primary);', fmt(totalInvested)));
    const gEl = el('div', 'font-size:11px;font-weight:700;margin-top:2px;', (totalGain >= 0 ? '+' : '') + gainPct.toFixed(1) + '%');
    gEl.style.color = totalGain >= 0 ? '#10b981' : '#ef4444';
    valWrap.appendChild(gEl);
    hRight.appendChild(valWrap);

    const chevron = el('div', 'font-size:12px;color:var(--color-text-tertiary);transition:transform 0.22s;', '\u25BC');
    chevron.style.transform = 'rotate(-90deg)';
    hRight.appendChild(chevron);

    headerTop.appendChild(hLeft); headerTop.appendChild(hRight);
    header.appendChild(headerTop);

    // Drawer: position list (hidden until expanded)
    const drawer = el('div', 'overflow:hidden;max-height:0;transition:max-height 0.3s cubic-bezier(0.4,0,0.2,1);');
    const drawerInner = el('div', 'padding-top:10px;display:flex;flex-direction:column;gap:8px;');
    let drawersBuilt = false;

    function buildDrawer() {
      if (drawersBuilt) return;
      drawersBuilt = true;
      positions.forEach(inv => drawerInner.appendChild(buildPositionMiniCard(inv)));
      drawer.appendChild(drawerInner);
    }

    function toggleGroup() {
      expanded = !expanded;
      chevron.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
      if (expanded) {
        buildDrawer();
        // Animate open: measure content height and animate to it
        drawer.style.maxHeight = drawerInner.scrollHeight + 48 + 'px';
        header.style.borderBottomLeftRadius = '0';
        header.style.borderBottomRightRadius = '0';
        header.style.borderBottom = '1px solid rgba(255,255,255,0.06)';
      } else {
        drawer.style.maxHeight = '0';
        header.style.borderBottomLeftRadius = '14px';
        header.style.borderBottomRightRadius = '14px';
        header.style.borderBottom = '';
      }
    }

    header.addEventListener('click', toggleGroup);
    wrapper.appendChild(header);
    wrapper.appendChild(drawer);
    return wrapper;
  }

  // ── Position Mini Card ───────────────────────────────────────────────────
  // Compact view of a single investment inside the strategy group drawer.

  function buildPositionMiniCard(investment) {
    const strategy  = getStrategyForInvestment(investment);
    const amount    = parseFloat(investment.amount || 0);
    const isMatured = investment.matures_at && new Date(investment.matures_at) <= new Date();
    const estVal    = _estimatedValue(investment);
    const gain      = estVal - amount;
    const gainPct   = amount > 0 ? (gain / amount) * 100 : 0;

    // Progress
    const created    = new Date(investment.created_at || Date.now()).getTime();
    const maturesAt  = investment.matures_at ? new Date(investment.matures_at).getTime() : NaN;
    const progress   = Number.isFinite(maturesAt) && maturesAt > created
      ? Math.max(0, Math.min(1, (Date.now() - created) / (maturesAt - created))) : 0;

    // Remaining time
    const diff = Number.isFinite(maturesAt) ? maturesAt - Date.now() : 0;
    let timeStr = diff <= 0 ? 'Ready now' : (() => {
      const days = Math.floor(diff / 86400000);
      const hrs  = Math.floor((diff % 86400000) / 3600000);
      return days > 0 ? days + 'd ' + hrs + 'h left' : Math.floor(diff / 3600000) + 'h left';
    })();

    const card = el('div', 'border-radius:12px;padding:12px 14px;background:var(--color-surface-elevated);border:1px solid var(--color-border);');
    if (isMatured) card.style.borderColor = 'rgba(16,185,129,0.25)';

    // Top row: amount · time · live value
    const topRow = el('div', 'display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px;');
    const mLeft  = el('div');
    mLeft.appendChild(el('div', 'font-size:13px;font-weight:700;color:var(--color-text-primary);', fmt(amount) + ' invested'));

    const statusEl = el('div', 'font-size:10px;font-weight:700;margin-top:3px;', isMatured ? '\u2713 Ready to Claim' : '\u25CF Active \u00B7 ' + timeStr);
    statusEl.style.color = isMatured ? 'var(--color-success)' : 'var(--color-text-tertiary)';
    mLeft.appendChild(statusEl);

    const mRight = el('div', 'text-align:right;');

    // Current value — deterministic preview of the server claim formula.
    const liveEl     = el('div', 'font-size:15px;font-weight:800;color:var(--color-text-primary);', fmt(estVal));
    liveEl.id        = 'vault-live-mini-' + investment.id;
    const gainLabel  = el('div', 'font-size:10px;font-weight:700;margin-top:2px;', (gain >= 0 ? '+' : '') + gainPct.toFixed(2) + '%');
    gainLabel.style.color = gain >= 0 ? '#10b981' : '#ef4444';
    mRight.appendChild(liveEl); mRight.appendChild(gainLabel);
    topRow.appendChild(mLeft); topRow.appendChild(mRight);
    card.appendChild(topRow);

    // Progress bar
    const bar  = el('div', 'width:100%;height:4px;border-radius:999px;background:var(--color-border);overflow:hidden;margin-bottom:10px;');
    const fill = el('div', 'height:100%;border-radius:999px;');
    fill.style.width      = Math.max(4, Math.round(progress * 100)) + '%';
    fill.style.background = isMatured ? '#10b981' : strategy.riskColor;
    bar.appendChild(fill); card.appendChild(bar);

    // Bottom row: claim button OR progress label
    if (isMatured) {
      const claimBtn = el('button', 'width:100%;padding:9px;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;background:var(--color-success-bg);color:var(--color-success);border:1px solid var(--color-success-border);', 'Claim ' + fmt(estVal) + ' \u2192');
      claimBtn.addEventListener('click', async () => {
        claimBtn.disabled = true;
        claimBtn.textContent = 'Claiming\u2026';
        try { await handleClaim(investment, false); }
        catch (_) { claimBtn.disabled = false; claimBtn.textContent = 'Claim ' + fmt(estVal) + ' \u2192'; }
      });
      card.appendChild(claimBtn);
    } else {
      const foot = el('div', 'display:flex;align-items:center;justify-content:space-between;');
      foot.appendChild(el('div', 'font-size:10px;color:var(--color-text-tertiary);', Math.round(progress * 100) + '% through term'));
      // "Add more" CTA
      const addBtn = el('button', 'font-size:11px;font-weight:700;color:var(--color-text-secondary);background:var(--color-surface);border:1px solid var(--color-border);border-radius:7px;padding:4px 10px;cursor:pointer;', 'Add more \u2192');
      addBtn.addEventListener('click', e => { e.stopPropagation(); openStrategyDetail(strategy); });
      foot.appendChild(addBtn);
      card.appendChild(foot);
    }

    // Keep the mini-card estimate synchronized with the canonical claim math.
    const displayTimer = setInterval(() => {
      if (_destroyed) { clearInterval(displayTimer); return; }
      const el_ = document.getElementById('vault-live-mini-' + investment.id);
      if (!el_) { clearInterval(displayTimer); _liveTimers.delete(displayTimer); return; }
      el_.textContent = fmt(_estimatedValue(investment));
    }, 4000);
    _liveTimers.add(displayTimer);

    return card;
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
      btn.style.color      = active ? 'var(--color-on-accent)' : 'var(--color-text-secondary)';
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

    // Inject item fade-in animation keyframes (idempotent)
    if (!document.getElementById('ntm-vault-anim')) {
      const _vanim = document.createElement('style');
      _vanim.id = 'ntm-vault-anim';
      _vanim.textContent = '@keyframes ntm-item-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}';
      document.head.appendChild(_vanim);
    }

    // Match wallet baseline: flex column, padding:0, no height override that fights flex parent
    element.style.cssText = [
      'display: flex',
      'flex-direction: column',
      'overflow-y: auto',
      'overflow-x: hidden',
      'width: 100%',
      'padding: 0',
      'box-sizing: border-box',
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
    vaultWrapper.style.paddingBottom = 'var(--scroll-bottom-clearance, 116px)';

    const pageHeader = el('div', 'padding:16px 16px 4px;');
    pageHeader.appendChild(el('p', 'font-size:13px;color:var(--color-text-tertiary);margin:0;line-height:1.4;', 'Two strategies. Transparent mechanics. Cycle returns set by pool performance, not promises.'));
    vaultWrapper.appendChild(pageHeader);

    const tabBarContainer = el('div');
    tabBarContainer.className = 'vault-tab-shell';
    tabBarContainer.style.cssText = [
      'position: sticky',
      'top: 0',
      'z-index: 50',
      'padding: 10px 16px',
      'background: var(--color-app-bg, #0a0c10)',
      'box-shadow: 0 4px 12px -2px rgba(0,0,0,0.6)'
    ].join(';');

    const tabBar      = el('div', 'display:flex;background:var(--color-surface);padding:4px;border-radius:12px;border:1px solid var(--color-border);');
    tabBar.className = 'vault-segmented';
    const activeCount = (investments || []).filter(i => i.status === 'active').length;
    [
      { id: 'explore',   label: 'Strategies' },
      { id: 'portfolio', label: 'My Portfolio (' + activeCount + ')' }
    ].forEach(tab => {
      const btn = el('button');
      btn.className = 'vault-segmented__item';
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

    const contentWrapper = el('div', 'padding:16px 0 0;position:relative;z-index:10;');

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
    // Cancel any milestone toast that hasn't fired yet — otherwise a toast
    // scheduled while Vault was open can still pop up 600ms later on
    // whatever panel the user has since navigated to.
    _milestoneTimers.forEach(id => clearTimeout(id));
    _milestoneTimers.clear();
    if (_container) _container.style.overflowY = '';
    _container = null;
    _milestoneChecked.clear();   // in-card render dedupe only — original per-session behavior, unchanged
    // NOTE: _toastShown is intentionally NOT cleared here. It's the
    // permanent "already shown" record (persisted via Storage), so a
    // milestone toast fires once per investment for the life of the
    // account — not once per Vault visit. See _loadMilestoneStore/
    // _persistMilestoneStore above.
  }

  function cleanup() { destroy(); }

  function refresh() {
    if (_destroyed || !_container) return;
    syncInvestmentsFromDB().then(() => { if (_activeTab === 'portfolio') renderPortfolioTab(); });
  }

  // ============================================
  // INVESTOR PROFILE QUIZ
  // ============================================

  function openQuiz() {
    if (!window.Modal) return;

    const QUESTIONS = [
      {
        q: 'How long are you comfortable locking your funds?',
        opts: [
          { text: '30 days or less',    vote: 'alpha'  },
          { text: '60\u201390 days',   vote: 'steady' },
          { text: 'As long as needed',  vote: 'steady' }
        ]
      },
      {
        q: 'If your investment drops 15% temporarily, you would:',
        opts: [
          { text: 'Exit immediately',               vote: 'steady' },
          { text: 'Hold and wait it out',           vote: 'steady' },
          { text: 'See it as a buying opportunity', vote: 'alpha'  }
        ]
      },
      {
        q: 'Which return profile fits you?',
        opts: [
          { text: 'Steady 18\u201326% per 90-day cycle \u2014 lower volatility',  vote: 'steady' },
          { text: 'Potentially 55\u201380% per 30-day cycle \u2014 higher risk',  vote: 'alpha'  }
        ]
      }
    ];

    let step = 0;
    const votes = [];
    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;gap:0;';

    function renderStep() {
      content.innerHTML = '';

      // Progress bar
      const dots = el('div', 'display:flex;gap:6px;justify-content:center;margin-bottom:20px;');
      QUESTIONS.forEach((_, i) => {
        const dot = el('div');
        dot.style.cssText = 'height:4px;border-radius:2px;transition:all 0.3s;' +
          'background:' + (i < step ? '#3b82f6' : i === step ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)') + ';' +
          'width:' + (i === step ? '28px' : '10px') + ';';
        dots.appendChild(dot);
      });
      content.appendChild(dots);

      const q = QUESTIONS[step];
      content.appendChild(el('div', 'font-size:10px;font-weight:700;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;', 'Question ' + (step + 1) + ' of ' + QUESTIONS.length));
      content.appendChild(el('div', 'font-size:16px;font-weight:700;color:var(--color-text-primary);line-height:1.4;margin-bottom:20px;', q.q));

      q.opts.forEach((opt, oi) => {
        const btn = el('button');
        btn.style.cssText = 'width:100%;text-align:left;padding:14px 16px;border-radius:12px;' +
          'border:1.5px solid rgba(255,255,255,0.09);background:rgba(255,255,255,0.03);' +
          'color:var(--color-text-primary);font-size:14px;font-weight:600;margin-bottom:10px;' +
          'cursor:pointer;transition:all 0.15s ease;display:block;' +
          'animation:ntm-item-in 0.18s ' + (oi * 60) + 'ms ease both;';
        btn.textContent = opt.text;
        btn.addEventListener('mouseenter', () => {
          btn.style.borderColor = 'rgba(59,130,246,0.4)';
          btn.style.background  = 'rgba(59,130,246,0.08)';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.borderColor = 'rgba(255,255,255,0.09)';
          btn.style.background  = 'rgba(255,255,255,0.03)';
        });
        btn.addEventListener('click', () => {
          votes.push(opt.vote);
          step++;
          if (step < QUESTIONS.length) renderStep();
          else showResult();
        });
        content.appendChild(btn);
      });
    }

    function showResult() {
      const alphaVotes = votes.filter(v => v === 'alpha').length;
      const result     = alphaVotes > votes.length / 2 ? 'alpha-seeker' : 'steady-accumulator';
      const strategy   = STRATEGIES.find(s => s.id === result);
      try { localStorage.setItem('nextrade_investor_profile', result); } catch (_) {}

      content.innerHTML = '';
      content.appendChild(el('div', 'text-align:center;font-size:48px;margin-bottom:16px;', strategy.icon));
      content.appendChild(el('div', 'font-size:19px;font-weight:800;color:var(--color-text-primary);text-align:center;margin-bottom:8px;letter-spacing:-0.3px;', 'You are a ' + strategy.name));
      content.appendChild(el('div', 'font-size:13px;color:var(--color-text-secondary);text-align:center;line-height:1.6;margin-bottom:20px;', strategy.tagline));

      const badge = el('div', 'display:flex;align-items:center;gap:12px;border-radius:12px;padding:12px 14px;margin-bottom:24px;');
      badge.style.background = strategy.riskColor + '12';
      badge.style.border = '1px solid ' + strategy.riskColor + '28';
      badge.appendChild(el('div', 'font-size:22px;', strategy.icon));
      const badgeTxt = el('div', 'flex:1;min-width:0;');
      badgeTxt.appendChild(el('div', 'font-size:12px;font-weight:700;color:var(--color-text-primary);margin-bottom:2px;', strategy.name + ' \u2014 ' + strategy.category));
      badgeTxt.appendChild(el('div', 'font-size:11px;color:var(--color-text-secondary);', 'Cycle target: ' + strategy.apyRange + ' \u00b7 Min: $' + strategy.minAmount.toLocaleString()));
      badge.appendChild(badgeTxt);
      content.appendChild(badge);

      const viewBtn = el('button', 'width:100%;padding:15px;border-radius:12px;font-size:15px;font-weight:800;border:none;color:var(--color-on-accent);cursor:pointer;background:var(--color-primary);margin-bottom:10px;', 'View My Plan \u2192');
      viewBtn.addEventListener('click', () => {
        if (window.Modal) Modal.close();
        setTimeout(() => { if (window.App) App.navigate('vault'); }, 200);
      });
      content.appendChild(viewBtn);

      const skipBtn = el('button', 'width:100%;padding:13px;border-radius:12px;font-size:14px;font-weight:600;border:1px solid var(--color-border);background:rgba(255,255,255,0.04);color:var(--color-text-secondary);cursor:pointer;', 'Maybe Later');
      skipBtn.addEventListener('click', () => { if (window.Modal) Modal.close(); });
      content.appendChild(skipBtn);
    }

    renderStep();
    Modal.open({ title: 'Find Your Investor Type', content, maxWidth: '440px' });
  }

  window.Vault = { render, refresh, destroy, cleanup, openInvestModal, openQuiz, handleClaimAll, syncInvestmentsFromDB };

})();
