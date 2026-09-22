/**
 * NexTrade — Wallet
 *
 * Spot/Vault values are display state hydrated from server-authoritative ledger
 * derivation. Transfers execute only through the serialized transfer RPC; the
 * browser never writes financial tables or profile balance caches directly.
 */

const Wallet = (() => {
  'use strict';

  /* ── Bottom clearance, as a real px number ──────────────────────────────
     Other pages read --scroll-bottom-clearance directly in CSS. The
     virtualized Activity list can't: VirtualScroller sizes its own
     scrollable range from its internal spacer div height, not from any
     CSS padding on the container, so this number has to be measured and
     handed to it directly. --scroll-bottom-clearance is itself derived
     from navbar.js's live getBoundingClientRect() measurement of the
     actual pill (see core.css), so this probe is reading a real,
     device-specific number, not a hard-coded estimate. */
  function getScrollBottomClearancePx() {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute; visibility:hidden; height:0; padding-bottom:var(--scroll-bottom-clearance, 116px);';
    document.body.appendChild(probe);
    const px = parseFloat(getComputedStyle(probe).paddingBottom) || 116;
    probe.remove();
    return px;
  }

  /* ── Activity row stride, measured not guessed ──────────────────────────
     VirtualScroller needs the true distance between successive row tops
     (rendered card height + the gap render() applies below each row) to
     size its spacer and virtualization math correctly. A hardcoded
     estimate drifts the moment createTransactionCard's markup/CSS changes
     — actual measured height in this app's own real card, real fonts, and
     real CSS was 70px, not the 72px previously assumed, so this renders
     one real card offscreen and reads its true box height directly. */
  function getActivityItemStridePx() {
    const probe = createTransactionCard({
      type: 'buy', amount: 5000, status: 'completed',
      created_at: new Date().toISOString(), asset: 'SOL'
    });
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.left = '-9999px';
    probe.style.width = '100%';
    document.body.appendChild(probe);
    const cardHeight = probe.getBoundingClientRect().height || CONFIG.VIRTUAL_SCROLL_ITEM_HEIGHT;
    probe.remove();
    const gap = (typeof VirtualScroller !== 'undefined' && VirtualScroller.ITEM_GAP_PX) || 8;
    return cardHeight + gap;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     CONFIGURATION
     ═══════════════════════════════════════════════════════════════════════════ */
  const CONFIG = {
    TICKER_INTERVAL: 1000,
    ITEMS_PER_PAGE: 50,
    // Fallback only — real stride is measured at runtime by
    // getActivityItemStridePx(); this is used solely if that measurement
    // ever comes back falsy (e.g. called before layout is ready).
    VIRTUAL_SCROLL_ITEM_HEIGHT: 72,
    VIRTUAL_SCROLL_BUFFER: 5,
    HERO_MIN_HEIGHT: 140,
  };

  /* ═══════════════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════════════ */
  let container = null;
  let tickerInterval = null;
  let unsubTx = null; // AppState 'transactions' subscription — cleaned up on re-render
  let virtualScrollers = {};

  const state = {
    user: null,
    balances: { spot: 0, vault: 0 },
    holdings: {},
    transactions: [],
    marketData: [],
    hideBalance: localStorage.getItem('nextrade_hide_balance') === 'true',
    ui: {
      activeTab: 'overview',
      scrollPositions: {},
      filters: {
        search: '',
        type: 'all',
        status: 'all',
        sortBy: 'date',
        sortOrder: 'desc'
      }
    }
  };

  /* ═══════════════════════════════════════════════════════════════════════════
     UTILITIES
     ═══════════════════════════════════════════════════════════════════════════ */
  function formatMoney(amount) {
    if (state.hideBalance) return '••••••••';
    return (window.Format && Format.currency) 
      ? Format.currency(amount) 
      : '$' + (amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
  }

  function formatCompact(num) {
    if (state.hideBalance) return '••••';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
  }

  function togglePrivacy() {
    state.hideBalance = !state.hideBalance;
    localStorage.setItem('nextrade_hide_balance', state.hideBalance);
    render(container);
  }

  const safeText = (value) => window.SafeDOM && SafeDOM.text ? SafeDOM.text(value) : String(value == null ? '' : value);
  const safeHttpsUrl = (value) => window.SafeDOM && SafeDOM.httpsUrl ? SafeDOM.httpsUrl(value) : '';
  const coinImageUrl = (value) => {
    const normalized = window.API && typeof API.proxiedCoinImageUrl === 'function'
      ? API.proxiedCoinImageUrl(value)
      : value;
    return safeHttpsUrl(normalized);
  };

  /* ═══════════════════════════════════════════════════════════════════════════
     DATA AGGREGATION
     ═══════════════════════════════════════════════════════════════════════════ */
  function calculateTotalEquity() {
    let total = (state.balances.spot || 0) + (state.balances.vault || 0);
    
    if (state.holdings && state.marketData && state.marketData.length > 0) {
      Object.entries(state.holdings).forEach(([symbol, amount]) => {
        if (amount > 0) {
          const id = symbol.toLowerCase();
          const coinData = state.marketData.find(c => c.id === id || c.symbol.toLowerCase() === id);
          
          if (coinData && coinData.current_price) {
            total += (amount * coinData.current_price);
          }
        }
      });
    }
    
    return total;
  }

  function getPortfolioSummary() {
    const totalEquity = calculateTotalEquity();
    const liquidBalance = state.balances.spot + state.balances.vault;
    
    let cryptoValue = 0;
    let assetCount = 0;
    
    if (state.holdings && state.marketData && state.marketData.length > 0) {
      Object.entries(state.holdings).forEach(([symbol, amount]) => {
        if (amount > 0.000001) {
          assetCount++;
          const id = symbol.toLowerCase();
          const coinData = state.marketData.find(c => c.id === id || c.symbol.toLowerCase() === id);
          
          if (coinData && coinData.current_price) {
            cryptoValue += (amount * coinData.current_price);
          }
        }
      });
    }
    
    const recentTxs = state.transactions
      .filter(tx => {
        const txDate = new Date(tx.created_at);
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return txDate > dayAgo;
      })
      .length;
    
    return {
      totalEquity,
      liquidBalance,
      cryptoValue,
      assetCount,
      spotBalance: state.balances.spot,
      vaultBalance: state.balances.vault,
      recentTxCount: recentTxs
    };
  }

  function getAssetsList() {
    const assets = [];
    
    if (!state.holdings) return assets;
    
    Object.entries(state.holdings).forEach(([symbol, amount]) => {
      if (amount > 0.000001) {
        const id = symbol.toLowerCase();
        const coinData = state.marketData.find(c => c.id === id || c.symbol.toLowerCase() === id);
        
        if (coinData) {
          const value = amount * coinData.current_price;
          assets.push({
            symbol: coinData.symbol,
            name: coinData.name,
            amount: amount,
            price: coinData.current_price,
            value: value,
            change24h: coinData.price_change_percentage_24h || 0,
            image: coinData.image,
            id: coinData.id
          });
        } else {
          assets.push({
            symbol: symbol.toUpperCase(),
            name: symbol.toUpperCase(),
            amount: amount,
            price: 0,
            value: 0,
            change24h: 0,
            image: null,
            id: symbol.toLowerCase()
          });
        }
      }
    });
    
    assets.sort((a, b) => b.value - a.value);
    
    return assets;
  }

  function filterAndSortTransactions(transactions, filters) {
    let filtered = [...transactions];
    
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(tx => {
        const label = window.TransactionUI
          ? TransactionUI.present(tx).label
          : (tx.type || '');
        return label.toLowerCase().includes(searchLower) ||
               tx.type?.toLowerCase().includes(searchLower) ||
               tx.status?.toLowerCase().includes(searchLower) ||
               tx.description?.toLowerCase().includes(searchLower) ||
               String(tx.id)?.toLowerCase().includes(searchLower);
      });
    }

    if (filters.type !== 'all') {
      filtered = filtered.filter(tx => tx.type === filters.type);
    }

    if (filters.status !== 'all') {
      // 'completed' filter also shows 'approved' (admin-confirmed deposits)
      if (filters.status === 'completed') {
        filtered = filtered.filter(tx => tx.status === 'completed' || tx.status === 'approved');
      } else {
        filtered = filtered.filter(tx => tx.status === filters.status);
      }
    }
    
    filtered.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return filters.sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });
    
    return filtered;
  }

  // VirtualScroller is defined in virtual-scroller.js (loaded before wallets.js
  // in index.html). The duplicate class that was here overwrote window.VirtualScroller
  // with a slightly different implementation — undefined behaviour depending on load
  // order. Removed. Use window.VirtualScroller from virtual-scroller.js directly.

  /* ═══════════════════════════════════════════════════════════════════════════
     TAB NAVIGATION - INSTITUTIONAL SEGMENTED CONTROL
     ═══════════════════════════════════════════════════════════════════════════ */
  function createTabNavigation() {
    const nav = document.createElement('div');
    nav.className = 'ui-segmented wallet-segmented';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Wallet sections');

    const tabs = [
      { id: 'overview', label: 'Overview', icon: 'fa-home' },
      { id: 'assets', label: 'Assets', icon: 'fa-coins' },
      { id: 'activity', label: 'Activity', icon: 'fa-list' }
    ];

    tabs.forEach(tab => {
      const btn = document.createElement('button');
      const isActive = tab.id === state.ui.activeTab;

      btn.className = 'ui-segmented__item wallet-tab-btn';
      btn.dataset.tab = tab.id;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(isActive));

      btn.innerHTML =
        `<i class="fas ${tab.icon}" aria-hidden="true"></i>` +
        `<span>${tab.label}</span>`;

      btn.onclick = () => switchTab(tab.id);
      nav.appendChild(btn);
    });

    return nav;
  }

  function switchTab(tabId) {
    if (
      virtualScrollers[state.ui.activeTab] &&
      virtualScrollers[state.ui.activeTab].container
    ) {
      state.ui.scrollPositions[state.ui.activeTab] =
        virtualScrollers[state.ui.activeTab].container.scrollTop;
    }

    state.ui.activeTab = tabId;

    document.querySelectorAll('.wallet-tab-btn').forEach(btn => {
      btn.setAttribute(
        'aria-selected',
        String(btn.dataset.tab === tabId)
      );
    });

    const contentContainer =
      container.querySelector('#tab-content-container');

    if (contentContainer) {
      Object.values(virtualScrollers).forEach(scroller => {
        if (scroller && scroller.destroy) scroller.destroy();
      });

      virtualScrollers = {};

      const newContent = renderTabContent(tabId);
      contentContainer.innerHTML = '';
      contentContainer.appendChild(newContent);

      requestAnimationFrame(() => {
        if (
          state.ui.scrollPositions[tabId] &&
          virtualScrollers[tabId]
        ) {
          requestAnimationFrame(() => {
            if (
              virtualScrollers[tabId] &&
              virtualScrollers[tabId].container
            ) {
              virtualScrollers[tabId].container.scrollTop =
                state.ui.scrollPositions[tabId];
            }
          });
        }
      });
    }
  }

  function renderTabContent(tabId) {
    switch (tabId) {
      case 'overview':
        return createOverviewTab();
      case 'assets':
        return createAssetsTab();
      case 'activity':
        return createActivityTab();
      default:
        return createOverviewTab();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     OVERVIEW TAB - INSTITUTIONAL REDESIGN
     ═══════════════════════════════════════════════════════════════════════════ */
  function createOverviewTab() {
    const tab = document.createElement('div');
    tab.className = 'overview-tab';
    tab.style.cssText = 'flex:1; min-height:0; display:flex; flex-direction:column; overflow-y:auto; overflow-x:hidden; padding-bottom:var(--scroll-bottom-clearance, 116px);';
    
    const summary = getPortfolioSummary();
    
    const heroShell = document.createElement('div');
    heroShell.className = 'wallet-hero-shell';
    heroShell.appendChild(createHeroCard(summary));
    tab.appendChild(heroShell);
    tab.appendChild(createBalanceCards(summary));
    tab.appendChild(createQuickActions());
    
    if (state.transactions.length > 0) {
      tab.appendChild(createRecentActivity());
    }
    
    return tab;
  }

  function createHeroCard(summary) {
    const card = document.createElement('div');
    card.id = 'wallet-main-hero';
    card.style.cssText = `
      position: relative;
      border-radius: 0 0 16px 16px;
      padding: 20px;
      margin-bottom: 0;
      background: linear-gradient(180deg, #111318 0%, #0c0e11 100%);
      border: none;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      box-shadow: 0 1px 0 rgba(255,255,255,0.04);
      min-height: ${CONFIG.HERO_MIN_HEIGHT}px;
      flex-shrink: 0;
    `;
    
    const iconClass = state.hideBalance ? 'fa-eye-slash' : 'fa-eye';
    
    card.innerHTML = `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:10px;">
        <div style="flex:1;">
          <div style="font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.8px; color:rgba(255,255,255,0.5); margin-bottom:6px;">
            Total Equity
          </div>
          <div id="total-equity-display" style="font-family:var(--font-mono); font-size:32px; font-weight:700; color:#ffffff; letter-spacing:-1px; line-height:1.15; margin-bottom:8px;">
            ${formatMoney(summary.totalEquity)}
          </div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <div style="font-size:10px; color:rgba(255,255,255,0.7);">
              <span style="opacity:0.6;">Liquid: </span>
              <span style="font-weight:600;">${formatMoney(summary.liquidBalance)}</span>
            </div>
            <div style="font-size:10px; color:rgba(255,255,255,0.7);">
              <span style="opacity:0.6;">Crypto: </span>
              <span style="font-weight:600;">${formatMoney(summary.cryptoValue)}</span>
            </div>
          </div>
        </div>
        <button id="wallet-privacy-btn" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.8); width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background 0.2s; flex-shrink:0;">
          <i class="fas ${iconClass}" style="font-size:12px;"></i>
        </button>
      </div>
      <div style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); padding:5px 10px; border-radius:8px; color:rgba(255,255,255,0.75); font-size:10px; font-weight:600; display:inline-flex; align-items:center; gap:6px; align-self:flex-start;">
        <i class="fas fa-flask" style="font-size:8px; opacity:0.7;"></i>
        <span>Portfolio model</span>
      </div>
    `;
    
    card.querySelector('#wallet-privacy-btn').onclick = (e) => { 
      e.stopPropagation(); 
      togglePrivacy(); 
    };
    
    return card;
  }

  function createBalanceCards(summary) {
    const section = document.createElement('div');
    section.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; padding:0;';
    
    const cards = [
      {
        label: 'Spot Wallet',
        value: summary.spotBalance,
        icon: 'fa-wallet',
        color: '#60a5fa',
        gradient: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)'
      },
      {
        label: 'Vault',
        value: summary.vaultBalance,
        icon: 'fa-layer-group',
        color: '#8b5cf6',
        gradient: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)'
      }
    ];
    
    cards.forEach(cardData => {
      const card = document.createElement('div');
      card.style.cssText = `
        background:var(--color-surface); border:1px solid var(--color-border);
        border-radius:12px; padding:12px; position:relative; overflow:hidden;
        cursor:pointer; transition:all 0.2s;
      `;
      
      card.onmouseenter = () => {
        card.style.borderColor = cardData.color;
        card.style.transform = 'translateY(-2px)';
      };
      card.onmouseleave = () => {
        card.style.borderColor = 'var(--color-border)';
        card.style.transform = 'translateY(0)';
      };
      
      card.innerHTML = `
        <div style="position:absolute; top:0; right:0; width:40px; height:40px; background:${cardData.gradient}; opacity:0.1; border-radius:0 12px 0 100%;"></div>
        <div style="position:relative; z-index:1;">
          <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
            <div style="width:28px; height:28px; border-radius:7px; background:${cardData.color}15; color:${cardData.color}; display:flex; align-items:center; justify-content:center;">
              <i class="fas ${cardData.icon}" style="font-size:12px;"></i>
            </div>
            <span style="font-size:11px; font-weight:600; color:var(--color-text-secondary);">${cardData.label}</span>
          </div>
          <div style="font-family:var(--font-mono); font-size:16px; font-weight:700; color:var(--color-text-primary);">
            ${formatMoney(cardData.value)}
          </div>
        </div>
      `;
      
      section.appendChild(card);
    });
    
    return section;
  }

  function createQuickActions() {
    const section = document.createElement('div');
    section.className = 'ui-action-grid';

    const actions = [
      {
        label: 'Deposit',
        icon: 'fa-arrow-down',
        tone: 'success',
        action: () => window.Trade && Trade.openDeposit()
      },
      {
        label: 'Withdraw',
        icon: 'fa-arrow-up',
        tone: 'danger',
        action: () => window.Trade && Trade.openWithdraw()
      },
      {
        label: 'Transfer',
        icon: 'fa-exchange-alt',
        tone: 'brand',
        action: () => openTransferModal()
      }
    ];

    actions.forEach(actionData => {
      const btn = document.createElement('button');

      btn.className = 'ui-action';
      btn.dataset.tone = actionData.tone;

      btn.innerHTML = `
        <span class="ui-action__icon" aria-hidden="true">
          <i class="fas ${actionData.icon}"></i>
        </span>
        <span class="ui-action__label">${actionData.label}</span>
      `;

      btn.onclick = actionData.action;
      section.appendChild(btn);
    });

    return section;
  }

  function createRecentActivity() {
    const section = document.createElement('div');
    section.style.marginBottom = '20px';

    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;justify-content:space-between;' +
      'align-items:center;margin-bottom:12px;';

    const title = document.createElement('h3');
    title.textContent = 'Recent Activity';
    title.style.cssText =
      'font-size:14px;font-weight:700;' +
      'color:var(--color-text-primary);margin:0;';

    const allBtn = document.createElement('button');
    allBtn.dataset.appAction = 'wallet-activity';
    allBtn.className = 'btn btn-ghost btn-sm';
    allBtn.textContent = 'View All →';

    header.appendChild(title);
    header.appendChild(allBtn);
    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'tx-list';

    state.transactions
      .slice(0, 5)
      .forEach(tx => {
        list.appendChild(createTransactionCard(tx));
      });

    section.appendChild(list);
    return section;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     ASSETS TAB (FIXED - CLICK OPENS MODAL)
     ═══════════════════════════════════════════════════════════════════════════ */
  function createAssetsTab() {
    const tab = document.createElement('div');
    tab.className = 'assets-tab';
    tab.style.cssText = 'flex:1; min-height:0; display:flex; flex-direction:column; overflow-y:auto; overflow-x:hidden; padding-bottom:var(--scroll-bottom-clearance, 116px);';
    
    const assets = getAssetsList();
    
    if (assets.length === 0) {
      tab.appendChild(createEmptyState('assets'));
      return tab;
    }
    
    const summary = getPortfolioSummary();
    
    const header = document.createElement('div');
    header.style.cssText = 'background:var(--color-surface); border:1px solid var(--color-border); border-radius:12px; padding:14px; margin-bottom:14px;';
    header.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
        <div style="text-align:center;">
          <div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px; text-transform:uppercase;">Total Assets</div>
          <div style="font-size:18px; font-weight:700; color:var(--color-text-primary);">${assets.length}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px; text-transform:uppercase;">Crypto Value</div>
          <div style="font-size:18px; font-weight:700; color:#10b981;">${formatMoney(summary.cryptoValue)}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px; text-transform:uppercase;">Allocation</div>
          <div style="font-size:18px; font-weight:700; color:var(--color-text-primary);">${summary.totalEquity > 0 ? ((summary.cryptoValue / summary.totalEquity) * 100).toFixed(0) : 0}%</div>
        </div>
      </div>
    `;
    tab.appendChild(header);
    
    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
    
    assets.forEach(asset => {
      const item = document.createElement('div');
      item.style.cssText = `
        display:flex; align-items:center; justify-content:space-between;
        padding:12px; background:var(--color-surface);
        border:1px solid var(--color-border); border-radius:10px;
        cursor:pointer; transition:all 0.2s;
      `;
      
      item.onmouseenter = () => {
        item.style.transform = 'translateX(4px)';
        item.style.borderColor = '#3b82f6';
      };
      item.onmouseleave = () => {
        item.style.transform = 'translateX(0)';
        item.style.borderColor = 'var(--color-border)';
      };
      
      // CRITICAL FIX: Add click handler to open modal
      item.onclick = () => {
        showAssetDetails(asset);
      };
      
      const isUp = asset.change24h >= 0;
      
      item.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:38px; height:38px; border-radius:50%; background:var(--color-surface-elevated); display:flex; align-items:center; justify-content:center; overflow:hidden;">
            ${coinImageUrl(asset.image) ? `<img src="${coinImageUrl(asset.image)}" style="width:100%; height:100%;" referrerpolicy="no-referrer" alt="">` : `<span style="font-size:13px; font-weight:700;">${safeText(String(asset.symbol || "?")[0])}</span>`}
          </div>
          <div>
            <div style="font-size:14px; font-weight:700; color:var(--color-text-primary);">${safeText(asset.name)}</div>
            <div style="font-size:11px; color:var(--color-text-secondary);">${state.hideBalance ? '•••••' : asset.amount.toFixed(4)} ${safeText(String(asset.symbol || '').toUpperCase())}</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-family:var(--font-mono); font-size:14px; font-weight:700; color:var(--color-text-primary);">
            ${formatMoney(asset.value)}
          </div>
          <div style="font-size:11px; font-weight:600; color:${isUp ? 'var(--color-success)' : 'var(--color-danger)'};">
            ${asset.price > 0 ? '$' + asset.price.toLocaleString() : '---'} ${isUp ? '▲' : '▼'}${Math.abs(asset.change24h).toFixed(2)}%
          </div>
        </div>
      `;
      list.appendChild(item);
    });
    
    tab.appendChild(list);
    return tab;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     ASSET DETAILS MODAL (NEW - CRITICAL FEATURE)
     ═══════════════════════════════════════════════════════════════════════════ */
  function showAssetDetails(asset) {
    if (!window.Modal) {
      console.warn('[WALLET] Modal not available');
      return;
    }

    // Calculate estimated P/L
    // Since we don't track purchase price, we estimate using 24h change
    const currentValue = asset.value;
    const estimatedPurchaseValue = asset.price > 0 
      ? (asset.amount * (asset.price / (1 + (asset.change24h / 100))))
      : currentValue;
    
    const estimatedProfit = currentValue - estimatedPurchaseValue;
    const estimatedProfitPercent = estimatedPurchaseValue > 0 
      ? ((estimatedProfit / estimatedPurchaseValue) * 100) 
      : 0;

    const isProfit = estimatedProfit >= 0;

    const content = document.createElement('div');
    content.innerHTML = `
      <div style="text-align:center; margin-bottom:20px;">
        <div style="width:64px; height:64px; margin:0 auto 14px; border-radius:50%; background:var(--color-surface-elevated); display:flex; align-items:center; justify-content:center; overflow:hidden;">
          ${coinImageUrl(asset.image) ? `<img src="${coinImageUrl(asset.image)}" style="width:100%; height:100%;" referrerpolicy="no-referrer" alt="">` : `<span style="font-size:24px; font-weight:700;">${safeText(String(asset.symbol || "?")[0])}</span>`}
        </div>
        <h3 style="font-size:18px; font-weight:700; color:var(--color-text-primary); margin-bottom:4px;">${safeText(asset.name)}</h3>
        <div style="font-size:13px; color:var(--color-text-secondary);">${safeText(String(asset.symbol || "").toUpperCase())}</div>
      </div>

      <div style="background:var(--color-surface-elevated); padding:18px; border-radius:12px; margin-bottom:18px; border:1px solid var(--color-border);">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
          <div>
            <div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px; font-weight:500;">Holdings</div>
            <div style="font-family:var(--font-mono); font-size:18px; font-weight:700; color:var(--color-text-primary);">
              ${asset.amount.toFixed(6)}
            </div>
          </div>
          <div>
            <div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px; font-weight:500;">Current Price</div>
            <div style="font-family:var(--font-mono); font-size:18px; font-weight:700; color:var(--color-text-primary);">
              ${Format.currency(asset.price)}
            </div>
          </div>
        </div>

        <div style="padding-top:16px; border-top:1px solid var(--color-border);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:12px; color:var(--color-text-tertiary);">Total Value</span>
            <span style="font-family:var(--font-mono); font-size:20px; font-weight:700; color:var(--color-text-primary);">
              ${formatMoney(currentValue)}
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:12px; color:var(--color-text-tertiary);">Est. P/L (24h basis)</span>
            <span style="font-family:var(--font-mono); font-size:16px; font-weight:700; color:${isProfit ? '#10b981' : '#ef4444'};">
              ${isProfit ? '+' : ''}${Format.currency(estimatedProfit)} (${isProfit ? '+' : ''}${estimatedProfitPercent.toFixed(2)}%)
            </span>
          </div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
        <div style="background:var(--color-surface-elevated); padding:12px; border-radius:10px; text-align:center; border:1px solid var(--color-border);">
          <div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px;">24h Change</div>
          <div style="font-size:16px; font-weight:700; color:${asset.change24h >= 0 ? '#10b981' : '#ef4444'};">
            ${asset.change24h >= 0 ? '+' : ''}${asset.change24h.toFixed(2)}%
          </div>
        </div>
        <div style="background:var(--color-surface-elevated); padding:12px; border-radius:10px; text-align:center; border:1px solid var(--color-border);">
          <div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px;">Allocation</div>
          <div style="font-size:16px; font-weight:700; color:var(--color-text-primary);">
            ${((currentValue / calculateTotalEquity()) * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <button id="sell-asset-btn" class="btn btn-secondary btn-full" style="background:rgba(239, 68, 68, 0.1); border-color:#ef4444; color:#ef4444;">
          <i class="fas fa-arrow-down" style="margin-right:6px;"></i>Sell
        </button>
        <button id="buy-asset-btn" class="btn btn-primary btn-full">
          <i class="fas fa-arrow-up" style="margin-right:6px;"></i>Buy More
        </button>
      </div>

      <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--color-border); font-size:10px; color:var(--color-text-tertiary); text-align:center;">
        <i class="fas fa-info-circle" style="margin-right:4px;"></i>
        P/L estimated from 24h price change. Actual cost basis may vary.
      </div>
    `;

    const sellBtn = content.querySelector('#sell-asset-btn');
    const buyBtn = content.querySelector('#buy-asset-btn');

    sellBtn.onclick = () => {
      Modal.close();
      
      setTimeout(() => {
        if (window.Trade && typeof Trade.openSell === 'function') {
          Trade.openSell(asset.id);
        } else {
          if (window.App && App.showError) {
            App.showError('Trade module is loading...');
          }
        }
      }, 300);
    };

    buyBtn.onclick = () => {
      Modal.close();
      
      setTimeout(() => {
        if (window.Trade && typeof Trade.openBuy === 'function') {
          Trade.openBuy(asset.id);
        } else {
          if (window.App && App.showError) {
            App.showError('Trade module is loading...');
          }
        }
      }, 300);
    };

    Modal.open({
      title: 'Asset Details',
      content: content,
      maxWidth: '480px',
      showCloseButton: true
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     ACTIVITY TAB
     ═══════════════════════════════════════════════════════════════════════════ */
  function createActivityTab() {
    const tab = document.createElement('div');
    tab.className = 'activity-tab';
    tab.style.cssText = 'display:flex; flex-direction:column; height:100%;';
    
    if (state.transactions.length === 0) {
      tab.appendChild(createEmptyState('activity'));
      return tab;
    }
    
    tab.appendChild(createFilterBar());
    
    const scrollContainer = document.createElement('div');
    scrollContainer.id = 'activity-scroll-container';
    scrollContainer.style.flex = '1';
    scrollContainer.style.minHeight = '0';
    
    const filtered = filterAndSortTransactions(state.transactions, state.ui.filters);
    
    const scroller = new VirtualScroller(
      scrollContainer,
      filtered,
      getActivityItemStridePx(),
      (tx, index) => createTransactionCard(tx),
      getScrollBottomClearancePx(),
      CONFIG.VIRTUAL_SCROLL_BUFFER
    );
    
    virtualScrollers.activity = scroller;
    
    tab.appendChild(scrollContainer);
    
    return tab;
  }

  function createFilterBar() {
    const bar = document.createElement('div');
    bar.style.cssText = 'margin-bottom:8px; padding:6px 8px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:10px; flex-shrink:0;';

    bar.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 100px 100px; gap:5px; align-items:center;">
        <input type="text" id="filter-search" placeholder="Search…"
          style="padding:6px 10px; background:var(--color-surface-elevated);
                 border:1px solid var(--color-border); border-radius:7px;
                 color:var(--color-text-primary); font-size:12px; min-width:0; outline:none;">
        <select id="filter-type"
          style="padding:6px 4px; background:var(--color-surface-elevated);
                 border:1px solid var(--color-border); border-radius:7px;
                 color:var(--color-text-primary); font-size:11px; cursor:pointer; outline:none;">
          <option value="all">All Types</option>
          <option value="deposit">Deposit</option>
          <option value="withdraw">Withdraw</option>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
          <option value="investment">Strategy Entry</option>
          <option value="claim">Claim</option>
          <option value="transfer_in">Transfer In</option>
          <option value="transfer_out">Transfer Out</option>
        </select>
        <select id="filter-status"
          style="padding:6px 4px; background:var(--color-surface-elevated);
                 border:1px solid var(--color-border); border-radius:7px;
                 color:var(--color-text-primary); font-size:11px; cursor:pointer; outline:none;">
          <option value="all">All Status</option>
          <option value="completed">Completed</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
      </div>
    `;

    bar.querySelector('#filter-search').oninput = (e) => {
      state.ui.filters.search = e.target.value;
      applyFilters();
    };

    bar.querySelector('#filter-type').onchange = (e) => {
      state.ui.filters.type = e.target.value;
      applyFilters();
    };

    bar.querySelector('#filter-status').onchange = (e) => {
      state.ui.filters.status = e.target.value;
      applyFilters();
    };

    return bar;
  }

  function applyFilters() {
    const filtered = filterAndSortTransactions(state.transactions, state.ui.filters);
    
    if (virtualScrollers.activity) {
      virtualScrollers.activity.update(filtered);
    }
  }

  /* ─── transaction presentation ─── */

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
      status: String(tx.status || 'unknown'),
      statusLabel: String(tx.status || 'Unknown'),
      context: String(tx.description || '')
    };
  }

  function formatTxDate(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const dayMs = 86400000;

    const timeStr = d.toLocaleTimeString(
      [],
      { hour: '2-digit', minute: '2-digit' }
    );

    if (diffMs < dayMs) {
      return timeStr + ' · Today';
    }

    if (diffMs < 2 * dayMs) {
      return timeStr + ' · Yesterday';
    }

    return d.toLocaleDateString(
      [],
      { month: 'short', day: 'numeric' }
    ) + ' · ' + timeStr;
  }

  function createTransactionCard(tx) {
    const view = transactionView(tx);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tx-card';
    card.dataset.status = view.status;
    card.dataset.tone = view.tone;
    card.dataset.direction = view.direction;

    const icon = document.createElement('div');
    icon.className = 'tx-card__icon';

    const iconGlyph = document.createElement('i');
    iconGlyph.className = 'fas ' + view.icon;
    iconGlyph.setAttribute('aria-hidden', 'true');
    icon.appendChild(iconGlyph);

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

    const date = document.createElement('span');
    date.textContent = formatTxDate(tx.created_at);

    const badge = document.createElement('span');
    badge.className = 'status-badge';
    badge.dataset.tone = view.tone;
    badge.textContent = view.statusLabel;

    meta.appendChild(date);
    meta.appendChild(badge);

    body.appendChild(title);
    body.appendChild(description);
    body.appendChild(meta);

    const amount = document.createElement('div');
    amount.className = 'tx-card__amount';
    amount.textContent =
      view.amountPrefix + formatMoney(tx.amount);

    card.appendChild(icon);
    card.appendChild(body);
    card.appendChild(amount);

    card.addEventListener('click', () => {
      if (window.Transactiondetail && Transactiondetail.open) {
        Transactiondetail.open(tx.id, 'wallet');
      }
    });

    return card;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     EMPTY STATES
     ═══════════════════════════════════════════════════════════════════════════ */
  function createEmptyState(type) {
    const messages = {
      assets: { 
        icon: 'fa-coins', 
        title: 'No Crypto Holdings', 
        message: 'Buy crypto to see your assets here', 
        action: 'Buy Crypto', 
        onclick: () => App.navigate('market') 
      },
      activity: {
        icon: 'fa-list',
        title: 'No Transactions',
        message: 'Your transaction history will appear here'
      }
    };

    const msg = messages[type] || messages.activity;
    const empty = document.createElement('div');

    if (type === 'activity') {
      // Skeleton rows — mirror real transaction card layout so the page
      // looks structurally complete, not empty. Each row shows a greyed-out
      // placeholder exactly matching createTransactionCard dimensions.
      empty.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:4px 0;';

      const SKELETON_ROWS = [
        { icon:'fa-arrow-down', label:'Deposit',    amount:'+$0.00', color:'rgba(16,185,129,0.15)', w1:'55%', w2:'30%' },
        { icon:'fa-arrow-up',   label:'Trade',      amount:'-$0.00', color:'rgba(59,130,246,0.15)',  w1:'40%', w2:'35%' },
        { icon:'fa-layer-group',label:'Strategy Entry', amount:'-$0.00', color:'rgba(139,92,246,0.15)', w1:'60%', w2:'25%' },
        { icon:'fa-arrow-down', label:'Claim',      amount:'+$0.00', color:'rgba(16,185,129,0.15)', w1:'45%', w2:'30%' },
      ];

      SKELETON_ROWS.forEach((row, i) => {
        const card = document.createElement('div');
        card.style.cssText = [
          'display:flex;align-items:center;justify-content:space-between;',
          'padding:12px;background:var(--color-surface);border:1px solid var(--color-border);',
          'border-radius:10px;opacity:' + (1 - i * 0.18) + ';'
        ].join('');

        const left = document.createElement('div');
        left.style.cssText = 'display:flex;align-items:center;gap:10px;';

        const avatar = document.createElement('div');
        avatar.style.cssText = [
          'width:36px;height:36px;border-radius:50%;',
          'background:var(--color-surface-elevated);',
          'display:flex;align-items:center;justify-content:center;',
          'border:1px solid var(--color-border);'
        ].join('');
        avatar.innerHTML = '<i class="fas ' + row.icon + '" style="font-size:12px;color:var(--color-text-tertiary);"></i>';

        const textBlock = document.createElement('div');

        const titleBar = document.createElement('div');
        titleBar.style.cssText = [
          'height:10px;border-radius:4px;margin-bottom:6px;',
          'background:var(--color-border);width:' + row.w1 + ';'
        ].join('');

        const subBar = document.createElement('div');
        subBar.style.cssText = [
          'height:8px;border-radius:3px;',
          'background:rgba(255,255,255,0.05);width:' + row.w2 + ';'
        ].join('');

        textBlock.appendChild(titleBar);
        textBlock.appendChild(subBar);
        left.appendChild(avatar);
        left.appendChild(textBlock);

        const amtBar = document.createElement('div');
        amtBar.style.cssText = 'height:12px;width:48px;border-radius:4px;background:var(--color-border);';

        card.appendChild(left);
        card.appendChild(amtBar);
        empty.appendChild(card);
      });

      // Call to action overlaid at bottom
      const cta = document.createElement('div');
      cta.style.cssText = [
        'margin-top:16px;padding:16px;text-align:center;',
        'border-radius:12px;background:rgba(59,130,246,0.06);',
        'border:1px solid rgba(59,130,246,0.15);'
      ].join('');
      cta.innerHTML = [
        '<div style="font-size:13px;font-weight:700;color:var(--color-text-primary);margin-bottom:4px;">',
        'No transactions yet</div>',
        '<div style="font-size:12px;color:var(--color-text-secondary);line-height:1.5;">',
        'Deposit funds to start. Every deposit, trade, and claim appears here in real time.</div>'
      ].join('');

      const depositBtn = document.createElement('button');
      depositBtn.className = 'btn btn-primary';
      depositBtn.style.cssText = 'margin-top:12px;width:100%;';
      depositBtn.textContent = 'Make First Deposit';
      depositBtn.addEventListener('click', () => {
        if (window.Trade) Trade.openDeposit();
      });
      cta.appendChild(depositBtn);
      empty.appendChild(cta);

    } else {
      // Generic empty state for other types (assets etc.)
      empty.style.cssText = 'text-align:center; padding:60px 20px; color:var(--color-text-tertiary);';
      empty.innerHTML = [
        '<i class="fas ' + msg.icon + '" style="font-size:56px;margin-bottom:16px;opacity:0.3;display:block;"></i>',
        '<div style="font-size:15px;font-weight:600;color:var(--color-text-primary);margin-bottom:6px;">' + msg.title + '</div>',
        '<div style="font-size:12px;color:var(--color-text-secondary);">' + msg.message + '</div>'
      ].join('');
      if (msg.action) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.textContent = msg.action;
        btn.style.marginTop = '16px';
        btn.onclick = msg.onclick;
        empty.appendChild(btn);
      }
    }

    return empty;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODALS
     ═══════════════════════════════════════════════════════════════════════════ */
  async function openTransferModal() {
    const balances = window.AppState ? (AppState.get('balances') || {}) : state.balances;
    const vaultCash = window.AppState ? Number(AppState.get('vaultCash') || 0) : 0;
    const content = document.createElement('div');

    content.innerHTML = `
      <div style="text-align:center; margin-bottom:20px;">
        <div style="width:60px; height:60px; margin:0 auto 14px; border-radius:14px; background:rgba(139,92,246,0.12); border:1px solid rgba(139,92,246,0.2); display:flex; align-items:center; justify-content:center;">
          <i class="fas fa-exchange-alt" style="font-size:26px; color:#ffffff;"></i>
        </div>
        <h3 style="font-size:18px; font-weight:700; color:var(--color-text-primary); margin-bottom:6px;">Transfer Funds</h3>
        <p style="font-size:12px; color:var(--color-text-secondary);">Move uninvested cash between Spot and Vault</p>
      </div>
      <div class="input-group" style="margin-bottom:14px;">
        <label class="input-label">From</label>
        <select id="transfer-from" class="input-field" style="padding:10px;">
          <option value="spot">Spot Wallet (${formatMoney(Number(balances.spot || 0))})</option>
          <option value="vault">Vault Cash (${formatMoney(vaultCash)})</option>
        </select>
      </div>
      <div class="input-group" style="margin-bottom:14px;">
        <label class="input-label">To</label>
        <select id="transfer-to" class="input-field" style="padding:10px;">
          <option value="vault">Vault Cash</option>
        </select>
      </div>
      <div class="input-group" style="margin-bottom:18px;">
        <label class="input-label" style="display:flex; justify-content:space-between; align-items:center;">
          <span>Amount</span>
          <button id="max-btn" style="background:none; border:none; color:var(--color-primary); font-size:11px; font-weight:600; cursor:pointer;">MAX</button>
        </label>
        <input type="number" id="transfer-amount" class="input-field financial-data" inputmode="decimal" min="0" step="0.01" placeholder="0.00" style="font-size:17px; font-weight:600; text-align:center;">
      </div>
      <div style="display:grid; grid-template-columns:1fr 2fr; gap:10px;">
        <button data-app-action="modal-close" class="btn btn-ghost btn-full">Cancel</button>
        <button id="transfer-confirm-btn" class="btn btn-primary btn-full">Transfer</button>
      </div>`;

    Modal.open({ title: '', content, maxWidth: '440px' });
    const fromSelect = content.querySelector('#transfer-from');
    const toSelect = content.querySelector('#transfer-to');
    const amountInput = content.querySelector('#transfer-amount');
    const maxBtn = content.querySelector('#max-btn');
    const confirmBtn = content.querySelector('#transfer-confirm-btn');

    function availableFor(from) {
      if (!window.AppState) return 0;
      return from === 'spot'
        ? Number((AppState.get('balances') || {}).spot || 0)
        : Number(AppState.get('vaultCash') || 0);
    }

    fromSelect.onchange = () => {
      toSelect.innerHTML = fromSelect.value === 'spot'
        ? '<option value="vault">Vault Cash</option>'
        : '<option value="spot">Spot Wallet</option>';
    };
    maxBtn.onclick = () => { amountInput.value = availableFor(fromSelect.value).toFixed(2); };

    confirmBtn.onclick = async () => {
      if (confirmBtn.disabled) return;
      const from = fromSelect.value;
      const amount = Number(amountInput.value);
      const max = availableFor(from);
      const cap = Number((window.APP_CONFIG && APP_CONFIG.defaults && APP_CONFIG.defaults.maxTransaction) || 1e9);
      if (!Number.isFinite(amount) || amount <= 0 || amount > cap) return App.showError('Enter a valid amount');
      if (amount > max) return App.showError('Insufficient available cash');

      const confirmed = await Modal.confirm({
        title: 'Confirm Transfer',
        message: `Transfer ${formatMoney(amount)} from ${from === 'spot' ? 'Spot Wallet' : 'Vault Cash'} to ${from === 'spot' ? 'Vault Cash' : 'Spot Wallet'}?`,
        confirmText: 'Transfer',
        cancelText: 'Cancel'
      });
      if (!confirmed) return;

      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
      try {
        const activeUser = window.AppState && AppState.get('user');
        if (!window.supabaseClient || !activeUser || !activeUser.id || !window.RequestId) {
          throw new Error('Secure transfer service unavailable');
        }
        const fingerprint = `${from}|${amount.toFixed(8)}`;
        const idempotencyKey = RequestId.get('transfer', fingerprint);
        const { data, error } = await window.supabaseClient.rpc('transfer_spot_vault', {
          p_from: from,
          p_amount: amount,
          p_idempotency_key: idempotencyKey
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row || !row.tx_id) throw new Error('Transfer authority returned an invalid response');

        if (window.AppState) {
          AppState.updateBalances({
            spot: Number(row.spot_balance),
            vaultCash: Number(row.vault_cash)
          });
          AppState.addTransaction({
            id: row.tx_id,
            type: from === 'spot' ? 'transfer_out' : 'transfer_in',
            amount,
            status: 'completed',
            description: from === 'spot' ? 'Transfer Spot → Vault' : 'Transfer Vault → Spot',
            created_at: row.created_at || new Date().toISOString()
          });
        }
        RequestId.clear('transfer', idempotencyKey);
        await Modal.close();
        render(container);
        App.showSuccess(`Transferred ${formatMoney(amount)}`);
      } catch (error) {
        console.error('[WALLET] Transfer failed:', error);
        App.showError(error.message || 'Transfer failed');
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Transfer';
      }
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     LIVE UPDATES
     ═══════════════════════════════════════════════════════════════════════════ */
  function startLiveTicker() {
    if (tickerInterval) clearInterval(tickerInterval);
    tickerInterval = setInterval(() => {
      const totalDisplay = document.getElementById('total-equity-display');
      if (totalDisplay) {
        const totalEquity = calculateTotalEquity();
        totalDisplay.textContent = formatMoney(totalEquity);
      }
    }, CONFIG.TICKER_INTERVAL);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════════════ */
  function render(element) {
    if (tickerInterval) clearInterval(tickerInterval);
    if (unsubTx) { unsubTx(); unsubTx = null; }
    Object.values(virtualScrollers).forEach(scroller => {
      if (scroller && scroller.destroy) scroller.destroy();
    });
    virtualScrollers = {};
    
    if (!element) return;
    
    container = element;
    container.className = 'wallet-page';
    container.style.cssText = 'display:flex; flex-direction:column; height:100%; overflow:hidden;';
    
    if (window.AppState) {
      state.user = AppState.get('user');
      const bals = AppState.get('balances');
      state.balances = bals || { spot: 0, vault: 0 };
      state.holdings = AppState.get('holdings') || {};
      state.transactions = AppState.get('transactions') || [];
      state.marketData = AppState.get('marketData') || [];
    }
    
    container.innerHTML = '';
    container.appendChild(createTabNavigation());
    
    const contentContainer = document.createElement('div');
    contentContainer.id = 'tab-content-container';
    contentContainer.style.cssText = 'flex:1; display:flex; flex-direction:column; min-height:0;';
    contentContainer.appendChild(renderTabContent(state.ui.activeTab));
    container.appendChild(contentContainer);
    
    startLiveTicker();

    // Re-render the active tab whenever a transaction is added (e.g. pending
    // deposit). AppState.addTransaction() emits 'transactions' — subscribing
    // here means the wallet page updates instantly without navigation.
    if (window.AppState) {
      unsubTx = AppState.subscribe('transactions', (txs) => {
        state.transactions = txs || [];
        const contentEl = document.getElementById('tab-content-container');
        if (contentEl) {
          contentEl.innerHTML = '';
          contentEl.appendChild(renderTabContent(state.ui.activeTab));
        }
      });

      // Re-render when balances or holdings change (e.g. after a trade).
      // Without these, the wallet page shows stale numbers until the user
      // navigates away and back — state.balances is only seeded at render()
      // time and never updated by the transactions subscription alone.
      AppState.subscribe('balances', (bals) => {
        state.balances = bals || { spot: 0, vault: 0 };
        state.holdings = AppState.get('holdings') || {};
        const contentEl = document.getElementById('tab-content-container');
        if (contentEl) {
          contentEl.innerHTML = '';
          contentEl.appendChild(renderTabContent(state.ui.activeTab));
        }
      });

      AppState.subscribe('holdings', (holdings) => {
        state.holdings = holdings || {};
        const contentEl = document.getElementById('tab-content-container');
        if (contentEl) {
          contentEl.innerHTML = '';
          contentEl.appendChild(renderTabContent(state.ui.activeTab));
        }
      });
    }

    if (window.Navbar) Navbar.setActive('wallet');
  }

  function switchToActivity() {
    switchTab('activity');
  }

  return { 
    render, 
    switchToActivity,
    showAssetDetails  // Export for external use
  };
})();

if (typeof window !== 'undefined') window.Wallet = Wallet;
