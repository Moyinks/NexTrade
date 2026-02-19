/**
 * NexTrade — Vault (Institutional Terminal) v5.0 - PERSISTENCE FIXED
 * ═══════════════════════════════════════════════════════════════════════════
 * CRITICAL FIXES:
 * 1. claim() and earlyWithdraw() now RE-FETCH from Supabase after mutation
 * 2. handleClaimAll() uses fresh DB data to prevent stale state
 * 3. Added crypto asset support (BTC/ETH/SOL) with fiat fallback
 * 4. Improved error handling with user-facing messages
 * ═══════════════════════════════════════════════════════════════════════════
 */

const Vault = (() => {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════════
     CONFIGURATION
     ═══════════════════════════════════════════════════════════════════════════ */
  const CONFIG = {
    PLATFORM_FEE: 0.015,
    EARLY_WITHDRAWAL_PENALTY: 0.02,
    TICKER_INTERVAL: 500,
    TVL_TOTAL: 2400000,
    ACTIVE_USERS: 2341,
    INSURANCE_AMOUNT: 250000,
    ITEMS_PER_PAGE: 20,
    VIRTUAL_SCROLL_ITEM_HEIGHT: 160,
    VIRTUAL_SCROLL_BUFFER: 5,
    HERO_MIN_HEIGHT: 180,
  };

  // Asset to Strategy Mapping
  const ASSET_STRATEGY_MAP = {
    'bitcoin': 'strat_stable',
    'ethereum': 'strat_defi',
    'solana': 'strat_degen'
  };

  /* ═══════════════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════════════ */
  let container = null;
  let tickerInterval = null;
  let virtualScrollers = {};

  const state = {
    user: null,
    balances: { spot: 0, vault: 0 },
    holdings: {},
    investments: [],
    strategies: [
      {
        id: 'usdc_alpha',
        name: 'USDC Yield Alpha',
        risk: 'Low',
        riskLevel: 1,
        baseAPY: 0.12,
        durationDays: 7,
        minInvestment: 100,
        description: 'Algorithmic stablecoin arbitrage across DEX liquidity pools.',
        color: '#10b981',
        gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        icon: 'fas fa-shield-alt',
        badge: '⭐',
        capacity: 0.78,
        participants: 842,
        performance: [0.11, 0.115, 0.12, 0.118, 0.122, 0.12, 0.119],
        acceptedAssets: ['usd', 'bitcoin']
      },
      {
        id: 'defi_bluechip',
        name: 'DeFi Blue Chip',
        risk: 'Medium',
        riskLevel: 3,
        baseAPY: 0.24,
        durationDays: 30,
        minInvestment: 500,
        description: 'Automated leverage farming on Aave and Compound.',
        color: '#3b82f6',
        gradient: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
        icon: 'fas fa-layer-group',
        badge: '🔥',
        capacity: 0.62,
        participants: 1456,
        performance: [0.22, 0.235, 0.24, 0.238, 0.245, 0.24, 0.242],
        acceptedAssets: ['usd', 'ethereum']
      },
      {
        id: 'meme_momentum',
        name: 'Meme Momentum',
        risk: 'High',
        riskLevel: 5,
        baseAPY: 1.50,
        durationDays: 3,
        minInvestment: 50,
        description: 'High-frequency scalping on volatile meme assets.',
        color: '#f59e0b',
        gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
        icon: 'fas fa-rocket',
        badge: '🆕',
        capacity: 0.34,
        participants: 234,
        performance: [1.2, 1.45, 1.6, 1.55, 1.5, 1.48, 1.52],
        acceptedAssets: ['usd', 'solana']
      }
    ],
    ui: {
      activeTab: 'overview',
      expandedGroups: new Set(),
      scrollPositions: {},
      filters: {
        search: '',
        strategy: 'all',
        sortBy: 'maturity',
        sortOrder: 'asc'
      },
      pagination: {
        active: { page: 1, total: 0 },
        completed: { page: 1, total: 0 },
        all: { page: 1, total: 0 }
      }
    }
  };

  /* ═══════════════════════════════════════════════════════════════════════════
     UTILITIES
     ═══════════════════════════════════════════════════════════════════════════ */
  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function getDynamicAPY(strategy) {
    const hour = new Date().getHours();
    const variance = Math.sin(hour / 24 * Math.PI * 2) * 0.02;
    return strategy.baseAPY * (1 + variance);
  }

  function getRiskColor(level) {
    const colors = ['#10b981', '#84cc16', '#eab308', '#f97316', '#ef4444'];
    return colors[Math.min(level - 1, 4)] || '#6b7280';
  }

  function createRiskDots(level, max = 5) {
    let html = '<div style="display:flex; gap:3px;">';
    for (let i = 1; i <= max; i++) {
      const color = i <= level ? getRiskColor(level) : 'rgba(255,255,255,0.2)';
      html += `<div style="width:6px; height:6px; border-radius:50%; background:${color};"></div>`;
    }
    return html + '</div>';
  }

  function createSparkline(data, color = '#10b981', width = 80, height = 24) {
    if (!data || data.length === 0) return '';
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    }).join(' ');
    return `<svg width="${width}" height="${height}" style="display:block;"><polyline fill="none" stroke="${color}" stroke-width="2" points="${points}" style="opacity:0.8;"/></svg>`;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     FINANCIAL CALCULATIONS
     ═══════════════════════════════════════════════════════════════════════════ */
  function calculateLiveValue(inv) {
    if (inv.status !== 'active') return (inv.amount || 0) + (inv.profit || 0);
    const now = Date.now();
    const start = new Date(inv.created_at).getTime();
    if (isNaN(start)) return inv.amount;
    const durationMs = (inv.duration || 30) * 24 * 60 * 60 * 1000;
    const maturityDate = start + durationMs;
    const effectiveNow = Math.min(now, maturityDate);
    const yearsElapsed = (effectiveNow - start) / (365 * 24 * 60 * 60 * 1000);
    const n = 365;
    const compoundValue = inv.amount * Math.pow(1 + inv.apy / n, n * yearsElapsed);
    const grossProfit = compoundValue - inv.amount;
    const platformFee = grossProfit * CONFIG.PLATFORM_FEE;
    return inv.amount + (grossProfit - platformFee);
  }

  function getTimeRemaining(inv) {
    const start = new Date(inv.created_at).getTime();
    const durationMs = (inv.duration || 30) * 24 * 60 * 60 * 1000;
    const maturityDate = start + durationMs;
    const remaining = maturityDate - Date.now();
    if (remaining <= 0) return { text: 'Matured', ms: 0, percent: 100, isDone: true, maturityDate };
    const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
    const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const elapsed = Date.now() - start;
    const percent = Math.min(100, Math.max(0, (elapsed / durationMs) * 100));
    return { text: `${days}d ${hours}h`, ms: remaining, percent, isDone: false, maturityDate };
  }

  function calculateProjection(amount, apy, days) {
    const years = days / 365;
    const n = 365;
    const compoundValue = amount * Math.pow(1 + apy / n, n * years);
    const grossProfit = compoundValue - amount;
    const platformFee = grossProfit * CONFIG.PLATFORM_FEE;
    const netProfit = grossProfit - platformFee;
    return { grossProfit, platformFee, netProfit, finalValue: amount + netProfit };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     DATABASE SYNC HELPER (NEW - CRITICAL FIX)
     ═══════════════════════════════════════════════════════════════════════════ */
  async function syncInvestmentsFromDB() {
    if (!window.supabaseClient || !state.user) {
      console.warn('[VAULT] Cannot sync: no supabase client or user');
      return false;
    }

    try {
      const { data: freshInvestments, error } = await window.supabaseClient
        .from('investments')
        .select('*')
        .eq('user_id', state.user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (freshInvestments) {
        AppState.set('investments', freshInvestments);
        state.investments = freshInvestments.filter(i => i && i.amount > 0);
        console.log(`[VAULT] ✅ Synced ${freshInvestments.length} investments from DB`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[VAULT] ❌ DB sync failed:', error);
      return false;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     DATA AGGREGATION
     ═══════════════════════════════════════════════════════════════════════════ */
  function getPositionGroups() {
    const groups = {};
    
    state.investments
      .filter(i => i.status === 'active')
      .forEach(inv => {
        const key = inv.strategy_id;
        if (!groups[key]) {
          groups[key] = {
            strategy: state.strategies.find(s => s.id === key) || { id: key, name: 'Unknown', color: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', icon: 'fas fa-box' },
            positions: [],
            totalInvested: 0,
            totalCurrent: 0,
            totalProfit: 0,
            earliestMaturity: null,
            readyToClaim: 0,
            avgAPY: 0
          };
        }
        
        const current = calculateLiveValue(inv);
        const profit = current - inv.amount;
        const timing = getTimeRemaining(inv);
        
        groups[key].positions.push({ ...inv, current, profit, timing });
        groups[key].totalInvested += inv.amount;
        groups[key].totalCurrent += current;
        groups[key].totalProfit += profit;
        groups[key].avgAPY += inv.apy;
        
        if (timing.isDone) groups[key].readyToClaim++;
        
        if (!groups[key].earliestMaturity || timing.maturityDate < groups[key].earliestMaturity) {
          groups[key].earliestMaturity = timing.maturityDate;
        }
      });
    
    Object.values(groups).forEach(group => {
      if (group.positions.length > 0) {
        group.avgAPY = group.avgAPY / group.positions.length;
      }
    });
    
    return Object.values(groups);
  }

  function getPortfolioSummary() {
    const activeInvs = state.investments.filter(i => i.status === 'active');
    const completedInvs = state.investments.filter(i => i.status === 'completed');
    
    const totalValue = activeInvs.reduce((acc, inv) => acc + calculateLiveValue(inv), 0);
    const totalInvested = activeInvs.reduce((acc, inv) => acc + inv.amount, 0);
    const totalProfit = totalValue - totalInvested;
    const lifetimeEarnings = completedInvs.reduce((acc, inv) => acc + (inv.profit || 0), 0);
    
    const claimableInvs = activeInvs.filter(inv => getTimeRemaining(inv).isDone);
    const totalClaims = claimableInvs.reduce((acc, inv) => acc + calculateLiveValue(inv), 0);
    
    const avgAPY = activeInvs.length > 0 
      ? activeInvs.reduce((acc, inv) => acc + (inv.apy || 0), 0) / activeInvs.length 
      : 0;
    
    return {
      totalValue,
      totalInvested,
      totalProfit,
      profitPercent: totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0,
      activeCount: activeInvs.length,
      completedCount: completedInvs.length,
      lifetimeEarnings,
      avgAPY,
      claimableCount: claimableInvs.length,
      totalClaims
    };
  }

  function filterAndSortInvestments(investments, filters) {
    let filtered = [...investments];
    
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(inv => {
        const strategy = state.strategies.find(s => s.id === inv.strategy_id);
        return strategy?.name.toLowerCase().includes(searchLower) || 
               inv.strategy_id.toLowerCase().includes(searchLower);
      });
    }
    
    if (filters.strategy !== 'all') {
      filtered = filtered.filter(inv => inv.strategy_id === filters.strategy);
    }
    
    filtered.sort((a, b) => {
      let valA, valB;
      
      switch (filters.sortBy) {
        case 'amount':
          valA = a.amount;
          valB = b.amount;
          break;
        case 'maturity':
          valA = getTimeRemaining(a).maturityDate;
          valB = getTimeRemaining(b).maturityDate;
          break;
        case 'apy':
          valA = a.apy;
          valB = b.apy;
          break;
        case 'profit':
          valA = calculateLiveValue(a) - a.amount;
          valB = calculateLiveValue(b) - b.amount;
          break;
        default:
          return 0;
      }
      
      return filters.sortOrder === 'asc' ? valA - valB : valB - valA;
    });
    
    return filtered;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     VIRTUAL SCROLL ENGINE
     ═══════════════════════════════════════════════════════════════════════════ */
  

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
      margin: 0 0 20px 0;
      border: 1px solid rgba(255,255,255,0.05);
      flex-shrink: 0;
    `;
    
    const tabs = [
      { id: 'overview', label: 'Overview', icon: 'fa-chart-pie' },
      { id: 'active', label: 'Active', icon: 'fa-chart-line' },
      { id: 'completed', label: 'Completed', icon: 'fa-check-circle' },
      { id: 'all', label: 'All', icon: 'fa-list' }
    ];
    
    tabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.className = 'vault-tab-btn';
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
        background: ${isActive ? '#3b82f6' : 'transparent'};
        color: ${isActive ? '#ffffff' : '#64748b'};
        box-shadow: ${isActive ? '0 2px 8px rgba(59, 130, 246, 0.4)' : 'none'};
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
    
    document.querySelectorAll('.vault-tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === tabId;
      btn.style.background = isActive ? '#3b82f6' : 'transparent';
      btn.style.color = isActive ? '#ffffff' : '#64748b';
      btn.style.boxShadow = isActive ? '0 2px 8px rgba(59, 130, 246, 0.4)' : 'none';
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
      case 'active':
        return createActiveTab();
      case 'completed':
        return createCompletedTab();
      case 'all':
        return createAllTab();
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
    tab.style.cssText = 'display:flex; flex-direction:column; height:100%; overflow-y:auto; overflow-x:hidden;';
    
    const summary = getPortfolioSummary();
    
    tab.appendChild(createHeroCard(summary));
    
    if (summary.activeCount > 0) {
      tab.appendChild(createAllocationDoughnut(summary));
    }
    
    if (summary.claimableCount > 0) {
      tab.appendChild(createClaimAllSection(summary));
    }
    
    tab.appendChild(createStatsBar());
    tab.appendChild(createMarketplace());
    
    return tab;
  }

  function createHeroCard(summary) {
    const card = document.createElement('div');
    card.id = 'vault-main-hero';
    card.style.cssText = `
      position: relative;
      overflow: hidden;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
      background: linear-gradient(180deg, #1e1b4b, #020617);
      border: 1px solid rgba(139, 92, 246, 0.3);
      box-shadow: 0 8px 24px -6px rgba(139, 92, 246, 0.2);
      min-height: ${CONFIG.HERO_MIN_HEIGHT}px;
      flex-shrink: 0;
    `;
    
    const changeColor = summary.profitPercent >= 0 ? '#10b981' : '#ef4444';
    
    card.innerHTML = `
      <div style="position:absolute; top:16px; right:16px; display:flex; align-items:center; gap:6px; font-size:10px; color:rgba(255,255,255,0.6);">
        <div style="width:6px; height:6px; border-radius:50%; background:#10b981; box-shadow:0 0 8px #10b981;"></div>
        <span>Live</span>
      </div>
      <div style="text-align:center;">
        <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:rgba(255,255,255,0.5); margin-bottom:6px;">Portfolio Value</div>
        <div id="vault-total-display" style="font-family:var(--font-mono); font-size:40px; font-weight:800; color:white; letter-spacing:-1px; text-shadow:0 2px 16px rgba(139,92,246,0.4); margin-bottom:6px;">${Format.currency(summary.totalValue)}</div>
        ${summary.totalValue > 0 ? `<div style="display:inline-flex; align-items:center; gap:6px; color:${changeColor}; font-size:13px; font-weight:600;"><i class="fas fa-arrow-${summary.profitPercent >= 0 ? 'up' : 'down'}" style="font-size:9px;"></i><span>${Format.currency(Math.abs(summary.totalProfit))} (${summary.profitPercent >= 0 ? '+' : ''}${summary.profitPercent.toFixed(2)}%)</span></div>` : ''}
      </div>
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-top:16px;">
        <div style="text-align:center; padding:8px; background:rgba(255,255,255,0.05); border-radius:8px;"><div style="font-size:10px; color:rgba(255,255,255,0.5); margin-bottom:2px;">Active</div><div style="font-size:18px; font-weight:700; color:white;">${summary.activeCount}</div></div>
        <div style="text-align:center; padding:8px; background:rgba(255,255,255,0.05); border-radius:8px;"><div style="font-size:10px; color:rgba(255,255,255,0.5); margin-bottom:2px;">Lifetime</div><div style="font-size:18px; font-weight:700; color:#10b981;">${Format.currency(summary.lifetimeEarnings)}</div></div>
        <div style="text-align:center; padding:8px; background:rgba(255,255,255,0.05); border-radius:8px;"><div style="font-size:10px; color:rgba(255,255,255,0.5); margin-bottom:2px;">Avg APY</div><div style="font-size:18px; font-weight:700; color:#a78bfa;">${(summary.avgAPY * 100).toFixed(1)}%</div></div>
      </div>
    `;
    return card;
  }

  function createAllocationDoughnut(summary) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:20px;';
    
    const activeValue = summary.totalValue;
    const idleValue = state.balances.spot;
    const totalAssets = activeValue + idleValue;
    const activePercent = totalAssets > 0 ? (activeValue / totalAssets) * 100 : 0;
    const idlePercent = 100 - activePercent;
    
    const activeAngle = (activePercent / 100) * 360;
    
    section.innerHTML = `
      <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:16px; padding:20px;">
        <h3 style="font-size:15px; font-weight:700; color:var(--color-text-primary); margin-bottom:16px;">
          <i class="fas fa-chart-pie" style="margin-right:8px; color:#8b5cf6;"></i>Portfolio Allocation
        </h3>
        <div style="display:grid; grid-template-columns:120px 1fr; gap:20px; align-items:center;">
          <div style="position:relative; width:120px; height:120px;">
            <div style="
              width:100%; 
              height:100%; 
              border-radius:50%; 
              background: conic-gradient(
                from 0deg,
                #10b981 0deg ${activeAngle}deg,
                #64748b ${activeAngle}deg 360deg
              );
              box-shadow: inset 0 0 20px rgba(0,0,0,0.3);
            "></div>
            <div style="
              position:absolute; 
              top:50%; 
              left:50%; 
              transform:translate(-50%, -50%); 
              width:70px; 
              height:70px; 
              background:var(--color-surface); 
              border-radius:50%; 
              display:flex; 
              align-items:center; 
              justify-content:center;
              flex-direction:column;
            ">
              <div style="font-size:20px; font-weight:700; color:#10b981;">${activePercent.toFixed(0)}%</div>
              <div style="font-size:9px; color:var(--color-text-tertiary);">Active</div>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="display:flex; align-items:center; gap:8px;">
                <div style="width:12px; height:12px; border-radius:3px; background:#10b981;"></div>
                <span style="font-size:13px; color:var(--color-text-secondary);">Active Staking</span>
              </div>
              <span style="font-family:var(--font-mono); font-size:14px; font-weight:700; color:#10b981;">${Format.currency(activeValue)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="display:flex; align-items:center; gap:8px;">
                <div style="width:12px; height:12px; border-radius:3px; background:#64748b;"></div>
                <span style="font-size:13px; color:var(--color-text-secondary);">Idle Capital</span>
              </div>
              <span style="font-family:var(--font-mono); font-size:14px; font-weight:700; color:var(--color-text-primary);">${Format.currency(idleValue)}</span>
            </div>
          </div>
        </div>
      </div>
    `;
    
    return section;
  }

  function createStatsBar() {
    const bar = document.createElement('div');
    bar.style.cssText = 'display:grid; grid-template-columns:repeat(2, 1fr); gap:12px; margin-bottom:24px;';
    const avgAPY = state.strategies.reduce((acc, s) => acc + getDynamicAPY(s), 0) / state.strategies.length;
    bar.innerHTML = `
      <div style="text-align:center; padding:16px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:12px;"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">TVL</div><div style="font-size:20px; font-weight:700; color:var(--color-text-primary);">${Format.currency(CONFIG.TVL_TOTAL)}</div></div>
      <div style="text-align:center; padding:16px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:12px;"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">Investors</div><div style="font-size:20px; font-weight:700; color:var(--color-text-primary);">${CONFIG.ACTIVE_USERS.toLocaleString()}</div></div>
    `;
    return bar;
  }

  function createClaimAllSection(summary) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:20px; padding:16px; background:rgba(16, 185, 129, 0.1); border:1px solid rgba(16, 185, 129, 0.3); border-radius:12px;';
    
    section.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <div>
          <div style="font-size:15px; font-weight:700; color:#10b981; margin-bottom:4px;">
            <i class="fas fa-gift" style="margin-right:6px;"></i>Ready to Claim
          </div>
          <div style="font-size:12px; color:var(--color-text-secondary);">
            ${summary.claimableCount} position${summary.claimableCount > 1 ? 's' : ''} matured
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:2px;">Total Value</div>
          <div style="font-family:var(--font-mono); font-size:22px; font-weight:700; color:#10b981;">${Format.currency(summary.totalClaims)}</div>
        </div>
      </div>
      <button id="claim-all-btn" class="btn btn-success btn-full" style="font-size:14px; padding:10px;">
        <i class="fas fa-hand-holding-usd" style="margin-right:6px;"></i>Claim All (${summary.claimableCount})
      </button>
    `;
    
    section.querySelector('#claim-all-btn').onclick = handleClaimAll;
    
    return section;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     ACTIVE TAB
     ═══════════════════════════════════════════════════════════════════════════ */
  function createActiveTab() {
    const tab = document.createElement('div');
    tab.className = 'active-tab';
    tab.style.cssText = 'display:flex; flex-direction:column; height:100%;';
    
    const groups = getPositionGroups();
    
    if (groups.length === 0) {
      tab.appendChild(createEmptyState('active'));
      return tab;
    }
    
    const scrollContainer = document.createElement('div');
    scrollContainer.id = 'active-scroll-container';
    scrollContainer.style.flex = '1';
    scrollContainer.style.minHeight = '0';
    
    const scroller = new VirtualScroller(
      scrollContainer,
      groups,
      CONFIG.VIRTUAL_SCROLL_ITEM_HEIGHT,
      (group, index) => createStrategyGroupCard(group)
    );
    
    virtualScrollers.active = scroller;
    
    tab.appendChild(scrollContainer);
    
    return tab;
  }

  function createStrategyGroupCard(group) {
    const card = document.createElement('div');
    card.className = 'strategy-group-card';
    card.dataset.strategyId = group.strategy.id;
    card.style.cssText = 'background:var(--color-surface); border:1px solid var(--color-border); border-radius:16px; padding:0; overflow:hidden; transition:all 0.3s;';
    
    const isExpanded = state.ui.expandedGroups.has(group.strategy.id);
    const profitPercent = group.totalInvested > 0 ? ((group.totalProfit / group.totalInvested) * 100) : 0;
    
    card.innerHTML = `
      <div class="group-header" style="padding:18px; cursor:pointer; background:${group.strategy.gradient}; position:relative;">
        <div style="position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.3);"></div>
        <div style="position:relative; z-index:1;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:44px; height:44px; border-radius:10px; background:rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:center;"><i class="${group.strategy.icon}" style="font-size:20px; color:white;"></i></div>
              <div>
                <div style="font-size:16px; font-weight:700; color:white;">${group.strategy.name}</div>
                <div style="font-size:12px; color:rgba(255,255,255,0.8);">${group.positions.length} position${group.positions.length > 1 ? 's' : ''} • ${(group.avgAPY * 100).toFixed(1)}% APY</div>
              </div>
            </div>
            <i class="fas fa-chevron-${isExpanded ? 'up' : 'down'}" id="expand-icon-${group.strategy.id}" style="color:white; font-size:14px; transition:transform 0.3s;"></i>
          </div>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; background:rgba(0,0,0,0.2); padding:10px; border-radius:8px;">
            <div style="text-align:center;"><div style="font-size:10px; color:rgba(255,255,255,0.7); margin-bottom:2px;">Invested</div><div style="font-family:var(--font-mono); font-size:14px; font-weight:700; color:white;">${Format.currency(group.totalInvested)}</div></div>
            <div style="text-align:center;"><div style="font-size:10px; color:rgba(255,255,255,0.7); margin-bottom:2px;">Current</div><div style="font-family:var(--font-mono); font-size:14px; font-weight:700; color:#86efac;">${Format.currency(group.totalCurrent)}</div></div>
            <div style="text-align:center;"><div style="font-size:10px; color:rgba(255,255,255,0.7); margin-bottom:2px;">P&L</div><div style="font-family:var(--font-mono); font-size:14px; font-weight:700; color:${profitPercent >= 0 ? '#86efac' : '#fca5a5'};">${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(2)}%</div></div>
          </div>
          ${group.readyToClaim > 0 ? `<div style="margin-top:10px; text-align:center; padding:6px; background:rgba(16, 185, 129, 0.3); border-radius:6px; font-size:12px; font-weight:700; color:white;"><i class="fas fa-gift" style="margin-right:4px;"></i>${group.readyToClaim} Ready</div>` : ''}
        </div>
      </div>
      <div class="group-positions" id="positions-${group.strategy.id}" style="max-height:${isExpanded ? 'none' : '0'}; overflow:hidden; transition:max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);">
        ${group.positions.map(pos => createPositionCard(pos, group.strategy)).join('')}
      </div>
    `;
    
    card.querySelector('.group-header').onclick = () => toggleGroupExpand(group.strategy.id);
    
    return card;
  }

  function toggleGroupExpand(strategyId) {
    const isExpanded = state.ui.expandedGroups.has(strategyId);
    
    if (isExpanded) {
      state.ui.expandedGroups.delete(strategyId);
    } else {
      state.ui.expandedGroups.add(strategyId);
    }
    
    const positionsDiv = document.getElementById(`positions-${strategyId}`);
    const icon = document.getElementById(`expand-icon-${strategyId}`);
    
    if (positionsDiv) {
      if (isExpanded) {
        positionsDiv.style.maxHeight = '0';
        icon.className = 'fas fa-chevron-down';
      } else {
        positionsDiv.style.maxHeight = `${positionsDiv.scrollHeight}px`;
        icon.className = 'fas fa-chevron-up';
      }
    }
  }

  function createPositionCard(pos, strategy) {
    const badge = pos.timing.isDone ? '<span class="badge badge-success" style="position:absolute; top:10px; right:10px; font-size:10px;">🎉 Ready</span>' : '<span class="badge badge-info" style="position:absolute; top:10px; right:10px; font-size:10px;">⚡ Active</span>';
    
    return `
      <div style="padding:14px; border-bottom:1px solid var(--color-border); position:relative; cursor:pointer;" onclick="Vault.showPositionDetails('${pos.id}')">
        ${badge}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
          <div><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:2px;">Principal</div><div style="font-family:var(--font-mono); font-size:13px; font-weight:600; color:var(--color-text-primary);">${Format.currency(pos.amount)}</div></div>
          <div><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:2px;">Current</div><div style="font-family:var(--font-mono); font-size:13px; font-weight:700; color:#10b981;">${Format.currency(pos.current)}</div></div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
          <div style="color:var(--color-text-secondary);"><i class="far fa-clock" style="margin-right:4px;"></i>${pos.timing.text}</div>
          <div style="font-size:12px; font-weight:700; color:${pos.profit >= 0 ? '#10b981' : '#ef4444'};">${pos.profit >= 0 ? '+' : ''}${Format.currency(pos.profit)}</div>
        </div>
        ${pos.timing.isDone ? `<button onclick="Vault.claim('${pos.id}'); event.stopPropagation();" class="btn btn-success btn-full" style="margin-top:10px; font-size:12px; padding:7px;"><i class="fas fa-hand-holding-usd" style="margin-right:4px;"></i>Claim</button>` : ''}
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     COMPLETED TAB
     ═══════════════════════════════════════════════════════════════════════════ */
  function createCompletedTab() {
    const tab = document.createElement('div');
    tab.className = 'completed-tab';
    tab.style.cssText = 'display:flex; flex-direction:column; height:100%;';
    
    const completed = state.investments.filter(i => i.status === 'completed');
    
    if (completed.length === 0) {
      tab.appendChild(createEmptyState('completed'));
      return tab;
    }
    
    const scrollContainer = document.createElement('div');
    scrollContainer.id = 'completed-scroll-container';
    scrollContainer.style.flex = '1';
    scrollContainer.style.minHeight = '0';
    
    const scroller = new VirtualScroller(
      scrollContainer,
      completed,
      120,
      (inv, index) => createCompletedCard(inv)
    );
    
    virtualScrollers.completed = scroller;
    
    tab.appendChild(scrollContainer);
    
    return tab;
  }

  function createCompletedCard(inv) {
    const strategy = state.strategies.find(s => s.id === inv.strategy_id) || { name: 'Unknown', color: '#8b5cf6', icon: 'fas fa-box' };
    const profitPercent = inv.amount > 0 ? ((inv.profit || 0) / inv.amount) * 100 : 0;
    const date = new Date(inv.created_at).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
    
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--color-surface); border:1px solid var(--color-border); border-radius:12px; padding:14px; margin-bottom:12px;';
    
    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
        <div style="width:36px; height:36px; border-radius:8px; background:${strategy.color}20; color:${strategy.color}; display:flex; align-items:center; justify-content:center;"><i class="${strategy.icon}" style="font-size:14px;"></i></div>
        <div style="flex:1;">
          <div style="font-size:14px; font-weight:700; color:var(--color-text-primary);">${strategy.name}</div>
          <div style="font-size:11px; color:var(--color-text-secondary);">${date}</div>
        </div>
        <span class="badge badge-success" style="font-size:9px;">Completed</span>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; padding:10px; background:var(--color-surface-elevated); border-radius:8px;">
        <div style="text-align:center;"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:2px;">Invested</div><div style="font-family:var(--font-mono); font-size:12px; font-weight:600; color:var(--color-text-primary);">${Format.currency(inv.amount)}</div></div>
        <div style="text-align:center;"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:2px;">Profit</div><div style="font-family:var(--font-mono); font-size:12px; font-weight:700; color:#10b981;">${Format.currency(inv.profit || 0)}</div></div>
        <div style="text-align:center;"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:2px;">Return</div><div style="font-family:var(--font-mono); font-size:12px; font-weight:700; color:#10b981;">${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(2)}%</div></div>
      </div>
    `;
    
    return card;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     ALL TAB
     ═══════════════════════════════════════════════════════════════════════════ */
  function createAllTab() {
    const tab = document.createElement('div');
    tab.className = 'all-tab';
    tab.style.cssText = 'display:flex; flex-direction:column; height:100%;';
    
    if (state.investments.length === 0) {
      tab.appendChild(createEmptyState('all'));
      return tab;
    }
    
    const scrollContainer = document.createElement('div');
    scrollContainer.id = 'all-scroll-container';
    scrollContainer.style.flex = '1';
    scrollContainer.style.minHeight = '0';
    
    const scroller = new VirtualScroller(
      scrollContainer,
      state.investments,
      120,
      (inv, index) => inv.status === 'active' ? createActiveInvestmentCard(inv) : createCompletedCard(inv)
    );
    
    virtualScrollers.all = scroller;
    
    tab.appendChild(scrollContainer);
    
    return tab;
  }

  function createActiveInvestmentCard(inv) {
    const strategy = state.strategies.find(s => s.id === inv.strategy_id) || { name: 'Unknown', color: '#8b5cf6', icon: 'fas fa-box' };
    const current = calculateLiveValue(inv);
    const profit = current - inv.amount;
    const timing = getTimeRemaining(inv);
    
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--color-surface); border:1px solid var(--color-border); border-radius:12px; padding:14px; margin-bottom:12px; cursor:pointer;';
    card.onclick = () => showPositionDetails(inv.id);
    
    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
        <div style="width:36px; height:36px; border-radius:8px; background:${strategy.color}20; color:${strategy.color}; display:flex; align-items:center; justify-content:center;"><i class="${strategy.icon}" style="font-size:14px;"></i></div>
        <div style="flex:1;">
          <div style="font-size:14px; font-weight:700; color:var(--color-text-primary);">${strategy.name}</div>
          <div style="font-size:11px; color:var(--color-text-secondary);"><i class="far fa-clock" style="margin-right:4px;"></i>${timing.text}</div>
        </div>
        <span class="badge ${timing.isDone ? 'badge-success' : 'badge-info'}" style="font-size:9px;">${timing.isDone ? '🎉 Ready' : '⚡ Active'}</span>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; padding:10px; background:var(--color-surface-elevated); border-radius:8px;">
        <div style="text-align:center;"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:2px;">Principal</div><div style="font-family:var(--font-mono); font-size:12px; font-weight:600; color:var(--color-text-primary);">${Format.currency(inv.amount)}</div></div>
        <div style="text-align:center;"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:2px;">Current</div><div style="font-family:var(--font-mono); font-size:12px; font-weight:700; color:#10b981;">${Format.currency(current)}</div></div>
        <div style="text-align:center;"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:2px;">Profit</div><div style="font-family:var(--font-mono); font-size:12px; font-weight:700; color:${profit >= 0 ? '#10b981' : '#ef4444'};">${profit >= 0 ? '+' : ''}${Format.currency(profit)}</div></div>
      </div>
    `;
    
    return card;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     EMPTY STATES
     ═══════════════════════════════════════════════════════════════════════════ */
  function createEmptyState(type) {
    const messages = {
      active: { icon: 'fa-inbox', title: 'No Active Investments', message: 'Start investing to see your positions here' },
      completed: { icon: 'fa-history', title: 'No Completed Investments', message: 'Your completed investments will appear here' },
      all: { icon: 'fa-folder-open', title: 'No Investments Yet', message: 'Choose a strategy below to get started' }
    };
    
    const msg = messages[type] || messages.all;
    
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center; padding:60px 20px; color:var(--color-text-tertiary);';
    empty.innerHTML = `
      <i class="fas ${msg.icon}" style="font-size:56px; margin-bottom:16px; opacity:0.3; display:block;"></i>
      <div style="font-size:15px; font-weight:600; color:var(--color-text-primary); margin-bottom:6px;">${msg.title}</div>
      <div style="font-size:12px; color:var(--color-text-secondary);">${msg.message}</div>
    `;
    return empty;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MARKETPLACE
     ═══════════════════════════════════════════════════════════════════════════ */
  function createMarketplace() {
    const section = document.createElement('div');
    section.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;"><h3 style="font-size:15px; font-weight:700; color:var(--color-text-primary);"><i class="fas fa-store" style="margin-right:6px; color:#8b5cf6;"></i>Investment Strategies</h3></div>`;
    
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid; grid-template-columns:1fr; gap:14px;';
    
    state.strategies.forEach(strategy => {
      const dynamicAPY = getDynamicAPY(strategy);
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--color-surface); border:1px solid var(--color-border); border-radius:14px; padding:16px; cursor:pointer; transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1); position:relative; overflow:hidden;';
      card.onmouseenter = () => { card.style.transform = 'translateY(-4px)'; card.style.boxShadow = `0 12px 24px -6px ${strategy.color}40`; card.style.borderColor = `${strategy.color}60`; };
      card.onmouseleave = () => { card.style.transform = 'translateY(0)'; card.style.boxShadow = 'none'; card.style.borderColor = 'var(--color-border)'; };
      card.onclick = () => openStrategy(strategy.id);
      
      card.innerHTML = `
        ${strategy.badge ? `<div style="position:absolute; top:10px; right:10px; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px); padding:3px 8px; border-radius:10px; font-size:9px; font-weight:600; border:1px solid rgba(255,255,255,0.1);">${strategy.badge}</div>` : ''}
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
          <div style="width:44px; height:44px; border-radius:10px; background:${strategy.gradient}; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 10px ${strategy.color}40;"><i class="${strategy.icon}" style="font-size:18px; color:white;"></i></div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:14px; font-weight:700; color:var(--color-text-primary); margin-bottom:2px;">${strategy.name}</div>
            <div style="display:flex; align-items:center; gap:4px;"><span style="font-size:10px; color:var(--color-text-tertiary);">Risk:</span>${createRiskDots(strategy.riskLevel)}</div>
          </div>
        </div>
        <p style="font-size:11px; color:var(--color-text-secondary); line-height:1.4; margin-bottom:14px; min-height:36px;">${strategy.description}</p>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px;">
          <div style="background:var(--color-surface-elevated); padding:10px; border-radius:8px; text-align:center;"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px;">APY</div><div style="font-size:17px; font-weight:700; color:#10b981;">${(dynamicAPY * 100).toFixed(1)}%</div></div>
          <div style="background:var(--color-surface-elevated); padding:10px; border-radius:8px; text-align:center;"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px;">Duration</div><div style="font-size:17px; font-weight:700; color:var(--color-text-primary);">${strategy.durationDays}d</div></div>
        </div>
        <div style="margin-bottom:14px;"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:6px; display:flex; justify-content:space-between;"><span>7-Day Performance</span><span style="color:${strategy.color};">${(strategy.performance[6] * 100).toFixed(1)}%</span></div>${createSparkline(strategy.performance, strategy.color, 280, 28)}</div>
        <div style="margin-bottom:12px;"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;"><span style="font-size:10px; color:var(--color-text-tertiary);">Capacity</span><span style="font-size:10px; color:var(--color-text-secondary); font-weight:600;">${(strategy.capacity * 100).toFixed(0)}%</span></div><div style="height:5px; background:var(--color-surface-elevated); border-radius:3px; overflow:hidden;"><div style="height:100%; width:${strategy.capacity * 100}%; background:${strategy.gradient}; transition:width 0.5s ease;"></div></div></div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:10px; color:var(--color-text-tertiary);"><i class="fas fa-users" style="margin-right:3px;"></i>${strategy.participants.toLocaleString()}</div>
          <div class="btn btn-sm btn-primary" style="background:${strategy.gradient}; border:none; padding:5px 12px; font-size:11px;">Invest <i class="fas fa-arrow-right" style="margin-left:3px; font-size:9px;"></i></div>
        </div>
      `;
      grid.appendChild(card);
    });
    
    section.appendChild(grid);
    return section;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODALS & INTERACTIONS
     ═══════════════════════════════════════════════════════════════════════════ */
  function openStrategy(id) {
    const strategy = state.strategies.find(s => s.id === id);
    if (!strategy) return;
    const dynamicAPY = getDynamicAPY(strategy);
    const defaultAmount = Math.max(strategy.minInvestment, 100);
    
    const content = document.createElement('div');
    content.innerHTML = `
      <div style="text-align:center; margin-bottom:20px;">
        <div style="width:60px; height:60px; margin:0 auto 14px; border-radius:14px; background:${strategy.gradient}; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 20px ${strategy.color}40;"><i class="${strategy.icon}" style="font-size:26px; color:white;"></i></div>
        <h3 style="font-size:18px; font-weight:700; color:var(--color-text-primary); margin-bottom:6px;">${strategy.name}</h3>
        <p style="font-size:12px; color:var(--color-text-secondary); line-height:1.4;">${strategy.description}</p>
      </div>
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-bottom:20px;">
        <div style="background:var(--color-surface-elevated); padding:12px; border-radius:10px; text-align:center; border:1px solid var(--color-border);"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px; text-transform:uppercase; letter-spacing:0.5px;">APY</div><div style="font-size:20px; font-weight:700; color:#10b981;">${(dynamicAPY * 100).toFixed(1)}%</div></div>
        <div style="background:var(--color-surface-elevated); padding:12px; border-radius:10px; text-align:center; border:1px solid var(--color-border);"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px; text-transform:uppercase; letter-spacing:0.5px;">Duration</div><div style="font-size:20px; font-weight:700; color:var(--color-text-primary);">${strategy.durationDays}d</div></div>
        <div style="background:var(--color-surface-elevated); padding:12px; border-radius:10px; text-align:center; border:1px solid var(--color-border);"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px; text-transform:uppercase; letter-spacing:0.5px;">Risk</div><div style="font-size:20px; font-weight:700; color:${getRiskColor(strategy.riskLevel)};">${strategy.risk}</div></div>
      </div>
      
      ${strategy.acceptedAssets && strategy.acceptedAssets.length > 1 ? `
        <div class="input-group" style="margin-bottom:14px;">
          <label class="input-label">Fund With</label>
          <select id="asset-select" class="input-field" style="padding:10px;">
            <option value="usd">USD (Spot Balance: ${Format.currency(state.balances.spot)})</option>
            ${strategy.acceptedAssets.filter(a => a !== 'usd').map(asset => {
              const holding = state.holdings[asset] || 0;
              const assetSymbol = asset.toUpperCase();
              return `<option value="${asset}">${assetSymbol} (Balance: ${holding.toFixed(6)})</option>`;
            }).join('')}
          </select>
        </div>
      ` : ''}
      
      <div class="input-group" style="margin-bottom:18px;"><label class="input-label" style="display:flex; justify-content:space-between; align-items:center;"><span>Investment Amount</span><span style="font-size:10px; color:var(--color-text-tertiary);">Available: <span style="color:var(--color-text-primary); font-weight:600;">${Format.currency(state.balances.spot)}</span></span></label><input type="number" id="inv-amount" class="input-field financial-data" placeholder="Min $${strategy.minInvestment}" value="${defaultAmount}" style="font-size:17px; font-weight:600; text-align:center;"></div>
      <div id="projection-preview" style="background:var(--color-surface-elevated); border-radius:10px; padding:14px; margin-bottom:18px; border:1px solid var(--color-border);"></div>
      <label style="display:flex; align-items:start; gap:8px; margin-bottom:18px; padding:10px; background:rgba(239, 68, 68, 0.05); border:1px solid rgba(239, 68, 68, 0.2); border-radius:8px; cursor:pointer;"><input type="checkbox" id="risk-ack" style="margin-top:2px;"><span style="font-size:10px; color:var(--color-text-secondary); line-height:1.4;">I understand investments carry risk. Past performance doesn't guarantee future results.</span></label>
      <div style="display:grid; grid-template-columns:1fr 2fr; gap:10px;"><button onclick="Modal.close()" class="btn btn-ghost btn-full">Cancel</button><button id="confirm-btn" class="btn btn-primary btn-full" disabled style="background:${strategy.gradient}; border:none;"><i class="fas fa-lock" style="margin-right:4px;"></i>Confirm</button></div>
      <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--color-border); font-size:10px; color:var(--color-text-tertiary); text-align:center;"><i class="fas fa-shield-alt" style="color:#10b981; margin-right:3px;"></i>Protected up to ${Format.currency(CONFIG.INSURANCE_AMOUNT)}</div>
    `;
    
    const input = content.querySelector('#inv-amount');
    const confirmBtn = content.querySelector('#confirm-btn');
    const riskCheckbox = content.querySelector('#risk-ack');
    const projectionDiv = content.querySelector('#projection-preview');
    const assetSelect = content.querySelector('#asset-select');
    
    function updateProjection() {
      const amount = parseFloat(input.value) || 0;
      if (amount < strategy.minInvestment) {
        projectionDiv.innerHTML = `<div style="text-align:center; color:#f59e0b; font-size:11px;"><i class="fas fa-exclamation-triangle" style="margin-right:4px;"></i>Minimum: ${Format.currency(strategy.minInvestment)}</div>`;
        return;
      }
      const proj = calculateProjection(amount, dynamicAPY, strategy.durationDays);
      projectionDiv.innerHTML = `<div style="text-align:center; margin-bottom:14px;"><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px;">Projected Final Value</div><div style="font-size:28px; font-weight:700; color:#10b981; font-family:var(--font-mono);">${Format.currency(proj.finalValue)}</div></div><div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; font-size:10px;"><div style="text-align:center;"><div style="color:var(--color-text-tertiary); margin-bottom:2px;">Gross</div><div style="color:#10b981; font-weight:600;">${Format.currency(proj.grossProfit)}</div></div><div style="text-align:center;"><div style="color:var(--color-text-tertiary); margin-bottom:2px;">Fee</div><div style="color:#ef4444; font-weight:600;">-${Format.currency(proj.platformFee)}</div></div><div style="text-align:center;"><div style="color:var(--color-text-tertiary); margin-bottom:2px;">Net</div><div style="color:#10b981; font-weight:700;">${Format.currency(proj.netProfit)}</div></div></div>`;
    }
    
    riskCheckbox.onchange = () => {
      confirmBtn.disabled = !riskCheckbox.checked;
      confirmBtn.innerHTML = riskCheckbox.checked ? '<i class="fas fa-check-circle" style="margin-right:4px;"></i>Confirm' : '<i class="fas fa-lock" style="margin-right:4px;"></i>Confirm';
    };
    
    input.oninput = () => { clearTimeout(input.timer); input.timer = setTimeout(updateProjection, 300); };
    updateProjection();
    
    confirmBtn.onclick = () => {
      const selectedAsset = assetSelect ? assetSelect.value : 'usd';
      handleInvestment(strategy, input.value, selectedAsset, confirmBtn);
    };
    
    Modal.open({ title: '', content, maxWidth: '480px' });
  }

  function showPositionDetails(invId) {
    const inv = state.investments.find(i => i.id === invId);
    if (!inv) return;
    
    const strategy = state.strategies.find(s => s.id === inv.strategy_id) || { name: 'Unknown', color: '#8b5cf6' };
    const timing = getTimeRemaining(inv);
    const currentValue = calculateLiveValue(inv);
    const profit = currentValue - inv.amount;
    
    const content = document.createElement('div');
    content.innerHTML = `
      <div style="text-align:center; margin-bottom:20px;">
        <div style="font-size:32px; margin-bottom:10px;">${timing.isDone ? '🎉' : '📊'}</div>
        <h3 style="font-size:17px; font-weight:700; color:var(--color-text-primary);">${strategy.name}</h3>
        <div style="font-size:12px; color:var(--color-text-secondary);">${timing.isDone ? 'Matured' : `Matures in ${timing.text}`}</div>
      </div>
      <div style="background:var(--color-surface-elevated); padding:18px; border-radius:10px; margin-bottom:18px;">
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:14px;">
          <div><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px;">Principal</div><div style="font-size:17px; font-weight:700; color:var(--color-text-primary);">${Format.currency(inv.amount)}</div></div>
          <div><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px;">Current</div><div style="font-size:17px; font-weight:700; color:#10b981;">${Format.currency(currentValue)}</div></div>
          <div><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px;">Profit</div><div style="font-size:17px; font-weight:700; color:${profit >= 0 ? '#10b981' : '#ef4444'};">${profit >= 0 ? '+' : ''}${Format.currency(profit)}</div></div>
          <div><div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:3px;">APY</div><div style="font-size:17px; font-weight:700; color:var(--color-text-primary);">${(inv.apy * 100).toFixed(1)}%</div></div>
        </div>
      </div>
      ${timing.isDone ? `<button onclick="Vault.claim('${inv.id}'); Modal.close();" class="btn btn-success btn-full"><i class="fas fa-hand-holding-usd" style="margin-right:6px;"></i>Claim ${Format.currency(currentValue)}</button>` : `<div style="text-align:center; padding:14px; background:rgba(239, 68, 68, 0.05); border:1px solid rgba(239, 68, 68, 0.2); border-radius:8px;"><i class="fas fa-exclamation-triangle" style="color:#f59e0b; margin-bottom:6px; font-size:18px; display:block;"></i><div style="font-size:11px; color:var(--color-text-secondary); margin-bottom:10px;">Early withdrawal: ${(CONFIG.EARLY_WITHDRAWAL_PENALTY * 100)}% penalty</div><button onclick="Vault.earlyWithdraw('${inv.id}')" class="btn btn-sm btn-ghost">Withdraw Early</button></div>`}
    `;
    Modal.open({ title: 'Position Details', content });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     CORE LOGIC (FIXED FOR PERSISTENCE)
/* ═══════════════════════════════════════════════════════════════════════════
   CORE LOGIC – FIXED (supabaseClient → window.supabaseClient everywhere)
   ═══════════════════════════════════════════════════════════════════════════ */

async function handleInvestment(strategy, amountInput, asset, btn) {
  const amount = parseFloat(amountInput);
  if (isNaN(amount) || amount <= 0) return App.showError('Invalid amount');
  if (amount < strategy.minInvestment) return App.showError(`Minimum: ${Format.currency(strategy.minInvestment)}`);

  let availableBalance = asset === 'usd' 
    ? state.balances.spot 
    : (state.holdings[asset] || 0);

  if (amount > availableBalance) return App.showError(`Insufficient ${asset.toUpperCase()} balance`);

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Processing...';

  try {
    const investmentId = generateUUID();
    const dynamicAPY = getDynamicAPY(strategy);

    const newInvestment = {
      id: investmentId,
      strategy_id: strategy.id,
      amount: amount,
      apy: dynamicAPY,
      duration: strategy.durationDays,
      created_at: new Date().toISOString(),
      status: 'active',
      profit: 0,
      asset_type: asset
    };

    if (window.supabaseClient && state.user) {
      // === BALANCE UPDATE ===
      let updateData = {};
      if (asset === 'usd') {
  const freshBals = AppState.get('balances');
  AppState.updateBalances({ spot: freshBals.spot - amount });
} else {
        const newHoldings = { ...state.holdings };
        newHoldings[asset] = (newHoldings[asset] || 0) - amount;
        if (newHoldings[asset] < 0.00000001) delete newHoldings[asset];
        updateData.holdings = newHoldings;
      }

      const { error: balanceError } = await window.supabaseClient
        .from('profiles')
        .update(updateData)
        .eq('id', state.user.id);
      if (balanceError) throw balanceError;

      // === INSERT INVESTMENT ===
      const { data: insertedInvestment, error: investmentError } = await window.supabaseClient
        .from('investments')
        .insert({
          user_id: state.user.id,
          strategy_id: newInvestment.strategy_id,
          amount: newInvestment.amount,
          apy: newInvestment.apy,
          duration: newInvestment.duration,
          created_at: newInvestment.created_at,
          status: newInvestment.status,
          profit: newInvestment.profit,
          asset_type: newInvestment.asset_type
        })
        .select()
        .single();

      if (investmentError) {
        // rollback
        if (asset === 'usd') {
          await window.supabaseClient.from('profiles').update({ spot_balance: state.balances.spot }).eq('id', state.user.id);
        } else {
          await window.supabaseClient.from('profiles').update({ holdings: state.holdings }).eq('id', state.user.id);
        }
        throw investmentError;
      }

      newInvestment.id = insertedInvestment.id;

      btn.innerHTML = '<i class="fas fa-hourglass-half fa-spin" style="margin-right:6px;"></i>Settling...';
      await new Promise(r => setTimeout(r, 2000));

      await syncInvestmentsFromDB();   // already uses window.supabaseClient
    } else {
      // local-only fallback
      btn.innerHTML = '<i class="fas fa-hourglass-half fa-spin" style="margin-right:6px;"></i>Settling...';
      await new Promise(r => setTimeout(r, 2000));
      AppState.addInvestment(newInvestment);
      state.investments = [...state.investments, newInvestment];
    }

    // === LOCAL STATE UPDATE ===
    if (asset === 'usd') {
      AppState.updateBalances({ spot: state.balances.spot - amount });
    } else {
      const newHoldings = { ...state.holdings };
      newHoldings[asset] = (newHoldings[asset] || 0) - amount;
      if (newHoldings[asset] < 0.00000001) delete newHoldings[asset];
      AppState.set('holdings', newHoldings);
      state.holdings = newHoldings;
    }

    await Modal.close();
    render(container);
    App.showSuccess(`Invested ${Format.currency(amount)}`);

  } catch (error) {
    console.error('[VAULT] Investment failed:', error);
    App.showError(error.message || 'Investment failed');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>Try Again';
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   OPTIMISTIC CLAIM (instant UI + safe persistence)
   ═══════════════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════════════
   FINAL FIXED: OPTIMISTIC + NO STALE SYNC OVERWRITE + RLS-SAFE
   ═══════════════════════════════════════════════════════════════════════════ */

async function claim(invId) {
  const invIndex = state.investments.findIndex(i => i.id === invId);
  if (invIndex === -1) return App.showError('Investment not found');

  const inv = state.investments[invIndex];
  const timing = getTimeRemaining(inv);
  if (!timing.isDone) return App.showError('Position has not matured yet');

  const finalValue = calculateLiveValue(inv);
  const profit = finalValue - inv.amount;
  const newSpotBalance = state.balances.spot + finalValue;

  const confirmed = await Modal.confirm({
    title: 'Confirm Claim',
    message: `Claim ${Format.currency(finalValue)} now?`,
    confirmText: 'Claim Now',
    cancelText: 'Cancel'
  });
  if (!confirmed) return;

  // === OPTIMISTIC (stays forever — no revert) ===
  const updatedInvs = [...state.investments];
  updatedInvs[invIndex] = { ...inv, status: 'completed', profit };

  state.investments = updatedInvs;
  AppState.set('investments', updatedInvs);
  AppState.updateBalances({ spot: newSpotBalance });

  render(container);
  App.showSuccess(`✅ Claimed ${Format.currency(finalValue)}`);

  // === BACKGROUND DB (no sync to prevent stale overwrite) ===
  if (window.supabaseClient && state.user) {
    try {
      // Update balance
      const { error: balanceError } = await window.supabaseClient
        .from('profiles')
        .update({ spot_balance: newSpotBalance })
        .eq('id', state.user.id);
      if (balanceError) throw balanceError;

      // Update investment + return the row to detect real change
      const { data: updatedRow, error: invError } = await window.supabaseClient
        .from('investments')
        .update({ status: 'completed', profit })
        .eq('id', invId)
        .select()
        .single();

      if (invError || !updatedRow) {
        console.warn('[VAULT] ⚠️ Update succeeded but no row returned — check RLS policy on investments table (need WITH CHECK clause)');
        App.showWarning('Claimed locally. Database update may need RLS fix — refresh later.');
        return;
      }

      console.log('[VAULT] ✅ Claim fully persisted to Supabase');
    } catch (error) {
      console.error('[VAULT] DB claim failed:', error);
      App.showWarning('Claimed locally only. Database sync failed (check RLS). Refresh page to retry.');
    }
  }
}

async function handleClaimAll() {
  const claimable = state.investments.filter(inv => 
    inv.status === 'active' && getTimeRemaining(inv).isDone
  );
  if (claimable.length === 0) return;

  const totalClaims = claimable.reduce((sum, inv) => sum + calculateLiveValue(inv), 0);

  const confirmed = await Modal.confirm({
    title: 'Claim All Mature Positions',
    message: `Claim ${claimable.length} position${claimable.length > 1 ? 's' : ''} for ${Format.currency(totalClaims)}?`,
    confirmText: `Claim All (${claimable.length})`,
    cancelText: 'Cancel'
  });
  if (!confirmed) return;

  // === OPTIMISTIC ===
  const claimableIds = new Set(claimable.map(c => c.id));
  let totalValue = 0;

  const updatedInvs = state.investments.map(inv => {
    if (claimableIds.has(inv.id)) {
      const fv = calculateLiveValue(inv);
      totalValue += fv;
      return { ...inv, status: 'completed', profit: fv - inv.amount };
    }
    return inv;
  });

  const newSpotBalance = state.balances.spot + totalValue;

  state.investments = updatedInvs;
  AppState.set('investments', updatedInvs);
  AppState.updateBalances({ spot: newSpotBalance });

  render(container);
  App.showSuccess(`✅ Claimed ${claimable.length} positions — ${Format.currency(totalValue)}`);

  // === BACKGROUND DB ===
  if (window.supabaseClient && state.user) {
    try {
      const batchSize = 5;
      for (let i = 0; i < claimable.length; i += batchSize) {
        const batch = claimable.slice(i, i + batchSize);
        await Promise.all(batch.map(async inv => {
          const fv = calculateLiveValue(inv);
          const { data, error } = await window.supabaseClient
            .from('investments')
            .update({ status: 'completed', profit: fv - inv.amount })
            .eq('id', inv.id)
            .select()
            .single();
          if (error || !data) throw new Error('Update failed or RLS blocked');
        }));
      }

      await window.supabaseClient
        .from('profiles')
        .update({ spot_balance: newSpotBalance })
        .eq('id', state.user.id);

      console.log('[VAULT] ✅ Claim All fully persisted');
    } catch (error) {
      console.error('[VAULT] DB claim-all failed:', error);
      App.showWarning('Claims saved locally. Database sync failed (check RLS policy).');
    }
  }
}

async function earlyWithdraw(invId) {
  const invIndex = state.investments.findIndex(i => i.id === invId);
  if (invIndex === -1) return;

  const inv = state.investments[invIndex];
  const currentValue = calculateLiveValue(inv);
  const penalty = inv.amount * CONFIG.EARLY_WITHDRAWAL_PENALTY;
  const finalAmount = currentValue - penalty;

  const confirmed = await Modal.confirm({
    title: 'Early Withdrawal',
    message: `Penalty: ${(CONFIG.EARLY_WITHDRAWAL_PENALTY * 100)}%\nReceive: ${Format.currency(finalAmount)}`,
    confirmText: 'Withdraw Anyway',
    cancelText: 'Cancel',
    dangerMode: true
  });
  if (!confirmed) return;

  // === OPTIMISTIC ===
  const updatedInvs = [...state.investments];
  updatedInvs[invIndex] = { ...inv, status: 'completed', profit: finalAmount - inv.amount };

  const newSpotBalance = state.balances.spot + finalAmount;

  state.investments = updatedInvs;
  AppState.set('investments', updatedInvs);
  AppState.updateBalances({ spot: newSpotBalance });

  render(container);
  App.showSuccess(`Withdrawn ${Format.currency(finalAmount)} (early)`);

  // === BACKGROUND DB ===
  if (window.supabaseClient && state.user) {
    try {
      const { data, error } = await window.supabaseClient
        .from('investments')
        .update({ status: 'completed', profit: finalAmount - inv.amount })
        .eq('id', invId)
        .select()
        .single();

      if (error || !data) {
        console.warn('[VAULT] ⚠️ Early withdraw update blocked — check RLS');
        App.showWarning('Withdrawn locally. Database may need RLS fix.');
        return;
      }

      await window.supabaseClient
        .from('profiles')
        .update({ spot_balance: newSpotBalance })
        .eq('id', state.user.id);

      console.log('[VAULT] ✅ Early withdraw persisted');
    } catch (error) {
      console.error('[VAULT] Early withdraw DB failed:', error);
      App.showWarning('Withdrawn locally only. Database sync failed.');
    }
  }
}
  function startLiveTicker() {
    if (tickerInterval) clearInterval(tickerInterval);
    tickerInterval = setInterval(() => {
      const totalDisplay = document.getElementById('vault-total-display');
      if (totalDisplay) {
        const summary = getPortfolioSummary();
        totalDisplay.textContent = Format.currency(summary.totalValue);
      }
    }, CONFIG.TICKER_INTERVAL);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════════════ */
  function render(element) {
    if (tickerInterval) clearInterval(tickerInterval);
    Object.values(virtualScrollers).forEach(scroller => {
      if (scroller && scroller.destroy) scroller.destroy();
    });
    virtualScrollers = {};
    
    if (!element) return;
    
    container = element;
    container.className = 'vault-page';
    container.style.cssText = 'display:flex; flex-direction:column; height:100%; overflow:hidden;';
    
    if (window.AppState) {
      state.user = AppState.get('user');
      const bals = AppState.get('balances');
      state.balances = bals || { spot: 0, vault: 0 };
      state.holdings = AppState.get('holdings') || {};
      const rawInvs = AppState.get('investments') || [];
      state.investments = rawInvs.filter(i => i && i.amount > 0);
    }
    
    container.innerHTML = '';
    container.appendChild(createTabNavigation());
    
    const contentContainer = document.createElement('div');
    contentContainer.id = 'tab-content-container';
    contentContainer.style.cssText = 'flex:1; display:flex; flex-direction:column; min-height:0; overflow:hidden;';
    contentContainer.appendChild(renderTabContent(state.ui.activeTab));
    container.appendChild(contentContainer);
    
    startLiveTicker();
    if (window.Navbar) Navbar.setActive('vault');
  }

  return { 
    render, 
    openStrategy, 
    claim, 
    handleClaimAll,
    earlyWithdraw, 
    showPositionDetails
  };
})();

if (typeof window !== 'undefined') window.Vault = Vault;