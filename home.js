// home.js
(function () {
  'use strict';

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
      const raw = localStorage.getItem('nex_streak');
      const streak = raw ? JSON.parse(raw) : { count: 0, lastDate: null };
      if (streak.lastDate === today) return streak;
      const next = {
        count: streak.lastDate === yesterday ? (streak.count || 0) + 1 : 1,
        lastDate: today
      };
      localStorage.setItem('nex_streak', JSON.stringify(next));
      return next;
    } catch (_) {
      return { count: 1, lastDate: null };
    }
  }

  function markOnboarded() {
    try { localStorage.setItem('nex_onboarded', '1'); } catch (_) {}
  }

  function isFirstLogin() {
    try { return !localStorage.getItem('nex_onboarded'); } catch (_) { return false; }
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
    const amount = Math.max(0, Number(inv?.amount) || 0);
    const created = new Date(inv?.created_at || Date.now()).getTime();
    const durationDays = Number(inv?.durationDays || inv?.duration || 0);
    const maturesAt = inv?.matures_at ? new Date(inv.matures_at).getTime() : (durationDays > 0 ? created + durationDays * 86400000 : NaN);
    const now = Date.now();

    let progress = 0;
    if (Number.isFinite(maturesAt) && maturesAt > created) {
      progress = Math.max(0, Math.min(1, (now - created) / (maturesAt - created)));
    }

    const apyRaw = Number(inv?.apy);
    const apy = Number.isFinite(apyRaw) ? (apyRaw > 1 ? apyRaw / 100 : apyRaw) : 0;
    const elapsedYears = Math.max(0, (Math.min(now, Number.isFinite(maturesAt) ? maturesAt : now) - created) / (365 * 86400000));
    const projected = amount + (amount * apy * elapsedYears);
    const currentValue = Number(inv?.current_value);

    return {
      progress,
      projected: Number.isFinite(currentValue) && currentValue > 0 ? currentValue : projected,
      maturesAt
    };
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
    if (raw.includes('withdraw')) return { label: 'Withdraw', icon: '↑', tone: 'negative' };
    if (raw.includes('claim')) return { label: 'Claim', icon: '✓', tone: 'positive' };
    if (raw.includes('sell')) return { label: 'Sell', icon: '↗', tone: 'negative' };
    if (raw.includes('buy') || raw.includes('invest')) return { label: 'Trade', icon: '↘', tone: 'neutral' };
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
    const hidden = localStorage.getItem('nex_hide_balance') === 'true';
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

    const delta = el('div', 'font-size:11px;font-weight:700;color:' + (change.crypto24 >= 0 ? '#10b981' : '#ef4444') + ';');
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
    const shell = sectionShell('Active investments', 'Highest priority positions');

    if (!active.length) {
      const empty = el('div', 'border-radius:16px;padding:18px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;gap:12px;');
      const copy = el('div', 'min-width:0;flex:1;');
      copy.appendChild(el('div', 'font-size:14px;font-weight:700;color:var(--color-text-primary,#fff);margin-bottom:4px;', 'No active positions'));
      copy.appendChild(el('div', 'font-size:12px;line-height:1.4;color:var(--color-text-secondary,#94a3b8);', 'Open Vault to start compounding your balance.'));
      const btn = el('button', 'border:none;border-radius:12px;padding:10px 14px;background:#3b82f6;color:#fff;font-size:13px;font-weight:800;cursor:pointer;flex-shrink:0;');
      btn.textContent = 'Open Vault';
      btn.addEventListener('click', () => window.App && App.navigate('vault'));
      empty.appendChild(copy);
      empty.appendChild(btn);
      shell.appendChild(empty);
      return shell;
    }

    const list = el('div', 'display:flex;flex-direction:column;gap:10px;');
    active.slice(0, 4).forEach(inv => {
      const p = investmentProgress(inv);
      const name = safeText(inv.strategy_name || inv.name || inv.strategy_id || 'Vault position');
      const amount = Number(inv.amount) || 0;
      const projected = Number.isFinite(p.projected) ? p.projected : amount;
      const box = el('button', 'width:100%;text-align:left;border-radius:16px;padding:14px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);cursor:pointer;display:flex;flex-direction:column;gap:10px;');
      box.type = 'button';
      box.addEventListener('click', () => {
        if (window.App && typeof App.navigate === 'function') App.navigate('vault');
      });

      const top = el('div', 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-width:0;');
      const left = el('div', 'min-width:0;flex:1;');
      left.appendChild(el('div', 'font-size:14px;font-weight:800;line-height:1.2;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', name));
      left.appendChild(el('div', 'font-size:12px;color:rgba(255,255,255,0.62);margin-top:4px;', formatMoney(amount) + ' invested · ' + timeRemaining(p.maturesAt)));
      top.appendChild(left);

      const right = el('div', 'text-align:right;flex-shrink:0;');
      right.appendChild(el('div', 'font-size:13px;font-weight:800;color:#fff;line-height:1.2;', formatMoney(projected)));
      right.appendChild(el('div', 'font-size:11px;color:rgba(255,255,255,0.6);margin-top:4px;', 'Projected return'));
      top.appendChild(right);
      box.appendChild(top);

      const bar = el('div', 'width:100%;height:8px;border-radius:999px;background:rgba(255,255,255,0.06);overflow:hidden;');
      const fill = el('div', 'height:100%;width:' + Math.max(8, Math.round((p.progress || 0) * 100)) + '%;border-radius:999px;background:linear-gradient(90deg, rgba(59,130,246,0.95), rgba(16,185,129,0.95));');
      bar.appendChild(fill);
      box.appendChild(bar);

      const bottom = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;');
      bottom.appendChild(el('div', 'font-size:11px;font-weight:700;color:rgba(255,255,255,0.7);', 'Progress ' + Math.min(100, Math.max(0, Math.round((p.progress || 0) * 100))) + '%'));
      bottom.appendChild(el('div', 'font-size:11px;font-weight:700;color:rgba(255,255,255,0.7);', safeText(inv.apy, '0') + '% APY'));
      box.appendChild(bottom);

      list.appendChild(box);
    });

    shell.appendChild(list);
    return shell;
  }

  function smartContextSection(snapshot) {
    const total = portfolioTotal(snapshot);
    const active = (snapshot.investments || []).filter(inv => inv && inv.status === 'active');
    const claimable = active.filter(inv => {
      const matured = inv?.matures_at ? new Date(inv.matures_at).getTime() <= Date.now() : false;
      return matured;
    });
    const cash = Number(snapshot.balances?.spot) || 0;
    const vault = Number(snapshot.balances?.vault) || 0;

    let title = 'Add funds';
    let body = 'Your portfolio is empty. Add money to begin.';
    let cta = 'Deposit';
    let action = () => window.Trade && Trade.openDeposit();
    let tone = 'linear-gradient(135deg, rgba(59,130,246,0.14), rgba(59,130,246,0.06))';
    let border = 'rgba(59,130,246,0.24)';

    if (snapshot.balanceSyncStatus !== 'ready') {
      title = 'Syncing balances';
      body = 'We are fetching the latest ledger and vault state.';
      cta = 'Refresh';
      action = () => refresh();
    } else if (claimable.length > 0) {
      title = 'Prepare to claim';
      body = claimable.length + ' position' + (claimable.length > 1 ? 's are' : ' is') + ' ready to settle.';
      cta = 'Open Vault';
      action = () => window.App && App.navigate('vault');
      tone = 'linear-gradient(135deg, rgba(16,185,129,0.14), rgba(16,185,129,0.06))';
      border = 'rgba(16,185,129,0.24)';
    } else if (total <= 0) {
      title = 'Add funds';
      body = 'Put money in your account to start building momentum.';
      cta = 'Deposit';
      action = () => window.Trade && Trade.openDeposit();
    } else if (active.length === 0 && cash > 0) {
      title = 'Invest idle balance';
      body = formatMoney(cash) + ' is sitting in cash. Move some into Vault.';
      cta = 'Invest';
      action = () => window.App && App.navigate('vault');
      tone = 'linear-gradient(135deg, rgba(139,92,246,0.14), rgba(139,92,246,0.06))';
      border = 'rgba(139,92,246,0.24)';
    } else if (vault > 0 && cash < Math.max(20, vault * 0.15)) {
      title = 'Reinvest runway';
      body = 'Your Vault is working. Keep cash ready for the next move.';
      cta = 'Wallet';
      action = () => window.App && App.navigate('wallet');
      tone = 'linear-gradient(135deg, rgba(245,158,11,0.14), rgba(245,158,11,0.06))';
      border = 'rgba(245,158,11,0.24)';
    } else {
      title = 'Stay ready';
      body = 'Your money is split across cash, vault, and market exposure.';
      cta = 'Wallet';
      action = () => window.App && App.navigate('wallet');
      tone = 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(16,185,129,0.06))';
      border = 'rgba(59,130,246,0.22)';
    }

    const shell = sectionShell('Smart context', null);
    const card = el('div', 'border-radius:16px;padding:16px;background:' + tone + ';border:1px solid ' + border + ';display:flex;align-items:flex-start;justify-content:space-between;gap:12px;');
    const copy = el('div', 'min-width:0;flex:1;');
    copy.appendChild(el('div', 'font-size:15px;font-weight:800;line-height:1.15;color:#fff;', title));
    copy.appendChild(el('div', 'font-size:12px;line-height:1.5;color:rgba(255,255,255,0.72);margin-top:5px;', body));
    card.appendChild(copy);
    const btn = el('button', 'border:none;border-radius:12px;padding:10px 14px;background:rgba(255,255,255,0.12);color:#fff;font-size:13px;font-weight:800;cursor:pointer;flex-shrink:0;');
    btn.textContent = cta;
    btn.addEventListener('click', action);
    card.appendChild(btn);
    shell.appendChild(card);
    return shell;
  }

  function activitySection(snapshot) {
    const items = latestActivity(snapshot);
    const shell = sectionShell('Recent activity', 'Last 5 ledger events', 'Wallet history', () => {
      if (window.App && typeof App.navigate === 'function') App.navigate('wallet');
      setTimeout(() => { if (window.Wallet && typeof Wallet.switchToActivity === 'function') Wallet.switchToActivity(); }, 120);
    });

    if (!items.length) {
      const empty = el('div', 'border-radius:16px;padding:18px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);');
      empty.appendChild(el('div', 'font-size:14px;font-weight:700;color:#fff;margin-bottom:4px;', 'No activity yet'));
      empty.appendChild(el('div', 'font-size:12px;line-height:1.4;color:rgba(255,255,255,0.62);', 'Deposits, claims, and trades will appear here.'));
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
      const next = el('button', 'width:100%;padding:14px;border:none;border-radius:14px;background:#3b82f6;color:#fff;font-size:14px;font-weight:800;cursor:pointer;', idx === steps.length - 1 ? 'Get started' : 'Next');
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
    const root = el('div', 'display:flex;flex-direction:column;gap:14px;min-width:0;width:100%;padding:0 0 calc(110px + env(safe-area-inset-bottom,0px)) 0;box-sizing:border-box;');

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
    const saved = _scrollEl.scrollTop;
    _scrollEl.innerHTML = '';
    _scrollEl.appendChild(buildRoot(state()));
    _scrollEl.scrollTop = saved;
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
