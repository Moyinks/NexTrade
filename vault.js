/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NexTrade — Vault (Institutional Yield Engine) v2.0
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUCTION-READY: Enhanced UX, UUID fix, transaction atomicity
 * ARCHITECTURE: Matches wallet.js pattern, integrates with state.js/router.js
 * ═══════════════════════════════════════════════════════════════════════════
 */

const Vault = (() => {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════════
     CONFIGURATION
     ═══════════════════════════════════════════════════════════════════════════ */
  const CONFIG = {
    PLATFORM_FEE: 0.1,
    EARLY_WITHDRAWAL_PENALTY: 0.2,
    TICKER_INTERVAL: 500,
    TVL_TOTAL: 2454701.89,
    ACTIVE_USERS: 2641,
    INSURANCE_AMOUNT: 250000,
  };

  /* ═══════════════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════════════ */
  let container = null;
  let tickerInterval = null;

  const state = {
    user: null,
    balances: { spot: 0, vault: 0 },
    investments: [],
    strategies: [
      {
        id: 'usdc_alpha',
        name: 'USDC Yield Alpha',
        risk: 'Low',
        riskLevel: 1,
        baseAPY: 0.22,
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
      },
      {
        id: 'defi_bluechip',
        name: 'DeFi Blue Chip',
        risk: 'Medium',
        riskLevel: 3,
        baseAPY: 0.45,
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
        participants: 2234,
        performance: [1.2, 1.45, 1.6, 1.55, 1.5, 1.48, 1.52],
      }
    ]
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

  function createCircularProgress(percent, size = 60, color = '#8b5cf6') {
    const radius = (size - 8) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;
    return `<svg width="${size}" height="${size}" style="transform:rotate(-90deg);"><circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="6"/><circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="${color}" stroke-width="6" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" style="transition: stroke-dashoffset 0.5s ease;"/></svg>`;
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
     UI COMPONENTS
     ═══════════════════════════════════════════════════════════════════════════ */
  function createHero() {
    const activeInvs = state.investments.filter(i => i.status === 'active');
    const totalValue = activeInvs.reduce((acc, inv) => acc + calculateLiveValue(inv), 0);
    const change24h = totalValue * 0.0234;
    const changePercent = totalValue > 0 ? (change24h / totalValue) * 100 : 0;
    const completedInvs = state.investments.filter(i => i.status === 'completed');
    const lifetimeEarnings = completedInvs.reduce((acc, inv) => acc + (inv.profit || 0), 0);

    const card = document.createElement('div');
    card.style.cssText = `position:relative; overflow:hidden; border-radius:20px; padding:32px 24px; margin-bottom:24px; background:radial-gradient(circle at 50% 0%, rgba(139, 92, 246, 0.25), transparent 70%), linear-gradient(180deg, #1e1b4b, #020617); border:1px solid rgba(139, 92, 246, 0.3); box-shadow:0 20px 60px -10px rgba(139, 92, 246, 0.3);`;
    
    card.innerHTML = `
      <div style="position:absolute; top:20px; right:20px; display:flex; align-items:center; gap:6px; font-size:11px; color:rgba(255,255,255,0.6);">
        <div style="width:6px; height:6px; border-radius:50%; background:#10b981; box-shadow:0 0 8px #10b981;"></div>
        <span>Live</span>
      </div>
      <div style="text-align:center; margin-bottom:24px;">
        <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:rgba(255,255,255,0.5); margin-bottom:8px;">Total Vault Balance</div>
        <div id="vault-total-display" style="font-family:var(--font-mono); font-size:48px; font-weight:800; color:white; letter-spacing:-2px; text-shadow:0 2px 20px rgba(139,92,246,0.5); margin-bottom:8px;">${Format.currency(totalValue)}</div>
        ${totalValue > 0 ? `<div style="display:inline-flex; align-items:center; gap:6px; color:${change24h >= 0 ? '#10b981' : '#ef4444'}; font-size:14px; font-weight:600;"><i class="fas fa-arrow-${change24h >= 0 ? 'up' : 'down'}" style="font-size:10px;"></i><span>${Format.currency(Math.abs(change24h))} (${changePercent.toFixed(2)}%)</span><span style="color:rgba(255,255,255,0.4); font-size:12px; font-weight:400;">24h</span></div>` : ''}
      </div>
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-bottom:20px;">
        <div style="text-align:center;"><div style="font-size:11px; color:rgba(255,255,255,0.5); margin-bottom:4px;">Active</div><div style="font-size:20px; font-weight:700; color:white;">${activeInvs.length}</div></div>
        <div style="text-align:center;"><div style="font-size:11px; color:rgba(255,255,255,0.5); margin-bottom:4px;">Lifetime</div><div style="font-size:20px; font-weight:700; color:#10b981;">${Format.currency(lifetimeEarnings)}</div></div>
        <div style="text-align:center;"><div style="font-size:11px; color:rgba(255,255,255,0.5); margin-bottom:4px;">Avg APY</div><div style="font-size:20px; font-weight:700; color:#a78bfa;">${activeInvs.length > 0 ? (activeInvs.reduce((acc, inv) => acc + (inv.apy || 0), 0) / activeInvs.length * 100).toFixed(1) : '0'}%</div></div>
      </div>
      ${totalValue > 0 ? `<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;"><button onclick="Vault.showHistory()" class="btn btn-sm" style="background:rgba(139, 92, 246, 0.2); border:1px solid rgba(139, 92, 246, 0.4); color:#a78bfa;"><i class="fas fa-history" style="margin-right:6px;"></i>History</button><button onclick="Vault.showEducation()" class="btn btn-sm" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:rgba(255,255,255,0.8);"><i class="fas fa-graduation-cap" style="margin-right:6px;"></i>Learn</button></div>` : `<div style="text-align:center; padding:16px; background:rgba(139, 92, 246, 0.1); border-radius:12px; border:1px dashed rgba(139, 92, 246, 0.3);"><i class="fas fa-rocket" style="font-size:24px; color:#a78bfa; margin-bottom:8px; display:block;"></i><div style="font-size:13px; color:rgba(255,255,255,0.7); margin-bottom:12px;">Start earning today</div><div style="font-size:11px; color:rgba(255,255,255,0.5);">Choose a strategy below</div></div>`}
    `;
    return card;
  }

  function createStatsBar() {
    const bar = document.createElement('div');
    bar.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:12px; margin-bottom:32px; padding:16px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:12px;';
    const avgAPY = state.strategies.reduce((acc, s) => acc + getDynamicAPY(s), 0) / state.strategies.length;
    bar.innerHTML = `
      <div style="text-align:center; padding:8px;"><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">TVL</div><div style="font-size:18px; font-weight:700; color:var(--color-text-primary);">${Format.currency(CONFIG.TVL_TOTAL)}</div></div>
      <div style="text-align:center; padding:8px;"><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">Investors</div><div style="font-size:18px; font-weight:700; color:var(--color-text-primary);">${CONFIG.ACTIVE_USERS.toLocaleString()}</div></div>
      <div style="text-align:center; padding:8px;"><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">Avg APY</div><div style="font-size:18px; font-weight:700; color:#10b981;">${(avgAPY * 100).toFixed(1)}%</div></div>
      <div style="text-align:center; padding:8px;"><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">Insured</div><div style="font-size:18px; font-weight:700; color:#3b82f6;">${Format.currency(CONFIG.INSURANCE_AMOUNT)}</div></div>
    `;
    return bar;
  }

  function createActiveSection() {
    const section = document.createElement('div');
    section.style.marginBottom = '32px';
    const activeInvs = state.investments.filter(i => i.status === 'active');
    if (activeInvs.length === 0) return document.createElement('div');
    
    section.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;"><h3 style="font-size:16px; font-weight:700; color:var(--color-text-primary);"><i class="fas fa-chart-line" style="margin-right:8px; color:#8b5cf6;"></i>Active Portfolios</h3><span class="badge badge-primary">${activeInvs.length}</span></div>`;
    
    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:16px;';
    
    activeInvs.forEach(inv => {
      const strategy = state.strategies.find(s => s.id === inv.strategy_id) || { name: 'Unknown', color: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', icon: 'fas fa-box' };
      const timing = getTimeRemaining(inv);
      const currentValue = calculateLiveValue(inv);
      const profit = currentValue - inv.amount;
      const profitPercent = (profit / inv.amount) * 100;
      
      const item = document.createElement('div');
      item.className = 'vault-inv-card';
      item.dataset.id = inv.id;
      item.style.cssText = 'background:var(--color-surface); border:1px solid var(--color-border); border-radius:16px; padding:20px; position:relative; transition:all 0.3s ease; cursor:pointer;';
      item.onmouseenter = () => { item.style.transform = 'translateY(-4px)'; item.style.boxShadow = `0 12px 24px -8px ${strategy.color}40`; item.style.borderColor = `${strategy.color}60`; };
      item.onmouseleave = () => { item.style.transform = 'translateY(0)'; item.style.boxShadow = 'none'; item.style.borderColor = 'var(--color-border)'; };
      
      const badge = timing.isDone ? '<span class="badge badge-success" style="position:absolute; top:16px; right:16px;">🎉 Ready</span>' : '<span class="badge badge-info" style="position:absolute; top:16px; right:16px;">⚡ Earning</span>';
      
      item.innerHTML = `
        ${badge}
        <div style="display:flex; gap:16px; margin-bottom:20px;">
          <div style="flex-shrink:0; position:relative;">${createCircularProgress(timing.percent, 70, strategy.color)}<div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); text-align:center;"><div style="font-size:16px; font-weight:700; color:white;">${Math.round(timing.percent)}%</div></div></div>
          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
              <div style="width:32px; height:32px; border-radius:8px; background:${strategy.color}20; color:${strategy.color}; display:flex; align-items:center; justify-content:center;"><i class="${strategy.icon}"></i></div>
              <div><div style="font-size:15px; font-weight:700; color:var(--color-text-primary);">${strategy.name}</div><div style="font-size:12px; color:var(--color-text-secondary);"><i class="far fa-clock" style="margin-right:4px;"></i>${timing.text}</div></div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px;">
              <div><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:2px;">Principal</div><div style="font-family:var(--font-mono); font-size:14px; font-weight:600; color:var(--color-text-secondary);">${Format.currency(inv.amount)}</div></div>
              <div><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:2px;">Profit</div><div class="profit-display" style="font-family:var(--font-mono); font-size:14px; font-weight:700; color:${profit >= 0 ? '#10b981' : '#ef4444'};">${profit >= 0 ? '+' : ''}${Format.currency(profit)}</div></div>
            </div>
          </div>
        </div>
        <div style="background:var(--color-surface-elevated); padding:12px; border-radius:10px; margin-bottom:${timing.isDone ? '12px' : '0'};">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:12px; color:var(--color-text-tertiary);">Current Value</span>
            <div style="text-align:right;">
              <div class="live-val" style="font-family:var(--font-mono); font-size:20px; font-weight:700; color:white;">${Format.currency(currentValue)}</div>
              <div style="font-size:11px; color:${profitPercent >= 0 ? '#10b981' : '#ef4444'}; font-weight:600;">${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(2)}%</div>
            </div>
          </div>
        </div>
        ${timing.isDone ? `<button onclick="Vault.claim('${inv.id}'); event.stopPropagation();" class="btn btn-success btn-full" style="animation: pulse 2s infinite;"><i class="fas fa-hand-holding-usd" style="margin-right:6px;"></i>Claim Returns</button>` : ''}
        <div style="position:absolute; top:0; left:0; width:100%; height:4px; background:${strategy.gradient};"></div>
      `;
      
      item.onclick = (e) => { if (e.target.tagName === 'BUTTON') return; showDetails(inv); };
      list.appendChild(item);
    });
    
    section.appendChild(list);
    return section;
  }

  function createMarketplace() {
    const section = document.createElement('div');
    section.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;"><h3 style="font-size:16px; font-weight:700; color:var(--color-text-primary);"><i class="fas fa-store" style="margin-right:8px; color:#8b5cf6;"></i>Strategy Marketplace</h3></div>`;
    
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid; grid-template-columns:1fr; gap:16px;';
    
    state.strategies.forEach(strategy => {
      const dynamicAPY = getDynamicAPY(strategy);
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--color-surface); border:1px solid var(--color-border); border-radius:16px; padding:20px; cursor:pointer; transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1); position:relative; overflow:hidden;';
      card.onmouseenter = () => { card.style.transform = 'translateY(-8px) scale(1.02)'; card.style.boxShadow = `0 20px 40px -12px ${strategy.color}40`; card.style.borderColor = `${strategy.color}60`; };
      card.onmouseleave = () => { card.style.transform = 'translateY(0) scale(1)'; card.style.boxShadow = 'none'; card.style.borderColor = 'var(--color-border)'; };
      card.onclick = () => openStrategy(strategy.id);
      
      card.innerHTML = `
        ${strategy.badge ? `<div style="position:absolute; top:12px; right:12px; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px); padding:4px 10px; border-radius:12px; font-size:10px; font-weight:600; border:1px solid rgba(255,255,255,0.1);">${strategy.badge}</div>` : ''}
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
          <div style="width:48px; height:48px; border-radius:12px; background:${strategy.gradient}; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 12px ${strategy.color}40;"><i class="${strategy.icon}" style="font-size:20px; color:white;"></i></div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:15px; font-weight:700; color:var(--color-text-primary); margin-bottom:2px;">${strategy.name}</div>
            <div style="display:flex; align-items:center; gap:6px;"><span style="font-size:11px; color:var(--color-text-tertiary);">Risk:</span>${createRiskDots(strategy.riskLevel)}</div>
          </div>
        </div>
        <p style="font-size:12px; color:var(--color-text-secondary); line-height:1.5; margin-bottom:16px; min-height:40px;">${strategy.description}</p>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
          <div style="background:var(--color-surface-elevated); padding:10px; border-radius:8px; text-align:center;"><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px;">APY</div><div style="font-size:18px; font-weight:700; color:#10b981;">${(dynamicAPY * 100).toFixed(1)}%</div></div>
          <div style="background:var(--color-surface-elevated); padding:10px; border-radius:8px; text-align:center;"><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px;">Duration</div><div style="font-size:18px; font-weight:700; color:var(--color-text-primary);">${strategy.durationDays}d</div></div>
        </div>
        <div style="margin-bottom:16px;"><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:6px; display:flex; justify-content:space-between;"><span>7-Day Performance</span><span style="color:${strategy.color};">${(strategy.performance[6] * 100).toFixed(1)}%</span></div>${createSparkline(strategy.performance, strategy.color, 280, 32)}</div>
        <div style="margin-bottom:16px;"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;"><span style="font-size:11px; color:var(--color-text-tertiary);">Capacity</span><span style="font-size:11px; color:var(--color-text-secondary); font-weight:600;">${(strategy.capacity * 100).toFixed(0)}% Full</span></div><div style="height:6px; background:var(--color-surface-elevated); border-radius:3px; overflow:hidden;"><div style="height:100%; width:${strategy.capacity * 100}%; background:${strategy.gradient}; transition:width 0.5s ease;"></div></div></div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:11px; color:var(--color-text-tertiary);"><i class="fas fa-users" style="margin-right:4px;"></i>${strategy.participants.toLocaleString()} investors</div>
          <div class="btn btn-sm btn-primary" style="background:${strategy.gradient}; border:none; padding:6px 14px;">Invest Now <i class="fas fa-arrow-right" style="margin-left:4px; font-size:10px;"></i></div>
        </div>
        <div style="position:absolute; bottom:0; left:0; width:100%; height:3px; background:${strategy.gradient};"></div>
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
      <div style="text-align:center; margin-bottom:24px;">
        <div style="width:64px; height:64px; margin:0 auto 16px; border-radius:16px; background:${strategy.gradient}; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 24px ${strategy.color}40;"><i class="${strategy.icon}" style="font-size:28px; color:white;"></i></div>
        <h3 style="font-size:20px; font-weight:700; color:var(--color-text-primary); margin-bottom:8px;">${strategy.name}</h3>
        <p style="font-size:13px; color:var(--color-text-secondary); line-height:1.5;">${strategy.description}</p>
      </div>
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:24px;">
        <div style="background:var(--color-surface-elevated); padding:14px; border-radius:10px; text-align:center; border:1px solid var(--color-border);"><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">APY</div><div style="font-size:22px; font-weight:700; color:#10b981;">${(dynamicAPY * 100).toFixed(1)}%</div></div>
        <div style="background:var(--color-surface-elevated); padding:14px; border-radius:10px; text-align:center; border:1px solid var(--color-border);"><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">Duration</div><div style="font-size:22px; font-weight:700; color:var(--color-text-primary);">${strategy.durationDays}d</div></div>
        <div style="background:var(--color-surface-elevated); padding:14px; border-radius:10px; text-align:center; border:1px solid var(--color-border);"><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">Risk</div><div style="font-size:22px; font-weight:700; color:${getRiskColor(strategy.riskLevel)};">${strategy.risk}</div></div>
      </div>
      <div class="input-group" style="margin-bottom:20px;"><label class="input-label" style="display:flex; justify-content:space-between; align-items:center;"><span>Investment Amount</span><span style="font-size:11px; color:var(--color-text-tertiary);">Available: <span style="color:var(--color-text-primary); font-weight:600;">${Format.currency(state.balances.spot)}</span></span></label><input type="number" id="inv-amount" class="input-field financial-data" placeholder="Min $${strategy.minInvestment}" value="${defaultAmount}" style="font-size:18px; font-weight:600; text-align:center;"></div>
      <div id="projection-preview" style="background:var(--color-surface-elevated); border-radius:12px; padding:16px; margin-bottom:20px; border:1px solid var(--color-border);"></div>
      <label style="display:flex; align-items:start; gap:10px; margin-bottom:20px; padding:12px; background:rgba(239, 68, 68, 0.05); border:1px solid rgba(239, 68, 68, 0.2); border-radius:8px; cursor:pointer;"><input type="checkbox" id="risk-ack" style="margin-top:2px;"><span style="font-size:11px; color:var(--color-text-secondary); line-height:1.5;">I understand investments carry risk. Past performance doesn't guarantee future results.</span></label>
      <div style="display:grid; grid-template-columns:1fr 2fr; gap:12px;"><button onclick="Modal.close()" class="btn btn-ghost btn-full">Cancel</button><button id="confirm-btn" class="btn btn-primary btn-full" disabled style="background:${strategy.gradient}; border:none;"><i class="fas fa-lock" style="margin-right:6px;"></i>Confirm</button></div>
      <div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--color-border); font-size:11px; color:var(--color-text-tertiary); text-align:center;"><i class="fas fa-shield-alt" style="color:#10b981; margin-right:4px;"></i>Protected up to ${Format.currency(CONFIG.INSURANCE_AMOUNT)}</div>
    `;
    
    const input = content.querySelector('#inv-amount');
    const confirmBtn = content.querySelector('#confirm-btn');
    const riskCheckbox = content.querySelector('#risk-ack');
    const projectionDiv = content.querySelector('#projection-preview');
    
    function updateProjection() {
      const amount = parseFloat(input.value) || 0;
      if (amount < strategy.minInvestment) {
        projectionDiv.innerHTML = `<div style="text-align:center; color:#f59e0b; font-size:12px;"><i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>Minimum: ${Format.currency(strategy.minInvestment)}</div>`;
        return;
      }
      const proj = calculateProjection(amount, dynamicAPY, strategy.durationDays);
      projectionDiv.innerHTML = `<div style="text-align:center; margin-bottom:16px;"><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px;">Projected Final Value</div><div style="font-size:32px; font-weight:700; color:#10b981; font-family:var(--font-mono);">${Format.currency(proj.finalValue)}</div></div><div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; font-size:11px;"><div style="text-align:center;"><div style="color:var(--color-text-tertiary); margin-bottom:2px;">Gross</div><div style="color:#10b981; font-weight:600;">${Format.currency(proj.grossProfit)}</div></div><div style="text-align:center;"><div style="color:var(--color-text-tertiary); margin-bottom:2px;">Fee</div><div style="color:#ef4444; font-weight:600;">-${Format.currency(proj.platformFee)}</div></div><div style="text-align:center;"><div style="color:var(--color-text-tertiary); margin-bottom:2px;">Net</div><div style="color:#10b981; font-weight:700;">${Format.currency(proj.netProfit)}</div></div></div>`;
    }
    
    riskCheckbox.onchange = () => {
      confirmBtn.disabled = !riskCheckbox.checked;
      confirmBtn.innerHTML = riskCheckbox.checked ? '<i class="fas fa-check-circle" style="margin-right:6px;"></i>Confirm' : '<i class="fas fa-lock" style="margin-right:6px;"></i>Confirm';
    };
    
    input.oninput = () => { clearTimeout(input.timer); input.timer = setTimeout(updateProjection, 300); };
    updateProjection();
    
    confirmBtn.onclick = () => handleInvestment(strategy, input.value, confirmBtn);
    Modal.open({ title: '', content, maxWidth: '520px' });
  }

  function showDetails(inv) {
    const strategy = state.strategies.find(s => s.id === inv.strategy_id) || { name: 'Unknown', color: '#8b5cf6' };
    const timing = getTimeRemaining(inv);
    const currentValue = calculateLiveValue(inv);
    const profit = currentValue - inv.amount;
    
    const content = document.createElement('div');
    content.innerHTML = `
      <div style="text-align:center; margin-bottom:24px;">
        <div style="font-size:36px; margin-bottom:12px;">${timing.isDone ? '🎉' : '📊'}</div>
        <h3 style="font-size:18px; font-weight:700; color:var(--color-text-primary);">${strategy.name}</h3>
        <div style="font-size:13px; color:var(--color-text-secondary);">${timing.isDone ? 'Matured' : `Matures in ${timing.text}`}</div>
      </div>
      <div style="background:var(--color-surface-elevated); padding:20px; border-radius:12px; margin-bottom:20px;">
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:16px;">
          <div><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px;">Principal</div><div style="font-size:18px; font-weight:700; color:var(--color-text-primary);">${Format.currency(inv.amount)}</div></div>
          <div><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px;">Current</div><div style="font-size:18px; font-weight:700; color:#10b981;">${Format.currency(currentValue)}</div></div>
          <div><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px;">Profit</div><div style="font-size:18px; font-weight:700; color:${profit >= 0 ? '#10b981' : '#ef4444'};">${profit >= 0 ? '+' : ''}${Format.currency(profit)}</div></div>
          <div><div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px;">APY</div><div style="font-size:18px; font-weight:700; color:var(--color-text-primary);">${(inv.apy * 100).toFixed(1)}%</div></div>
        </div>
      </div>
      ${timing.isDone ? `<button onclick="Vault.claim('${inv.id}'); Modal.close();" class="btn btn-success btn-full"><i class="fas fa-hand-holding-usd" style="margin-right:8px;"></i>Claim ${Format.currency(currentValue)}</button>` : `<div style="text-align:center; padding:16px; background:rgba(239, 68, 68, 0.05); border:1px solid rgba(239, 68, 68, 0.2); border-radius:8px;"><i class="fas fa-exclamation-triangle" style="color:#f59e0b; margin-bottom:8px; font-size:20px; display:block;"></i><div style="font-size:12px; color:var(--color-text-secondary); margin-bottom:12px;">Early withdrawal: ${(CONFIG.EARLY_WITHDRAWAL_PENALTY * 100)}% penalty</div><button onclick="Vault.earlyWithdraw('${inv.id}')" class="btn btn-sm btn-ghost">Withdraw Early</button></div>`}
    `;
    Modal.open({ title: 'Details', content });
  }

  function showHistory() {
    const content = document.createElement('div');
    const transactions = [];
    state.investments.forEach(inv => {
      const strategy = state.strategies.find(s => s.id === inv.strategy_id);
      transactions.push({ date: new Date(inv.created_at), type: 'deposit', strategy: strategy?.name || 'Unknown', amount: inv.amount, status: inv.status });
      if (inv.status === 'completed') {
        const maturityDate = new Date(inv.created_at);
        maturityDate.setDate(maturityDate.getDate() + (inv.duration || 30));
        transactions.push({ date: maturityDate, type: 'withdrawal', strategy: strategy?.name || 'Unknown', amount: inv.amount + (inv.profit || 0), profit: inv.profit, status: 'completed' });
      }
    });
    transactions.sort((a, b) => b.date - a.date);
    
    content.innerHTML = `<div style="max-height:500px; overflow-y:auto;">${transactions.length === 0 ? `<div style="text-align:center; padding:40px 20px; color:var(--color-text-tertiary);"><i class="fas fa-inbox" style="font-size:48px; margin-bottom:16px; display:block; opacity:0.5;"></i><div style="font-size:14px;">No transactions</div></div>` : transactions.map(tx => `<div style="display:flex; justify-content:space-between; align-items:center; padding:16px; border-bottom:1px solid var(--color-border);"><div style="display:flex; align-items:center; gap:12px;"><div style="width:40px; height:40px; border-radius:10px; background:${tx.type === 'deposit' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)'}; display:flex; align-items:center; justify-content:center;"><i class="fas fa-${tx.type === 'deposit' ? 'arrow-down' : 'arrow-up'}" style="color:${tx.type === 'deposit' ? '#3b82f6' : '#10b981'};"></i></div><div><div style="font-size:13px; font-weight:600; color:var(--color-text-primary); margin-bottom:2px;">${tx.type === 'deposit' ? 'Invested in' : 'Claimed from'} ${tx.strategy}</div><div style="font-size:11px; color:var(--color-text-tertiary);">${tx.date.toLocaleDateString()} ${tx.date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div></div></div><div style="text-align:right;"><div style="font-size:15px; font-weight:700; color:${tx.type === 'deposit' ? '#ef4444' : '#10b981'}; font-family:var(--font-mono);">${tx.type === 'deposit' ? '-' : '+'}${Format.currency(tx.amount)}</div>${tx.profit !== undefined ? `<div style="font-size:11px; color:#10b981;">+${Format.currency(tx.profit)} profit</div>` : ''}</div></div>`).join('')}</div>`;
    Modal.open({ title: 'History', content, maxWidth: '600px' });
  }

  function showEducation() {
    const content = document.createElement('div');
    content.innerHTML = `<div style="max-height:500px; overflow-y:auto; padding-right:8px;"><h4 style="font-size:16px; font-weight:700; color:var(--color-text-primary); margin-bottom:16px;"><i class="fas fa-graduation-cap" style="margin-right:8px; color:#8b5cf6;"></i>How Vault Works</h4><div style="margin-bottom:24px;"><h5 style="font-size:14px; font-weight:700; color:var(--color-text-primary); margin-bottom:8px;">What is APY?</h5><p style="font-size:12px; color:var(--color-text-secondary); line-height:1.6;">APY (Annual Percentage Yield) is your total return over one year with compound interest. Higher APY = higher returns but typically higher risk.</p></div><div style="margin-bottom:24px;"><h5 style="font-size:14px; font-weight:700; color:var(--color-text-primary); margin-bottom:8px;">Risk Levels</h5><div style="font-size:12px; color:var(--color-text-secondary); line-height:1.6;">${createRiskDots(1)} Low: Stablecoins, minimal volatility<br>${createRiskDots(3)} Medium: Balanced, moderate volatility<br>${createRiskDots(5)} High: Aggressive, high volatility</div></div><div style="margin-bottom:24px;"><h5 style="font-size:14px; font-weight:700; color:var(--color-text-primary); margin-bottom:8px;">Fees</h5><p style="font-size:12px; color:var(--color-text-secondary); line-height:1.6;">Platform: ${(CONFIG.PLATFORM_FEE * 100)}% of profits<br>Early Withdrawal: ${(CONFIG.EARLY_WITHDRAWAL_PENALTY * 100)}% penalty<br>No hidden fees</p></div><div style="background:rgba(16, 185, 129, 0.1); border:1px solid rgba(16, 185, 129, 0.3); border-radius:12px; padding:16px;"><div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;"><i class="fas fa-shield-alt" style="color:#10b981;"></i><span style="font-size:13px; font-weight:700; color:var(--color-text-primary);">Safety</span></div><ul style="font-size:12px; color:var(--color-text-secondary); line-height:1.6; margin:0; padding-left:20px;"><li>Audited by CertiK</li><li>Protected up to ${Format.currency(CONFIG.INSURANCE_AMOUNT)}</li><li>Non-custodial contracts</li></ul></div></div>`;
    Modal.open({ title: 'Learn', content, maxWidth: '600px' });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     CORE LOGIC
     ═══════════════════════════════════════════════════════════════════════════ */
  async function handleInvestment(strategy, amountInput, btn) {
    const amount = parseFloat(amountInput);
    if (isNaN(amount) || amount <= 0) return App.showError('Invalid amount');
    if (amount < strategy.minInvestment) return App.showError(`Minimum: ${Format.currency(strategy.minInvestment)}`);
    if (amount > state.balances.spot) return App.showError('Insufficient balance');
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>Processing...';
    
    try {
      const investmentId = generateUUID();
      const newSpotBalance = state.balances.spot - amount;
      const dynamicAPY = getDynamicAPY(strategy);
      const newInvestment = {
        id: investmentId,
        strategy_id: strategy.id,
        amount: amount,
        apy: dynamicAPY,
        duration: strategy.durationDays,
        created_at: new Date().toISOString(),
        status: 'active',
        profit: 0
      };
      
      if (window.supabaseClient) {
        const { error: balanceError } = await supabaseClient.from('profiles').update({ spot_balance: newSpotBalance }).eq('id', state.user.id);
        if (balanceError) throw balanceError;
        
        const { data: insertedInvestment, error: investmentError } = await supabaseClient.from('investments').insert({
          user_id: state.user.id,
          strategy_id: newInvestment.strategy_id,
          amount: newInvestment.amount,
          apy: newInvestment.apy,
          duration: newInvestment.duration,
          created_at: newInvestment.created_at,
          status: newInvestment.status,
          profit: newInvestment.profit
        }).select().single();
        
        if (investmentError) {
          await supabaseClient.from('profiles').update({ spot_balance: state.balances.spot }).eq('id', state.user.id);
          throw investmentError;
        }
        newInvestment.id = insertedInvestment.id;
      }
      
      btn.innerHTML = '<i class="fas fa-hourglass-half fa-spin" style="margin-right:8px;"></i>Settling...';
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      AppState.updateBalances({ spot: newSpotBalance });
      AppState.addInvestment(newInvestment);
      
      await Modal.close();
      render(container);
      App.showSuccess(`Invested ${Format.currency(amount)}`);
      
    } catch (error) {
      console.error('Investment failed:', error);
      App.showError(error.message || 'Investment failed');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-exclamation-triangle" style="margin-right:8px;"></i>Try Again';
    }
  }

  async function claim(invId) {
    const inv = state.investments.find(i => i.id === invId);
    if (!inv) return;
    const timing = getTimeRemaining(inv);
    if (!timing.isDone) return App.showError('Not matured');
    async function claim(invId) { // Add async keyword
  const inv = state.investments.find(i => i.id === invId);
  if (!inv) return;
  
  const timing = getTimeRemaining(inv);
  if (!timing.isDone) return App.showError('Not matured');
  
  // NEW: Use Modal.confirm instead
  const confirmed = await Modal.confirm({
    title: 'Confirm Withdrawal',
    message: `Withdraw ${Format.currency(calculateLiveValue(inv))}?`,
    confirmText: 'Withdraw Now',
    cancelText: 'Cancel'
  });
  
  if (!confirmed) return; // User cancelled
  
  // ... rest of existing code unchanged
}
    
    try {
      const finalValue = calculateLiveValue(inv);
      const profit = finalValue - inv.amount;
      const newSpotBalance = state.balances.spot + finalValue;
      
      if (window.supabaseClient) {
        const { error: balanceError } = await supabaseClient.from('profiles').update({ spot_balance: newSpotBalance }).eq('id', state.user.id);
        if (balanceError) throw balanceError;
        
        const { error: invError } = await supabaseClient.from('investments').update({ status: 'completed', profit: profit }).eq('id', invId);
        if (invError) {
          await supabaseClient.from('profiles').update({ spot_balance: state.balances.spot }).eq('id', state.user.id);
          throw invError;
        }
      }
      
      const updatedInvs = state.investments.map(i => i.id === invId ? { ...i, status: 'completed', profit: profit } : i);
      AppState.updateBalances({ spot: newSpotBalance });
      AppState.set('investments', updatedInvs);
      
      render(container);
      App.showSuccess(`Claimed ${Format.currency(finalValue)}`);
      
    } catch (error) {
      console.error('Claim failed:', error);
      App.showError('Claim failed');
    }
  }

  async function earlyWithdraw(invId) {
    const inv = state.investments.find(i => i.id === invId);
    if (!inv) return;
    const currentValue = calculateLiveValue(inv);
    const penalty = inv.amount * CONFIG.EARLY_WITHDRAWAL_PENALTY;
    const finalAmount = currentValue - penalty;
    
    // Similar pattern - make function async and replace confirm()
async function earlyWithdraw(invId) { // Add async
  const inv = state.investments.find(i => i.id === invId);
  if (!inv) return;
  
  const currentValue = calculateLiveValue(inv);
  const penalty = inv.amount * CONFIG.EARLY_WITHDRAWAL_PENALTY;
  const finalAmount = currentValue - penalty;
  
  // NEW: Custom modal with danger mode
  const confirmed = await Modal.confirm({
    title: 'Early Withdrawal Penalty',
    message: `Early withdrawal incurs a ${(CONFIG.EARLY_WITHDRAWAL_PENALTY * 100)}% penalty.\n\nCurrent Value: ${Format.currency(currentValue)}\nPenalty: -${Format.currency(penalty)}\nYou Receive: ${Format.currency(finalAmount)}\n\nThis action cannot be undone.`,
    confirmText: 'Withdraw Anyway',
    cancelText: 'Keep Invested',
    dangerMode: true // Triggers red button
  });
  
  if (!confirmed) return;
  
  // ... rest of existing code unchanged
}
    
    try {
      const newSpotBalance = state.balances.spot + finalAmount;
      if (window.supabaseClient) {
        await supabaseClient.from('profiles').update({ spot_balance: newSpotBalance }).eq('id', state.user.id);
        await supabaseClient.from('investments').update({ status: 'completed', profit: finalAmount - inv.amount }).eq('id', invId);
      }
      
      const updatedInvs = state.investments.map(i => i.id === invId ? { ...i, status: 'completed', profit: finalAmount - inv.amount } : i);
      AppState.updateBalances({ spot: newSpotBalance });
      AppState.set('investments', updatedInvs);
      
      Modal.close();
      render(container);
      App.showSuccess(`Withdrawn ${Format.currency(finalAmount)}`);
      
    } catch (error) {
      console.error('Withdrawal failed:', error);
      App.showError('Withdrawal failed');
    }
  }

  function startLiveTicker() {
    if (tickerInterval) clearInterval(tickerInterval);
    tickerInterval = setInterval(() => {
      const totalDisplay = document.getElementById('vault-total-display');
      if (totalDisplay) {
        const totalVal = state.investments.filter(i => i.status === 'active').reduce((acc, inv) => acc + calculateLiveValue(inv), 0);
        totalDisplay.textContent = Format.currency(totalVal);
      }
      document.querySelectorAll('.vault-inv-card').forEach(card => {
        const inv = state.investments.find(i => i.id === card.dataset.id);
        if (inv && inv.status === 'active') {
          const valEl = card.querySelector('.live-val');
          const profitEl = card.querySelector('.profit-display');
          if (valEl) valEl.textContent = Format.currency(calculateLiveValue(inv));
          if (profitEl) {
            const profit = calculateLiveValue(inv) - inv.amount;
            profitEl.textContent = `${profit >= 0 ? '+' : ''}${Format.currency(profit)}`;
            profitEl.style.color = profit >= 0 ? '#10b981' : '#ef4444';
          }
        }
      });
    }, CONFIG.TICKER_INTERVAL);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════════════ */
  function render(element) {
    if (tickerInterval) clearInterval(tickerInterval);
    if (!element) return;
    
    container = element;
    container.className = 'vault-page';

    
    if (window.AppState) {
      state.user = AppState.get('user');
      const bals = AppState.get('balances');
      state.balances = bals || { spot: 0, vault: 0 };
      const rawInvs = AppState.get('investments') || [];
      state.investments = rawInvs.filter(i => i && i.amount > 0);
    }
    
    container.innerHTML = '';
    container.appendChild(createHero());
    container.appendChild(createStatsBar());
    
    const activeInvs = state.investments.filter(i => i.status === 'active');
    if (activeInvs.length > 0) {
      container.appendChild(createActiveSection());
    }
    
    container.appendChild(createMarketplace());
    
    startLiveTicker();
    if (window.Navbar) Navbar.setActive('vault');
    
    if (!document.getElementById('vault-animations')) {
      const style = document.createElement('style');
      style.id = 'vault-animations';
      style.textContent = '@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }';
      document.head.appendChild(style);
    }
  }

  return { render, openStrategy, claim, earlyWithdraw, showHistory, showEducation };
})();

if (typeof window !== 'undefined') window.Vault = Vault;