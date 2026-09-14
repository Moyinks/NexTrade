// home.js
(function () {
  'use strict';

  // Strategy display names — mirrors STRATEGIES in vault.js (single source of truth is vault.js)
  const STRATEGY_NAMES = {
    'steady-accumulator': 'Steady Accumulator',
    'alpha-seeker':       'Surge Pool'
  };
  function strategyDisplayName(inv) {
    if (!inv) return 'Vault Strategy';
    return STRATEGY_NAMES[inv.strategy_id]
      || inv.strategy_name
      || (inv.strategy_id ? inv.strategy_id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null)
      || 'Vault Strategy';
  }

  let _container = null;
  let _scrollEl   = null;
  let _destroyed = false;
  let _ticker = null;
  let _refreshTimer = null;
  let _welcomeShown = false;
  let _subscriptions = [];

  function el(tag, css, text) {
    const node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (text != null) node.textContent = text;
    return node;
  }

  function state() {
    if (!window.AppState) {
      return {
        user: null,
        profile: null,
        balances: { spot: 0, vault: 0, total: 0 },
        holdings: {},
        investments: [],
        transactions: [],
        marketData: [],
        balanceSyncStatus: 'syncing'
      };
    }

    return {
      user: AppState.get('user') || null,
      profile: AppState.get('profile') || null,
      balances: AppState.get('balances') || { spot: 0, vault: 0, total: 0 },
      holdings: AppState.get('holdings') || {},
      investments: AppState.get('investments') || [],
      transactions: AppState.get('transactions') || [],
      marketData: AppState.get('marketData') || [],
      balanceSyncStatus: AppState.get('balanceSyncStatus') || 'syncing'
    };
  }

  function formatMoney(value) {
    const n = Number(value) || 0;
    if (window.Format && typeof Format.currency === 'function') return Format.currency(n);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatCompactMoney(value) {
    const n = Number(value) || 0;
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k';
    return formatMoney(n);
  }

  function formatPercent(value, digits = 2) {
    const n = Number(value) || 0;
    const sign = n > 0 ? '+' : '';
    return sign + n.toFixed(digits) + '%';
  }

  function formatRelativeTime(input) {
    if (window.Format && typeof Format.relativeTime === 'function') return Format.relativeTime(input);
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return '';
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    return days + 'd ago';
  }

  function safeText(value, fallback = '—') {
    if (value == null || value === '') return fallback;
    return String(value);
  }

  function firstName() {
    const s = state();
    const meta = (s.user || {}).user_metadata || {};
    const raw = (s.profile || {}).full_name || meta.full_name || meta.name || 'there';
    return String(raw).split(' ')[0] || 'there';
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function getStreak() {
    try {
      const today = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      const raw = localStorage.getItem('nextrade_streak');
      const streak = raw ? JSON.parse(raw) : { count: 0, lastDate: null };
      if (streak.lastDate === today) return streak;
      const next = {
        count: streak.lastDate === yesterday ? (streak.count || 0) + 1 : 1,
        lastDate: today
      };
      localStorage.setItem('nextrade_streak', JSON.stringify(next));
      return next;
    } catch (_) {
      return { count: 1, lastDate: null };
    }
  }

  function markOnboarded() {
    try { localStorage.setItem('nextrade_onboarded', '1'); } catch (_) {}
  }

  function isFirstLogin() {
    try { return !localStorage.getItem('nextrade_onboarded'); } catch (_) { return false; }
  }

  function portfolioTotal(snapshot) {
    const balances = snapshot.balances || {};
    let total = (Number(balances.spot) || 0) + (Number(balances.vault) || 0);

    const holdings = snapshot.holdings || {};
    const market = snapshot.marketData || [];
    Object.entries(holdings).forEach(([symbol, amount]) => {
      const qty = Number(amount) || 0;
      if (!qty) return;
      const id = String(symbol || '').toLowerCase();
      const coin = market.find(c => String(c.id || '').toLowerCase() === id || String(c.symbol || '').toLowerCase() === id);
      if (coin && Number(coin.current_price)) total += qty * Number(coin.current_price);
    });

    return total;
  }

  function portfolioChange(snapshot) {
    const market = snapshot.marketData || [];
    const holdings = snapshot.holdings || {};
    let cryptoValue = 0;
    let crypto24 = 0;

    Object.entries(holdings).forEach(([symbol, amount]) => {
      const qty = Number(amount) || 0;
      if (!qty) return;
      const id = String(symbol || '').toLowerCase();
      const coin = market.find(c => String(c.id || '').toLowerCase() === id || String(c.symbol || '').toLowerCase() === id);
      if (coin && Number(coin.current_price)) {
        const value = qty * Number(coin.current_price);
        cryptoValue += value;
        crypto24 += value * ((Number(coin.price_change_percentage_24h) || 0) / 100);
      }
    });

    return { cryptoValue, crypto24 };
  }

  function investmentProgress(inv) {
    const created = Date.parse(inv?.created_at || '');
    const maturesAt = inv?.matures_at ? Date.parse(inv.matures_at) : NaN;
    if (window.FinanceMath) {
      const estimate = FinanceMath.investmentEstimate(inv);
      return {
        progress: estimate.progress,
        atMaturity: estimate.atMaturity,
        currentEstimate: estimate.value,
        maturesAt
      };
    }
    const amount = Math.max(0, Number(inv?.amount) || 0);
    return { progress: 0, atMaturity: amount, currentEstimate: amount, maturesAt: Number.isFinite(maturesAt) ? maturesAt : created };
  }

  function timeRemaining(ts) {
    const target = Number(ts);
    if (!Number.isFinite(target)) return '—';
    const diff = target - Date.now();
    if (diff <= 0) return 'Ready now';
    const mins = Math.max(1, Math.floor(diff / 60000));
    const days = Math.floor(mins / 1440);
    const hrs = Math.floor((mins % 1440) / 60);
    const remMins = mins % 60;
    if (days > 0) return days + 'd ' + hrs + 'h left';
    if (hrs > 0) return hrs + 'h ' + remMins + 'm left';
    return remMins + 'm left';
  }

  function calcHolderCount(snapshot) {
    return Object.entries(snapshot.holdings || {}).filter(([, amt]) => (Number(amt) || 0) > 0).length;
  }

  function latestActivity(snapshot) {
    const txs = Array.isArray(snapshot.transactions) ? snapshot.transactions.slice() : [];
    return txs.sort((a, b) => new Date(b.created_at || b.timestamp || 0) - new Date(a.created_at || a.timestamp || 0)).slice(0, 5);
  }

  function typeMeta(tx) {
    const raw = String(tx?.type || tx?.status || '').toLowerCase();
    if (raw.includes('deposit')) return { label: 'Deposit', icon: '↓', tone: 'positive' };
    if (raw.includes('withdraw')) return { label: 'Withdrawal', icon: '↑', tone: 'negative' };
    if (raw.includes('claim')) return { label: 'Returns Claimed', icon: '✓', tone: 'positive' };
    if (raw.includes('invest')) return { label: 'Strategy Entry', icon: '⬡', tone: 'neutral' };
    if (raw.includes('sell')) return { label: 'Sell', icon: '↗', tone: 'negative' };
    if (raw.includes('buy')) return { label: 'Trade', icon: '↘', tone: 'neutral' };
    if (raw.includes('transfer')) return { label: 'Transfer', icon: '⇄', tone: 'neutral' };
    return { label: safeText(tx?.type, 'Activity'), icon: '•', tone: 'neutral' };
  }

  function ownedAssets(snapshot) {
    const market = snapshot.marketData || [];
    const holdings = snapshot.holdings || {};
    return Object.entries(holdings)
      .map(([symbol, amount]) => {
        const qty = Number(amount) || 0;
        if (qty <= 0) return null;
        const id = String(symbol || '').toLowerCase();
        const coin = market.find(c => String(c.id || '').toLowerCase() === id || String(c.symbol || '').toLowerCase() === id);
        if (!coin) return null;
        const value = qty * (Number(coin.current_price) || 0);
        return {
          id: coin.id || id,
          symbol: (coin.symbol || symbol).toUpperCase(),
          name: coin.name || symbol,
          qty,
          value,
          change24: Number(coin.price_change_percentage_24h) || 0,
          image: coin.image || ''
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.value - a.value);
  }

  function topMover(snapshot, excludeIds) {
    const market = snapshot.marketData || [];
    const excluded = new Set((excludeIds || []).map(s => String(s).toLowerCase()));
    return market
      .map(c => ({
        id: String(c.id || '').toLowerCase(),
        symbol: String(c.symbol || '').toUpperCase(),
        name: c.name || c.symbol || 'Asset',
        price: Number(c.current_price) || 0,
        change24: Number(c.price_change_percentage_24h) || 0,
        image: c.image || ''
      }))
      .filter(c => c.id && !excluded.has(c.id))
      .sort((a, b) => Math.abs(b.change24) - Math.abs(a.change24))[0] || null;
  }

  function heroCard(snapshot) {
    const total = portfolioTotal(snapshot);
    const change = portfolioChange(snapshot);
    const streak = getStreak();
    const hidden = localStorage.getItem('nextrade_hide_balance') === 'true';
    const ready = snapshot.balanceSyncStatus === 'ready';

    const card = el('button', [
      'width:100%',
      'border:none',
      'padding:16px',
      'border-radius:18px',
      'background:linear-gradient(180deg, rgba(10,16,28,1), rgba(6,10,18,1))',
      'border:1px solid rgba(255,255,255,0.08)',
      'box-shadow:0 12px 32px rgba(0,0,0,0.22)',
      'text-align:left',
      'cursor:pointer'
    ].join(';'));
    card.type = 'button';
    card.addEventListener('click', () => {
      if (window.App && typeof App.navigate === 'function') App.navigate('wallet');
    });

    const top = el('div', 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;');
    const left = el('div', 'min-width:0;flex:1;');

    const eyebrow = el('div', 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;');
    eyebrow.appendChild(el('div', 'font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:rgba(255,255,255,0.52);', greeting() + ', ' + firstName()));
    if (streak.count > 1) {
      eyebrow.appendChild(el('div', 'font-size:11px;font-weight:700;color:rgba(255,255,255,0.72);display:inline-flex;align-items:center;gap:4px;', '🔥 ' + streak.count + 'd streak'));
    }
    left.appendChild(eyebrow);

    const totalNode = el('div', 'font-family:var(--font-mono,monospace);font-size:30px;line-height:1.05;font-weight:800;letter-spacing:-0.9px;color:#fff;word-break:break-word;');
    totalNode.textContent = hidden ? '••••••••' : formatMoney(total);
    left.appendChild(totalNode);

    const row = el('div', 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;');
    const badge = el('div', 'display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:999px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);font-size:11px;font-weight:700;color:rgba(255,255,255,0.9);');
    badge.textContent = ready ? 'Live' : 'Syncing';
    row.appendChild(badge);

    const delta = el('div', 'font-size:11px;font-weight:700;color:' + (change.crypto24 >= 0 ? 'var(--color-success,#10b981)' : 'var(--color-danger,#ef4444)') + ';');
    delta.textContent = hidden ? 'Balance hidden' : ('24h ' + (change.crypto24 >= 0 ? '+' : '-') + formatMoney(Math.abs(change.crypto24)));
    row.appendChild(delta);

    const balanceNote = el('div', 'width:100%;font-size:12px;line-height:1.4;color:rgba(255,255,255,0.62);margin-top:2px;');
    if (!ready) {
      balanceNote.textContent = 'Loading your latest balances…';
    } else if (total <= 0) {
      balanceNote.textContent = 'Add funds to start moving money.';
    } else {
      balanceNote.textContent = 'Tap to open Wallet.';
    }

    left.appendChild(row);
    left.appendChild(balanceNote);

    const right = el('div', 'width:42px;height:42px;border-radius:14px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.18);color:#93c5fd;');
    right.innerHTML = '<i class="fas fa-wallet" style="font-size:14px"></i>';

    top.appendChild(left);
    top.appendChild(right);
    card.appendChild(top);

    return card;
  }

  function sectionShell(title, subtitle, actionText, actionHandler) {
    const wrap = el('section', 'display:flex;flex-direction:column;gap:10px;');
    const head = el('div', 'display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:0 16px;');
    const left = el('div', 'min-width:0;');
    left.appendChild(el('div', 'font-size:16px;font-weight:800;line-height:1.15;color:var(--color-text-primary,#fff);letter-spacing:-0.3px;', title));
    if (subtitle) left.appendChild(el('div', 'font-size:12px;line-height:1.4;color:var(--color-text-secondary,#94a3b8);margin-top:3px;', subtitle));
    head.appendChild(left);
    if (actionText && actionHandler) {
      const action = el('button', 'border:none;background:none;padding:0;margin:0;font-size:12px;font-weight:700;color:var(--color-primary,#60a5fa);cursor:pointer;flex-shrink:0;');
      action.textContent = actionText;
      action.addEventListener('click', actionHandler);
      head.appendChild(action);
    }
    wrap.appendChild(head);
    return wrap;
  }

  function investmentsSection(snapshot) {
    const active = (snapshot.investments || []).filter(inv => inv && inv.status === 'active');
    const shell = sectionShell('Active Strategies', 'Open positions in the Vault');

    if (!active.length) {
      const empty = el('div', 'border-radius:16px;padding:18px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;gap:12px;');
      const copy = el('div', 'min-width:0;flex:1;');
      copy.appendChild(el('div', 'font-size:14px;font-weight:700;color:var(--color-text-primary,#fff);margin-bottom:4px;', 'No active positions'));
      copy.appendChild(el('div', 'font-size:12px;line-height:1.4;color:var(--color-text-secondary,#94a3b8);', 'Open Vault to pick a strategy and start compounding.'));
      const btn = el('button', 'border:none;border-radius:12px;padding:10px 14px;background:var(--color-primary,#3b82f6);color:#fff;font-size:13px;font-weight:800;cursor:pointer;flex-shrink:0;');
      btn.textContent = 'Open Vault';
      btn.addEventListener('click', () => window.App && App.navigate('vault'));
      empty.appendChild(copy);
      empty.appendChild(btn);
      shell.appendChild(empty);
      return shell;
    }

    const list = el('div', 'display:flex;flex-direction:column;gap:10px;');
    active.slice(0, 4).forEach(inv => {
      const p      = investmentProgress(inv);
      const name   = strategyDisplayName(inv);
      const amount = Number(inv.amount) || 0;
      const atMat  = Number.isFinite(p.atMaturity) && p.atMaturity > amount ? p.atMaturity : amount;
      const profit  = atMat - amount;

      const box = el('button', 'width:100%;text-align:left;border-radius:16px;padding:14px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);cursor:pointer;display:flex;flex-direction:column;gap:10px;');
      box.type = 'button';
      box.addEventListener('click', () => {
        if (window.App && typeof App.navigate === 'function') App.navigate('vault');
      });

      const top  = el('div', 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-width:0;');
      const left = el('div', 'min-width:0;flex:1;');
      left.appendChild(el('div', 'font-size:14px;font-weight:800;line-height:1.2;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', name));
      left.appendChild(el('div', 'font-size:12px;color:rgba(255,255,255,0.55);margin-top:4px;', formatMoney(amount) + ' invested \u00B7 ' + timeRemaining(p.maturesAt)));
      top.appendChild(left);

      const right = el('div', 'text-align:right;flex-shrink:0;');
      right.appendChild(el('div', 'font-size:13px;font-weight:800;color:#fff;line-height:1.2;', formatMoney(atMat)));
      right.appendChild(el('div', 'font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px;', 'Est. at maturity'));
      const profitEl = el('div', 'font-size:10px;font-weight:700;margin-top:3px;', '+' + formatMoney(profit) + ' profit');
      profitEl.style.color = '#10b981';
      right.appendChild(profitEl);
      top.appendChild(right);
      box.appendChild(top);

      const bar  = el('div', 'width:100%;height:5px;border-radius:999px;background:rgba(255,255,255,0.06);overflow:hidden;');
      const fill = el('div', 'height:100%;width:' + Math.max(4, Math.round((p.progress || 0) * 100)) + '%;border-radius:999px;background:linear-gradient(90deg,rgba(59,130,246,0.95),rgba(16,185,129,0.95));');
      bar.appendChild(fill);
      box.appendChild(bar);

      const bottom = el('div', 'display:flex;align-items:center;justify-content:space-between;');
      bottom.appendChild(el('div', 'font-size:11px;color:rgba(255,255,255,0.5);', Math.round((p.progress || 0) * 100) + '% complete'));
      bottom.appendChild(el('div', 'font-size:11px;font-weight:700;color:rgba(255,255,255,0.65);', (inv.apy || 0) + '% cycle target'));
      box.appendChild(bottom);

      list.appendChild(box);
    });

    shell.appendChild(list);
    return shell;
  }

  function smartContextSection(snapshot) {
    const active = (snapshot.investments || []).filter(inv => inv && inv.status === 'active');
    const claimable = active.filter(inv => inv?.matures_at && new Date(inv.matures_at) <= new Date());
    const cash  = Number(snapshot.balances?.spot)  || 0;
    const total = portfolioTotal(snapshot);

    // Upcoming maturities (sorted soonest first)
    const upcoming = active
      .filter(inv => inv?.matures_at && new Date(inv.matures_at) > new Date())
      .sort((a, b) => new Date(a.matures_at) - new Date(b.matures_at));
    const next = upcoming[0];
    const daysToNext = next
      ? Math.max(1, Math.ceil((new Date(next.matures_at) - Date.now()) / 86400000))
      : null;

    // Portfolio gain across all active positions
    const totalInvested = active.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const totalEst = active.reduce((s, i) => {
      const p = investmentProgress(i);
      return s + (Number.isFinite(p.currentEstimate) ? p.currentEstimate : (Number(i.amount) || 0));
    }, 0);
    const unrealisedGain = totalEst - totalInvested;

    let title, body, cta = null, action = null;
    let tone   = 'linear-gradient(135deg,rgba(59,130,246,0.13),rgba(59,130,246,0.05))';
    let border = 'rgba(59,130,246,0.22)';

    if (snapshot.balanceSyncStatus !== 'ready') {
      title = 'Syncing your portfolio\u2026';
      body  = 'Fetching latest ledger and pool data.';

    } else if (claimable.length > 0) {
      const claimVal = claimable.reduce((s, i) => s + (Number(i.current_value) || Number(i.amount) || 0), 0);
      const plural   = claimable.length > 1;
      title  = claimable.length + ' position' + (plural ? 's' : '') + ' ready to claim';
      body   = formatMoney(claimVal) + ' ' + (plural ? 'are' : 'is') + ' waiting. Claim to your Spot Wallet and decide what\u2019s next.';
      cta    = 'Claim now';
      action = () => window.App && App.navigate('vault');
      tone   = 'linear-gradient(135deg,rgba(16,185,129,0.15),rgba(16,185,129,0.05))';
      border = 'rgba(16,185,129,0.28)';

    } else if (total <= 0) {
      title  = 'Nothing here yet';
      body   = 'Deposit funds, pick a strategy, and let the pool work. Steady starts at $100.';
      cta    = 'Deposit';
      action = () => window.Trade && Trade.openDeposit();

    } else if (active.length === 0 && cash > 0) {
      title  = formatMoney(cash) + ' sitting idle';
      body   = 'That cash could be working. Steady Accumulator starts at $100 \u2014 90-day cycle. Surge Pool takes $1,500 \u2014 30-day cycle.';
      cta    = 'Invest now';
      action = () => window.App && App.navigate('vault');
      tone   = 'linear-gradient(135deg,rgba(245,158,11,0.14),rgba(245,158,11,0.05))';
      border = 'rgba(245,158,11,0.26)';

    } else if (active.length > 0 && daysToNext !== null && daysToNext <= 4) {
      const sName = strategyDisplayName(next);
      title  = sName + ' matures in ' + daysToNext + ' day' + (daysToNext === 1 ? '' : 's');
      body   = formatMoney(Number(next.amount) || 0) + ' is almost done. Plan now: reinvest or withdraw to wallet.';
      cta    = 'View positions';
      action = () => window.App && App.navigate('vault');
      tone   = 'linear-gradient(135deg,rgba(245,158,11,0.14),rgba(245,158,11,0.05))';
      border = 'rgba(245,158,11,0.26)';

    } else if (active.length > 0 && unrealisedGain > 0) {
      const pct = totalInvested > 0 ? ((unrealisedGain / totalInvested) * 100).toFixed(1) : '0.0';
      title  = 'Up ' + formatMoney(unrealisedGain) + ' since entry';
      body   = active.length + ' position' + (active.length > 1 ? 's' : '') + ' tracking \u2014 '
             + pct + '% unrealised. '
             + (daysToNext ? 'Next payout in ' + daysToNext + 'd.' : 'Stay the course.');
      cta    = 'View';
      action = () => window.App && App.navigate('vault');
      tone   = 'linear-gradient(135deg,rgba(16,185,129,0.12),rgba(16,185,129,0.04))';
      border = 'rgba(16,185,129,0.2)';

    } else if (active.length > 0 && cash < Math.max(50, totalInvested * 0.08)) {
      title  = 'Fully deployed';
      body   = 'All capital is in the pool. Keep a small cash buffer for flexibility \u2014 or sit tight until maturity.';
      cta    = 'Wallet';
      action = () => window.App && App.navigate('wallet');
      tone   = 'linear-gradient(135deg,rgba(139,92,246,0.12),rgba(139,92,246,0.04))';
      border = 'rgba(139,92,246,0.2)';

    } else {
      const posStr = active.length + ' position' + (active.length > 1 ? 's' : '') + ' active';
      title  = 'Portfolio running';
      body   = posStr + '. ' + (cash > 0 ? formatMoney(cash) + ' available to deploy.' : 'No idle cash right now.');
      cta    = 'Vault';
      action = () => window.App && App.navigate('vault');
    }

    const shell = sectionShell('Smart context', null);
    const card  = el('div', 'border-radius:16px;padding:16px;background:' + tone + ';border:1px solid ' + border + ';display:flex;align-items:flex-start;justify-content:space-between;gap:12px;');
    const copy  = el('div', 'min-width:0;flex:1;');
    copy.appendChild(el('div', 'font-size:15px;font-weight:800;line-height:1.2;color:#fff;', title));
    copy.appendChild(el('div', 'font-size:12px;line-height:1.55;color:rgba(255,255,255,0.68);margin-top:6px;', body));
    card.appendChild(copy);
    if (cta && action) {
      const btn = el('button', 'border:none;border-radius:12px;padding:10px 14px;background:rgba(255,255,255,0.11);color:#fff;font-size:13px;font-weight:800;cursor:pointer;flex-shrink:0;white-space:nowrap;');
      btn.textContent = cta;
      btn.addEventListener('click', action);
      card.appendChild(btn);
    }
    shell.appendChild(card);
    return shell;
  }

  function activitySection(snapshot) {
    const items = latestActivity(snapshot);
    const shell = sectionShell('Recent Activity', 'Last 5 ledger events', 'Wallet history', () => {
      if (window.App && typeof App.navigate === 'function') App.navigate('wallet');
      setTimeout(() => { if (window.Wallet && typeof Wallet.switchToActivity === 'function') Wallet.switchToActivity(); }, 120);
    });

    if (!items.length) {
      const empty = el('div', 'display:flex;flex-direction:column;gap:6px;');

      // Skeleton rows — same dimensions as real activity rows so the
      // layout feels populated rather than empty.
      const SKELETONS = [
        { w1:'52%', w2:'28%', aW:'42px', opacity:'1'    },
        { w1:'38%', w2:'32%', aW:'36px', opacity:'0.65' },
        { w1:'60%', w2:'24%', aW:'48px', opacity:'0.35' },
      ];
      SKELETONS.forEach(s => {
        const row = el('div', [
          'display:flex;align-items:center;gap:12px;min-width:0;',
          'border-radius:14px;padding:12px 14px;',
          'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);',
          'opacity:' + s.opacity + ';'
        ].join(''));

        const dot = el('div', [
          'width:32px;height:32px;border-radius:11px;flex:0 0 auto;',
          'background:rgba(255,255,255,0.07);'
        ].join(''));
        row.appendChild(dot);

        const mid = el('div', 'flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;');
        mid.appendChild(el('div', 'height:10px;border-radius:4px;background:rgba(255,255,255,0.1);width:' + s.w1 + ';', ''));
        mid.appendChild(el('div', 'height:8px;border-radius:3px;background:rgba(255,255,255,0.05);width:' + s.w2 + ';', ''));
        row.appendChild(mid);

        const amt = el('div', 'height:12px;border-radius:4px;background:rgba(255,255,255,0.08);flex-shrink:0;width:' + s.aW + ';', '');
        row.appendChild(amt);

        empty.appendChild(row);
      });

      const note = el('div', [
        'margin-top:4px;padding:12px 14px;border-radius:12px;',
        'background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.12);',
        'font-size:12px;line-height:1.5;color:rgba(255,255,255,0.5);text-align:center;'
      ].join(''), 'Your first deposit starts the ledger.');
      empty.appendChild(note);

      shell.appendChild(empty);
      return shell;
    }

    const list = el('div', 'display:flex;flex-direction:column;gap:8px;');
    items.forEach(tx => {
      const meta = typeMeta(tx);
      const row = el('button', 'width:100%;text-align:left;border-radius:14px;padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);cursor:pointer;display:flex;align-items:center;gap:12px;min-width:0;');
      row.type = 'button';
      row.addEventListener('click', () => {
        if (window.App && typeof App.navigate === 'function') App.navigate('wallet');
        setTimeout(() => { if (window.Wallet && typeof Wallet.switchToActivity === 'function') Wallet.switchToActivity(); }, 120);
      });

      const icon = el('div', 'width:32px;height:32px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:' + (meta.tone === 'positive' ? 'rgba(16,185,129,0.12)' : meta.tone === 'negative' ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.12)') + ';color:' + (meta.tone === 'positive' ? '#34d399' : meta.tone === 'negative' ? '#f87171' : '#93c5fd') + ';font-size:13px;font-weight:900;');
      icon.textContent = meta.icon;
      row.appendChild(icon);

      const copy = el('div', 'min-width:0;flex:1;');
      copy.appendChild(el('div', 'font-size:13px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', meta.label + ' · ' + safeText(tx.description || tx.title || '')));
      copy.appendChild(el('div', 'font-size:11px;color:rgba(255,255,255,0.6);margin-top:4px;', formatRelativeTime(tx.created_at || tx.timestamp || Date.now())));
      row.appendChild(copy);

      const amount = Number(tx.amount);
      if (Number.isFinite(amount)) {
        const right = el('div', 'text-align:right;flex-shrink:0;');
        const isPositive = meta.tone === 'positive' || String(tx.type || '').toLowerCase().includes('deposit') || String(tx.type || '').toLowerCase().includes('claim');
        right.appendChild(el('div', 'font-size:13px;font-weight:800;color:' + (isPositive ? '#34d399' : '#fca5a5') + ';', (isPositive ? '+' : '-') + formatMoney(amount)));
        row.appendChild(right);
      }
      list.appendChild(row);
    });

    shell.appendChild(list);
    return shell;
  }

  function marketPulseSection(snapshot) {
    const assets = ownedAssets(snapshot);
    const mover = topMover(snapshot, assets.map(a => a.id));
    const shell = sectionShell('Market pulse', 'Owned assets plus one top mover', 'See more', () => {
      if (window.App && typeof App.navigate === 'function') App.navigate('market');
    });

    const wrap = el('div', 'display:flex;flex-direction:column;gap:10px;');

    if (!assets.length && !mover) {
      const empty = el('div', 'border-radius:16px;padding:18px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);');
      empty.appendChild(el('div', 'font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;', 'No market exposure yet'));
      empty.appendChild(el('div', 'font-size:12px;line-height:1.4;color:rgba(255,255,255,0.62);', 'When you hold assets, they will appear here.'));
      wrap.appendChild(empty);
      shell.appendChild(wrap);
      return shell;
    }

    assets.slice(0, 3).forEach(asset => {
      const row = el('div', 'display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);min-width:0;');
      const icon = el('div', 'width:30px;height:30px;border-radius:999px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:rgba(255,255,255,0.06);color:#fff;font-size:12px;font-weight:900;');
      if (asset.image) {
        const img = document.createElement('img');
        img.src = asset.image;
        img.alt = asset.symbol;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        icon.appendChild(img);
      } else {
        icon.textContent = asset.symbol.charAt(0);
      }
      row.appendChild(icon);
      const copy = el('div', 'min-width:0;flex:1;');
      copy.appendChild(el('div', 'font-size:13px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', asset.name + ' · ' + asset.symbol));
      copy.appendChild(el('div', 'font-size:11px;color:rgba(255,255,255,0.62);margin-top:4px;', formatMoney(asset.qty) + ' · ' + formatMoney(asset.value)));
      row.appendChild(copy);
      const chg = el('div', 'flex-shrink:0;font-size:12px;font-weight:800;color:' + (asset.change24 >= 0 ? '#34d399' : '#f87171') + ';', formatPercent(asset.change24));
      row.appendChild(chg);
      wrap.appendChild(row);
    });

    if (mover) {
      const row = el('div', 'display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg, rgba(59,130,246,0.12), rgba(16,185,129,0.06));border:1px solid rgba(59,130,246,0.18);min-width:0;');
      const icon = el('div', 'width:30px;height:30px;border-radius:999px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:rgba(255,255,255,0.08);color:#fff;font-size:12px;font-weight:900;');
      if (mover.image) {
        const img = document.createElement('img');
        img.src = mover.image;
        img.alt = mover.symbol;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        icon.appendChild(img);
      } else {
        icon.textContent = mover.symbol.charAt(0);
      }
      row.appendChild(icon);
      const copy = el('div', 'min-width:0;flex:1;');
      copy.appendChild(el('div', 'font-size:13px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', 'Top mover · ' + mover.name));
      copy.appendChild(el('div', 'font-size:11px;color:rgba(255,255,255,0.68);margin-top:4px;', mover.symbol + ' · ' + formatMoney(mover.price)));
      row.appendChild(copy);
      row.appendChild(el('div', 'flex-shrink:0;font-size:12px;font-weight:800;color:' + (mover.change24 >= 0 ? '#34d399' : '#f87171') + ';', formatPercent(mover.change24)));
      wrap.appendChild(row);
    }

    shell.appendChild(wrap);
    return shell;
  }

  function liveStatsSection(snapshot) {
    const active = (snapshot.investments || []).filter(inv => inv && inv.status === 'active');
    const completed = (snapshot.investments || []).filter(inv => inv && (inv.status === 'completed' || inv.status === 'claimed'));
    const txs = Array.isArray(snapshot.transactions) ? snapshot.transactions : [];
    const claims = txs.filter(tx => String(tx.type || '').toLowerCase().includes('claim') || String(tx.description || '').toLowerCase().includes('claim')).length;
    const deposits = txs.filter(tx => String(tx.type || '').toLowerCase().includes('deposit')).length;
    const holdCount = calcHolderCount(snapshot);
    const total = portfolioTotal(snapshot);

    const shell = sectionShell('Live stats', 'Real counts from your account state');
    const grid = el('div', 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;');

    const cells = [
      { label: 'Active positions', value: String(active.length) },
      { label: 'Completed claims', value: String(claims || completed.length) },
      { label: 'Deposits', value: String(deposits) },
      { label: 'Tracked assets', value: String(holdCount) },
      { label: 'Portfolio total', value: formatCompactMoney(total) },
      { label: 'Update state', value: snapshot.balanceSyncStatus === 'ready' ? 'Live' : 'Syncing' }
    ];

    cells.forEach(cell => {
      const box = el('div', 'border-radius:14px;padding:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);min-width:0;');
      box.appendChild(el('div', 'font-size:11px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:rgba(255,255,255,0.56);', cell.label));
      box.appendChild(el('div', 'font-size:18px;font-weight:900;letter-spacing:-0.3px;color:#fff;margin-top:8px;word-break:break-word;', cell.value));
      grid.appendChild(box);
    });

    shell.appendChild(grid);
    return shell;
  }

  function emptySkeletonLine(width, height) {
    const node = el('div', 'width:' + width + ';height:' + height + ';border-radius:999px;', null);
    node.className = 'skeleton-pulse';
    return node;
  }

  function loadingSection(title, lines = 2) {
    const shell = sectionShell(title, null);
    const card = el('div', 'border-radius:16px;padding:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:10px;');
    for (let i = 0; i < lines; i++) card.appendChild(emptySkeletonLine(i === 0 ? '72%' : '52%', '14px'));
    shell.appendChild(card);
    return shell;
  }

  function buildWelcome() {
    if (!window.Modal || _welcomeShown) return;
    _welcomeShown = true;
    const content = el('div', 'display:flex;flex-direction:column;gap:14px;');
    const steps = [
      { icon: '👋', title: 'Welcome, ' + firstName(), body: 'Home gives you a fast briefing. Wallet keeps the actions.' },
      { icon: '💼', title: 'One total number', body: 'Your header shows the full portfolio view without the wallet clutter.' },
      { icon: '🚀', title: 'Next step', body: 'Deposit, invest, or claim from Wallet and Vault when you are ready.' }
    ];
    let idx = 0;

    const renderStep = () => {
      content.innerHTML = '';
      const step = steps[idx];
      const dots = el('div', 'display:flex;gap:6px;justify-content:center;');
      steps.forEach((_, i) => dots.appendChild(el('div', 'width:' + (i === idx ? '20px' : '8px') + ';height:8px;border-radius:999px;background:' + (i <= idx ? '#60a5fa' : 'rgba(255,255,255,0.1)') + ';')));
      content.appendChild(dots);
      content.appendChild(el('div', 'font-size:44px;text-align:center;', step.icon));
      content.appendChild(el('div', 'font-size:18px;font-weight:900;color:#fff;text-align:center;line-height:1.25;', step.title));
      content.appendChild(el('div', 'font-size:14px;line-height:1.6;color:#cbd5e1;text-align:center;', step.body));
      const next = el('button', 'width:100%;padding:14px;border:none;border-radius:14px;background:var(--color-primary,#3b82f6);color:#fff;font-size:14px;font-weight:800;cursor:pointer;', idx === steps.length - 1 ? 'Get started' : 'Next');
      next.addEventListener('click', () => {
        if (idx === steps.length - 1) {
          markOnboarded();
          Modal.close();
          setTimeout(() => { if (window.Trade && Trade.openDeposit) Trade.openDeposit(); }, 200);
        } else {
          idx += 1;
          renderStep();
        }
      });
      content.appendChild(next);
      if (idx < steps.length - 1) {
        const skip = el('button', 'width:100%;padding:13px;border-radius:14px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.05);color:#cbd5e1;font-size:13px;font-weight:700;cursor:pointer;');
        skip.textContent = 'Skip';
        skip.addEventListener('click', () => { markOnboarded(); Modal.close(); });
        content.appendChild(skip);
      }
    };

    renderStep();
    Modal.open({ title: '', content, maxWidth: '420px', hideTitle: true, dismissible: false });
  }

  function teardownSubscriptions() {
    _subscriptions.forEach(fn => {
      try { fn && fn(); } catch (_) {}
    });
    _subscriptions = [];
  }

  function scheduleRefresh() {
    if (_destroyed || !_scrollEl) return;
    if (_refreshTimer) return;
    _refreshTimer = setTimeout(() => {
      _refreshTimer = null;
      if (!_destroyed && _scrollEl) _updateContent();
    }, 80);
  }

  function bindStateListeners() {
    if (!window.AppState || typeof AppState.subscribe !== 'function') return;
    teardownSubscriptions();

    const keys = ['balances', 'investments', 'transactions', 'marketData', 'balanceSyncStatus', 'holdings'];
    keys.forEach(key => {
      let skippedInitial = false;
      const unsub = AppState.subscribe(key, () => {
        if (!skippedInitial) {
          skippedInitial = true;
          return;
        }
        scheduleRefresh();
      });
      _subscriptions.push(unsub);
    });
  }

  function buildRoot(snapshot) {
    const root = el('div', 'display:flex;flex-direction:column;gap:14px;min-width:0;width:100%;padding:0 0 var(--scroll-bottom-clearance, 116px) 0;box-sizing:border-box;');

    root.appendChild(heroCard(snapshot));

    if (snapshot.balanceSyncStatus !== 'ready') {
      root.appendChild(loadingSection('Active investments', 3));
      root.appendChild(loadingSection('Smart context', 2));
      root.appendChild(loadingSection('Recent activity', 3));
      root.appendChild(loadingSection('Market pulse', 3));
      root.appendChild(loadingSection('Live stats', 4));
      return root;
    }

    root.appendChild(investmentsSection(snapshot));
    root.appendChild(smartContextSection(snapshot));
    root.appendChild(activitySection(snapshot));
    root.appendChild(marketPulseSection(snapshot));
    root.appendChild(liveStatsSection(snapshot));
    return root;
  }

  function stopTimers() {
    if (_ticker) {
      clearInterval(_ticker);
      _ticker = null;
    }
    if (_refreshTimer) {
      clearTimeout(_refreshTimer);
      _refreshTimer = null;
    }
  }

  function startTicker() {
    if (_ticker) return;
    _ticker = setInterval(() => {
      if (_destroyed || !_container) return;
      scheduleRefresh();
    }, 30000);
  }

  // ── Content update — preserves scroll position ──────────────────────────
  function _updateContent() {
    if (!_scrollEl || _destroyed) return;
    // Was the user at (or essentially at) the bottom before this refresh?
    // Content height can drift a few px between the loading skeleton and
    // real data (or as icon-font glyphs finish loading and reflow), so
    // restoring the old absolute scrollTop can land short of the new true
    // bottom — the last item ends up peeking out from under the floating
    // nav. Re-anchoring to "bottom" instead of "old pixel value" survives
    // that drift.
    const wasNearBottom = (_scrollEl.scrollHeight - _scrollEl.scrollTop - _scrollEl.clientHeight) < 40;
    const saved = _scrollEl.scrollTop;
    _scrollEl.innerHTML = '';
    _scrollEl.appendChild(buildRoot(state()));
    _scrollEl.scrollTop = wasNearBottom ? _scrollEl.scrollHeight : saved;
  }

  // ── Full mount — called once per navigation ───────────────────────────────
  function render(container) {
    if (!container) return;
    _container = container;
    _scrollEl   = null;
    _destroyed  = false;

    stopTimers();
    teardownSubscriptions();

    // Exact same baseline as Wallet: flex column, overflow hidden, zero padding.
    // CSS .app-main padding is neutralised by inline style so content is truly full-width.
    container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;padding:0;box-sizing:border-box;';
    container.innerHTML = '';

    // Inner scroll wrapper — the only element that scrolls
    const scroller = document.createElement('div');
    scroller.style.cssText = 'flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;';
    _scrollEl = scroller;

    scroller.appendChild(buildRoot(state()));
    container.appendChild(scroller);

    bindStateListeners();
    startTicker();

    if (window.Navbar && typeof Navbar.setActive === 'function') {
      Navbar.setActive('home');
    }

    if (isFirstLogin()) {
      setTimeout(() => {
        if (!_destroyed) buildWelcome();
      }, 700);
    }
  }

  // ── Lightweight refresh (state change) — never resets scroll ─────────────
  function refresh() {
    _updateContent();
  }

  function destroy() {
    _destroyed = true;
    teardownSubscriptions();
    stopTimers();
    _container = null;
    _scrollEl   = null;
  }

  function cleanup() {
    destroy();
  }

  window.Home = { render, refresh, destroy, cleanup };
})();
