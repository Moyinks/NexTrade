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

  function coinImageUrl(value) {
    return window.API && typeof API.proxiedCoinImageUrl === 'function'
      ? API.proxiedCoinImageUrl(value)
      : '';
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

  function transactionView(tx) {
    if (
      window.TransactionUI &&
      typeof TransactionUI.present === 'function'
    ) {
      return TransactionUI.present(tx);
    }

    return {
      label: 'Transaction',
      icon: 'fa-circle-dot',
      direction: 'neutral',
      tone: 'neutral',
      amountPrefix: '',
      status: String(tx?.status || 'unknown'),
      statusLabel: String(tx?.status || 'Unknown'),
      context: String(tx?.description || '')
    };
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
      'border:1px solid var(--color-border)',
      'box-shadow:0 12px 32px rgba(0,0,0,0.22)',
      'text-align:left',
      'cursor:pointer'
    ].join(';'));
    card.type = 'button';
    card.className = 'hero-card home-hero-card';
    card.addEventListener('click', () => {
      if (window.App && typeof App.navigate === 'function') App.navigate('wallet');
    });

    const top = el('div', 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;');
    const left = el('div', 'min-width:0;flex:1;');

    const eyebrow = el('div', 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;');
    eyebrow.appendChild(el('div', 'font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:rgba(255,255,255,0.52);', greeting() + ', ' + firstName()));
    if (streak.count > 1) {
      eyebrow.appendChild(el('div', 'font-size:11px;font-weight:700;color:var(--color-text-secondary);display:inline-flex;align-items:center;gap:4px;', '🔥 ' + streak.count + 'd streak'));
    }
    left.appendChild(eyebrow);

    const totalNode = el('div', 'font-family:var(--font-mono,monospace);font-size:30px;line-height:1.05;font-weight:800;letter-spacing:-0.9px;color:var(--color-text-primary);word-break:break-word;');
    totalNode.textContent = hidden ? '••••••••' : formatMoney(total);
    left.appendChild(totalNode);

    const row = el('div', 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;');
    const badge = el('div', 'display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:999px;background:var(--color-surface-elevated);border:1px solid var(--color-border);font-size:11px;font-weight:700;color:rgba(255,255,255,0.9);');
    badge.textContent = ready ? 'Live' : 'Syncing';
    row.appendChild(badge);

    const delta = el('div', 'font-size:11px;font-weight:700;color:' + (change.crypto24 >= 0 ? 'var(--color-success,#10b981)' : 'var(--color-danger,#ef4444)') + ';');
    delta.textContent = hidden ? 'Balance hidden' : ('24h ' + (change.crypto24 >= 0 ? '+' : '-') + formatMoney(Math.abs(change.crypto24)));
    row.appendChild(delta);

    const balanceNote = el('div', 'width:100%;font-size:12px;line-height:1.4;color:var(--color-text-secondary);margin-top:2px;');
    if (!ready) {
      balanceNote.textContent = 'Loading your latest balances…';
    } else if (total <= 0) {
      balanceNote.textContent = 'Add funds to start moving money.';
    } else {
      balanceNote.textContent = 'Tap to open Wallet.';
    }

    left.appendChild(row);
    left.appendChild(balanceNote);

    const right = el('div', 'width:42px;height:42px;border-radius:14px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:rgba(59,130,246,0.12);border:1px solid var(--color-border);color:#93c5fd;');
    right.innerHTML = '<i class="fas fa-wallet" style="font-size:14px"></i>';

    top.appendChild(left);
    top.appendChild(right);
    card.appendChild(top);

    return card;
  }

  function sectionShell(title, subtitle, actionText, actionHandler) {
    const wrap = el('section', 'display:flex;flex-direction:column;gap:10px;');
    wrap.className = 'home-section';
    const head = el('div', 'display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:0 16px;');
    head.className = 'home-section__head';
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
      const empty = el('div', 'border-radius:16px;padding:18px;background:var(--color-surface);border:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;gap:12px;');
      empty.className = 'home-strategy-empty';
      const copy = el('div', 'min-width:0;flex:1;');
      copy.appendChild(el('div', 'font-size:14px;font-weight:700;color:var(--color-text-primary,#fff);margin-bottom:4px;', 'No active positions'));
      copy.appendChild(el('div', 'font-size:12px;line-height:1.4;color:var(--color-text-secondary,#94a3b8);', 'Open Vault to pick a strategy and start compounding.'));
      const btn = el('button', 'border:none;border-radius:12px;padding:10px 14px;background:var(--color-primary,#3b82f6);color:var(--color-text-primary);font-size:13px;font-weight:800;cursor:pointer;flex-shrink:0;');
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

      const box = el('button', 'width:100%;text-align:left;border-radius:16px;padding:14px;border:1px solid var(--color-border);background:var(--color-surface);cursor:pointer;display:flex;flex-direction:column;gap:10px;');
      box.type = 'button';
      box.addEventListener('click', () => {
        if (window.App && typeof App.navigate === 'function') App.navigate('vault');
      });

      const top  = el('div', 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-width:0;');
      const left = el('div', 'min-width:0;flex:1;');
      left.appendChild(el('div', 'font-size:14px;font-weight:800;line-height:1.2;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', name));
      left.appendChild(el('div', 'font-size:12px;color:var(--color-text-tertiary);margin-top:4px;', formatMoney(amount) + ' invested \u00B7 ' + timeRemaining(p.maturesAt)));
      top.appendChild(left);

      const right = el('div', 'text-align:right;flex-shrink:0;');
      right.appendChild(el('div', 'font-size:13px;font-weight:800;color:var(--color-text-primary);line-height:1.2;', formatMoney(atMat)));
      right.appendChild(el('div', 'font-size:11px;color:var(--color-text-tertiary);margin-top:2px;', 'Est. at maturity'));
      const profitEl = el('div', 'font-size:10px;font-weight:700;margin-top:3px;', '+' + formatMoney(profit) + ' profit');
      profitEl.style.color = '#10b981';
      right.appendChild(profitEl);
      top.appendChild(right);
      box.appendChild(top);

      const bar  = el('div', 'width:100%;height:5px;border-radius:999px;background:var(--color-surface-elevated);overflow:hidden;');
      const fill = el('div', 'height:100%;width:' + Math.max(4, Math.round((p.progress || 0) * 100)) + '%;border-radius:999px;background:linear-gradient(90deg,rgba(59,130,246,0.95),rgba(16,185,129,0.95));');
      bar.appendChild(fill);
      box.appendChild(bar);

      const bottom = el('div', 'display:flex;align-items:center;justify-content:space-between;');
      bottom.appendChild(el('div', 'font-size:11px;color:var(--color-text-tertiary);', Math.round((p.progress || 0) * 100) + '% complete'));
      bottom.appendChild(el('div', 'font-size:11px;font-weight:700;color:var(--color-text-secondary);', (inv.apy || 0) + '% cycle target'));
      box.appendChild(bottom);

      list.appendChild(box);
    });

    shell.appendChild(list);
    return shell;
  }

  function smartContextPriority(snapshot) {
    const investments = Array.isArray(snapshot.investments)
      ? snapshot.investments
      : [];

    const transactions = Array.isArray(snapshot.transactions)
      ? snapshot.transactions
      : [];

    const now = Date.now();

    const hasClaimable = investments.some(inv =>
      inv &&
      inv.status === 'active' &&
      inv.matures_at &&
      new Date(inv.matures_at).getTime() <= now
    );

    const hasRecentFailedTransaction = transactions.some(tx => {
      const status = String(tx?.status || '').toLowerCase();
      if (status !== 'failed' && status !== 'rejected') return false;

      const created = new Date(tx.created_at || tx.timestamp || 0).getTime();
      return Number.isFinite(created) && created > 0 && (now - created) <= 7 * 86400000;
    });

    if (hasClaimable || hasRecentFailedTransaction) {
      return 'action';
    }

    const hasPendingDeposit = transactions.some(tx => {
      if (!tx || String(tx.status || '').toLowerCase() !== 'pending') return false;

      const haystack = [
        tx.type,
        tx.category,
        tx.description,
        tx.metadata?.kind,
        tx.metadata?.rail
      ].filter(Boolean).join(' ').toLowerCase();

      return haystack.includes('deposit');
    });

    const approachingMaturity = investments.some(inv => {
      if (!inv || inv.status !== 'active' || !inv.matures_at) return false;
      const remaining = new Date(inv.matures_at).getTime() - now;
      return remaining > 0 && remaining <= 4 * 86400000;
    });

    return (hasPendingDeposit || approachingMaturity)
      ? 'attention'
      : 'advisory';
  }

  function smartContextSection(snapshot) {
    const active = (snapshot.investments || []).filter(
      inv => inv && inv.status === 'active'
    );
    const claimable = active.filter(
      inv => inv?.matures_at && new Date(inv.matures_at) <= new Date()
    );
    const cash = Number(snapshot.balances?.spot) || 0;
    const total = portfolioTotal(snapshot);

    const transactions = Array.isArray(snapshot.transactions)
      ? snapshot.transactions
      : [];

    const pendingDeposit = transactions.find(tx => {
      if (!tx || String(tx.status || '').toLowerCase() !== 'pending') {
        return false;
      }

      const haystack = [
        tx.type,
        tx.category,
        tx.description,
        tx.metadata?.kind,
        tx.metadata?.rail
      ].filter(Boolean).join(' ').toLowerCase();

      return haystack.includes('deposit');
    }) || null;

    const actionRequiredTransaction = transactions.find(tx => {
      const status = String(tx?.status || '').toLowerCase();
      if (status !== 'failed' && status !== 'rejected') return false;

      const created = new Date(tx.created_at || tx.timestamp || 0).getTime();
      return Number.isFinite(created) &&
        created > 0 &&
        (Date.now() - created) <= 7 * 86400000;
    }) || null;

    const upcoming = active
      .filter(inv => inv?.matures_at && new Date(inv.matures_at) > new Date())
      .sort((a, b) => new Date(a.matures_at) - new Date(b.matures_at));

    const next = upcoming[0];
    const daysToNext = next
      ? Math.max(1, Math.ceil((new Date(next.matures_at) - Date.now()) / 86400000))
      : null;

    const totalInvested = active.reduce(
      (sum, investment) => sum + (Number(investment.amount) || 0),
      0
    );

    const totalEst = active.reduce((sum, investment) => {
      const progress = investmentProgress(investment);
      return sum + (
        Number.isFinite(progress.currentEstimate)
          ? progress.currentEstimate
          : (Number(investment.amount) || 0)
      );
    }, 0);

    const unrealisedGain = totalEst - totalInvested;

    let title = '';
    let body = '';
    let primary = null;
    let secondary = null;

    const toVault = () => {
      if (window.App && typeof App.navigate === 'function') App.navigate('vault');
    };

    const toWallet = () => {
      if (window.App && typeof App.navigate === 'function') App.navigate('wallet');
    };

    const deposit = () => {
      if (window.Trade && typeof Trade.openDeposit === 'function') Trade.openDeposit();
    };

    const viewPendingDeposit = () => {
      if (
        pendingDeposit &&
        window.Transactiondetail &&
        typeof Transactiondetail.open === 'function'
      ) {
        Transactiondetail.open(pendingDeposit.id, 'home');
        return;
      }

      toWallet();
      window.setTimeout(() => {
        if (window.Wallet && typeof Wallet.switchToActivity === 'function') {
          Wallet.switchToActivity();
        }
      }, 120);
    };

    if (snapshot.balanceSyncStatus !== 'ready') {
      title = 'Syncing your portfolio…';
      body = 'Fetching the latest ledger and strategy state.';

    } else if (claimable.length > 0) {
      const claimValue = claimable.reduce(
        (sum, investment) => sum + (
          Number(investment.current_value) ||
          Number(investment.amount) ||
          0
        ),
        0
      );

      title = claimable.length + ' position' +
        (claimable.length > 1 ? 's' : '') + ' ready to claim';
      body = formatMoney(claimValue) + ' is ready for your next decision.';
      primary = { label: 'Review positions', action: toVault };

    } else if (actionRequiredTransaction) {
      const failedStatus = String(actionRequiredTransaction.status || '').toLowerCase();
      title = 'A transaction needs attention';
      body = failedStatus === 'rejected'
        ? 'A recent ledger request was rejected. Review the record before deciding what to do next.'
        : 'A recent ledger request did not complete. Review the record before trying another action.';
      primary = {
        label: 'Review transaction',
        action: () => {
          if (
            window.Transactiondetail &&
            typeof Transactiondetail.open === 'function'
          ) {
            Transactiondetail.open(actionRequiredTransaction.id, 'home');
            return;
          }
          toWallet();
        }
      };

    } else if (total <= 0 && pendingDeposit) {
      title = 'Your deposit is under review';
      body = 'The ledger request is pending human review. Inspect its status or explore strategies while you wait.';
      primary = { label: 'View deposit', action: viewPendingDeposit };
      secondary = { label: 'Explore Vault', action: toVault };

    } else if (total <= 0) {
      title = 'Start with one clear step';
      body = 'Fund your Spot Wallet, then choose a strategy when you are ready.';
      primary = { label: 'Deposit', action: deposit };
      secondary = { label: 'Explore Vault', action: toVault };

    } else if (active.length === 0 && cash > 0) {
      title = formatMoney(cash) + ' is available';
      body = 'Your cash is ready. Compare strategy term, mechanics and risk before making a demo allocation.';
      primary = { label: 'Open Vault', action: toVault };
      secondary = { label: 'Deposit more', action: deposit };

    } else if (active.length > 0 && daysToNext !== null && daysToNext <= 4) {
      const strategyName = strategyDisplayName(next);
      title = strategyName + ' matures in ' + daysToNext + ' day' + (daysToNext === 1 ? '' : 's');
      body = 'Review the position before maturity so your next move is deliberate.';
      primary = { label: 'View positions', action: toVault };

    } else if (active.length > 0 && unrealisedGain > 0) {
      const pct = totalInvested > 0
        ? ((unrealisedGain / totalInvested) * 100).toFixed(1)
        : '0.0';
      title = 'Portfolio update';
      body = active.length + ' active position' +
        (active.length > 1 ? 's' : '') + ' · ' + pct +
        '% modeled change since entry' +
        (daysToNext ? ' · next maturity in ' + daysToNext + 'd.' : '.');
      primary = { label: 'View positions', action: toVault };

    } else if (active.length > 0 && cash < Math.max(50, totalInvested * 0.08)) {
      title = 'Capital is deployed';
      body = 'Your active strategy positions are using most available cash.';
      primary = { label: 'View Vault', action: toVault };
      secondary = { label: 'Open Wallet', action: toWallet };

    } else {
      title = 'Portfolio running';
      body = active.length + ' active position' +
        (active.length > 1 ? 's' : '') +
        (cash > 0 ? ' · ' + formatMoney(cash) + ' still available.' : '.');
      primary = { label: 'View Vault', action: toVault };
    }

    const shell = sectionShell('Smart context', null);
    const card = el('div');
    card.className = 'home-context-card';
    card.dataset.priority = smartContextPriority(snapshot);

    const copy = el('div', 'min-width:0;');
    copy.appendChild(el(
      'div',
      'font-size:15px;font-weight:800;line-height:1.2;color:var(--color-text-primary);',
      title
    ));
    copy.appendChild(el(
      'div',
      'font-size:12px;line-height:1.55;color:var(--color-text-secondary);margin-top:6px;',
      body
    ));
    card.appendChild(copy);

    if (primary || secondary) {
      const actions = el('div');
      actions.className = 'home-context-actions';

      [
        ['primary', primary],
        ['secondary', secondary]
      ].forEach(([tone, item]) => {
        if (!item) return;
        const button = el('button', '');
        button.type = 'button';
        button.className =
          'home-context-action home-context-action--' + tone +
          (tone === 'primary' ? ' btn-primary' : '');
        button.textContent = item.label;
        button.addEventListener('click', item.action);
        actions.appendChild(button);
      });

      card.appendChild(actions);
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
          'background:var(--color-surface);border:1px solid var(--color-border);',
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
        'font-size:12px;line-height:1.5;color:var(--color-text-tertiary);text-align:center;'
      ].join(''), 'Your first deposit starts the ledger.');
      empty.appendChild(note);

      shell.appendChild(empty);
      return shell;
    }

    const list = el('div', 'display:flex;flex-direction:column;gap:8px;');
    list.className = 'home-activity-list';
    items.forEach(tx => {
      const view = transactionView(tx);

      const row = document.createElement('button');
      row.className = 'tx-card tx-card--button tx-card--compact';
      row.type = 'button';
      row.dataset.status = view.status;
      row.dataset.tone = view.tone;
      row.dataset.direction = view.direction;

      row.addEventListener('click', () => {
        if (
          window.Transactiondetail &&
          typeof Transactiondetail.open === 'function'
        ) {
          Transactiondetail.open(tx.id, 'home');
          return;
        }

        if (
          window.App &&
          typeof App.navigate === 'function'
        ) {
          App.navigate('wallet');
        }
      });

      const icon = document.createElement('div');
      icon.className = 'tx-card__icon';

      const glyph = document.createElement('i');
      glyph.className = 'fas ' + view.icon;
      glyph.setAttribute('aria-hidden', 'true');
      icon.appendChild(glyph);

      const body = document.createElement('div');
      body.className = 'tx-card__body';

      const title = document.createElement('div');
      title.className = 'tx-card__title';
      title.textContent = view.label;

      const description = document.createElement('div');
      description.className = 'tx-card__description';
      description.textContent = view.context;

      const meta = document.createElement('div');
      meta.className = 'tx-card__meta';

      const when = document.createElement('span');
      when.textContent = formatRelativeTime(
        tx.created_at ||
        tx.timestamp ||
        Date.now()
      );

      const badge = document.createElement('span');
      badge.className = 'status-badge';
      badge.dataset.tone = view.tone;
      badge.textContent = view.statusLabel;

      meta.appendChild(when);
      meta.appendChild(badge);

      body.appendChild(title);
      body.appendChild(description);
      body.appendChild(meta);

      const numericAmount = Number(tx.amount);
      const amount = document.createElement('div');
      amount.className = 'tx-card__amount';

      amount.textContent =
        Number.isFinite(numericAmount)
          ? view.amountPrefix + formatMoney(numericAmount)
          : '—';

      row.appendChild(icon);
      row.appendChild(body);
      row.appendChild(amount);

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
    wrap.className = 'home-market-list';

    if (!assets.length && !mover) {
      const empty = el('div', 'border-radius:16px;padding:18px;background:var(--color-surface);border:1px solid var(--color-border);');
      empty.appendChild(el('div', 'font-size:14px;font-weight:700;color:var(--color-text-primary);margin-bottom:4px;', 'No market exposure yet'));
      empty.appendChild(el('div', 'font-size:12px;line-height:1.4;color:var(--color-text-secondary);', 'When you hold assets, they will appear here.'));
      wrap.appendChild(empty);
      shell.appendChild(wrap);
      return shell;
    }

    assets.slice(0, 3).forEach(asset => {
      const row = el('div', 'display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:var(--color-surface);border:1px solid var(--color-border);min-width:0;');
      const icon = el('div', 'width:30px;height:30px;border-radius:999px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:var(--color-surface-elevated);color:var(--color-text-primary);font-size:12px;font-weight:900;');
      const assetImageUrl = coinImageUrl(asset.image);
      if (assetImageUrl) {
        const img = document.createElement('img');
        img.alt = asset.symbol;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        img.addEventListener('error', () => {
          img.remove();
          icon.textContent = asset.symbol.slice(0, 3);
        }, { once: true });
        img.src = assetImageUrl;
        icon.appendChild(img);
      } else {
        icon.textContent = asset.symbol.slice(0, 3);
      }
      row.appendChild(icon);
      const copy = el('div', 'min-width:0;flex:1;');
      copy.appendChild(el('div', 'font-size:13px;font-weight:800;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', asset.name + ' · ' + asset.symbol));
      copy.appendChild(el('div', 'font-size:11px;color:var(--color-text-secondary);margin-top:4px;', formatMoney(asset.qty) + ' · ' + formatMoney(asset.value)));
      row.appendChild(copy);
      const chg = el('div', 'flex-shrink:0;font-size:12px;font-weight:800;color:' + (asset.change24 >= 0 ? '#34d399' : '#f87171') + ';', formatPercent(asset.change24));
      row.appendChild(chg);
      wrap.appendChild(row);
    });

    if (mover) {
      const row = el('div', 'display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:var(--color-surface);border:1px solid var(--color-border);min-width:0;');
      const icon = el('div', 'width:30px;height:30px;border-radius:999px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:rgba(255,255,255,0.08);color:var(--color-text-primary);font-size:12px;font-weight:900;');
      const moverImageUrl = coinImageUrl(mover.image);
      if (moverImageUrl) {
        const img = document.createElement('img');
        img.alt = mover.symbol;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        img.addEventListener('error', () => {
          img.remove();
          icon.textContent = mover.symbol.slice(0, 3);
        }, { once: true });
        img.src = moverImageUrl;
        icon.appendChild(img);
      } else {
        icon.textContent = mover.symbol.slice(0, 3);
      }
      row.appendChild(icon);
      const copy = el('div', 'min-width:0;flex:1;');
      copy.appendChild(el('div', 'font-size:13px;font-weight:800;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', 'Top mover · ' + mover.name));
      copy.appendChild(el('div', 'font-size:11px;color:var(--color-text-secondary);margin-top:4px;', mover.symbol + ' · ' + formatMoney(mover.price)));
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
    grid.className = 'home-stat-grid';

    const cells = [
      { label: 'Active positions', value: String(active.length) },
      { label: 'Completed claims', value: String(claims || completed.length) },
      { label: 'Deposits', value: String(deposits) },
      { label: 'Tracked assets', value: String(holdCount) },
      { label: 'Portfolio total', value: formatCompactMoney(total) },
      { label: 'Update state', value: snapshot.balanceSyncStatus === 'ready' ? 'Live' : 'Syncing' }
    ];

    cells.forEach(cell => {
      const box = el('div', 'min-width:0;');
      box.className = 'home-stat-cell';
      box.appendChild(el('div', 'font-size:11px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:var(--color-text-tertiary);', cell.label));
      box.appendChild(el('div', 'font-size:18px;font-weight:900;letter-spacing:-0.3px;color:var(--color-text-primary);margin-top:8px;word-break:break-word;', cell.value));
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
    const card = el('div', 'border-radius:16px;padding:16px;background:var(--color-surface);border:1px solid var(--color-border);display:flex;flex-direction:column;gap:10px;');
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
      content.appendChild(el('div', 'font-size:18px;font-weight:900;color:var(--color-text-primary);text-align:center;line-height:1.25;', step.title));
      content.appendChild(el('div', 'font-size:14px;line-height:1.6;color:#cbd5e1;text-align:center;', step.body));
      const next = el('button', 'width:100%;padding:14px;border:none;border-radius:14px;background:var(--color-primary,#3b82f6);color:var(--color-text-primary);font-size:14px;font-weight:800;cursor:pointer;', idx === steps.length - 1 ? 'Get started' : 'Next');
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
        const skip = el('button', 'width:100%;padding:13px;border-radius:14px;border:1px solid var(--color-border);background:rgba(255,255,255,0.05);color:#cbd5e1;font-size:13px;font-weight:700;cursor:pointer;');
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
    root.className = 'home-workspace';

    root.appendChild(heroCard(snapshot));

    if (snapshot.balanceSyncStatus !== 'ready') {
      root.appendChild(loadingSection('Recent activity', 3));
      root.appendChild(loadingSection('Market pulse', 3));
      root.appendChild(loadingSection('Smart context', 2));
      root.appendChild(loadingSection('Live stats', 4));
      return root;
    }

    const hasActiveStrategies = (snapshot.investments || []).some(
      investment => investment && investment.status === 'active'
    );

    const smartPriority = smartContextPriority(snapshot);

    if (smartPriority === 'action') {
      root.appendChild(
        smartContextSection(snapshot)
      );
    }

    if (hasActiveStrategies) {
      root.appendChild(
        investmentsSection(snapshot)
      );
    }

    root.appendChild(
      activitySection(snapshot)
    );

    root.appendChild(
      marketPulseSection(snapshot)
    );

    if (smartPriority !== 'action') {
      root.appendChild(
        smartContextSection(snapshot)
      );
    }

    root.appendChild(
      liveStatsSection(snapshot)
    );
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

  function getNavigationState() {
    return { scrollTop: _scrollEl ? _scrollEl.scrollTop : 0 };
  }

  function restoreNavigationState(snapshot) {
    if (!_scrollEl || !snapshot) return;
    requestAnimationFrame(() => {
      _scrollEl.scrollTop = Number(snapshot.scrollTop) || 0;
    });
  }

  window.Home = { render, refresh, destroy, cleanup, getNavigationState, restoreNavigationState };
})();
