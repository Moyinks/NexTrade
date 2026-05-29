/**
 * NexTrade — Wallet (Institutional Terminal) v5.1
 * ═══════════════════════════════════════════════════════════════════════════
 * FIXES (v5.0 → v5.1):
 * 1. Internal transfer now writes a ledger entry — previously openTransferModal
 *    updated profiles.spot_balance and profiles.vault_balance directly with no
 *    record in the transactions table. The next time deriveSpotBalance ran (on
 *    any subsequent buy/sell/invest/claim), it would re-derive the spot balance
 *    from ledger, find no transfer record, and restore the pre-transfer amount.
 *    This created phantom funds equal to the transferred amount.
 *
 *    Fix: before updating profiles, one transactions.insert() is executed:
 *      - spot → vault: type = 'transfer_out' (spot debited)
 *      - vault → spot: type = 'transfer_in'  (spot credited)
 *    vault_balance has no ledger derivation function; it remains a stored value
 *    updated directly. The ledger entry covers the spot side, which is the only
 *    side that deriveSpotBalance reads. CREDIT_TYPES and DEBIT_TYPES in trade.js
 *    and vault.js are updated to recognise these two new type strings.
 *
 * 2. Fresh DB read before transfer execution — amount was validated against
 *    state.balances captured when the modal opened. If the user had a concurrent
 *    session or a pending operation that changed the balance, the in-memory
 *    snapshot could be stale. Now reads spot_balance and vault_balance fresh from
 *    profiles immediately before execution and re-validates.
 *
 * PRIOR FIXES (v5.0, carried forward):
 * 1. Added showAssetDetails() modal with P/L estimation
 * 2. Integrated Buy/Sell buttons with Trade module
 * 3. Fixed asset click handlers
 * 4. Added defensive checks for missing market data
 * ═══════════════════════════════════════════════════════════════════════════
 */

const Wallet = (() => {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════════
     CONFIGURATION
     ═══════════════════════════════════════════════════════════════════════════ */
  const CONFIG = {
    TICKER_INTERVAL: 1000,
    ITEMS_PER_PAGE: 50,
    VIRTUAL_SCROLL_ITEM_HEIGHT: 72,
    VIRTUAL_SCROLL_BUFFER: 5,
    WALLET_ADDRESS: "0x71C7656EC7ab88b098defB751B7401B5f6d89A23",
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
    hideBalance: localStorage.getItem('nex_hide_balance') === 'true',
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
    localStorage.setItem('nex_hide_balance', state.hideBalance);
    render(container);
  }

  function copyAddress() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(CONFIG.WALLET_ADDRESS)
        .then(() => { if (window.App && App.showSuccess) App.showSuccess('Address copied to clipboard'); })
        .catch(() => { if (window.App && App.showError) App.showError('Could not copy — please copy the address manually.'); });
    } else {
      try {
        window.prompt('Copy this address:', CONFIG.WALLET_ADDRESS);
      } catch (_) {
        if (window.App && App.showError) App.showError('Could not copy address.');
      }
    }
  }
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
        const label = TX_META[tx.type]?.label || tx.type || '';
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
    nav.style.cssText = `
      display: flex;
      background: #0f172a;
      padding: 4px;
      border-radius: 12px;
      margin: 0 0 16px 0;
      border: 1px solid rgba(255,255,255,0.05);
      flex-shrink: 0;
    `;
    
    const tabs = [
      { id: 'overview', label: 'Overview', icon: 'fa-home' },
      { id: 'assets', label: 'Assets', icon: 'fa-coins' },
      { id: 'activity', label: 'Activity', icon: 'fa-list' }
    ];
    
    tabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.className = 'wallet-tab-btn';
      btn.dataset.tab = tab.id;
      const isActive = tab.id === state.ui.activeTab;
      
      btn.style.cssText = `
        flex: 1;
        padding: 10px 0;
        border: none;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        background: ${isActive ? 'rgba(255,255,255,0.09)' : 'transparent'};
        color: ${isActive ? '#ffffff' : '#475569'};
        box-shadow: ${isActive ? '0 1px 3px rgba(0,0,0,0.35)' : 'none'};
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      `;
      
      btn.innerHTML = `<i class="fas ${tab.icon}" style="font-size:11px;"></i><span>${tab.label}</span>`;
      btn.onclick = () => switchTab(tab.id);
      nav.appendChild(btn);
    });
    
    return nav;
  }

  function switchTab(tabId) {
    if (virtualScrollers[state.ui.activeTab] && virtualScrollers[state.ui.activeTab].container) {
      state.ui.scrollPositions[state.ui.activeTab] = virtualScrollers[state.ui.activeTab].container.scrollTop;
    }
    
    state.ui.activeTab = tabId;
    
    document.querySelectorAll('.wallet-tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === tabId;
      btn.style.background = isActive ? 'rgba(255,255,255,0.09)' : 'transparent';
      btn.style.color = isActive ? '#ffffff' : '#475569';
      btn.style.boxShadow = isActive ? '0 1px 3px rgba(0,0,0,0.35)' : 'none';
    });
    
    const contentContainer = container.querySelector('#tab-content-container');
    if (contentContainer) {
      Object.values(virtualScrollers).forEach(scroller => {
        if (scroller && scroller.destroy) scroller.destroy();
      });
      virtualScrollers = {};
      
      const newContent = renderTabContent(tabId);
      contentContainer.innerHTML = '';
      contentContainer.appendChild(newContent);
      
      requestAnimationFrame(() => {
        if (state.ui.scrollPositions[tabId] && virtualScrollers[tabId]) {
          requestAnimationFrame(() => {
            if (virtualScrollers[tabId] && virtualScrollers[tabId].container) {
              virtualScrollers[tabId].container.scrollTop = state.ui.scrollPositions[tabId];
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
    tab.style.cssText = 'flex:1; min-height:0; display:flex; flex-direction:column; overflow-y:auto; overflow-x:hidden; padding-bottom:calc(80px + env(safe-area-inset-bottom, 0px));';
    
    const summary = getPortfolioSummary();
    
    tab.appendChild(createHeroCard(summary));
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
      margin-bottom: 16px;
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
      <button id="copy-addr-btn" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); padding:5px 10px; border-radius:8px; color:rgba(255,255,255,0.85); font-family:var(--font-mono); font-size:10px; font-weight:500; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:all 0.2s; align-self:flex-start;">
        <span style="opacity:0.9;">${CONFIG.WALLET_ADDRESS.substring(0, 6)}...${CONFIG.WALLET_ADDRESS.substring(38)}</span>
        <i class="fas fa-copy" style="font-size:8px; opacity:0.6;"></i>
      </button>
    `;
    
    card.querySelector('#wallet-privacy-btn').onclick = (e) => { 
      e.stopPropagation(); 
      togglePrivacy(); 
    };
    
    card.querySelector('#copy-addr-btn').onclick = copyAddress;
    
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
    section.style.cssText = 'display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:16px; padding:0;';
    
    const actions = [
      { label: 'Deposit', icon: 'fa-arrow-down', color: '#10b981', action: () => window.Trade && Trade.openDeposit() },
      { label: 'Withdraw', icon: 'fa-arrow-up', color: '#ef4444', action: () => window.Trade && Trade.openWithdraw() },
      { label: 'Transfer', icon: 'fa-exchange-alt', color: '#8b5cf6', action: () => openTransferModal() }
    ];
    
    actions.forEach(actionData => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background:var(--color-surface); border:1px solid var(--color-border);
        border-radius:10px; padding:12px 8px; height:auto;
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:5px; cursor:pointer; transition:all 0.2s;
      `;
      
      btn.innerHTML = `
        <div style="width:28px; height:28px; border-radius:7px; background:${actionData.color}15; color:${actionData.color}; display:flex; align-items:center; justify-content:center;">
          <i class="fas ${actionData.icon}" style="font-size:12px;"></i>
        </div>
        <span style="font-size:11px; font-weight:600; color:var(--color-text-primary);">${actionData.label}</span>
      `;
      
      btn.onmouseenter = () => {
        btn.style.borderColor = actionData.color;
        btn.style.background = `${actionData.color}08`;
      };
      btn.onmouseleave = () => {
        btn.style.borderColor = 'var(--color-border)';
        btn.style.background = 'var(--color-surface)';
      };
      
      btn.onclick = actionData.action;
      
      section.appendChild(btn);
    });
    
    return section;
  }

  function createRecentActivity() {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:20px; padding:0;';
    
    section.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="font-size:14px; font-weight:700; color:var(--color-text-primary); margin:0;">Recent Activity</h3>
        <button onclick="Wallet.switchToActivity()" style="background:none; border:none; color:var(--color-primary); font-size:11px; font-weight:600; cursor:pointer;">View All →</button>
      </div>
    `;
    
    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
    
    const recent = state.transactions.slice(0, 5);
    
    recent.forEach(tx => {
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
    tab.style.cssText = 'flex:1; min-height:0; display:flex; flex-direction:column; overflow-y:auto; overflow-x:hidden; padding-bottom:calc(80px + env(safe-area-inset-bottom, 0px));';
    
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
            ${asset.image ? `<img src="${asset.image}" style="width:100%; height:100%;">` : `<span style="font-size:13px; font-weight:700;">${asset.symbol[0]}</span>`}
          </div>
          <div>
            <div style="font-size:14px; font-weight:700; color:var(--color-text-primary);">${asset.name}</div>
            <div style="font-size:11px; color:var(--color-text-secondary);">${state.hideBalance ? '•••••' : asset.amount.toFixed(4)} ${asset.symbol.toUpperCase()}</div>
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
          ${asset.image ? `<img src="${asset.image}" style="width:100%; height:100%;">` : `<span style="font-size:24px; font-weight:700;">${asset.symbol[0]}</span>`}
        </div>
        <h3 style="font-size:18px; font-weight:700; color:var(--color-text-primary); margin-bottom:4px;">${asset.name}</h3>
        <div style="font-size:13px; color:var(--color-text-secondary);">${asset.symbol.toUpperCase()}</div>
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
      CONFIG.VIRTUAL_SCROLL_ITEM_HEIGHT,
      (tx, index) => createTransactionCard(tx)
    );
    
    virtualScrollers.activity = scroller;
    
    // Bottom spacer so last transaction clears the navbar
    const activitySpacer = document.createElement('div');
    activitySpacer.style.cssText = 'flex-shrink:0; height:calc(80px + env(safe-area-inset-bottom, 0px));';
    tab.appendChild(scrollContainer);
    tab.appendChild(activitySpacer);
    
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

  /* ─── transaction type metadata ─── */
  const TX_META = {
    deposit:      { label: 'Deposit',          icon: 'fa-arrow-down',        iconBg: 'rgba(16,185,129,0.15)',  iconColor: '#10b981', isCredit: true  },
    withdraw:     { label: 'Withdrawal',       icon: 'fa-arrow-up',          iconBg: 'rgba(239,68,68,0.15)',   iconColor: '#ef4444', isCredit: false },
    buy:          { label: 'Buy Order',        icon: 'fa-arrow-trend-up',    iconBg: 'rgba(59,130,246,0.15)',  iconColor: '#3b82f6', isCredit: false },
    sell:         { label: 'Sell Order',       icon: 'fa-arrow-trend-down',  iconBg: 'rgba(245,158,11,0.15)', iconColor: '#f59e0b', isCredit: true  },
    investment:   { label: 'Strategy Entry',   icon: 'fa-layer-group',       iconBg: 'rgba(139,92,246,0.15)', iconColor: '#8b5cf6', isCredit: false },
    claim:        { label: 'Cycle Return',     icon: 'fa-coins',             iconBg: 'rgba(16,185,129,0.15)', iconColor: '#10b981', isCredit: true  },
    transfer_in:  { label: 'Transfer In',      icon: 'fa-arrows-left-right', iconBg: 'rgba(99,102,241,0.15)', iconColor: '#6366f1', isCredit: true  },
    transfer_out: { label: 'Transfer Out',     icon: 'fa-arrows-left-right', iconBg: 'rgba(99,102,241,0.15)', iconColor: '#6366f1', isCredit: false },
  };

  const TX_CONTEXT = {
    deposit:      { pending: 'Awaiting admin confirmation', completed: 'Credited to Spot Wallet', approved: 'Credited to Spot Wallet', failed: 'Deposit rejected' },
    withdraw:     { pending: 'Processing — funds locked',  completed: 'Sent from Spot Wallet',   approved: 'Sent from Spot Wallet',  failed: 'Withdrawal failed' },
    buy:          { pending: 'Order pending',              completed: 'Crypto bought via Spot',  approved: 'Crypto bought via Spot', failed: 'Order cancelled' },
    sell:         { pending: 'Order pending',              completed: 'Proceeds to Spot Wallet', approved: 'Proceeds to Spot Wallet',failed: 'Sell failed' },
    investment:   { pending: 'Entering strategy…',        completed: 'Capital deployed in Vault', approved: 'Capital deployed in Vault', failed: 'Entry failed' },
    claim:        { pending: 'Cycle return processing',    completed: 'Principal + cycle return to Spot Wallet', approved: 'Principal + cycle return to Spot Wallet', failed: 'Claim failed' },
    transfer_in:  { pending: 'Transferring…',             completed: 'Vault \u2192 Spot Wallet', approved: 'Vault \u2192 Spot Wallet', failed: 'Transfer failed' },
    transfer_out: { pending: 'Transferring…',             completed: 'Spot Wallet \u2192 Vault', approved: 'Spot Wallet \u2192 Vault', failed: 'Transfer failed' },
  };

  function getTxLabel(tx) {
    const meta = TX_META[tx.type];
    return meta ? meta.label : (tx.type || 'Transaction').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function getTxSubline(tx) {
    // Prefer an explicit description from the DB record
    if (tx.description && tx.description.length > 2 && tx.description.toLowerCase() !== tx.type) {
      return tx.description;
    }
    const ctx = TX_CONTEXT[tx.type];
    if (ctx) return ctx[tx.status] || ctx.completed || '';
    return tx.status ? tx.status.charAt(0).toUpperCase() + tx.status.slice(1) : '';
  }

  function formatTxDate(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const dayMs = 86400000;
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffMs < dayMs) return timeStr + ' · Today';
    if (diffMs < 2 * dayMs) return timeStr + ' · Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + timeStr;
  }

  function createTransactionCard(tx) {
    const card = document.createElement('div');
    card.style.cssText = [
      'display:flex; align-items:center; justify-content:space-between;',
      'padding:12px; background:var(--color-surface); border:1px solid var(--color-border);',
      'border-radius:10px; gap:10px;'
    ].join('');

    const meta = TX_META[tx.type] || {
      label: (tx.type || 'Transaction').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      icon: 'fa-circle-dot', iconBg: 'rgba(148,163,184,0.12)', iconColor: '#94a3b8', isCredit: false
    };

    const isPending  = tx.status === 'pending';
    const isFailed   = tx.status === 'failed';
    const isCredit   = meta.isCredit;

    // Override icon color for status
    let dotColor = meta.iconColor;
    if (isPending) dotColor = '#f59e0b';
    if (isFailed)  dotColor = '#ef4444';

    const statusBadgeColor = { completed:'#10b981', approved:'#10b981', pending:'#f59e0b', failed:'#ef4444', cancelled:'#94a3b8' }[tx.status] || '#94a3b8';

    const amountColor = isFailed ? '#ef4444' : (isCredit ? '#10b981' : 'var(--color-text-primary)');
    const amountSign  = isFailed ? '' : (isCredit ? '+' : '-');

    const label   = getTxLabel(tx);
    const subline = getTxSubline(tx);
    const dateStr = formatTxDate(tx.created_at);

    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
        <div style="width:36px; height:36px; border-radius:50%; flex-shrink:0;
                    background:${meta.iconBg}; color:${dotColor};
                    border:1px solid ${dotColor}22;
                    display:flex; align-items:center; justify-content:center;">
          <i class="fas ${meta.icon}" style="font-size:12px;"></i>
        </div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:13px; font-weight:600; color:var(--color-text-primary);
                      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${label}
          </div>
          <div style="font-size:11px; color:var(--color-text-secondary); margin-top:2px;
                      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${subline}
          </div>
          <div style="font-size:9px; color:rgba(148,163,184,0.7); margin-top:3px; display:flex; align-items:center; gap:5px;">
            <span>${dateStr}</span>
            <span style="display:inline-block; padding:1px 5px; border-radius:3px;
                         font-weight:700; text-transform:uppercase; letter-spacing:0.3px;
                         background:${statusBadgeColor}18; color:${statusBadgeColor};">
              ${tx.status}
            </span>
          </div>
        </div>
      </div>
      <div style="font-family:var(--font-mono); font-size:14px; font-weight:700;
                  color:${amountColor}; flex-shrink:0; text-align:right;">
        ${amountSign}${formatMoney(tx.amount)}
      </div>
    `;

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
    const content = document.createElement('div');
    
    content.innerHTML = `
      <div style="text-align:center; margin-bottom:20px;">
        <div style="width:60px; height:60px; margin:0 auto 14px; border-radius:14px; background:rgba(139,92,246,0.12); border:1px solid rgba(139,92,246,0.2); display:flex; align-items:center; justify-content:center;">
          <i class="fas fa-exchange-alt" style="font-size:26px; color:#ffffff;"></i>
        </div>
        <h3 style="font-size:18px; font-weight:700; color:var(--color-text-primary); margin-bottom:6px;">Transfer Funds</h3>
        <p style="font-size:12px; color:var(--color-text-secondary);">Move funds between Spot and Vault</p>
      </div>
      
      <div class="input-group" style="margin-bottom:14px;">
        <label class="input-label">From</label>
        <select id="transfer-from" class="input-field" style="padding:10px;">
          <option value="spot">Spot Wallet (${formatMoney(state.balances.spot)})</option>
          <option value="vault">Vault (${formatMoney(state.balances.vault)})</option>
        </select>
      </div>
      
      <div class="input-group" style="margin-bottom:14px;">
        <label class="input-label">To</label>
        <select id="transfer-to" class="input-field" style="padding:10px;">
          <option value="vault">Vault</option>
          <option value="spot">Spot Wallet</option>
        </select>
      </div>
      
      <div class="input-group" style="margin-bottom:18px;">
        <label class="input-label" style="display:flex; justify-content:space-between; align-items:center;">
          <span>Amount</span>
          <button id="max-btn" style="background:none; border:none; color:var(--color-primary); font-size:11px; font-weight:600; cursor:pointer;">MAX</button>
        </label>
        <input type="number" id="transfer-amount" class="input-field financial-data" placeholder="0.00" style="font-size:17px; font-weight:600; text-align:center;">
      </div>
      
      <div style="display:grid; grid-template-columns:1fr 2fr; gap:10px;">
        <button onclick="Modal.close()" class="btn btn-ghost btn-full">Cancel</button>
        <button id="transfer-confirm-btn" class="btn btn-primary btn-full">Transfer</button>
      </div>
    `;
    
    Modal.open({ title: '', content, maxWidth: '440px' });
    
    const fromSelect = content.querySelector('#transfer-from');
    const toSelect = content.querySelector('#transfer-to');
    const amountInput = content.querySelector('#transfer-amount');
    const maxBtn = content.querySelector('#max-btn');
    const confirmBtn = content.querySelector('#transfer-confirm-btn');
    
    fromSelect.onchange = () => {
      const from = fromSelect.value;
      toSelect.innerHTML = from === 'spot' 
        ? `<option value="vault">Vault</option>` 
        : `<option value="spot">Spot Wallet</option>`;
    };
    
    maxBtn.onclick = () => {
      const from = fromSelect.value;
      const max = from === 'spot' ? state.balances.spot : state.balances.vault;
      amountInput.value = max;
    };
    
    confirmBtn.onclick = async () => {
      const from = fromSelect.value;
      const to   = toSelect.value;
      const amount = parseFloat(amountInput.value);
      
      if (!amount || amount <= 0) return App.showError('Invalid amount');
      
      // Pre-flight check against current in-memory state (modal-open snapshot).
      // A fresh DB check happens below before the actual DB write.
      const snapshotMax = from === 'spot' ? state.balances.spot : state.balances.vault;
      if (amount > snapshotMax) return App.showError('Insufficient balance');
      
      const confirmed = await Modal.confirm({
        title: 'Confirm Transfer',
        message: `Transfer ${formatMoney(amount)} from ${from === 'spot' ? 'Spot Wallet' : 'Vault'} to ${to === 'vault' ? 'Vault' : 'Spot Wallet'}?`,
        confirmText: 'Transfer',
        cancelText: 'Cancel'
      });
      
      if (!confirmed) return;
      
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
      
      try {
        // ── FIX (v5.1 — D1, step 1): Fresh DB read ──────────────────────────
        // Re-read actual balances from DB immediately before execution.
        // The modal-open snapshot could be stale if a concurrent session or
        // a background operation changed the balance since the modal opened.
        let freshSpot  = state.balances.spot;
        let freshVault = state.balances.vault;
        
        if (window.supabaseClient && state.user) {
          const { data: freshProfile, error: readErr } = await window.supabaseClient
            .from('profiles')
            .select('spot_balance, vault_balance')
            .eq('id', state.user.id)
            .single();
          if (readErr) throw readErr;
          freshSpot  = parseFloat(freshProfile.spot_balance)  || 0;
          freshVault = parseFloat(freshProfile.vault_balance) || 0;
        }
        
        // Re-validate against fresh balances before touching anything
        const freshMax = from === 'spot' ? freshSpot : freshVault;
        if (amount > freshMax) {
          throw new Error('Insufficient balance. Balance changed since dialog opened.');
        }
        // ── END fresh DB read ────────────────────────────────────────────────
        
        const newBalances = { spot: freshSpot, vault: freshVault };
        newBalances[from] -= amount;
        newBalances[to]   += amount;
        
        if (window.supabaseClient && state.user) {
          // ── FIX (v5.1 — D1, step 2): Ledger entry ──────────────────────────
          // Insert a transaction record for the spot side of this transfer.
          //
          // Why one entry, not two:
          //   deriveSpotBalance() derives the SPOT balance only. vault_balance
          //   has no ledger derivation — it is a stored column updated directly
          //   in profiles. So we write exactly one entry that describes what
          //   happened to the spot wallet:
          //
          //   spot → vault: type = 'transfer_out'
          //     DEBIT_TYPES includes 'transfer_out' → spot decremented
          //
          //   vault → spot: type = 'transfer_in'
          //     CREDIT_TYPES includes 'transfer_in' → spot incremented
          //
          // Without this entry, the next call to deriveSpotBalance (triggered
          // by any subsequent buy/sell/invest/claim) would recompute spot from
          // a ledger with no transfer record, restoring the pre-transfer amount
          // and creating phantom funds equal to the transfer.
          const ledgerType = from === 'spot' ? 'transfer_out' : 'transfer_in';
          const { error: txError } = await window.supabaseClient
            .from('transactions')
            .insert({
              user_id:     state.user.id,
              type:        ledgerType,
              amount:      amount,
              status:      'completed',
              description: 'Transfer ' + (from === 'spot' ? 'Spot → Vault' : 'Vault → Spot'),
              created_at:  new Date().toISOString()
            });
          if (txError) throw txError;
          // ── END ledger entry ─────────────────────────────────────────────────
          
          // Update both balances in a single profiles write
          const { error } = await window.supabaseClient
            .from('profiles')
            .update({
              spot_balance:  newBalances.spot,
              vault_balance: newBalances.vault,
              updated_at:    new Date().toISOString()
            })
            .eq('id', state.user.id);
          if (error) throw error;
        }
        
        AppState.updateBalances(newBalances);
        
        // Also record locally in AppState transactions so activity tab updates
        if (window.AppState) {
          AppState.addTransaction({
            id:         'tx_' + Date.now(),
            type:       from === 'spot' ? 'transfer_out' : 'transfer_in',
            amount:     amount,
            status:     'completed',
            description: 'Transfer ' + (from === 'spot' ? 'Spot → Vault' : 'Vault → Spot'),
            created_at: new Date().toISOString()
          });
        }
        
        await Modal.close();
        render(container);
        App.showSuccess(`Transferred ${formatMoney(amount)}`);
        
      } catch (error) {
        console.error('[WALLET] Transfer failed:', error);
        App.showError(error.message || 'Transfer failed');
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = 'Transfer';
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
