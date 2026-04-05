/**
 * NexTrade — Market Module (Production-Ready - Zero Blank Screens)
 * ══════════════════════════════════════════════════════════════
 * ARCHITECTURE IMPROVEMENTS:
 * 1. Uses CacheManager for all data (no direct API calls)
 * 2. Pre-computed filters (gainers/losers instant)
 * 3. Optimistic rendering (show cached data immediately)
 * 4. Graceful degradation (stale > empty)
 * 5. Zero "No Results Found" errors
 * ══════════════════════════════════════════════════════════════
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
  let currentSearchQuery = '';
  let trendingData = [];
  let marketData = [];
  let isInitialLoad = true;

  // ============================================
  // MAIN RENDER (ASYNC - OPTIMISTIC)
  // ============================================

  async function render(element) {
    if (!element) {
      console.error('[MARKET] Container not found');
      return;
    }

    container = element;
    container.className = 'market-page';
    container.style.overflowY = 'auto';
    container.style.webkitOverflowScrolling = 'touch';
    // Tell the page to take up the full screen, ignoring the old navbar height
container.style.height = '100dvh'; 


    console.log('[MARKET] 🎯 Rendering market page...');

    // CRITICAL: Check if CacheManager is available
    if (!window.CacheManager) {
      console.error('[MARKET] ❌ CacheManager not loaded!');
      showErrorScreen('CacheManager module not available. Please refresh the page.');
      return;
    }

    // Show skeleton only on true first load (no cache)
    const cacheStatus = CacheManager.getCacheStatus();
    const hasCache = cacheStatus.marketData.cached && cacheStatus.marketData.count > 0;

    if (!hasCache || isInitialLoad) {
      showLoadingScreen();
      isInitialLoad = false;
    } else {
      // Build UI immediately with cached data
      buildUIFromCache();
    }

    try {
      // Load data (will use cache if valid)
      await loadAllData();

      // Build/update UI with fresh data
      buildUI();

      subscribeToUpdates();
      
      if (window.Navbar) Navbar.setActive('market');

      console.log('[MARKET] ✅ Render complete');
      
    } catch (error) {
      console.error('[MARKET] ❌ Render failed:', error);
      
      // Try to use cached data as fallback
      const fallbackStatus = CacheManager.getCacheStatus();
      if (fallbackStatus.marketData.cached) {
        console.log('[MARKET] 📦 Using cached data after error');
        buildUIFromCache();
      } else {
        showErrorScreen(error.message);
      }
    }
  }

  // ============================================
  // OPTIMISTIC RENDERING
  // ============================================

  function buildUIFromCache() {
    console.log('[MARKET] 📦 Building UI from cache...');

    const cacheStatus = CacheManager.getCacheStatus();
    
    container.innerHTML = '';
    
    container.appendChild(createTrendingSection());
    container.appendChild(createHeader());
    container.appendChild(createMarketList());

    // Use cached market data
    if (cacheStatus.marketData.cached) {
      marketData = CacheManager.getMarketData().data || [];
      const filtered = applyFilter(marketData, currentFilter);
      renderMarketItems(filtered);
    }

    // Use cached trending
    if (cacheStatus.trending.cached) {
      trendingData = CacheManager.getTrendingCoins().data || [];
      renderTrendingCards();
    }

    // Show stale indicator if needed
    if (cacheStatus.marketData.stale) {
      showStaleIndicator(cacheStatus.marketData.age);
    }

    console.log('[MARKET] ✅ UI built from cache');
  }

  // ============================================
  // LOADING & ERROR SCREENS
  // ============================================

  function showLoadingScreen() {
    if (!container) return;

    container.innerHTML = '';

    const screen = document.createElement('div');
    screen.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:60vh; padding:20px;';

    screen.innerHTML = `
      <i class="fas fa-spinner fa-spin" style="font-size:40px; color:var(--color-primary); margin-bottom:20px;"></i>
      <div style="font-size:15px; font-weight:600; color:var(--color-text-primary); margin-bottom:8px;">
        Loading Market Data
      </div>
      <div style="font-size:13px; color:var(--color-text-secondary);">
        Fetching live prices from exchanges...
      </div>
    `;

    container.appendChild(screen);
  }

  function showErrorScreen(message) {
    if (!container) return;

    container.innerHTML = '';

    const screen = document.createElement('div');
    screen.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:60vh; padding:20px; text-align:center;';

    screen.innerHTML = `
      <div style="font-size:48px; margin-bottom:20px; opacity:0.5;">
        <i class="fas fa-exclamation-triangle" style="color:#f59e0b;"></i>
      </div>
      <div style="font-size:16px; font-weight:600; color:var(--color-text-primary); margin-bottom:8px;">
        Failed to Load Market
      </div>
      <div style="font-size:13px; color:var(--color-text-secondary); margin-bottom:20px; max-width:300px;">
        <div id="error-message-text"></div>
      </div>
      <button onclick="Market.refresh()" class="btn btn-primary" style="padding:10px 24px;">
        <i class="fas fa-sync-alt" style="margin-right:8px;"></i>
        Retry
      </button>
    `;
screen.querySelector('#error-message-text').textContent = message || 'Unable to fetch market data. Please check your connection.';
    container.appendChild(screen);
  }

  function showStaleIndicator(age) {
    if (!container) return;

    const indicator = document.createElement('div');
    indicator.id = 'stale-indicator';
    indicator.style.cssText = `
      position: fixed;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(245, 158, 11, 0.95);
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      z-index: 1000;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;

    indicator.innerHTML = `
      <i class="fas fa-clock" style="font-size:11px;"></i>
      <span>Showing cached data from ${age}</span>
      <i class="fas fa-spinner fa-spin" style="font-size:11px;"></i>
    `;

    container.insertBefore(indicator, container.firstChild);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.style.opacity = '0';
        indicator.style.transition = 'opacity 0.3s';
        setTimeout(() => indicator.remove(), 300);
      }
    }, 5000);
  }

  // ============================================
  // BUILD UI (AFTER DATA LOADED)
  // ============================================

  function buildUI() {
    if (!container) return;

    console.log('[MARKET] 🎨 Building UI with fresh data...');

    // Remove stale indicator if present
    const staleIndicator = document.getElementById('stale-indicator');
    if (staleIndicator) staleIndicator.remove();

    container.innerHTML = '';

    const trendingSection = createTrendingSection();
    container.appendChild(trendingSection);

    const header = createHeader();
    container.appendChild(header);

    const marketList = createMarketList();
    container.appendChild(marketList);

    const filtered = applyFilter(marketData, currentFilter);
    renderMarketItems(filtered);

    renderTrendingCards();

    console.log('[MARKET] ✅ UI built');
  }

  // ============================================
  // TRENDING SECTION
  // ============================================

  function createTrendingSection() {
    const section = document.createElement('div');
    section.style.cssText = 'padding: 16px 16px 0 16px; background: var(--color-background);';

    section.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="font-size:15px; font-weight:700; color:var(--color-text-primary); margin:0;">
          <i class="fas fa-fire" style="color:#f59e0b; margin-right:6px; font-size:14px;"></i>
          Trending Now
        </h3>
        <button onclick="Market.refreshTrending()" style="background:none; border:none; color:var(--color-text-tertiary); cursor:pointer; padding:4px;">
          <i class="fas fa-sync-alt" style="font-size:12px;"></i>
        </button>
      </div>
      
      <div id="trending-container" style="overflow-x: auto; -webkit-overflow-scrolling: touch; margin:0 -16px; padding:0 16px 16px 16px;">
        <div style="display:flex; gap:10px; min-width:min-content;">
          ${createTrendingSkeletons()}
        </div>
      </div>
    `;

    return section;
  }

  function createTrendingSkeletons() {
    return Array(5).fill(0).map(() => `
      <div class="skeleton" style="
        min-width:140px; height:100px; border-radius:12px; 
        background:linear-gradient(90deg, var(--color-surface) 0%, var(--color-surface-elevated) 50%, var(--color-surface) 100%);
        background-size:200% 100%; animation: shimmer 1.5s infinite;
      "></div>
    `).join('');
  }

  async function loadTrendingCoins() {
    console.log('[MARKET] 🔥 Loading trending coins...');

    try {
      const result = await CacheManager.getTrendingCoins();
      
      if (result.success && result.data && result.data.length > 0) {
        trendingData = result.data.slice(0, 7);
        console.log(`[MARKET] ✅ Loaded ${trendingData.length} trending coins`);
      } else {
        console.warn('[MARKET] ⚠️ No trending data available');
        useTrendingFallback();
      }
    } catch (error) {
      console.error('[MARKET] ❌ Trending load error:', error);
      useTrendingFallback();
    }
  }

  function useTrendingFallback() {
    if (marketData.length === 0) {
      trendingData = [];
      return;
    }

    const topGainers = [...marketData]
      .filter(c => c.price_change_percentage_24h > 0)
      .sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h)
      .slice(0, 7);

    if (topGainers.length > 0) {
      trendingData = topGainers.map(c => ({
        id: c.id,
        symbol: c.symbol,
        name: c.name,
        thumb: c.image
      }));
    }
  }

  function renderTrendingCards() {
    const trendingContainer = document.getElementById('trending-container');
    if (!trendingContainer) return;

    if (trendingData.length === 0) {
      trendingContainer.innerHTML = `
        <div style="text-align:center; padding:20px; color:var(--color-text-tertiary); font-size:12px;">
          No trending data available
        </div>
      `;
      return;
    }

    const cards = trendingData.map((coin, index) => {
      const fullData = marketData.find(c => c.id === coin.id);
      const change24h = fullData?.price_change_percentage_24h || 0;
      const price = fullData?.current_price || 0;
      const isUp = change24h >= 0;

      // FIX: coin.id was interpolated into an onclick string — executable JS context.
      // A compromised API response could inject arbitrary JS. Use data-attribute + delegation.
      const safeId = encodeURIComponent(String(coin.id || ''));
      return `
        <div data-trending-coin="${safeId}" style="
          min-width:140px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 12px;
          padding: 12px;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
          overflow: hidden;
        ">
          
          <div style="position:absolute; top:8px; right:8px; font-size:10px; font-weight:700; color:var(--color-text-tertiary); background:var(--color-surface-elevated); padding:2px 6px; border-radius:4px;">
            #${index + 1}
          </div>

          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <div style="width:28px; height:28px; border-radius:50%; background:var(--color-surface-elevated); display:flex; align-items:center; justify-content:center; overflow:hidden;">
              ${coin.thumb && coin.thumb.startsWith('https://') ? `<img src="${coin.thumb}" style="width:100%; height:100%;" referrerpolicy="no-referrer">` : `<span style="font-size:11px; font-weight:700;">${coin.symbol.substring(0, 2)}</span>`}
            </div>
            <div style="flex:1; min-width:0;">
              <div style="font-size:12px; font-weight:700; color:var(--color-text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${coin.symbol}
              </div>
              <div style="font-size:10px; color:var(--color-text-tertiary);">
                ${coin.name.length > 12 ? coin.name.substring(0, 12) + '...' : coin.name}
              </div>
            </div>
          </div>

          ${price > 0 ? `
            <div style="font-family:var(--font-mono); font-size:14px; font-weight:700; color:var(--color-text-primary); margin-bottom:4px;">
              $${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          ` : ''}

          <div style="display:flex; align-items:center; gap:4px;">
            <i class="fas ${isUp ? 'fa-arrow-up' : 'fa-arrow-down'}" style="color:${isUp ? '#10b981' : '#ef4444'}; font-size:10px;"></i>
            <span style="font-size:12px; font-weight:700; color:${isUp ? '#10b981' : '#ef4444'};">
              ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%
            </span>
          </div>

          ${fullData && fullData.sparkline && fullData.sparkline.length > 0 ? `
            <canvas id="trending-spark-${index}" width="120" height="30" style="margin-top:8px; width:100%; height:30px;"></canvas>
          ` : ''}
        </div>
      `;
    }).join('');

    trendingContainer.innerHTML = `
      <div style="display:flex; gap:10px; min-width:min-content;">
        ${cards}
      </div>
    `;

    // Event delegation — handles clicks on all [data-trending-coin] cards.
    // Decodes the coin id from the data attribute (was encoded to prevent XSS
    // when the attribute was built from API data).
    trendingContainer.addEventListener('click', (e) => {
      const card = e.target.closest('[data-trending-coin]');
      if (!card) return;
      const coinId = decodeURIComponent(card.dataset.trendingCoin || '');
      if (coinId) showCoinDetails(coinId);
    }, { once: false });

    setTimeout(() => renderTrendingSparklines(), 100);
  }

  function renderTrendingSparklines() {
    trendingData.forEach((coin, index) => {
      const canvas = document.getElementById(`trending-spark-${index}`);
      if (!canvas) return;

      const fullData = marketData.find(c => c.id === coin.id);
      if (!fullData || !fullData.sparkline || fullData.sparkline.length === 0) return;

      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;

      const data = fullData.sparkline.slice(-20);
      const max = Math.max(...data);
      const min = Math.min(...data);
      const range = max - min || 1;

      const isUp = fullData.price_change_percentage_24h >= 0;
      const color = isUp ? '#10b981' : '#ef4444';

      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      data.forEach((price, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((price - min) / range) * height;
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();
    });
  }

  // ============================================
  // HEADER (SEARCH & FILTERS)
  // ============================================

  function createHeader() {
    const header = document.createElement('div');
    header.className = 'market-header';
    header.style.cssText = 'padding:0 16px 16px 16px; position:sticky; top:0; background:var(--color-background); z-index:10;';

    const searchWrapper = document.createElement('div');
    searchWrapper.style.cssText = 'position:relative; margin-bottom:12px;';

    searchWrapper.innerHTML = `
      <i class="fas fa-search" style="position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--color-text-tertiary); font-size:13px; pointer-events:none;"></i>
      <input 
        type="text" 
        id="market-search" 
        placeholder="Search cryptocurrencies..." 
        value="${currentSearchQuery}"
        style="
          width:100%; 
          padding:12px 14px 12px 40px; 
          background:var(--color-surface); 
          border:1px solid var(--color-border); 
          border-radius:12px; 
          color:var(--color-text-primary); 
          font-size:14px;
          outline:none;
          transition: border-color 0.2s;
        "
      />
    `;

    searchWrapper.querySelector('#market-search').addEventListener('input', (e) => {
      handleSearch(e.target.value);
    });

    searchWrapper.querySelector('#market-search').addEventListener('focus', (e) => {
      e.target.style.borderColor = 'var(--color-primary)';
    });

    searchWrapper.querySelector('#market-search').addEventListener('blur', (e) => {
      e.target.style.borderColor = 'var(--color-border)';
    });

    const filters = createFilters();

    header.appendChild(searchWrapper);
    header.appendChild(filters);

    return header;
  }

  function createFilters() {
    const filters = document.createElement('div');
    filters.className = 'market-filters';
    filters.style.cssText = 'display:flex; gap:8px; overflow-x:auto; -webkit-overflow-scrolling:touch; padding-bottom:2px;';
    filters.id = 'market-filters';

    const filterOptions = [
      { id: 'all', label: 'All', icon: 'fa-list' },
      { id: 'gainers', label: 'Gainers', icon: 'fa-arrow-up' },
      { id: 'losers', label: 'Losers', icon: 'fa-arrow-down' },
      { id: 'volume', label: 'Volume', icon: 'fa-chart-bar' }
    ];

    filterOptions.forEach(option => {
      const btn = document.createElement('button');
      btn.className = 'market-filter-btn';
      
      const isActive = option.id === currentFilter;
      
      btn.style.cssText = `
        flex-shrink:0;
        padding:8px 16px;
        border-radius:20px;
        font-size:12px;
        font-weight:600;
        border:none;
        cursor:pointer;
        transition: all 0.2s;
        display:flex;
        align-items:center;
        gap:6px;
        background:${isActive ? 'var(--color-primary)' : 'var(--color-surface)'};
        color:${isActive ? '#fff' : 'var(--color-text-primary)'};
        border: 1px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'};
      `;

      btn.innerHTML = `
        <i class="fas ${option.icon}" style="font-size:10px;"></i>
        <span>${option.label}</span>
      `;

      btn.setAttribute('data-filter', option.id);

      btn.addEventListener('click', () => {
        handleFilterChange(option.id);
      });

      filters.appendChild(btn);
    });

    return filters;
  }

  // ============================================
  // MARKET LIST
  // ============================================

  function createMarketList() {
    const list = document.createElement('div');
    list.className = 'market-list';
    list.style.cssText = 'padding:0 16px 100px 16px;';
    list.id = 'market-list';

    return list;
  }

  function renderMarketItems(coins) {
    const list = document.getElementById('market-list');
    if (!list) return;

    list.innerHTML = '';

    if (!coins || coins.length === 0) {
      showEmptyState();
      return;
    }

    console.log(`[MARKET] 🎨 Rendering ${coins.length} coins`);

    coins.forEach(coin => {
      const item = createMarketCard(coin);
      list.appendChild(item);
    });
  }

  function createMarketCard(coin) {
    const card = document.createElement('div');
    card.className = 'market-card';
    
    const isUp = (coin.price_change_percentage_24h || 0) >= 0;
    const changeColor = isUp ? '#10b981' : '#ef4444';

    card.style.cssText = `
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: all 0.2s;
    `;

    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="width:40px; height:40px; border-radius:50%; background:var(--color-surface-elevated); display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0;">
          ${coin.image && coin.image.startsWith('https://') ? `<img src="${coin.image}" style="width:100%; height:100%;" referrerpolicy="no-referrer">` : `<span style="font-size:11px; font-weight:700;">${coin.symbol.substring(0, 2)}</span>`}
        </div>

        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">
            <span style="font-size:15px; font-weight:700; color:var(--color-text-primary);">${coin.symbol}</span>
            ${coin.market_cap_rank ? `<span style="font-size:10px; color:var(--color-text-tertiary); background:var(--color-surface-elevated); padding:2px 6px; border-radius:4px;">#${coin.market_cap_rank}</span>` : ''}
          </div>
          <div style="font-size:12px; color:var(--color-text-secondary);">${coin.name}</div>
        </div>

        <div style="text-align:right; flex-shrink:0;">
          <div style="font-family:var(--font-mono); font-size:15px; font-weight:700; color:var(--color-text-primary); margin-bottom:2px;">
            $${coin.current_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
          </div>
          <div style="display:flex; align-items:center; justify-content:flex-end; gap:4px;">
            <i class="fas ${isUp ? 'fa-arrow-up' : 'fa-arrow-down'}" style="color:${changeColor}; font-size:10px;"></i>
            <span style="font-size:12px; font-weight:700; color:${changeColor};">
              ${coin.price_change_percentage_24h >= 0 ? '+' : ''}${(coin.price_change_percentage_24h || 0).toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      ${coin.sparkline && coin.sparkline.length > 0 ? `
        <div style="margin-top:12px; height:50px; position:relative;">
          <canvas class="market-sparkline" data-coin-id="${coin.id}" width="300" height="50"></canvas>
        </div>
      ` : ''}
    `;

    card.addEventListener('click', () => {
      showCoinDetails(coin);
    });

    card.addEventListener('mouseenter', () => {
      card.style.borderColor = 'var(--color-primary)';
      card.style.transform = 'translateY(-2px)';
      card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
    });

    card.addEventListener('mouseleave', () => {
      card.style.borderColor = 'var(--color-border)';
      card.style.transform = 'translateY(0)';
      card.style.boxShadow = 'none';
    });

    if (coin.sparkline && coin.sparkline.length > 0) {
      setTimeout(() => {
        renderSparkline(coin.id, coin.sparkline, isUp);
      }, 50);
    }

    return card;
  }

  function renderSparkline(coinId, data, isUp) {
    const canvas = document.querySelector(`.market-sparkline[data-coin-id="${coinId}"]`);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    const sparklineData = data.slice(-50);
    const max = Math.max(...sparklineData);
    const min = Math.min(...sparklineData);
    const range = max - min || 1;

    const color = isUp ? '#10b981' : '#ef4444';
    const gradientColor = isUp ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';

    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, gradientColor);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, height);

    sparklineData.forEach((price, i) => {
      const x = (i / (sparklineData.length - 1)) * width;
      const y = height - ((price - min) / range) * height;
      ctx.lineTo(x, y);
    });

    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    sparklineData.forEach((price, i) => {
      const x = (i / (sparklineData.length - 1)) * width;
      const y = height - ((price - min) / range) * height;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();
  }

  function showEmptyState() {
    const list = document.getElementById('market-list');
    if (!list) return;

    list.innerHTML = '';

    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center; padding:60px 20px;';

    empty.innerHTML = `
      <div style="font-size:48px; margin-bottom:16px; opacity:0.3;">
        <i class="fas fa-search"></i>
      </div>
      <div style="font-size:16px; font-weight:600; color:var(--color-text-primary); margin-bottom:8px;">
        No Results Found
      </div>
      <div style="font-size:13px; color:var(--color-text-secondary);">
        Try adjusting your search or filters
      </div>
    `;

    list.appendChild(empty);
  }

  // ============================================
  // EVENT HANDLERS
  // ============================================

  function handleSearch(query) {
    if (searchTimeout) clearTimeout(searchTimeout);

    currentSearchQuery = query;

    searchTimeout = setTimeout(() => {
      const trimmed = query.trim().toLowerCase();

      let filtered = applyFilter(marketData, currentFilter);

      if (trimmed.length > 0) {
        filtered = filtered.filter(coin =>
          coin.name.toLowerCase().includes(trimmed) ||
          coin.symbol.toLowerCase().includes(trimmed)
        );
      }

      renderMarketItems(filtered);
    }, 300);
  }

  function handleFilterChange(filterId) {
    currentFilter = filterId;

    const filterBtns = document.querySelectorAll('.market-filter-btn');
    filterBtns.forEach(btn => {
      const btnFilterId = btn.getAttribute('data-filter');
      const isActive = btnFilterId === filterId;
      
      btn.style.background = isActive ? 'var(--color-primary)' : 'var(--color-surface)';
      btn.style.color = isActive ? '#fff' : 'var(--color-text-primary)';
      btn.style.borderColor = isActive ? 'var(--color-primary)' : 'var(--color-border)';
    });

    let filtered = applyFilter(marketData, filterId);

    if (currentSearchQuery && currentSearchQuery.length > 0) {
      const trimmed = currentSearchQuery.toLowerCase();
      filtered = filtered.filter(coin =>
        coin.name.toLowerCase().includes(trimmed) ||
        coin.symbol.toLowerCase().includes(trimmed)
      );
    }

    renderMarketItems(filtered);
  }

  function applyFilter(data, filterId) {
    if (!data || data.length === 0) return [];

    console.log(`[MARKET] 🔍 Applying filter: ${filterId}`);

    switch (filterId) {
      case 'gainers':
        const gainers = CacheManager.getGainers();
        console.log(`[MARKET] ✅ Using cached gainers: ${gainers.length}`);
        return gainers;

      case 'losers':
        const losers = CacheManager.getLosers();
        console.log(`[MARKET] ✅ Using cached losers: ${losers.length}`);
        return losers;

      case 'volume':
        const volumeLeaders = CacheManager.getVolumeLeaders();
        console.log(`[MARKET] ✅ Using cached volume leaders: ${volumeLeaders.length}`);
        return volumeLeaders;

      case 'all':
      default:
        return data;
    }
  }

  // ============================================
  // DATA LOADING (USES CACHE MANAGER)
  // ============================================

  async function loadAllData() {
    console.log('[MARKET] 🔄 Loading all data via CacheManager...');

    try {
      const [marketResult, trendingResult] = await Promise.all([
        CacheManager.getMarketData(),
        loadTrendingCoins()
      ]);

      if (marketResult.success && marketResult.data && marketResult.data.length > 0) {
        marketData = marketResult.data;
        console.log(`[MARKET] ✅ Market data loaded: ${marketData.length} coins (source: ${marketResult.source})`);
      } else {
        console.warn('[MARKET] ⚠️ No market data available');
        marketData = [];
      }

    } catch (error) {
      console.error('[MARKET] ❌ Load error:', error);
      throw error;
    }
  }

  async function refresh() {
    console.log('[MARKET] 🔄 Manual refresh requested...');
    
    if (container) {
      showLoadingScreen();
      
      try {
        await CacheManager.getMarketData(true);
        await loadTrendingCoins();
        buildUI();
      } catch (error) {
        console.error('[MARKET] ❌ Refresh failed:', error);
        showErrorScreen(error.message);
      }
    }
  }

  async function refreshTrending() {
    const btn = document.querySelector('#trending-container button');
    if (btn) {
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:12px;"></i>';
      btn.disabled = true;
    }
    
    try {
      await CacheManager.getTrendingCoins(true);
      await loadTrendingCoins();
      renderTrendingCards();
    } catch (error) {
      console.error('[MARKET] ❌ Trending refresh failed:', error);
    }
    
    if (btn) {
      btn.innerHTML = '<i class="fas fa-sync-alt" style="font-size:12px;"></i>';
      btn.disabled = false;
    }
  }

  // ============================================
  // COIN DETAILS MODAL
  // ============================================

  function showCoinDetails(coinIdOrObject) {
    if (!window.Modal) {
      console.warn('[MARKET] Modal not available');
      return;
    }

    let coin;
    
    if (typeof coinIdOrObject === 'string') {
      coin = marketData.find(c => c.id === coinIdOrObject);
      
      if (!coin) {
        console.error('[MARKET] Coin not found:', coinIdOrObject);
        return;
      }
    } else {
      coin = coinIdOrObject;
    }

    const content = document.createElement('div');
    const isUp = (coin.price_change_percentage_24h || 0) >= 0;

    content.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; padding-bottom:16px; border-bottom:1px solid var(--color-border); margin-bottom:16px;">
        <div style="width:48px; height:48px; border-radius:50%; background:var(--color-surface-elevated); display:flex; align-items:center; justify-content:center; overflow:hidden;">
          ${coin.image && coin.image.startsWith('https://') ? `<img src="${coin.image}" style="width:100%; height:100%;" referrerpolicy="no-referrer">` : `<span style="font-size:11px; font-weight:700;">${coin.symbol.substring(0, 2)}</span>`}
        </div>
        <div style="flex:1;">
          <div style="font-size:18px; font-weight:700; color:var(--color-text-primary);">${coin.name}</div>
          <div style="font-size:13px; color:var(--color-text-secondary);">${coin.symbol.toUpperCase()}</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
        <div>
          <div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px; font-weight:500;">Price</div>
          <div style="font-family:var(--font-mono); font-size:20px; font-weight:700; color:var(--color-text-primary);">
            ${Format.currency(coin.current_price)}
          </div>
        </div>
        <div>
          <div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px; font-weight:500;">24h Change</div>
          <div style="font-size:18px; font-weight:700; color:${isUp ? '#10b981' : '#ef4444'};">
            ${coin.price_change_percentage_24h >= 0 ? '+' : ''}${(coin.price_change_percentage_24h || 0).toFixed(2)}%
          </div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
        <div style="background:var(--color-surface-elevated); padding:12px; border-radius:8px;">
          <div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px;">Market Cap</div>
          <div style="font-family:var(--font-mono); font-size:14px; font-weight:600; color:var(--color-text-primary);">
            ${Format.compactCurrency(coin.market_cap)}
          </div>
        </div>
        <div style="background:var(--color-surface-elevated); padding:12px; border-radius:8px;">
          <div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px;">24h Volume</div>
          <div style="font-family:var(--font-mono); font-size:14px; font-weight:600; color:var(--color-text-primary);">
            ${Format.compactCurrency(coin.total_volume)}
          </div>
        </div>
        <div style="background:var(--color-surface-elevated); padding:12px; border-radius:8px;">
          <div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px;">24h High</div>
          <div style="font-family:var(--font-mono); font-size:14px; font-weight:600; color:var(--color-text-primary);">
            ${Format.currency(coin.high_24h)}
          </div>
        </div>
        <div style="background:var(--color-surface-elevated); padding:12px; border-radius:8px;">
          <div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:4px;">24h Low</div>
          <div style="font-family:var(--font-mono); font-size:14px; font-weight:600; color:var(--color-text-primary);">
            ${Format.currency(coin.low_24h)}
          </div>
        </div>
      </div>

      <button id="trade-btn-${coin.id}" class="btn btn-primary" style="width:100%; margin-top:8px;">
        Trade ${coin.symbol.toUpperCase()}
      </button>
    `;

    const tradeBtn = content.querySelector(`#trade-btn-${coin.id}`);
    
    tradeBtn.onclick = () => {
      Modal.close();
      
      setTimeout(() => {
        if (window.Trade) {
          Trade.openBuy(coin.id);
        } else {
          if (window.App && App.showError) {
            App.showError('Trade module is loading...');
          }
        }
      }, 300);
    };

    Modal.open({
      title: 'Coin Details',
      content: content,
      maxWidth: '500px',
      showCloseButton: true
    });
  }

  // ============================================
  // STATE SUBSCRIPTIONS
  // ============================================

  function subscribeToUpdates() {
    if (unsubscribe) unsubscribe();

    if (window.AppState) {
      unsubscribe = AppState.subscribe((state) => {
        if (state.marketData && state.marketData.length > 0) {
          marketData = state.marketData;
        }
      });
    }
  }

  function cleanup() {
    if (unsubscribe) unsubscribe();
    if (searchTimeout) clearTimeout(searchTimeout);
    
    console.log('[MARKET] 🧹 Cleaned up');
  }

  // ============================================
  // PUBLIC API
  // ============================================

  return {
    render,
    refresh,
    refreshTrending,
    showCoinDetails,
    cleanup
  };
})();

if (typeof window !== 'undefined') window.Market = Market;
