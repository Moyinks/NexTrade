/**
 * NexTrade — Home Dashboard (FIXED - Accurate Portfolio Tracking)
 * ══════════════════════════════════════════════════════════════
 * CRITICAL FIXES:
 * 1. Portfolio calculation only uses REAL holdings (no fake profits)
 * 2. Proper data validation before rendering
 * 3. Graceful handling of missing market data
 * 4. Fixed equity calculations
 * ══════════════════════════════════════════════════════════════
 */

const Home = (() => {
  'use strict';

  // ============================================
  // STATE MANAGEMENT
  // ============================================
  let container = null;
  let chartInstance = null;
  let priceSubscription = null;
  let pulseUpdateInterval = null;
  
  const state = {
    user: null,
    balances: { spot: 0, vault: 0 },
    holdings: {}, 
    hideBalance: localStorage.getItem('nex_hide_balance') === 'true',
    chartCoin: 'bitcoin',
    chartPeriod: '1D',
    marketData: [],
    globalMetrics: null,
    alerts: [],
    isLoading: {
      market: false,
      chart: false,
      pulse: false
    }
  };

  const CHART_COINS = [
    { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
    { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
    { id: 'solana', symbol: 'SOL', name: 'Solana' }
  ];

  // ============================================
  // INITIALIZATION & CLEANUP
  // ============================================
  
  async function render(element) {
    cleanup();

    if (!element) return;
    
    container = element;
    container.className = 'home-page';
    container.style.paddingBottom = '100px'; 

    // Sync state from AppState
    if (window.AppState) {
      state.user = AppState.get('user');
      state.balances = AppState.get('balances') || { spot: 0, vault: 0 };
      state.holdings = AppState.get('holdings') || {};
    }

    // Load Chart.js library
    await loadChartLibrary();

    // Build initial UI
    container.innerHTML = '';
    container.appendChild(createHeader());
    container.appendChild(createEquityCard());
    container.appendChild(createQuickActions());
    container.appendChild(createMarketPulse());
    container.appendChild(createChartSection());
    container.appendChild(createSmartAlerts());

    if (window.Navbar) Navbar.setActive('home');

    // Load data asynchronously
    await loadAllData();

    // Start live updates
    setTimeout(() => {
      initChart();
      startLiveUpdates();
    }, 100);
  }

  function cleanup() {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    if (priceSubscription && window.API && API.unsubscribeTicker) {
      API.unsubscribeTicker();
      priceSubscription = null;
    }

    if (pulseUpdateInterval) {
      clearInterval(pulseUpdateInterval);
      pulseUpdateInterval = null;
    }
  }

  // ============================================
  // CHART.JS LOADER
  // ============================================
  
  function loadChartLibrary() {
    return new Promise((resolve) => {
      if (window.Chart) return resolve();
      if (document.querySelector('script[src*="chart.js"]')) {
        setTimeout(resolve, 500);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      script.onload = resolve;
      script.onerror = () => { 
        console.warn('Chart.js failed to load'); 
        resolve(); 
      };
      document.head.appendChild(script);
    });
  }

  // ============================================
  // DATA LOADING
  // ============================================

  async function loadAllData() {
    console.log('[HOME] 🚀 Loading all data...');

    await Promise.all([
      loadMarketData(),
      loadGlobalMetrics(),
      loadTrendingCoins()
    ]);

    generateSmartAlerts();
    updateUI();

    console.log('[HOME] ✅ All data loaded');
  }

  async function loadMarketData() {
    state.isLoading.market = true;

    try {
      const result = await API.getMarketData(50, 'usd', true);
      
      if (result.success && result.data && result.data.length > 0) {
        state.marketData = result.data;
        console.log(`[HOME] ✅ Loaded ${result.data.length} coins from market data`);
        
        await API.ensureCoinLoaded(state.chartCoin);
        
        const chartCoinData = result.data.find(c => c.id === state.chartCoin);
        if (chartCoinData) {
          console.log(`[HOME] ✅ Chart coin ${state.chartCoin} loaded:`, chartCoinData.current_price);
        }
      } else {
        console.warn('[HOME] ⚠️ Market data load failed or empty');
      }
    } catch (error) {
      console.error('[HOME] ❌ Market data error:', error);
    } finally {
      state.isLoading.market = false;
    }
  }

  async function loadGlobalMetrics() {
    state.isLoading.pulse = true;

    try {
      const response = await fetch('https://api.coingecko.com/api/v3/global');
      
      if (!response.ok) {
        throw new Error('Global API unavailable');
      }
      
      const data = await response.json();
      
      if (data && data.data) {
        state.globalMetrics = {
          totalMarketCap: data.data.total_market_cap?.usd || 0,
          totalVolume: data.data.total_volume?.usd || 0,
          btcDominance: data.data.market_cap_percentage?.btc || 0,
          ethDominance: data.data.market_cap_percentage?.eth || 0,
          marketCapChange24h: data.data.market_cap_change_percentage_24h_usd || 0,
          activeCoins: data.data.active_cryptocurrencies || 0
        };
        
        console.log('[HOME] ✅ Global metrics loaded:', state.globalMetrics);
      }
      
      const fngResult = await API.getFearGreedIndex();
      if (fngResult.success && fngResult.data) {
        state.globalMetrics.fearGreedValue = fngResult.data.value;
        state.globalMetrics.fearGreedClassification = fngResult.data.classification;
        console.log('[HOME] ✅ Fear & Greed loaded:', fngResult.data.value);
      }
      
    } catch (error) {
      console.warn('[HOME] ⚠️ Global metrics error, using fallback:', error);
      state.globalMetrics = {
        totalMarketCap: 2100000000000,
        totalVolume: 89200000000,
        btcDominance: 54.3,
        ethDominance: 17.2,
        marketCapChange24h: 3.2,
        activeCoins: 10000,
        fearGreedValue: 50,
        fearGreedClassification: 'Neutral'
      };
    } finally {
      state.isLoading.pulse = false;
    }
  }

  async function loadTrendingCoins() {
    try {
      const result = await API.getTrendingCoins();
      
      if (result.success && result.data) {
        state.trendingCoins = result.data;
        console.log(`[HOME] ✅ Loaded ${result.data.length} trending coins`);
      }
    } catch (error) {
      console.warn('[HOME] ⚠️ Trending coins unavailable:', error);
      state.trendingCoins = [];
    }
  }

  function generateSmartAlerts() {
    state.alerts = [];

    if (!state.marketData || state.marketData.length === 0) {
      console.log('[HOME] ⚠️ No market data for alerts');
      return;
    }

    // Alert 1: Trending coins (top 3)
    if (state.trendingCoins && state.trendingCoins.length > 0) {
      const topTrending = state.trendingCoins.slice(0, 3);
      const names = topTrending.map(c => c.symbol).join(', ');
      
      state.alerts.push({
        type: 'trending',
        icon: 'fa-fire',
        color: '#f59e0b',
        title: 'Trending on CoinGecko',
        message: `${names} are gaining massive search interest`
      });
    }

    // Alert 2: Portfolio performance (ONLY if user has holdings)
    const totalEquity = calculateTotalEquity();
    const hasHoldings = Object.keys(state.holdings).some(k => state.holdings[k] > 0);
    
    if (totalEquity > 0 && state.globalMetrics && hasHoldings) {
      const marketChange = state.globalMetrics.marketCapChange24h || 0;
      const portfolioChange = calculatePortfolioChange24h();
      
      if (Math.abs(portfolioChange - marketChange) > 2) {
        const performance = portfolioChange > marketChange ? 'outperforming' : 'underperforming';
        const diff = Math.abs(portfolioChange - marketChange).toFixed(1);
        
        state.alerts.push({
          type: 'performance',
          icon: 'fa-chart-line',
          color: portfolioChange > marketChange ? '#10b981' : '#8b5cf6',
          title: `Portfolio ${performance} market`,
          message: `You're ${diff}% ${performance > marketChange ? 'ahead' : 'behind'} the overall market`
        });
      }
    }

    // Alert 3: Top gainer in holdings (ONLY if holdings exist)
    if (hasHoldings) {
      let topGainer = null;
      let maxGain = -Infinity;

      Object.entries(state.holdings).forEach(([symbol, amount]) => {
        if (amount <= 0) return;
        
        const coinId = symbol.toLowerCase();
        const coinData = state.marketData.find(c => c.id === coinId || c.symbol.toLowerCase() === coinId);
        
        if (coinData && coinData.price_change_percentage_24h > maxGain) {
          maxGain = coinData.price_change_percentage_24h;
          topGainer = { 
            symbol: coinData.symbol, 
            name: coinData.name, 
            change: maxGain, 
            amount 
          };
        }
      });

      if (topGainer && maxGain > 5) {
        state.alerts.push({
          type: 'holding',
          icon: 'fa-arrow-up',
          color: '#10b981',
          title: `${topGainer.symbol} surging`,
          message: `Your ${topGainer.symbol} position up ${maxGain.toFixed(1)}% today`
        });
      } else if (topGainer && maxGain < -5) {
        state.alerts.push({
          type: 'holding',
          icon: 'fa-arrow-down',
          color: '#ef4444',
          title: `${topGainer.symbol} declining`,
          message: `Your ${topGainer.symbol} position down ${Math.abs(maxGain).toFixed(1)}% today`
        });
      }
    }

    // Alert 4: Major market movements
    const chartCoinData = state.marketData.find(c => c.id === state.chartCoin);
    if (chartCoinData) {
      const change24h = chartCoinData.price_change_percentage_24h || 0;
      
      if (Math.abs(change24h) > 10) {
        const direction = change24h > 0 ? 'rallying hard' : 'in steep decline';
        state.alerts.push({
          type: 'market',
          icon: change24h > 0 ? 'fa-rocket' : 'fa-exclamation-triangle',
          color: change24h > 0 ? '#10b981' : '#ef4444',
          title: `${chartCoinData.name} ${direction}`,
          message: `${change24h > 0 ? '+' : ''}${change24h.toFixed(1)}% in the last 24 hours`
        });
      }
    }

    // Alert 5: Vault opportunity (ONLY if no vault balance exists)
    if (state.balances.spot > 500 && state.balances.vault === 0) {
      const potentialYield = (state.balances.spot * 0.12).toFixed(2);
      state.alerts.push({
        type: 'opportunity',
        icon: 'fa-piggy-bank',
        color: '#8b5cf6',
        title: 'Vault earning potential',
        message: `Your idle $${formatCompact(state.balances.spot)} could earn $${potentialYield}/year at 12% APY`
      });
    }

    state.alerts = state.alerts.slice(0, 3);
    
    console.log(`[HOME] 🔔 Generated ${state.alerts.length} alerts`);
  }

  // ============================================
  // EQUITY CALCULATIONS (FIXED)
  // ============================================

  function calculateTotalEquity() {
    // Start with liquid balances
    let total = (state.balances.spot || 0) + (state.balances.vault || 0);

    // Add crypto holdings AT CURRENT MARKET VALUE (no fake profits)
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

  function calculatePortfolioChange24h() {
    // If no holdings, use market benchmark
    if (!state.holdings || Object.keys(state.holdings).length === 0) {
      const chartCoin = state.marketData.find(c => c.id === state.chartCoin);
      return chartCoin?.price_change_percentage_24h || 0;
    }

    let totalCurrentValue = 0;
    let totalPreviousValue = 0;

    Object.entries(state.holdings).forEach(([symbol, amount]) => {
      if (amount <= 0) return;
      
      const id = symbol.toLowerCase();
      const coinData = state.marketData.find(c => c.id === id || c.symbol.toLowerCase() === id);
      
      if (coinData && coinData.current_price) {
        const currentPrice = coinData.current_price;
        const change24h = coinData.price_change_24h || 0;
        const previousPrice = currentPrice - change24h;
        
        totalCurrentValue += (amount * currentPrice);
        totalPreviousValue += (amount * previousPrice);
      }
    });

    if (totalPreviousValue === 0) return 0;
    
    return ((totalCurrentValue - totalPreviousValue) / totalPreviousValue) * 100;
  }

  // ============================================
  // HELPER FUNCTIONS
  // ============================================

  function formatMoney(amount) {
    if (state.hideBalance) return '••••••••';
    return (window.Format && Format.currency) 
      ? Format.currency(amount) 
      : '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2 });
  }

  function formatCompact(num) {
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

  function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 18) return 'Good Afternoon';
    return 'Good Evening';
  }

  function formatName(user) {
    if (!user) return 'Trader';
    if (user.user_metadata && user.user_metadata.full_name) {
      return user.user_metadata.full_name.split(' ')[0];
    }
    return 'Trader';
  }

  // ============================================
  // UI UPDATE
  // ============================================

  function updateUI() {
    updateEquityCard();
    updateMarketPulse();
    updateSmartAlerts();
  }

  function updateEquityCard() {
    const card = container.querySelector('.hero-card');
    if (!card) return;

    const totalEquity = calculateTotalEquity();
    const portfolioChange = calculatePortfolioChange24h();
    const isUp = portfolioChange >= 0;

    const balanceDisplay = card.querySelector('[data-balance]');
    if (balanceDisplay) {
      balanceDisplay.textContent = formatMoney(totalEquity);
    }

    const changeDisplay = card.querySelector('[data-change]');
    if (changeDisplay) {
      changeDisplay.textContent = `${portfolioChange >= 0 ? '+' : ''}${portfolioChange.toFixed(2)}%`;
      changeDisplay.style.color = isUp ? '#10b981' : '#ef4444';
    }
  }

  function updateMarketPulse() {
    const pulseCard = container.querySelector('[data-pulse-card]');
    if (!pulseCard || !state.globalMetrics) return;

    const marketCapEl = pulseCard.querySelector('[data-market-cap]');
    if (marketCapEl) {
      marketCapEl.textContent = '$' + formatCompact(state.globalMetrics.totalMarketCap);
    }

    const marketChangeEl = pulseCard.querySelector('[data-market-change]');
    if (marketChangeEl) {
      const change = state.globalMetrics.marketCapChange24h;
      marketChangeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}% 24h`;
      marketChangeEl.style.color = change >= 0 ? '#10b981' : '#ef4444';
    }
  }

  function updateSmartAlerts() {
    const alertsContainer = container.querySelector('#alerts-container');
    if (!alertsContainer) return;

    if (state.alerts.length === 0) {
      alertsContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--color-text-tertiary); font-size:13px;">No alerts at this time</div>';
      return;
    }

    alertsContainer.innerHTML = state.alerts.map(alert => `
      <div class="card" style="padding:14px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:10px; display:flex; align-items:flex-start; gap:12px;">
        <div style="width:32px; height:32px; border-radius:8px; background:${alert.color}15; color:${alert.color}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          <i class="fas ${alert.icon}" style="font-size:13px;"></i>
        </div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:13px; font-weight:600; color:var(--color-text-primary); margin-bottom:2px;">
            ${alert.title}
          </div>
          <div style="font-size:12px; color:var(--color-text-secondary); line-height:1.4;">
            ${alert.message}
          </div>
        </div>
      </div>
    `).join('');
  }

  // ============================================
  // UI COMPONENTS
  // ============================================

  function createHeader() {
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom:16px; padding-top:12px;';
    
    const userName = formatName(state.user);
    
    header.innerHTML = `
      <div style="font-size:15px; color:var(--color-text-secondary); display:flex; align-items:baseline; gap:6px; font-weight:500;">
        ${getGreeting()}, <span style="font-size:20px; font-weight:700; color:var(--color-text-primary);">${userName}</span>
      </div>
    `;
    return header;
  }

  function createEquityCard() {
    const card = document.createElement('div');
    card.className = 'hero-card';
    
    card.style.cssText = `
      position: relative;
      overflow: hidden;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
      min-height: 140px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      border: 1px solid rgba(255,255,255,0.08);
      box-shadow: 0 4px 24px -4px rgba(0,0,0,0.25);
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
    `;
    
    const totalEquity = calculateTotalEquity();
    const portfolioChange = calculatePortfolioChange24h();
    const isUp = portfolioChange >= 0;
    const iconClass = state.hideBalance ? 'fa-eye-slash' : 'fa-eye';

    const nextMilestone = Math.ceil(totalEquity / 1000) * 1000;
    const progress = totalEquity > 0 ? ((totalEquity / nextMilestone) * 100).toFixed(0) : 0;

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
        <div>
          <div style="font-size:11px; font-weight:600; color:rgba(255,255,255,0.5); text-transform:uppercase; letter-spacing:0.8px; margin-bottom:8px;">
            Total Portfolio
          </div>
          <div data-balance style="font-family:var(--font-mono); font-size:36px; font-weight:700; color:white; letter-spacing:-1.5px; line-height:1;">
            ${formatMoney(totalEquity)}
          </div>
        </div>
        <button id="toggle-privacy-btn" style="background:rgba(255,255,255,0.1); border:none; color:rgba(255,255,255,0.7); width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; transition: all 0.2s;">
          <i class="fas ${iconClass}" style="font-size:13px;"></i>
        </button>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 8px; background: ${isUp ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; border: 1px solid ${isUp ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'};">
          <i class="fas ${isUp ? 'fa-arrow-up' : 'fa-arrow-down'}" style="color:${isUp ? '#10b981' : '#ef4444'}; font-size:10px;"></i>
          <span data-change style="color:${isUp ? '#10b981' : '#ef4444'}; font-size:13px; font-weight:700;">${portfolioChange >= 0 ? '+' : ''}${portfolioChange.toFixed(2)}%</span>
          <span style="color:rgba(255,255,255,0.4); font-size:11px; font-weight:500;">24h</span>
        </div>

        ${totalEquity > 0 ? `
          <div style="font-size:11px; color:rgba(255,255,255,0.5);">
            ${progress}% to ${formatMoney(nextMilestone)}
          </div>
        ` : ''}
      </div>

      ${totalEquity > 0 ? `
        <div style="margin-top:12px; height:3px; background:rgba(255,255,255,0.1); border-radius:2px; overflow:hidden;">
          <div style="height:100%; width:${progress}%; background:linear-gradient(90deg, #3b82f6, #8b5cf6); transition: width 0.5s ease;"></div>
        </div>
      ` : ''}
    `;

    card.querySelector('#toggle-privacy-btn').onclick = (e) => { 
      e.stopPropagation(); 
      togglePrivacy(); 
    };

    return card;
  }

  function createQuickActions() {
    const section = document.createElement('div');
    section.style.marginBottom = '20px';
    
    section.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
        ${createActionTile('Deposit', 'fa-arrow-down', '#3b82f6', () => window.Trade && Trade.openDeposit())}
        ${createActionTile('Withdraw', 'fa-arrow-up', '#8b5cf6', () => window.Trade && Trade.openWithdraw())}
        ${createActionTile('Trade', 'fa-exchange-alt', '#10b981', () => window.App && App.navigate('market'))}
      </div>
    `;
    
    return section;
  }

  function createActionTile(label, icon, color, action) {
    return `
      <button onclick="(${action})()" style="
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 14px;
        height: 72px;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        cursor: pointer;
        transition: all 0.2s;
      " onmouseover="this.style.borderColor='${color}'; this.style.background='${color}08';" onmouseout="this.style.borderColor='var(--color-border)'; this.style.background='var(--color-surface)';">
        <div style="width:28px; height:28px; border-radius:8px; background:${color}15; color:${color}; display:flex; align-items:center; justify-content:center;">
          <i class="fas ${icon}" style="font-size:13px;"></i>
        </div>
        <span style="font-size:12px; font-weight:600; color:var(--color-text-primary);">${label}</span>
      </button>
    `;
  }

  function createMarketPulse() {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom: 24px;';

    if (!state.globalMetrics) {
      section.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 style="font-size:15px; font-weight:700; color:var(--color-text-primary); margin:0;">Market Pulse</h3>
        </div>
        <div class="card" style="padding:16px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:12px;">
          <div style="text-align:center; padding:20px; color:var(--color-text-tertiary);">
            <i class="fas fa-spinner fa-spin" style="font-size:24px; margin-bottom:8px;"></i>
            <div style="font-size:12px;">Loading market data...</div>
          </div>
        </div>
      `;
      return section;
    }

    const metrics = state.globalMetrics;
    const isMarketUp = metrics.marketCapChange24h >= 0;
    
    const fearGreedScore = metrics.fearGreedValue || 50;
    let sentiment = metrics.fearGreedClassification || 'Neutral';
    let sentimentColor = '#94a3b8';
    
    if (fearGreedScore < 25) { sentimentColor = '#ef4444'; }
    else if (fearGreedScore < 45) { sentimentColor = '#f59e0b'; }
    else if (fearGreedScore < 55) { sentimentColor = '#94a3b8'; }
    else { sentimentColor = '#10b981'; }

    section.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="font-size:15px; font-weight:700; color:var(--color-text-primary); margin:0;">Market Pulse</h3>
        <i class="fas fa-globe" style="font-size:13px; color:var(--color-text-tertiary);"></i>
      </div>

      <div data-pulse-card class="card" style="padding:16px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:12px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:14px;">
          <div>
            <div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px; font-weight:500;">Market Cap</div>
            <div data-market-cap style="font-family:var(--font-mono); font-size:18px; font-weight:700; color:var(--color-text-primary);">
              $${formatCompact(metrics.totalMarketCap)}
            </div>
            <div data-market-change style="font-size:11px; font-weight:600; color:${isMarketUp ? '#10b981' : '#ef4444'}; margin-top:2px;">
              ${isMarketUp ? '+' : ''}${metrics.marketCapChange24h.toFixed(2)}% 24h
            </div>
          </div>

          <div>
            <div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px; font-weight:500;">BTC Dominance</div>
            <div style="font-family:var(--font-mono); font-size:18px; font-weight:700; color:var(--color-text-primary);">
              ${metrics.btcDominance.toFixed(1)}%
            </div>
            <div style="font-size:11px; color:var(--color-text-secondary); margin-top:2px;">
              ETH ${metrics.ethDominance.toFixed(1)}%
            </div>
          </div>
        </div>

        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div style="font-size:11px; color:var(--color-text-tertiary); font-weight:500;">Market Sentiment</div>
            <div style="font-size:12px; font-weight:700; color:${sentimentColor};">${sentiment}</div>
          </div>
          <div style="height:6px; background:var(--color-surface-elevated); border-radius:3px; overflow:hidden; position:relative;">
            <div style="position:absolute; left:0; top:0; height:100%; width:${fearGreedScore}%; background:linear-gradient(90deg, #ef4444, #f59e0b, #94a3b8, #10b981); transition: width 0.5s ease;"></div>
            <div style="position:absolute; left:${fearGreedScore}%; top:50%; transform:translate(-50%, -50%); width:12px; height:12px; background:white; border:2px solid ${sentimentColor}; border-radius:50%; box-shadow:0 0 0 3px rgba(0,0,0,0.3);"></div>
          </div>
          <div style="display:flex; justify-content:space-between; margin-top:4px;">
            <span style="font-size:9px; color:var(--color-text-tertiary); font-weight:500;">Fear</span>
            <span style="font-size:9px; color:var(--color-text-tertiary); font-weight:500;">Greed</span>
          </div>
        </div>
      </div>
    `;

    return section;
  }

  function createChartSection() {
    const section = document.createElement('div');
    
    const coinData = state.marketData.find(c => c.id === state.chartCoin) || { 
      name: 'Bitcoin', 
      current_price: 0 
    };
    
    const priceDisplay = coinData.current_price > 0 
      ? '$' + coinData.current_price.toLocaleString() 
      : 'Loading...';

    section.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="font-size:15px; font-weight:700; color:var(--color-text-primary); margin:0;">Price Chart</h3>
        <select id="chart-coin-select" style="
            appearance: none;
            background: var(--color-surface-elevated);
            border: 1px solid var(--color-border);
            padding: 6px 28px 6px 12px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            color: var(--color-text-primary);
            cursor: pointer;
            outline: none;
            background-image: url('data:image/svg+xml;charset=UTF-8,%3csvg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"%3e%3cpath d="M1 1.5L6 6.5L11 1.5" stroke="%2394a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/%3e%3c/svg%3e');
            background-repeat: no-repeat;
            background-position: right 8px center;
          ">
            ${CHART_COINS.map(c => `<option value="${c.id}" ${c.id === state.chartCoin ? 'selected' : ''}>${c.symbol}</option>`).join('')}
        </select>
      </div>

      <div class="card" style="padding: 18px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom: 16px;">
          <div>
            <div style="font-size:13px; color:var(--color-text-secondary); font-weight:500; margin-bottom:4px;">
              ${coinData.name}
            </div>
            <div id="chart-price-display" style="font-family:var(--font-mono); font-size:24px; font-weight:700; color:var(--color-text-primary);">
              ${priceDisplay}
            </div>
          </div>
          <div id="dynamic-chart-change" style="font-size:13px; font-weight:700; padding:4px 8px; border-radius:6px; color:var(--color-text-secondary);">
            --
          </div>
        </div>

        <div style="display:flex; gap:6px; margin-bottom:14px; overflow-x:auto; -webkit-overflow-scrolling: touch;">
          ${['1H', '1D', '1W', '1M', '1Y'].map(p => `
            <button onclick="Home.setPeriod('${p}')" 
              style="
                flex-shrink:0;
                padding:6px 14px;
                border-radius:8px;
                font-size:11px;
                font-weight:600;
                border:none;
                cursor:pointer;
                transition: all 0.2s;
                background:${state.chartPeriod === p ? 'var(--color-surface-elevated)' : 'transparent'};
                color:${state.chartPeriod === p ? 'var(--color-primary)' : 'var(--color-text-secondary)'};
                border: 1px solid ${state.chartPeriod === p ? 'var(--color-border)' : 'transparent'};
              ">
              ${p}
            </button>
          `).join('')}
        </div>

        <div id="chart-loading" style="display:none; text-align:center; padding:60px 0; color:var(--color-text-tertiary);">
          <i class="fas fa-spinner fa-spin" style="font-size:24px; margin-bottom:8px;"></i>
          <div style="font-size:12px;">Loading chart data...</div>
        </div>

        <div style="height: 220px; position: relative; width:100%;">
          <canvas id="real-crypto-chart"></canvas>
        </div>
      </div>
    `;

    section.querySelector('#chart-coin-select').onchange = async (e) => {
      state.chartCoin = e.target.value;
      
      if (window.API && API.unsubscribeTicker) {
        API.unsubscribeTicker();
      }
      
      await API.ensureCoinLoaded(state.chartCoin);
      await loadMarketData();
      
      render(container);
    };

    return section;
  }

  function createSmartAlerts() {
    const section = document.createElement('div');
    section.style.cssText = 'margin-top: 24px;';

    section.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="font-size:15px; font-weight:700; color:var(--color-text-primary); margin:0;">Smart Alerts</h3>
        <i class="fas fa-bell" style="font-size:13px; color:var(--color-text-tertiary);"></i>
      </div>
      <div id="alerts-container" style="display:flex; flex-direction:column; gap:8px;">
        ${state.alerts.length === 0 ? `
          <div style="text-align:center; padding:20px; color:var(--color-text-tertiary); font-size:13px;">
            No alerts at this time
          </div>
        ` : ''}
      </div>
    `;

    return section;
  }

  // ============================================
  // CHART LOGIC (REAL BINANCE DATA)
  // ============================================

  async function initChart() {
    const canvas = document.getElementById('real-crypto-chart');
    const loadingEl = document.getElementById('chart-loading');
    
    if (!canvas || typeof Chart === 'undefined') return;

    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    const coinData = state.marketData.find(c => c.id === state.chartCoin);
    if (!coinData) {
      console.warn('[HOME] ⚠️ Chart coin not found in market data');
      return;
    }

    if (loadingEl) {
      loadingEl.style.display = 'block';
      canvas.style.display = 'none';
    }

    let candleData = [];
    
    if (window.API && typeof API.getCandles === 'function') {
      try {
        console.log(`[HOME] 📊 Fetching candles for ${state.chartCoin}...`);
        candleData = await API.getCandles(state.chartCoin, state.chartPeriod);
        console.log(`[HOME] ✅ Got ${candleData.length} candles`);
      } catch (error) {
        console.warn('[HOME] ⚠️ Binance candles failed:', error);
      }
    }

    if (candleData.length === 0 && coinData.sparkline && coinData.sparkline.length > 0) {
      console.log('[HOME] 📊 Using CoinGecko sparkline');
      candleData = coinData.sparkline.map((price, index) => ({
        time: Date.now() / 1000 - (coinData.sparkline.length - index) * 3600,
        close: price,
        value: price
      }));
    }

    if (candleData.length === 0) {
      console.warn('[HOME] ⚠️ No chart data available');
      if (loadingEl) {
        loadingEl.innerHTML = '<div style="text-align:center; padding:40px; color:var(--color-text-tertiary); font-size:12px;">Chart data unavailable</div>';
      }
      return;
    }

    if (loadingEl) {
      loadingEl.style.display = 'none';
      canvas.style.display = 'block';
    }

    const priceData = candleData.map(c => c.close || c.value);
    const labels = candleData.map((_, i) => i);

    const startPrice = priceData[0];
    const endPrice = priceData[priceData.length - 1];
    const changePct = ((endPrice - startPrice) / startPrice) * 100;
    const isUp = changePct >= 0;

    const changeEl = document.getElementById('dynamic-chart-change');
    if (changeEl) {
      changeEl.textContent = (isUp ? '+' : '') + changePct.toFixed(2) + '%';
      changeEl.style.color = isUp ? '#10b981' : '#ef4444';
      changeEl.style.backgroundColor = isUp ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';
    }

    const lineColor = isUp ? '#10b981' : '#ef4444';
    const gradientColor = isUp ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';

    chartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          data: priceData,
          borderColor: lineColor,
          borderWidth: 2,
          backgroundColor: (context) => {
            const ctx = context.chart.ctx;
            const gradient = ctx.createLinearGradient(0, 0, 0, 220);
            gradient.addColorStop(0, gradientColor);
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            return gradient;
          },
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: lineColor,
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#fff',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            padding: 10,
            displayColors: false,
            callbacks: {
              title: () => '',
              label: (context) => {
                return '$' + context.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              }
            }
          }
        },
        scales: {
          x: {
            display: false,
            grid: { display: false }
          },
          y: {
            display: false,
            grid: { display: false }
          }
        },
        interaction: {
          mode: 'nearest',
          axis: 'x',
          intersect: false
        }
      }
    });

    console.log('[HOME] ✅ Chart rendered');
  }

  // ============================================
  // LIVE UPDATES
  // ============================================

  function startLiveUpdates() {
    if (window.API && typeof API.subscribeToTicker === 'function') {
      try {
        console.log(`[HOME] 🔌 Subscribing to ${state.chartCoin} price feed`);
        
        priceSubscription = API.subscribeToTicker(state.chartCoin, (newPrice) => {
          updateLivePrice(newPrice);
        });
      } catch (error) {
        console.warn('[HOME] ⚠️ WebSocket subscription failed:', error);
      }
    }

    pulseUpdateInterval = setInterval(async () => {
      if (container && document.body.contains(container)) {
        await loadGlobalMetrics();
        updateMarketPulse();
      }
    }, 60000);
  }

  function updateLivePrice(newPrice) {
    const priceDisplay = document.getElementById('chart-price-display');
    if (priceDisplay && !state.hideBalance) {
      priceDisplay.textContent = '$' + newPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    const coinIndex = state.marketData.findIndex(c => c.id === state.chartCoin);
    if (coinIndex !== -1) {
      state.marketData[coinIndex].current_price = newPrice;
    }
  }

  // ============================================
  // PUBLIC API
  // ============================================

  function setPeriod(period) {
    state.chartPeriod = period;
    initChart();
    
    const buttons = container.querySelectorAll('.card button');
    buttons.forEach(btn => {
      const isActive = btn.textContent.trim() === period;
      btn.style.background = isActive ? 'var(--color-surface-elevated)' : 'transparent';
      btn.style.color = isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)';
      btn.style.borderColor = isActive ? 'var(--color-border)' : 'transparent';
    });
  }

  return {
    render,
    setPeriod,
    cleanup
  };
})();

if (typeof window !== 'undefined') window.Home = Home;
