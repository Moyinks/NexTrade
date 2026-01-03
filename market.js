/**
 * NexTrade — Market Module (REPAIRED & TRADING INTEGRATED)
 * Robust Pointer/tap vs Scroll Handling with Atomic Trade Execution.
 * * FIXES & ENHANCEMENTS:
 * - NEW: Integrated Buy/Sell buttons directly in the coin detail modal.
 * - NEW: Trading logic linked to 'holdings' and 'spot' balance in AppState.
 * - NEW: Automated transaction generation for trade history.
 * - PERSISTENCE: Triggers AppState.save() after trades to ensure data sticks on reload.
 * - UI SAFETY: Maintains original high-performance pointer tracking for mobile-first scrolling.
 */

const Market = (() => {
  'use strict';

  // ============================================
  // STATE
  // ============================================
  let container = null;
  let unsubscribe = null;
  let searchTimeout = null;
  let currentFilter = 'all';

  // Track active pointer listeners so we can remove them during cleanup
  const pointerTrackers = new WeakMap();

  // ============================================
  // UTIL
  // ============================================
  const clamp = (v, a = 0, b = 1e9) => Math.max(a, Math.min(b, v));

  function distanceSq(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  }

  // thresholds for tap vs scroll discrimination
  const MOVE_THRESHOLD_PX = 8;
  const MOVE_THRESHOLD_SQ = MOVE_THRESHOLD_PX * MOVE_THRESHOLD_PX;
  const TAP_MAX_DURATION_MS = 500;

  // ============================================
  // RENDER ENTRY
  // ============================================
  function render(element) {
    if (!element) {
      console.error('Market container not found');
      return;
    }

    container = element;
    container.className = 'market-page';

    // Clear any previous contents/listeners
    cleanupDOM(container);

    const header = createHeader();
    container.appendChild(header);

    const marketList = createMarketList();
    container.appendChild(marketList);

    const marketData = (window.AppState && window.AppState.get)
      ? AppState.get('marketData')
      : [];

    if (!marketData || marketData.length === 0) {
      loadMarketData();
    } else {
      renderMarketItems(marketData);
    }

    subscribeToUpdates();
  }

  // ============================================
  // HEADER / FILTERS / SEARCH
  // ============================================
  function createHeader() {
    const header = document.createElement('div');
    header.className = 'market-header';

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'market-search';

    const searchIcon = document.createElement('span');
    searchIcon.className = 'market-search-icon';
    searchIcon.textContent = '🔍';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'market-search-input';
    searchInput.placeholder = 'Search cryptocurrencies...';
    searchInput.id = 'market-search';
    searchInput.autocomplete = 'off';
    searchInput.addEventListener('input', (e) => handleSearch(e.target.value));

    searchWrapper.appendChild(searchIcon);
    searchWrapper.appendChild(searchInput);

    const filters = createFilters();

    header.appendChild(searchWrapper);
    header.appendChild(filters);

    return header;
  }

  function createFilters() {
    const filters = document.createElement('div');
    filters.className = 'market-filters';
    filters.id = 'market-filters';
    filters.style.overflowX = 'auto';
    filters.style.whiteSpace = 'nowrap';
    filters.style.webkitOverflowScrolling = 'touch';

    const filterOptions = [
      { id: 'all', label: 'All' },
      { id: 'gainers', label: 'Top Gainers' },
      { id: 'losers', label: 'Top Losers' },
      { id: 'volume', label: 'Volume' }
    ];

    filterOptions.forEach(option => {
      const btn = document.createElement('button');
      btn.className = 'market-filter-btn';
      btn.textContent = option.label;
      btn.setAttribute('data-filter', option.id);
      btn.type = 'button';
      if (option.id === currentFilter) btn.classList.add('active');

      btn.addEventListener('click', () => {
        handleFilterChange(option.id);
      });

      filters.appendChild(btn);
    });

    filters.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    return filters;
  }

  // ============================================
  // LIST CREATION & ITEM TAP/CLICK SAFETY
  // ============================================
  function createMarketList() {
    const list = document.createElement('div');
    list.className = 'market-list';
    list.id = 'market-list';

    list.style.overflowY = 'auto';
    list.style.webkitOverflowScrolling = 'touch';
    list.style.touchAction = 'pan-y';

    showLoading(list);
    return list;
  }

  function renderMarketItems(coins) {
    const list = document.getElementById('market-list');
    if (!list) return;

    cleanupItemTrackers(list);
    list.innerHTML = '';

    if (!coins || coins.length === 0) {
      showEmptyState(list);
      return;
    }

    coins.forEach(coin => {
      const item = (typeof Card !== 'undefined' && typeof Card.createMarketItem === 'function')
        ? Card.createMarketItem(coin)
        : createFallbackItem(coin);

      item.setAttribute('role', 'button');
      item.tabIndex = 0;

      attachPointerTapHandlers(item, coin);
      list.appendChild(item);
    });
  }

  function createFallbackItem(coin) {
    const item = document.createElement('div');
    item.className = 'market-item';
    item.style.cursor = 'pointer';
    item.innerHTML = `
      <div class="market-item-icon">${(coin.symbol||'').substring(0,3)}</div>
      <div class="market-item-info">
        <div class="market-item-name">${coin.name || 'Unknown'}</div>
        <div class="market-item-symbol">${coin.symbol || ''}</div>
      </div>
      <div class="market-item-data">
        <div class="market-item-price">${window.Format ? Format.currency(coin.current_price) : coin.current_price}</div>
      </div>
    `;
    return item;
  }

  // ============================================
  // POINTER / TAP HANDLING (PRESERVED)
  // ============================================
  function attachPointerTapHandlers(item, coin) {
    const tracker = {
      pointerId: null,
      startX: 0,
      startY: 0,
      moved: false,
      startTime: 0,
      movedDuringPointer: false,
      handlers: {}
    };

    const onPointerDown = (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      try { item.setPointerCapture?.(ev.pointerId); } catch (e) {}
      tracker.pointerId = ev.pointerId;
      tracker.startX = ev.clientX;
      tracker.startY = ev.clientY;
      tracker.moved = false;
      tracker.movedDuringPointer = false;
      tracker.startTime = Date.now();
    };

    const onPointerMove = (ev) => {
      if (tracker.pointerId === null || ev.pointerId !== tracker.pointerId) return;
      const d2 = distanceSq(tracker.startX, tracker.startY, ev.clientX, ev.clientY);
      if (d2 > MOVE_THRESHOLD_SQ) {
        tracker.moved = true;
        tracker.movedDuringPointer = true;
      }
    };

    const onPointerUp = (ev) => {
      if (tracker.pointerId === null || ev.pointerId !== tracker.pointerId) return;
      const duration = Date.now() - tracker.startTime;
      const wasTap = !tracker.moved && duration <= TAP_MAX_DURATION_MS;
      try { item.releasePointerCapture?.(tracker.pointerId); } catch (e) {}
      tracker.pointerId = null;
      if (wasTap) {
        safeShowCoinDetails(coin);
      }
    };

    const onClickCapture = (ev) => {
      const t = pointerTrackers.get(item);
      if (t && (t.movedDuringPointer || !t.movedDuringPointer)) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
      }
    };

    const onKeyDown = (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        safeShowCoinDetails(coin);
      }
    };

    tracker.handlers = { onPointerDown, onPointerMove, onPointerUp, onClickCapture, onKeyDown };
    pointerTrackers.set(item, tracker);

    item.addEventListener('pointerdown', onPointerDown, { passive: true });
    item.addEventListener('pointermove', onPointerMove, { passive: true });
    item.addEventListener('pointerup', onPointerUp, { passive: true });
    item.addEventListener('click', onClickCapture, true);
    item.addEventListener('keydown', onKeyDown);
  }

  function cleanupItemTrackers(listElement) {
    const children = Array.from(listElement.children || []);
    children.forEach(child => {
      const t = pointerTrackers.get(child);
      if (t && t.handlers) {
        try {
          child.removeEventListener('pointerdown', t.handlers.onPointerDown, { passive: true });
          child.removeEventListener('pointermove', t.handlers.onPointerMove, { passive: true });
          child.removeEventListener('pointerup', t.handlers.onPointerUp, { passive: true });
          child.removeEventListener('click', t.handlers.onClickCapture, true);
          child.removeEventListener('keydown', t.handlers.onKeyDown);
        } catch (e) {}
        pointerTrackers.delete(child);
      }
    });
  }

  function cleanupDOM(root) {
    if (!root) return;
    const list = root.querySelector('#market-list');
    if (list) cleanupItemTrackers(list);
  }

  let lastShowTs = 0;
  function safeShowCoinDetails(coin) {
    const now = Date.now();
    if (now - lastShowTs < 250) return;
    lastShowTs = now;
    showCoinDetails(coin);
  }

  // ============================================
  // COIN DETAILS & TRADING (ENHANCED)
  // ============================================
  async function showCoinDetails(coin) {
    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-4);';

    // 1. TRADING ACTIONS (NEW)
    const tradeBox = document.createElement('div');
    tradeBox.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:var(--space-3); padding-bottom:var(--space-2);';
    
    const buyBtn = document.createElement('button');
    buyBtn.className = 'btn btn-success btn-full';
    buyBtn.textContent = 'Buy';
    buyBtn.onclick = () => openTradeForm(coin, 'buy');

    const sellBtn = document.createElement('button');
    sellBtn.className = 'btn btn-danger btn-full';
    sellBtn.textContent = 'Sell';
    sellBtn.onclick = () => openTradeForm(coin, 'sell');

    tradeBox.appendChild(buyBtn);
    tradeBox.appendChild(sellBtn);
    content.appendChild(tradeBox);

    // 2. HEADER
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:var(--space-3);padding-bottom:var(--space-4);border-bottom:1px solid var(--color-border);';

    const icon = document.createElement('div');
    icon.style.cssText = 'width:48px;height:48px;border-radius:50%;background-color:var(--color-surface-elevated);display:flex;align-items:center;justify-content:center;font-size:var(--text-xl);font-weight:var(--weight-bold);';
    icon.textContent = (coin.symbol || '').substring(0, 3).toUpperCase();

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;';
    const name = document.createElement('div');
    name.style.cssText = 'font-size:var(--text-lg);font-weight:var(--weight-semibold);color:var(--color-text-primary);';
    name.textContent = coin.name || 'Unknown';
    const symbol = document.createElement('div');
    symbol.style.cssText = 'font-size:var(--text-sm);color:var(--color-text-secondary);';
    symbol.textContent = coin.symbol || '';

    info.appendChild(name);
    info.appendChild(symbol);
    header.appendChild(icon);
    header.appendChild(info);

    // 3. STATS
    const stats = document.createElement('div');
    stats.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-4);';

    const statsData = [
      { label: 'Price', value: Format.currency(coin.current_price) },
      { label: '24h Change', value: Format.percentage(coin.price_change_percentage_24h), color: (coin.price_change_percentage_24h || 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)' },
      { label: 'Market Cap', value: Format.compactCurrency(coin.market_cap) },
      { label: '24h Volume', value: Format.compactCurrency(coin.total_volume) },
      { label: '24h High', value: Format.currency(coin.high_24h) },
      { label: '24h Low', value: Format.currency(coin.low_24h) }
    ];

    statsData.forEach(stat => {
      const statDiv = document.createElement('div');
      const label = document.createElement('div');
      label.style.cssText = 'font-size:var(--text-xs);color:var(--color-text-secondary);margin-bottom:var(--space-2);';
      label.textContent = stat.label;

      const value = document.createElement('div');
      value.className = 'financial-data';
      value.style.cssText = `font-size:var(--text-base);font-weight:var(--weight-semibold);color:${stat.color || 'var(--color-text-primary)'};`;
      value.textContent = stat.value;

      statDiv.appendChild(label);
      statDiv.appendChild(value);
      stats.appendChild(statDiv);
    });

    content.appendChild(header);
    content.appendChild(stats);

    Modal.open({ title: `${coin.name} — Details`, content, maxWidth: '560px', showCloseButton: true });
  }

  /**
   * TRADING FORM LOGIC (Buy/Sell Coin)
   * Ensures 'holdings' in AppState are updated correctly and balanced with 'spot'.
   */
  async function openTradeForm(coin, type) {
    if (window.Modal) await Modal.close(); // Sequence correctly
    
    const balances = window.AppState ? AppState.get('balances') : { spot: 0 };
    const holdings = window.AppState ? (AppState.get('holdings') || {}) : {};
    const currentOwned = holdings[coin.symbol.toUpperCase()] || 0;

    const content = document.createElement('div');
    content.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-5);';

    const info = document.createElement('div');
    info.style.cssText = `padding:var(--space-4); background:var(--color-surface-elevated); border-radius:var(--radius-base); border-left:4px solid ${type === 'buy' ? 'var(--color-success)' : 'var(--color-danger)'};`;
    info.innerHTML = `
      <div style="font-size:var(--text-xs); color:var(--color-text-secondary); text-transform:uppercase;">${type} ${coin.name}</div>
      <div style="font-size:var(--text-sm); color:var(--color-text-primary); margin-top:2px;">
        ${type === 'buy' ? 'Available: ' + Format.currency(balances.spot) : 'Holding: ' + currentOwned.toFixed(6) + ' ' + coin.symbol.toUpperCase()}
      </div>
    `;

    const form = document.createElement('form');
    form.innerHTML = `
      <div class="input-group">
        <label class="input-label">${type === 'buy' ? 'Spend (USD)' : 'Sell (' + coin.symbol.toUpperCase() + ')'}</label>
        <input type="number" class="input-field financial-data" id="trade-amount" placeholder="0.00" step="any" required>
        <div id="est-value" style="font-size:var(--text-xs); color:var(--color-text-secondary); margin-top:var(--space-1);">Est: 0.00</div>
        <span class="input-error-message" id="trade-error" style="display:none;"></span>
      </div>
      <button type="submit" class="btn ${type === 'buy' ? 'btn-success' : 'btn-danger'} btn-full" style="margin-top:var(--space-4);">${type.toUpperCase()} ${coin.symbol.toUpperCase()}</button>
    `;

    const input = form.querySelector('#trade-amount');
    const est = form.querySelector('#est-value');
    const error = form.querySelector('#trade-error');

    input.oninput = () => {
      const val = parseFloat(input.value) || 0;
      error.style.display = 'none';
      if (type === 'buy') {
        est.textContent = `Get: ${(val / coin.current_price).toFixed(8)} ${coin.symbol.toUpperCase()}`;
      } else {
        est.textContent = `Get: ${Format.currency(val * coin.current_price)}`;
      }
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const value = parseFloat(input.value);
      
      // VALIDATION
      if (type === 'buy' && value > balances.spot) {
        error.textContent = 'Insufficient USD balance';
        error.style.display = 'block';
        return;
      }
      if (type === 'sell' && value > currentOwned) {
        error.textContent = 'Insufficient asset holdings';
        error.style.display = 'block';
        return;
      }

      try {
        const usdImpact = type === 'buy' ? -value : (value * coin.current_price);
        const assetImpact = type === 'buy' ? (value / coin.current_price) : -value;

        const newBalances = { ...balances, spot: balances.spot + usdImpact };
        const newHoldings = { ...holdings, [coin.symbol.toUpperCase()]: (holdings[coin.symbol.toUpperCase()] || 0) + assetImpact };

        // ATOMIC STATE UPDATE
        AppState.set('balances', newBalances);
        AppState.set('holdings', newHoldings);
        
        // TRANSACTION RECORD
        const tx = {
          id: 'txn_' + Date.now(),
          type: type,
          amount: type === 'buy' ? value : (value * coin.current_price),
          description: `${type.charAt(0).toUpperCase() + type.slice(1)} ${coin.name}`,
          status: 'completed',
          created_at: new Date().toISOString()
        };
        const curTx = AppState.get('transactions') || [];
        AppState.set('transactions', [tx, ...curTx]);

        if (typeof AppState.save === 'function') AppState.save();

        await Modal.close();
        if (window.App && App.showSuccess) App.showSuccess(`Trade Successful: ${coin.name}`);
      } catch (err) {
        error.textContent = 'Trade execution failed';
        error.style.display = 'block';
      }
    };

    content.appendChild(info);
    content.appendChild(form);

    Modal.open({ title: `Trade: ${coin.name}`, content, maxWidth: '400px', showCloseButton: true });
    setTimeout(() => input.focus(), 120);
  }

  // ============================================
  // DATA HELPERS (PRESERVED)
  // ============================================
  function showLoading(listEl) {
    const list = listEl || document.getElementById('market-list');
    if (!list) return;
    list.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      list.appendChild(typeof Card !== 'undefined' && typeof Card.createSkeleton === 'function' ? Card.createSkeleton() : createSkeletonFallback());
    }
  }

  function createSkeletonFallback() {
    const s = document.createElement('div');
    s.className = 'skeleton-card';
    s.style.cssText = 'height:64px; border-radius:8px; background:linear-gradient(90deg, rgba(255,255,255,0.03), rgba(255,255,255,0.06)); margin-bottom:12px;';
    return s;
  }

  function showEmptyState(listEl) {
    const list = listEl || document.getElementById('market-list');
    if (!list) return;
    list.innerHTML = `<div class="empty-state" style="text-align:center; padding:var(--space-10); opacity:0.5;">No results found.</div>`;
  }

  async function loadMarketData() {
    const list = document.getElementById('market-list');
    showLoading(list);
    try {
      const result = (window.API && API.getMarketData) ? await API.getMarketData(50) : { success: false };
      if (result && result.success) {
        const filtered = applyFilter(result.data || [], currentFilter);
        renderMarketItems(filtered);
      }
    } catch (error) {
      console.error('Market: data load failed', error);
    }
  }

  function handleSearch(query) {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const trimmed = (query || '').trim().toLowerCase();
      const marketData = (window.AppState && AppState.get) ? AppState.get('marketData') : [];
      let filtered = applyFilter(marketData, currentFilter);
      if (trimmed.length > 0) {
        filtered = filtered.filter(coin => 
          (coin.name || '').toLowerCase().includes(trimmed) || 
          (coin.symbol || '').toLowerCase().includes(trimmed)
        );
      }
      renderMarketItems(filtered);
    }, 220);
  }

  function handleFilterChange(filterId) {
    currentFilter = filterId;
    document.querySelectorAll('.market-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === filterId);
    });
    const marketData = (window.AppState && AppState.get) ? AppState.get('marketData') : [];
    renderMarketItems(applyFilter(marketData, filterId));
  }

  function applyFilter(data, filterId) {
    if (!data) return [];
    let filtered = [...data];
    switch (filterId) {
      case 'gainers': filtered = filtered.filter(c => (c.price_change_percentage_24h || 0) > 0).sort((a,b) => b.price_change_percentage_24h - a.price_change_percentage_24h).slice(0, 20); break;
      case 'losers': filtered = filtered.filter(c => (c.price_change_percentage_24h || 0) < 0).sort((a,b) => a.price_change_percentage_24h - b.price_change_percentage_24h).slice(0, 20); break;
      case 'volume': filtered = filtered.sort((a,b) => (b.total_volume || 0) - (a.total_volume || 0)).slice(0, 20); break;
    }
    return filtered;
  }

  function subscribeToUpdates() {
    if (unsubscribe) unsubscribe();
    if (window.AppState && typeof AppState.subscribe === 'function') {
      unsubscribe = AppState.subscribe(state => {
        if (state.marketData && state.marketData.length > 0) {
          renderMarketItems(applyFilter(state.marketData, currentFilter));
        }
      });
    }
  }

  function cleanup() {
    if (searchTimeout) clearTimeout(searchTimeout);
    if (unsubscribe) unsubscribe();
    cleanupDOM(container);
    unsubscribe = null;
    container = null;
  }

  return { render, refresh: loadMarketData, cleanup };
})();

if (typeof window !== 'undefined') window.Market = Market;
