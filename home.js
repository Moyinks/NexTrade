/**
 * NexTrade — Home Dashboard v6.0
 *
 * ARCHITECTURE — mirrors wallet.js exactly:
 *
 * CONTAINER:
 *   Wallet does: container.style.cssText = 'display:flex; flex-direction:column; height:100%; overflow:hidden;'
 *   Home does:   same. This overrides .app-main's overflow-y:auto but NOT its padding:16px
 *   (cssText only overrides properties explicitly listed — padding is not listed so CSS class still gives us 16px sides)
 *
 * INNER SCROLLER:
 *   Wallet: contentContainer (flex:1, overflow:hidden) → overview-tab (flex col, overflow-y:auto, NO extra padding)
 *   Home:   scroller (flex:1, overflow-y:auto, padding-bottom:80px, NO extra horizontal padding)
 *   Both sit inside container's CSS-class 16px padding → hero and all cards are automatically identical width.
 *
 * HERO:
 *   Identical CSS to wallet hero: border-radius:0 0 16px 16px, padding:20px, margin-bottom:16px, min-height:140px.
 *   Compact 2-part layout: left (label+number+sub-line) / right (eye button). No chips, no sub-grids.
 *
 * VAULT BALANCE:
 *   Reads directly from AppState.get('balances').vault — same source as wallet. No recalculation.
 *
 * COIN CLICK:
 *   Opens a modal with Buy/Sell buttons calling Trade.openBuy(id) / Trade.openSell(id), same as wallet's showAssetDetails().
 */

(function () {
  'use strict';

  let _container     = null;
  let _destroyed     = false;
  let _tickerTimer   = null;
  let _streakToasted = false;

  function _showStreakToast(count) {
    const old = document.getElementById('_nex_streak_toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = '_nex_streak_toast';
    t.style.cssText = 'position:fixed;top:76px;left:50%;transform:translateX(-50%) translateY(-10px);z-index:9999;background:rgba(8,12,24,0.95);border:1px solid rgba(251,146,60,0.3);border-radius:16px;padding:10px 16px 10px 12px;display:flex;align-items:center;gap:12px;box-shadow:0 12px 32px rgba(0,0,0,0.5),0 0 0 1px rgba(251,146,60,0.06);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);opacity:0;transition:opacity 0.25s ease,transform 0.35s cubic-bezier(0.34,1.56,0.64,1);pointer-events:none;white-space:nowrap;';
    t.innerHTML = '<div style="width:34px;height:34px;border-radius:10px;background:rgba(251,146,60,0.12);border:1px solid rgba(251,146,60,0.2);display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;">🔥</div><div><div style="font-size:13px;font-weight:700;color:#fff;letter-spacing:-0.3px;">' + count + '-day streak</div><div style="font-size:11px;color:rgba(251,146,60,0.7);margin-top:1px;font-weight:500;">Keep it up</div></div>';
    document.body.appendChild(t);
    requestAnimationFrame(() => { requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; }); });
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(-10px)'; setTimeout(() => t.remove(), 300); }, 3000);
  }

  // ─── STATE ───────────────────────────────────────────────────────────────────

  function getState() {
    if (!window.AppState) {
      return { user: null, profile: null, balances: { spot:0, vault:0 }, holdings: {}, investments: [], transactions: [], marketData: [] };
    }
    return {
      user:         AppState.get('user')         || null,
      profile:      AppState.get('profile')      || null,
      balances:     AppState.get('balances')     || { spot: 0, vault: 0 },
      holdings:     AppState.get('holdings')     || {},
      investments:  AppState.get('investments')  || [],
      transactions: AppState.get('transactions') || [],
      marketData:   AppState.get('marketData')   || []
    };
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────────

  function calcPortfolio() {
    const st    = getState();
    // Read vault directly from AppState — same source as wallet, no recalculation
    const spot  = parseFloat((st.balances || {}).spot  || 0);
    const vault = parseFloat((st.balances || {}).vault || 0);
    const mkt   = st.marketData || [];
    const hld   = st.holdings   || {};
    let cryptoValue = 0, crypto24hDiff = 0;
    Object.entries(hld).forEach(([sym, amt]) => {
      const qty = parseFloat(amt) || 0;
      if (qty <= 0) return;
      const coin = mkt.find(c =>
        (c.symbol||'').toLowerCase() === sym.toLowerCase() ||
        (c.id    ||'').toLowerCase() === sym.toLowerCase()
      );
      if (coin && coin.current_price) {
        const val = qty * coin.current_price;
        cryptoValue   += val;
        crypto24hDiff += val * ((coin.price_change_percentage_24h || 0) / 100);
      }
    });
    const total     = spot + vault + cryptoValue;
    const prev24h   = total - crypto24hDiff;
    const change24  = total - prev24h;
    const changePct = prev24h > 0 ? (change24 / prev24h) * 100 : 0;
    return { spot, vault, cryptoValue, total, change24, changePct };
  }

  function fmt(val) {
    const n = parseFloat(val) || 0;
    if (window.Format && Format.currency) return Format.currency(n);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtCompact(n) {
    n = parseFloat(n) || 0;
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k';
    return fmt(n);
  }

  function firstName() {
    const st   = getState();
    const meta = (st.user || {}).user_metadata || {};
    const raw  = (st.profile || {}).full_name || meta.full_name || meta.name || 'there';
    return raw.split(' ')[0];
  }

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  function bumpStreak() {
    try {
      const today     = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      const raw       = localStorage.getItem('nex_streak');
      const s         = raw ? JSON.parse(raw) : { count: 0, lastDate: null };
      if (s.lastDate === today) return s;
      const count = s.lastDate === yesterday ? s.count + 1 : 1;
      const next  = { count, lastDate: today };
      localStorage.setItem('nex_streak', JSON.stringify(next));
      return next;
    } catch (_) { return { count: 1, lastDate: null }; }
  }

  function isFirstLogin() {
    try { return !localStorage.getItem('nex_onboarded'); } catch (_) { return false; }
  }
  function markOnboarded() {
    try { localStorage.setItem('nex_onboarded', '1'); } catch (_) {}
  }

  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css)          e.style.cssText = css;
    if (text != null) e.textContent   = text;
    return e;
  }

  // ─── COIN DETAIL MODAL ────────────────────────────────────────────────────────
  // Mirrors wallet's showAssetDetails() — Buy/Sell buttons open Trade module.

  function showCoinModal(coin) {
    if (!window.Modal) return;
    const chg    = coin.price_change_percentage_24h || 0;
    const isUp   = chg >= 0;
    const hidden = localStorage.getItem('nex_hide_balance') === 'true';

    // Check if user holds this coin
    const st      = getState();
    const holdings = st.holdings || {};
    const coinId   = (coin.id || coin.symbol || '').toLowerCase();
    let heldAmt    = 0;
    let heldValue  = 0;
    Object.entries(holdings).forEach(([sym, amt]) => {
      if (sym.toLowerCase() === coinId || sym.toLowerCase() === (coin.symbol||'').toLowerCase()) {
        heldAmt   = parseFloat(amt) || 0;
        heldValue = heldAmt * (coin.current_price || 0);
      }
    });

    const content = document.createElement('div');

    // Coin header
    const header = el('div', 'text-align:center;margin-bottom:20px;');
    const imgWrap = el('div', 'width:64px;height:64px;margin:0 auto 14px;border-radius:50%;background:var(--color-surface-elevated,#1e2330);display:flex;align-items:center;justify-content:center;overflow:hidden;');
    if (coin.image) {
      const img = document.createElement('img');
      img.src = coin.image; img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      imgWrap.appendChild(img);
    } else {
      imgWrap.appendChild(el('span', 'font-size:24px;font-weight:700;color:#fff;', (coin.symbol||'?')[0].toUpperCase()));
    }
    header.appendChild(imgWrap);
    header.appendChild(el('h3', 'font-size:18px;font-weight:700;color:var(--color-text-primary,#fff);margin:0 0 4px;', coin.name || ''));
    header.appendChild(el('div', 'font-size:13px;color:var(--color-text-secondary,#94a3b8);', (coin.symbol||'').toUpperCase()));
    content.appendChild(header);

    // Stats card
    const stats = el('div', 'background:var(--color-surface-elevated,#1e2330);padding:16px;border-radius:12px;margin-bottom:16px;border:1px solid var(--color-border,rgba(255,255,255,0.08));');
    const statsGrid = el('div', 'display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;');

    const priceCell = el('div');
    priceCell.appendChild(el('div', 'font-size:10px;color:var(--color-text-tertiary,#64748b);margin-bottom:4px;font-weight:500;text-transform:uppercase;', 'Current Price'));
    priceCell.appendChild(el('div', 'font-family:var(--font-mono,monospace);font-size:18px;font-weight:700;color:var(--color-text-primary,#fff);', fmt(coin.current_price || 0)));
    statsGrid.appendChild(priceCell);

    const changeCell = el('div');
    changeCell.appendChild(el('div', 'font-size:10px;color:var(--color-text-tertiary,#64748b);margin-bottom:4px;font-weight:500;text-transform:uppercase;', '24h Change'));
    changeCell.appendChild(el('div', 'font-size:18px;font-weight:700;color:' + (isUp ? '#10b981' : '#ef4444') + ';', (isUp ? '+' : '') + chg.toFixed(2) + '%'));
    statsGrid.appendChild(changeCell);

    stats.appendChild(statsGrid);

    if (heldAmt > 0) {
      const divider = el('div', 'padding-top:14px;border-top:1px solid var(--color-border,rgba(255,255,255,0.08));');
      const holdRow = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;');
      holdRow.appendChild(el('span', 'font-size:12px;color:var(--color-text-tertiary,#64748b);', 'Your Holdings'));
      holdRow.appendChild(el('span', 'font-family:var(--font-mono,monospace);font-size:14px;font-weight:700;color:var(--color-text-primary,#fff);', hidden ? '••••' : heldAmt.toFixed(6) + ' ' + (coin.symbol||'').toUpperCase()));
      divider.appendChild(holdRow);
      const valRow = el('div', 'display:flex;justify-content:space-between;align-items:center;');
      valRow.appendChild(el('span', 'font-size:12px;color:var(--color-text-tertiary,#64748b);', 'Value'));
      valRow.appendChild(el('span', 'font-family:var(--font-mono,monospace);font-size:16px;font-weight:700;color:var(--color-text-primary,#fff);', hidden ? '••••' : fmt(heldValue)));
      divider.appendChild(valRow);
      stats.appendChild(divider);
    }
    content.appendChild(stats);

    // Buy / Sell buttons — same as wallet
    const btns = el('div', 'display:grid;grid-template-columns:1fr 1fr;gap:10px;');

    const sellBtn = el('button', 'width:100%;padding:13px;font-size:14px;font-weight:700;border-radius:10px;cursor:pointer;background:rgba(239,68,68,0.1);border:1px solid #ef4444;color:#ef4444;display:flex;align-items:center;justify-content:center;gap:6px;', '');
    const sellI = document.createElement('i'); sellI.className = 'fas fa-arrow-down'; sellI.style.fontSize = '12px';
    sellBtn.insertBefore(sellI, sellBtn.firstChild);
    sellBtn.appendChild(document.createTextNode('Sell'));
    sellBtn.onclick = () => {
      Modal.close();
      setTimeout(() => { if (window.Trade && Trade.openSell) Trade.openSell(coin.id); }, 300);
    };

    const buyBtn = el('button', 'width:100%;padding:13px;font-size:14px;font-weight:700;border-radius:10px;cursor:pointer;background:#10b981;border:1px solid #10b981;color:#fff;display:flex;align-items:center;justify-content:center;gap:6px;', '');
    const buyI = document.createElement('i'); buyI.className = 'fas fa-arrow-up'; buyI.style.fontSize = '12px';
    buyBtn.insertBefore(buyI, buyBtn.firstChild);
    buyBtn.appendChild(document.createTextNode('Buy'));
    buyBtn.onclick = () => {
      Modal.close();
      setTimeout(() => { if (window.Trade && Trade.openBuy) Trade.openBuy(coin.id); }, 300);
    };

    btns.appendChild(sellBtn);
    btns.appendChild(buyBtn);
    content.appendChild(btns);

    Modal.open({ title: coin.name || 'Coin', content, maxWidth: '420px', showCloseButton: true });
  }

  // ─── HERO ─────────────────────────────────────────────────────────────────────
  // CSS identical to wallet's createHeroCard(). Compact single-row layout.

  function buildHero() {
    const { spot, vault, cryptoValue, total, change24, changePct } = calcPortfolio();
    const strk   = bumpStreak();
    const up     = change24 >= 0;
    const hidden = localStorage.getItem('nex_hide_balance') === 'true';

    const _toastKey = 'nex_streak_toasted_' + new Date().toDateString();
    if (strk.count >= 2 && !localStorage.getItem(_toastKey)) {
      localStorage.setItem(_toastKey, '1');
      setTimeout(() => _showStreakToast(strk.count), 1400);
    }

    const card = document.createElement('div');
    card.id = 'home-hero-card';
    card.style.cssText = [
      'position:sticky',
      'top:0',
      'z-index:20',
      'overflow:hidden',
      'border-radius:0 0 16px 16px',
      'padding:20px',
      'margin-bottom:16px',
      'background:linear-gradient(168deg, #070f1e, #030810)',
      'border:none',
      'border-bottom:1px solid rgba(59,130,246,0.15)',
      'box-shadow:0 4px 16px rgba(0,0,0,0.3)',
      'min-height:140px',
      'flex-shrink:0'
    ].join(';');

    // Decorative blob
    const blob = el('div');
    blob.style.cssText = 'position:absolute;top:-40px;right:-40px;width:150px;height:150px;border-radius:50%;background:rgba(99,102,241,0.07);pointer-events:none;';
    card.appendChild(blob);

    // Main row: left content / right eye button — exactly wallet layout
    const row = el('div', 'display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px;');
    const left = el('div', 'flex:1;');

    // Greeting as label (wallet: "TOTAL EQUITY", home: greeting + streak)
    const labelRow = el('div', 'display:flex;align-items:center;gap:8px;margin-bottom:6px;');
    labelRow.appendChild(el('div', 'font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.5);', greeting() + ', ' + firstName()));
    if (strk.count >= 2) {
      const sb = el('div', 'display:inline-flex;align-items:center;gap:3px;');
      sb.appendChild(el('span', 'font-size:10px;', '🔥'));
      sb.appendChild(el('span', 'font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);', strk.count + 'd'));
      labelRow.appendChild(sb);
    }
    left.appendChild(labelRow);

    // Big number — 32px, font-weight:700, letter-spacing:-1px — same as wallet
    const numEl = el('div');
    numEl.id = 'home-total-value';
    numEl.style.cssText = 'font-family:var(--font-mono,monospace);font-size:32px;font-weight:700;color:#fff;letter-spacing:-1px;line-height:1;margin-bottom:8px;';
    numEl.textContent = hidden ? '••••••••' : fmt(total);
    left.appendChild(numEl);

    // Sub-line: "Liquid: $X  Crypto: $X  ▲ 0.41% 24h" — same pattern as wallet
    const subLine = el('div', 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;');
    if (total > 0) {
      const parts = [];
      if (spot > 0)        parts.push({ label: 'Cash',   val: fmtCompact(spot) });
      if (vault > 0)       parts.push({ label: 'Vault',  val: fmtCompact(vault) });
      if (cryptoValue > 0) parts.push({ label: 'Crypto', val: fmtCompact(cryptoValue) });
      parts.forEach(p => {
        const chunk = document.createElement('div');
        chunk.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.7);';
        chunk.innerHTML = '<span style="opacity:0.6;">' + p.label + ': </span><span style="font-weight:600;">' + (hidden ? '••••' : p.val) + '</span>';
        subLine.appendChild(chunk);
      });
      if (change24 !== 0 && !hidden) {
        subLine.appendChild(el('div', 'font-size:10px;font-weight:700;color:' + (up ? '#6ee7b7' : '#fca5a5') + ';', (up ? '▲' : '▼') + ' ' + Math.abs(changePct).toFixed(2) + '% 24h'));
      }
    } else {
      subLine.appendChild(el('div', 'font-size:10px;color:rgba(255,255,255,0.45);', 'Add funds to start growing your portfolio'));
    }
    left.appendChild(subLine);
    row.appendChild(left);

    // Eye button — same size, same style as wallet
    const privBtn = el('button');
    privBtn.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.8);width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background 0.2s;padding:0;';
    const privIcon = document.createElement('i');
    privIcon.className = 'fas ' + (hidden ? 'fa-eye-slash' : 'fa-eye');
    privIcon.style.fontSize = '12px';
    privBtn.appendChild(privIcon);
    privBtn.addEventListener('click', e => {
      e.stopPropagation();
      const cur = localStorage.getItem('nex_hide_balance') === 'true';
      localStorage.setItem('nex_hide_balance', String(!cur));
      if (_container) render(_container);
    });
    row.appendChild(privBtn);
    card.appendChild(row);

    // Deposit CTA for zero state — same style as wallet's address chip
    if (total === 0) {
      const depBtn = el('button');
      depBtn.style.cssText = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);padding:5px 10px;border-radius:8px;color:rgba(255,255,255,0.85);font-family:var(--font-mono,monospace);font-size:10px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all 0.2s;';
      depBtn.innerHTML = '<span style="opacity:0.9;">Deposit to get started</span><i class="fas fa-arrow-right" style="font-size:8px;opacity:0.6;"></i>';
      depBtn.addEventListener('click', () => { if (window.Trade) Trade.openDeposit(); });
      card.appendChild(depBtn);
    }

    return card;
  }

  // ─── QUICK ACTIONS ────────────────────────────────────────────────────────────
  // Pixel-identical to wallet's createQuickActions().

  function buildQuickActions() {
    const section = el('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;padding:0;');

    const actions = [
      { label: 'Add Money', icon: 'fa-arrow-down',   color: '#10b981', action: () => window.Trade && Trade.openDeposit()    },
      { label: 'Send',      icon: 'fa-arrow-up',     color: '#ef4444', action: () => window.Trade && Trade.openWithdraw()   },
      { label: 'Trade',     icon: 'fa-exchange-alt', color: '#8b5cf6', action: () => window.App   && App.navigate('market') }
    ];

    actions.forEach(a => {
      const btn = el('button');
      btn.style.cssText = 'background:var(--color-surface,#151921);border:1px solid var(--color-border,rgba(255,255,255,0.08));border-radius:10px;padding:12px 8px;height:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;cursor:pointer;transition:all 0.2s;width:100%;';

      const iconBox = el('div');
      iconBox.style.cssText = 'width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:' + a.color + '20;color:' + a.color + ';';
      const i = document.createElement('i');
      i.className = 'fas ' + a.icon; i.style.fontSize = '12px';
      iconBox.appendChild(i);
      btn.appendChild(iconBox);
      btn.appendChild(el('span', 'font-size:11px;font-weight:600;color:var(--color-text-primary,#fff);', a.label));

      btn.addEventListener('mouseenter', () => { btn.style.borderColor = a.color; btn.style.background = a.color + '08'; });
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--color-border,rgba(255,255,255,0.08))'; btn.style.background = 'var(--color-surface,#151921)'; });
      btn.addEventListener('click', a.action);
      section.appendChild(btn);
    });

    return section;
  }

  // ─── MARKETS PREVIEW ──────────────────────────────────────────────────────────
  // Each coin row clickable → showCoinModal(). Section header + borderless list card.

  function buildMarket() {
    const st   = getState();
    const data = (st.marketData || []).slice(0, 5);
    const wrap = el('div', 'margin-bottom:16px;padding:0;');

    const hdr = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;');
    hdr.appendChild(el('span', 'font-size:14px;font-weight:700;color:var(--color-text-primary,#fff);', 'Markets'));
    const seeAll = el('button', 'font-size:11px;font-weight:600;color:var(--color-primary,#3b82f6);background:none;border:none;cursor:pointer;padding:0;', 'See all →');
    seeAll.addEventListener('click', () => { if (window.App) App.navigate('market'); });
    hdr.appendChild(seeAll);
    wrap.appendChild(hdr);

    // Card matches wallet's borderless list style
    const card = el('div', 'background:var(--color-surface,#151921);border:1px solid var(--color-border,rgba(255,255,255,0.08));border-radius:12px;overflow:hidden;');

    if (!data.length) {
      for (let i = 0; i < 5; i++) {
        const row = el('div', 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px;' + (i < 4 ? 'border-bottom:1px solid rgba(255,255,255,0.05);' : ''));
        const L = el('div', 'display:flex;align-items:center;gap:10px;');
        L.appendChild(el('div', 'width:36px;height:36px;border-radius:50%;background:var(--color-surface-elevated,#1e2330);'));
        const t = el('div');
        t.appendChild(el('div', 'width:' + [65,50,60,45,55][i] + 'px;height:11px;background:var(--color-surface-elevated,#1e2330);border-radius:4px;margin-bottom:4px;'));
        t.appendChild(el('div', 'width:38px;height:9px;background:var(--color-surface-elevated,#1e2330);border-radius:4px;'));
        L.appendChild(t);
        row.appendChild(L);
        row.appendChild(el('div', 'width:52px;height:12px;background:var(--color-surface-elevated,#1e2330);border-radius:4px;'));
        card.appendChild(row);
      }
      wrap.appendChild(card);
      return wrap;
    }

    data.forEach((coin, idx) => {
      const chg = coin.price_change_percentage_24h || 0;
      const up  = chg >= 0;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background 0.1s;' + (idx < data.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.05);' : '');

      // Click → coin modal with Buy/Sell
      row.addEventListener('click', () => showCoinModal(coin));
      row.addEventListener('touchstart', () => { row.style.background = 'rgba(255,255,255,0.04)'; }, { passive: true });
      row.addEventListener('touchend',   () => { row.style.background = ''; }, { passive: true });

      const L = el('div', 'display:flex;align-items:center;gap:10px;');
      const iconWrap = el('div', 'width:36px;height:36px;border-radius:50%;background:var(--color-surface-elevated,#1e2330);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;');
      if (coin.image) {
        const img = document.createElement('img');
        img.src = coin.image; img.width = 28; img.height = 28;
        img.style.cssText = 'border-radius:50%;object-fit:cover;';
        img.onerror = () => { img.style.display = 'none'; iconWrap.appendChild(el('span', 'font-size:9px;font-weight:700;color:rgba(255,255,255,0.5);', (coin.symbol||'?').toUpperCase().slice(0,3))); };
        iconWrap.appendChild(img);
      } else {
        iconWrap.appendChild(el('span', 'font-size:9px;font-weight:700;color:rgba(255,255,255,0.5);', (coin.symbol||'?').toUpperCase().slice(0,3)));
      }
      L.appendChild(iconWrap);
      const t = el('div');
      t.appendChild(el('div', 'font-size:13px;font-weight:700;color:var(--color-text-primary,#fff);', (coin.symbol||'').toUpperCase()));
      t.appendChild(el('div', 'font-size:11px;color:var(--color-text-secondary,#94a3b8);', coin.name || ''));
      L.appendChild(t);

      const R = el('div', 'text-align:right;');
      R.appendChild(el('div', 'font-size:13px;font-weight:700;color:var(--color-text-primary,#fff);font-family:var(--font-mono,monospace);', fmt(coin.current_price || 0)));
      R.appendChild(el('div', 'font-size:11px;font-weight:600;color:' + (up ? '#10b981' : '#ef4444') + ';', (up ? '+' : '') + chg.toFixed(2) + '%'));

      row.appendChild(L);
      row.appendChild(R);
      card.appendChild(row);
    });

    wrap.appendChild(card);
    return wrap;
  }


  // ─── INVESTOR PROFILE QUIZ CARD ───────────────────────────────────────────────
  // Shows on home feed. 2 questions, 8 seconds. Stores result in localStorage.
  // Once answered, collapses to a compact profile chip.

  function buildInvestorQuizCard() {
    const PROFILE_KEY = 'nex_investor_profile';
    const existing = localStorage.getItem(PROFILE_KEY);
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:16px;';

    if (existing) {
      const isPlanA = existing === 'steady-accumulator';
      const chip = document.createElement('div');
      chip.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:var(--color-surface,#151921);border:1px solid var(--color-border,rgba(255,255,255,0.08));border-radius:12px;padding:12px 14px;cursor:pointer;';
      const left = document.createElement('div');
      left.style.cssText = 'display:flex;align-items:center;gap:10px;';
      const icon = document.createElement('div');
      icon.style.cssText = 'width:34px;height:34px;border-radius:9px;background:' + (isPlanA ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)') + ';display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;';
      icon.textContent = isPlanA ? '\u{1F6E1}\uFE0F' : '\u26A1';
      const txt = document.createElement('div');
      const t1 = document.createElement('div');
      t1.style.cssText = 'font-size:11px;color:var(--color-text-secondary,#94a3b8);margin-bottom:2px;';
      t1.textContent = 'Your investor profile';
      const t2 = document.createElement('div');
      t2.style.cssText = 'font-size:13px;font-weight:700;color:var(--color-text-primary,#fff);';
      t2.textContent = isPlanA ? 'Steady Accumulator' : 'Alpha Seeker';
      txt.appendChild(t1); txt.appendChild(t2);
      left.appendChild(icon); left.appendChild(txt);
      const arrow = document.createElement('div');
      arrow.style.cssText = 'font-size:13px;font-weight:600;color:var(--color-primary,#3b82f6);';
      arrow.textContent = 'View plan \u2192';
      chip.appendChild(left); chip.appendChild(arrow);
      chip.addEventListener('click', () => { if (window.App) App.navigate('vault'); });
      wrap.appendChild(chip);
      return wrap;
    }

    const card = document.createElement('div');
    card.style.cssText = 'background:linear-gradient(135deg,rgba(99,102,241,0.08) 0%,rgba(59,130,246,0.05) 100%);border:1px solid rgba(99,102,241,0.2);border-radius:16px;padding:18px;overflow:hidden;position:relative;';

    const orb = document.createElement('div');
    orb.style.cssText = 'position:absolute;top:-30px;right:-30px;width:110px;height:110px;border-radius:50%;background:rgba(99,102,241,0.07);pointer-events:none;';
    card.appendChild(orb);

    const questions = [
      {
        q: 'If your investment dipped 25% in week one, you\'d\u2026',
        a: [
          { label: 'Lose sleep and exit', val: 'steady-accumulator' },
          { label: 'Hold \u2014 I think long-term', val: 'alpha-seeker' }
        ]
      },
      {
        q: 'Your goal with this money is\u2026',
        a: [
          { label: 'Reliable, steady growth', val: 'steady-accumulator' },
          { label: 'Maximum returns, I know the risks', val: 'alpha-seeker' }
        ]
      }
    ];

    let step = 0;
    const votes = [];

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:14px;';
    const hIcon = document.createElement('div');
    hIcon.style.cssText = 'font-size:22px;flex-shrink:0;';
    hIcon.textContent = '\u{1F9ED}';
    const hTxt = document.createElement('div');
    const hTitle = document.createElement('div');
    hTitle.style.cssText = 'font-size:14px;font-weight:700;color:var(--color-text-primary,#fff);margin-bottom:2px;';
    hTitle.textContent = 'What kind of investor are you?';
    const hSub = document.createElement('div');
    hSub.style.cssText = 'font-size:11px;color:var(--color-text-secondary,#94a3b8);';
    hSub.textContent = '2 questions \u00B7 8 seconds \u00B7 find your plan';
    hTxt.appendChild(hTitle); hTxt.appendChild(hSub);
    header.appendChild(hIcon); header.appendChild(hTxt);
    card.appendChild(header);

    const progWrap = document.createElement('div');
    progWrap.style.cssText = 'display:flex;gap:5px;margin-bottom:14px;';
    const bars = questions.map(() => {
      const b = document.createElement('div');
      b.style.cssText = 'flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,0.1);transition:background 0.3s;';
      progWrap.appendChild(b);
      return b;
    });
    card.appendChild(progWrap);

    const qArea = document.createElement('div');
    card.appendChild(qArea);

    function renderQ(idx) {
      qArea.innerHTML = '';
      if (idx < bars.length) bars[idx].style.background = 'rgba(99,102,241,0.8)';
      const q = questions[idx];
      const qText = document.createElement('div');
      qText.style.cssText = 'font-size:13px;font-weight:600;color:var(--color-text-primary,#fff);margin-bottom:10px;line-height:1.5;';
      qText.textContent = q.q;
      qArea.appendChild(qText);
      q.a.forEach(opt => {
        const btn = document.createElement('button');
        btn.style.cssText = 'width:100%;text-align:left;padding:11px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:var(--color-text-primary,#fff);font-size:13px;font-weight:500;cursor:pointer;margin-bottom:8px;display:block;transition:all 0.15s;';
        btn.textContent = opt.label;
        btn.addEventListener('touchstart', () => { btn.style.background='rgba(99,102,241,0.2)'; btn.style.borderColor='rgba(99,102,241,0.5)'; }, { passive: true });
        btn.addEventListener('click', () => {
          votes.push(opt.val);
          step++;
          if (step < questions.length) { renderQ(step); }
          else {
            const aCnt = votes.filter(v => v === 'alpha-seeker').length;
            const profile = aCnt > votes.length - aCnt ? 'alpha-seeker' : 'steady-accumulator';
            try { localStorage.setItem(PROFILE_KEY, profile); } catch(_) {}
            showResult(profile);
          }
        });
        qArea.appendChild(btn);
      });
    }

    function showResult(profile) {
      const isPlanA = profile === 'steady-accumulator';
      qArea.innerHTML = '';
      bars.forEach(b => { b.style.background = 'rgba(99,102,241,0.8)'; });
      const res = document.createElement('div');
      res.style.cssText = 'text-align:center;padding:4px 0;';
      const badge = document.createElement('div');
      badge.style.cssText = 'display:inline-flex;align-items:center;gap:8px;background:' + (isPlanA ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)') + ';border:1px solid ' + (isPlanA ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)') + ';border-radius:20px;padding:6px 14px;margin-bottom:10px;';
      badge.innerHTML = '<span>' + (isPlanA ? '\u{1F6E1}\uFE0F' : '\u26A1') + '</span><span style="font-size:12px;font-weight:700;color:' + (isPlanA ? '#10b981' : '#f59e0b') + ';">You\u2019re a ' + (isPlanA ? 'Steady Accumulator' : 'Alpha Seeker') + '</span>';
      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:12px;color:var(--color-text-secondary,#94a3b8);margin-bottom:12px;line-height:1.5;';
      sub.textContent = isPlanA ? 'Consistent 22% APY. Capital protected. 90-day term.' : 'Up to 65% APY. Quant-driven momentum. 30-day term.';
      const cta = document.createElement('button');
      cta.style.cssText = 'width:100%;padding:12px;font-size:13px;font-weight:700;background:' + (isPlanA ? '#10b981' : '#f59e0b') + ';color:#fff;border:none;border-radius:10px;cursor:pointer;';
      cta.textContent = 'See my plan \u2192';
      cta.addEventListener('click', () => { if (window.App) App.navigate('vault'); });
      res.appendChild(badge); res.appendChild(sub); res.appendChild(cta);
      qArea.appendChild(res);
    }

    renderQ(0);
    wrap.appendChild(card);
    return wrap;
  }

  // ─── VAULT CTA ────────────────────────────────────────────────────────────────

  function buildVaultCta() {
    const st     = getState();
    const active = (st.investments || []).filter(i => i.status === 'active');
    const hasAny = active.length > 0;

    const card = el('div');
    card.style.cssText = 'background:linear-gradient(135deg,rgba(139,92,246,0.1) 0%,rgba(59,130,246,0.07) 100%);border:1px solid rgba(139,92,246,0.2);border-radius:12px;padding:14px;';

    const hdr = el('div', 'display:flex;align-items:center;gap:10px;margin-bottom:10px;');
    const iconWrap = el('div', 'width:36px;height:36px;border-radius:9px;background:rgba(139,92,246,0.18);display:flex;align-items:center;justify-content:center;flex-shrink:0;');
    const ico = document.createElement('i');
    ico.className = 'fas fa-layer-group'; ico.style.cssText = 'color:#8b5cf6;font-size:14px;';
    iconWrap.appendChild(ico);
    hdr.appendChild(iconWrap);

    const titleWrap = el('div', 'flex:1;');
    titleWrap.appendChild(el('div', 'font-size:13px;font-weight:700;color:var(--color-text-primary,#fff);margin-bottom:2px;', 'Vault — Earn up to 150% APY'));
    titleWrap.appendChild(el('div', 'font-size:11px;color:var(--color-text-secondary,#94a3b8);', hasAny ? active.length + ' active investment' + (active.length > 1 ? 's' : '') + ' running' : '8.5% stable · 28% balanced · 150% high yield'));
    hdr.appendChild(titleWrap);
    card.appendChild(hdr);

    const btn = el('button');
    btn.style.cssText = 'width:100%;padding:10px;font-size:12px;font-weight:700;color:#c4b5fd;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:8px;cursor:pointer;transition:background 0.15s;';
    btn.textContent = hasAny ? 'View My Portfolio →' : 'Explore Strategies →';
    btn.addEventListener('click', () => { if (window.App) App.navigate('vault'); });
    btn.addEventListener('touchstart', () => { btn.style.background = 'rgba(139,92,246,0.25)'; }, { passive: true });
    btn.addEventListener('touchend',   () => { btn.style.background = 'rgba(139,92,246,0.15)'; }, { passive: true });
    card.appendChild(btn);

    return card;
  }

  // ─── WELCOME OVERLAY ──────────────────────────────────────────────────────────

  function showWelcome() {
    if (!window.Modal) { markOnboarded(); return; }
    const steps = [
      { icon: '👋', title: 'Welcome, ' + firstName(), body: 'Everything in one place — your cash, crypto, and investments.' },
      { icon: '💼', title: 'One number to rule them all', body: 'Your portfolio total includes cash, vault earnings, and crypto holdings.' },
      { icon: '💳', title: 'Start by adding funds', body: 'Deposit as little as $10. Withdraw any time with no lock-in fees.' }
    ];
    let step = 0;
    const content = el('div');
    function renderStep() {
      content.innerHTML = '';
      const s = steps[step];
      const dots = el('div', 'display:flex;gap:6px;justify-content:center;margin-bottom:20px;');
      steps.forEach((_, i) => {
        dots.appendChild(el('div', 'width:' + (i === step ? '20px' : '8px') + ';height:8px;border-radius:4px;background:' + (i <= step ? '#3b82f6' : 'rgba(255,255,255,0.08)') + ';transition:all 0.3s;'));
      });
      content.appendChild(dots);
      content.appendChild(el('div', 'font-size:44px;text-align:center;margin-bottom:14px;', s.icon));
      content.appendChild(el('div', 'font-size:18px;font-weight:800;color:#fff;text-align:center;margin-bottom:8px;line-height:1.3;', s.title));
      content.appendChild(el('div', 'font-size:14px;color:#94a3b8;text-align:center;line-height:1.6;margin-bottom:22px;', s.body));
      const isLast = step === steps.length - 1;
      const next = el('button', 'width:100%;padding:15px;font-size:15px;font-weight:700;background:#3b82f6;color:#fff;border:none;border-radius:12px;cursor:pointer;margin-bottom:8px;', isLast ? "Let's go →" : 'Next');
      next.addEventListener('click', () => {
        if (isLast) { markOnboarded(); Modal.close(); setTimeout(() => { if (window.Trade) Trade.openDeposit(); }, 350); }
        else { step++; renderStep(); }
      });
      content.appendChild(next);
      if (!isLast) {
        const skip = el('button', 'width:100%;padding:13px;font-size:14px;font-weight:600;background:rgba(255,255,255,0.06);color:#94a3b8;border:1px solid rgba(255,255,255,0.08);border-radius:12px;cursor:pointer;', 'Skip');
        skip.addEventListener('click', () => { markOnboarded(); Modal.close(); });
        content.appendChild(skip);
      }
    }
    renderStep();
    Modal.open({ title: '', content, maxWidth: '400px', hideTitle: true, dismissible: false });
  }

  // ─── LIVE TICKER ─────────────────────────────────────────────────────────────

  function startTicker() {
    if (_tickerTimer) return;
    function tick() {
      if (_destroyed) return;
      const p = (window.CacheManager && CacheManager.getMarketData) ? CacheManager.getMarketData() : Promise.resolve(null);
      p.then(data => {
        if (data && data.length && window.AppState) AppState.set('marketData', data);
        if (_destroyed) return;
        const hidden = localStorage.getItem('nex_hide_balance') === 'true';
        const numEl  = document.getElementById('home-total-value');
        if (numEl) numEl.textContent = hidden ? '••••••••' : fmt(calcPortfolio().total);
        const mktEl = document.getElementById('home-market-section');
        if (mktEl && !_destroyed) {
          const fresh = buildMarket();
          fresh.id = 'home-market-section';
          mktEl.replaceWith(fresh);
        }
      }).catch(() => {});
    }
    _tickerTimer = setInterval(tick, 30000);
  }

  // ─── MAIN RENDER ─────────────────────────────────────────────────────────────

  async function render(container) {
    if (!container) return;
    _container     = container;
    _destroyed     = false;
  

    // MIRROR WALLET EXACTLY:
    // Wallet: container.style.cssText = 'display:flex; flex-direction:column; height:100%; overflow:hidden;'
    // This stamps display/height/overflow inline. The .app-main CSS class padding:16px is NOT in cssText
    // so it is NOT overridden — .app-main still provides 16px horizontal padding from the CSS class.
    // Result: hero and all cards sit inside the same 16px bounds → identical width, no mismatch.
    container.style.cssText = 'display:flex; flex-direction:column; height:100%; width:100%; overflow:hidden; padding:0;';

    container.innerHTML = '';
    container.scrollTop = 0;

    // Inner scroller — mirrors wallet's overview tab
    // flex:1 fills the remaining height. overflow-y:auto is the actual scroll engine.
    // padding-bottom:80px clears the fixed navbar.
    // NO extra horizontal padding — .app-main CSS class already provides 16px on each side.
    const scroller = el('div');
    scroller.style.cssText = 'flex:1; min-height:0; width:100%; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; padding-bottom:110px;';


    scroller.appendChild(buildHero());
    scroller.appendChild(buildQuickActions());

    const market = buildMarket();
    market.id = 'home-market-section';
    scroller.appendChild(market);

    scroller.appendChild(buildInvestorQuizCard());
    scroller.appendChild(buildVaultCta());
    container.appendChild(scroller);

    // Eager market fetch
    if (window.CacheManager && CacheManager.getMarketData) {
      CacheManager.getMarketData().then(data => {
        if (_destroyed || !data || !data.length) return;
        if (window.AppState) AppState.set('marketData', data);
        const mktEl = document.getElementById('home-market-section');
        if (mktEl && !_destroyed) {
          const fresh = buildMarket();
          fresh.id = 'home-market-section';
          mktEl.replaceWith(fresh);
        }
        const numEl = document.getElementById('home-total-value');
        if (numEl) {
          const hidden = localStorage.getItem('nex_hide_balance') === 'true';
          numEl.textContent = hidden ? '••••••••' : fmt(calcPortfolio().total);
        }
      }).catch(() => {});
    }

    startTicker();
    if (window.Navbar) Navbar.setActive('home');
    if (isFirstLogin()) setTimeout(showWelcome, 700);
  }

  // ─── LIFECYCLE ────────────────────────────────────────────────────────────────

  function refresh() { if (!_destroyed && _container) render(_container); }

  function destroy() {
    _destroyed = true;
    if (_tickerTimer) { clearInterval(_tickerTimer); _tickerTimer = null; }
    _container = null;
  }

  function cleanup() { destroy(); }

  window.Home = { render, refresh, destroy, cleanup };

})();
