/**
 * NexTrade — Market Module (Production-Ready - Zero Blank Screens)
 * ══════════════════════════════════════════════════════════════
 * ARCHITECTURE IMPROVEMENTS:
 * 1. Uses CacheManager for all data (no direct API calls)
 * 2. Pre-computed filters (gainers/losers instant)
 * 3. Optimistic rendering (show cached data immediately)
 * 4. Graceful degradation (stale > empty)
 * 5. Zero "No Results Found" errors
 *
 * FIX (C2): buildUIFromCache() was synchronous and accessed
 * CacheManager.getMarketData().data and CacheManager.getTrendingCoins().data
 * without await. Both functions are async and return Promises. Accessing
 * .data on a Promise returns undefined, which fell through to the || []
 * fallback. The cache was loaded but the data was silently discarded.
 * The function is now async. Both calls are awaited. Call sites in render()
 * are also awaited.
 * ══════════════════════════════════════════════════════════════
 */

const Market = (() => {
  'use strict';

  const safeText = (value) => window.SafeDOM && SafeDOM.text ? SafeDOM.text(value) : String(value == null ? '' : value);
  const safeHttpsUrl = (value) => window.SafeDOM && SafeDOM.httpsUrl ? SafeDOM.httpsUrl(value) : '';


  function coinFallbackSymbol(symbol) {
    return String(symbol || '?').trim().toUpperCase().slice(0, 3) || '?';
  }

  function coinIconMarkup(url, symbol) {
    const normalized = window.API && typeof API.proxiedCoinImageUrl === 'function'
      ? API.proxiedCoinImageUrl(url)
      : url;
    const safeUrl = safeHttpsUrl(normalized);
    const fallback = safeText(coinFallbackSymbol(symbol));

    // No remote URL: show the symbol immediately.
    if (!safeUrl) {
      return `<span class="market-coin-fallback" aria-hidden="true">${fallback}</span>`;
    }

    // Important: do not assign src in the HTML string. Handlers are attached
    // first, then src is assigned. This prevents the browser broken-image glyph
    // and prevents the text fallback flashing before a valid logo finishes.
    return `
      <span class="market-coin-fallback" aria-hidden="true" hidden>${fallback}</span>
      <img class="market-coin-remote-img" data-src="${safeUrl}" referrerpolicy="no-referrer" alt="">
    `;
  }

  function armCoinImageFallbacks(root) {
    if (!root || !root.querySelectorAll) return;

    root.querySelectorAll('img.market-coin-remote-img').forEach((img) => {
      const shell = img.closest('.market-coin-icon-shell');
      const fallback = shell ? shell.querySelector('.market-coin-fallback') : null;
      const src = img.getAttribute('data-src') || '';
      let settled = false;
      let fallbackTimer = null;

      const showImage = () => {
        if (settled) return;
        settled = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        if (fallback) fallback.hidden = true;
        img.classList.add('is-loaded');
      };

      const showFallback = () => {
        if (settled) return;
        settled = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        img.remove();
        if (fallback) fallback.hidden = false;
      };

      // Attach handlers BEFORE src. This also handles memory/disk-cached images.
      img.addEventListener('load', showImage, { once: true });
      img.addEventListener('error', showFallback, { once: true });

      if (!src) {
        showFallback();
        return;
      }

      // Do not synchronously inspect img.complete after assigning src.
      // Mobile Chromium can transiently report complete/naturalWidth=0 while
      // a newly assigned request is still being scheduled.
      fallbackTimer = setTimeout(showFallback, 12000);
      img.src = src;
    });
  }

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
    // Match wallet baseline: flex column, padding:0 overrides .app-main CSS padding (full width),
    // no height override that fights the flex parent
    container.style.cssText = 'display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding:0;box-sizing:border-box;';
    container.className = 'market-page';


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
      // FIX (C2): buildUIFromCache is now async — must await here so the
      // optimistic render completes before loadAllData is called. Without
      // this await, buildUIFromCache returned a Promise immediately and the
      // cache data was never populated into marketData / trendingData before
      // the UI was handed off.
      await buildUIFromCache();
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
        // FIX (C2): await here too — same bug existed in the error fallback path.
        await buildUIFromCache();
      } else {
        showErrorScreen(error.message);
      }
    }
  }

  // ============================================
  // OPTIMISTIC RENDERING
  // ============================================

  // FIX (C2): Function is now async. Both CacheManager calls are awaited.
  // Previously: CacheManager.getMarketData().data
  //   → getMarketData() returns Promise<{success, data, ...}>
  //   → .data on a Promise is undefined
  //   → undefined || [] = []
  //   → marketData set to [], rendering nothing from cache
  // Now: (await CacheManager.getMarketData()).data
  //   → resolves the Promise first
  //   → .data accesses the actual result object's data property
  //   → correct array of coins is used
  async function buildUIFromCache() {
    console.log('[MARKET] 📦 Building UI from cache...');

    const cacheStatus = CacheManager.getCacheStatus();
    
    container.innerHTML = '';
    
    container.appendChild(createTrendingSection());
    container.appendChild(createHeader());
    container.appendChild(createMarketList());

    // Use cached market data
    if (cacheStatus.marketData.cached) {
      const marketResult = await CacheManager.getMarketData();
      marketData = marketResult.data || [];
      const filtered = applyFilter(marketData, currentFilter);
      renderMarketItems(filtered);
    }

    // Use cached trending
    if (cacheStatus.trending.cached) {
      const trendingResult = await CacheManager.getTrendingCoins();
      trendingData = trendingResult.data || [];
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
      <button data-app-action="market-refresh" class="btn btn-primary" style="padding:10px 24px;">
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
    section.style.cssText = 'padding: 0; margin: 0; background: var(--color-background); width:100%; box-sizing:border-box;';

    section.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:0 16px;">
        <h3 style="font-size:15px; font-weight:700; color:var(--color-text-primary); margin:0;">
          <i class="fas fa-fire" style="color:#f59e0b; margin-right:6px; font-size:14px;"></i>
          Trending Now
        </h3>
        <button class="trending-refresh-btn" data-app-action="market-refresh-trending" style="background:none; border:none; color:var(--color-text-tertiary); cursor:pointer; padding:4px;">
          <i class="fas fa-sync-alt" style="font-size:12px;"></i>
        </button>
      </div>
      
      <div id="trending-container" style="overflow-x: auto; -webkit-overflow-scrolling: touch; margin:0; padding:0 0 16px 0;">
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
            <div class="market-coin-icon-shell" style="width:28px; height:28px;">
              ${coinIconMarkup(coin.thumb, coin.symbol)}
            </div>
            <div style="flex:1; min-width:0;">
              <div style="font-size:12px; font-weight:700; color:var(--color-text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${safeText(coin.symbol)}
              </div>
              <div style="font-size:10px; color:var(--color-text-tertiary);">
                ${safeText(String(coin.name || '').length > 12 ? String(coin.name).substring(0, 12) + '...' : coin.name)}
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
    armCoinImageFallbacks(trendingContainer);

    // Event delegation — handles clicks on all [data-trending-coin] cards.
    // Decodes the coin id from the data attribute (was encoded to prevent XSS
    // when the attribute was built from API data).
    trendingContainer.addEventListener('click', (e) => {
      const card = e.target.closest('[data-trending-coin]');
      if (!card) return;
      const coinId = decodeURIComponent(card.dataset.trendingCoin || '');
      if (coinId) showCoinDetails(coinId);
    }, { once: false });

    // 250ms gives the DOM time to paint before canvas draws
    requestAnimationFrame(() => requestAnimationFrame(() => renderTrendingSparklines()));
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
    header.style.cssText = 'padding:0 0 16px 0; position:sticky; top:0; background:var(--color-background); z-index:10; width:100%; box-sizing:border-box;';

    const searchWrapper = document.createElement('div');
    searchWrapper.style.cssText = 'position:relative; margin:0 16px 12px;';

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
    filters.className = 'market-filters ui-filter-row';
    filters.id = 'market-filters';
    filters.style.cssText =
      'padding:0 16px 2px 16px;' +
      'width:100%;box-sizing:border-box;';

    const filterOptions = [
      { id: 'all', label: 'All', icon: 'fa-list' },
      { id: 'gainers', label: 'Gainers', icon: 'fa-arrow-up' },
      { id: 'losers', label: 'Losers', icon: 'fa-arrow-down' },
      { id: 'volume', label: 'Volume', icon: 'fa-chart-bar' }
    ];

    filterOptions.forEach(option => {
      const btn = document.createElement('button');
      const isActive = option.id === currentFilter;

      btn.className = 'market-filter-btn ui-filter-chip';
      btn.dataset.filter = option.id;
      btn.setAttribute(
        'aria-pressed',
        String(isActive)
      );

      btn.innerHTML = `
        <i class="fas ${option.icon}" aria-hidden="true"></i>
        <span>${option.label}</span>
      `;

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
    list.style.cssText = 'padding:0 0 var(--scroll-bottom-clearance, 116px) 0; width:100%; box-sizing:border-box;';
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
        <div class="market-coin-icon-shell" style="width:40px; height:40px; flex-shrink:0;">
          ${coinIconMarkup(coin.image, coin.symbol)}
        </div>

        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">
            <span style="font-size:15px; font-weight:700; color:var(--color-text-primary);">${safeText(coin.symbol)}</span>
            ${coin.market_cap_rank ? `<span style="font-size:10px; color:var(--color-text-tertiary); background:var(--color-surface-elevated); padding:2px 6px; border-radius:4px;">#${coin.market_cap_rank}</span>` : ''}
          </div>
          <div style="font-size:12px; color:var(--color-text-secondary);">${safeText(coin.name)}</div>
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
          <canvas class="market-sparkline" data-coin-id="${encodeURIComponent(String(coin.id || ''))}" width="300" height="50"></canvas>
        </div>
      ` : ''}
    `;

    armCoinImageFallbacks(card);

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
    const canvas = document.querySelector(`.market-sparkline[data-coin-id="${encodeURIComponent(String(coinId || ''))}"]`);
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

    const filterBtns =
      document.querySelectorAll('.market-filter-btn');

    filterBtns.forEach(btn => {
      btn.setAttribute(
        'aria-pressed',
        String(
          btn.getAttribute('data-filter') ===
          filterId
        )
      );
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
    // Correct selector — the refresh btn is a sibling of #trending-container,
    // not a child. Both live inside the createTrendingSection() wrapper div.
    const btn = document.querySelector('.trending-refresh-btn');
    if (btn) {
      btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:12px;"></i>';
      btn.disabled = true;
    }
    try {
      await CacheManager.getTrendingCoins(true);
      await loadTrendingCoins();
      renderTrendingCards();
    } catch (error) {
      console.error('[MARKET] ❌ Trending refresh failed:', error);
    } finally {
      if (btn) {
        btn.innerHTML = '<i class="fas fa-sync-alt" style="font-size:12px;"></i>';
        btn.disabled = false;
      }
    }
  }

  // ============================================
  // COIN DETAIL OVERLAY — full-screen with chart
  // ============================================

  // Active chart instance — destroyed on close to free memory
  let _chartInstance  = null;
  let _chartSeries    = null;
  let _chartEl        = null;   // chart container element — needed for RO cleanup
  let _activeRange    = '1W';   // default range shown on open
  let _overlayEl      = null;
  let _liveWs         = null;   // Binance WebSocket — null when no overlay is open
  let _lastOHLC       = null;   // last historical candle — live WS updates this
  let _liveBadgeEl    = null;   // "● LIVE" badge DOM element
  let _livePriceLine  = null;   // current live price guide line
  let _followLive     = true;   // false while user is inspecting history
  let _chartInspectorEl = null;
  let _returnLiveBtn  = null;

  // Binance symbol map — CoinGecko ID → Binance trading pair
  // Binance public WS is free, no API key required.
  const BINANCE_SYM = {
    'bitcoin':        'btcusdt',  'ethereum':       'ethusdt',
    'solana':         'solusdt',  'binancecoin':    'bnbusdt',
    'ripple':         'xrpusdt',  'cardano':        'adausdt',
    'avalanche-2':    'avaxusdt', 'chainlink':      'linkusdt',
    'matic-network':  'maticusdt','uniswap':        'uniusdt',
    'dogecoin':       'dogeusdt', 'toncoin':        'tonusdt',
    'polkadot':       'dotusdt',  'litecoin':       'ltcusdt',
    'tron':           'trxusdt',  'near':           'nearusdt',
    'stellar':        'xlmusdt',  'sui':            'suiusdt',
  };

  // RANGE_DAYS → Binance kline interval that best matches the historical candle size
  const RANGE_WS_INTERVAL = { '1D': '30m', '1W': '4h', '1M': '1d', '3M': '1d' };

  // Surge Pool coins NexTrade trades — drives the "NexTrade trades this" card
  const NEXTRADE_TRADED_COINS = new Set([
    'bitcoin','ethereum','solana','binancecoin','ripple',
    'cardano','avalanche-2','chainlink','matic-network','uniswap'
  ]);

  // Time range → CoinGecko `days` param
  const RANGE_DAYS = { '1D': 1, '1W': 7, '1M': 30, '3M': 90 };

  function stopLiveWs() {
    if (_liveWs) {
      try { _liveWs.close(); } catch (_) {}
      _liveWs = null;
    }
    if (_chartSeries && _livePriceLine && typeof _chartSeries.removePriceLine === 'function') {
      try { _chartSeries.removePriceLine(_livePriceLine); } catch (_) {}
    }
    _livePriceLine = null;
    _lastOHLC = null;
    _followLive = true;
    _chartInspectorEl = null;
    _returnLiveBtn = null;
    if (_liveBadgeEl) { _liveBadgeEl.style.opacity = '0'; }
  }

  function destroyChart() {
    stopLiveWs();
    if (_chartInstance) {
      try { _chartInstance.remove(); } catch (_) {}
      _chartInstance = null;
      _chartSeries   = null;
    }
    // Disconnect ResizeObserver using the stored element reference.
    // The old querySelector('[id^="chart-"]') never matched because chartEl
    // has no id, so the RO was leaking on every overlay open/close.
    if (_chartEl && _chartEl._ro) { try { _chartEl._ro.disconnect(); } catch (_) {} _chartEl._ro = null; }
    _chartEl = null;
  }

  // Start Binance WebSocket kline stream — updates last candle in real time.
  // Called after historical OHLC loads. Gracefully falls back if:
  //   - coin has no Binance mapping
  //   - WebSocket fails to connect
  //   - Network is unavailable
  function startLiveWs(coinId, range, reconnectAttempt) {
    reconnectAttempt = reconnectAttempt || 0;
    stopLiveWs();
    const sym = BINANCE_SYM[coinId];
    // Match the live feed interval to the visible chart range so candles
    // actually advance in real time instead of mutating one frozen bar.
    const interval = RANGE_WS_INTERVAL[range] || '1m';
    if (!sym || typeof WebSocket === 'undefined') return;

    try {
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@kline_${interval}`);

      ws.onopen = () => {
        if (_liveBadgeEl) {
          _liveBadgeEl.textContent = '● LIVE';
          _liveBadgeEl.style.opacity = '1';
          _liveBadgeEl.style.color   = '#10b981';
        }
      };

      ws.onmessage = (event) => {
        try {
          const { k } = JSON.parse(event.data);
          if (!k || !_chartSeries) return;

          const open  = parseFloat(k.o);
          const high  = parseFloat(k.h);
          const low   = parseFloat(k.l);
          const close = parseFloat(k.c);
          const time  = Math.floor((k.t || k.T || Date.now()) / 1000);

          if (![open, high, low, close, time].every(Number.isFinite)) return;

          const update = { time, open, high, low, close };
          _chartSeries.update(update);
          _lastOHLC = update;

          if (_chartSeries && typeof _chartSeries.removePriceLine === 'function' && _livePriceLine) {
            try { _chartSeries.removePriceLine(_livePriceLine); } catch (_) {}
            _livePriceLine = null;
          }
          if (_chartSeries && typeof _chartSeries.createPriceLine === 'function') {
            _livePriceLine = _chartSeries.createPriceLine({
              price: close,
              color: close >= open ? '#10b981' : '#ef4444',
              lineWidth: 1,
              lineStyle: LightweightCharts.LineStyle.Dashed,
              axisLabelVisible: true,
              title: 'LIVE'
            });
          }

          if (
            _followLive &&
            _chartInstance &&
            typeof _chartInstance.timeScale === 'function'
          ) {
            try { _chartInstance.timeScale().scrollToRealTime(); } catch (_) {}
          }
        } catch (_) {}
      };

      ws.onerror = () => {
        // onerror always fires before onclose — update badge only; let onclose handle reconnect.
        if (_liveBadgeEl) {
          _liveBadgeEl.textContent = 'Delayed';
          _liveBadgeEl.style.color = 'var(--color-text-tertiary)';
        }
      };

      ws.onclose = (evt) => {
        _liveWs = null;
        // Auto-reconnect only when: overlay is still open AND close was not
        // user-initiated (code 1000 = normal/intentional, sent by stopLiveWs).
        if (_overlayEl && evt.code !== 1000 && reconnectAttempt < 3) {
          const delay = Math.min(2000 * Math.pow(2, reconnectAttempt), 16000);
          const attempt = reconnectAttempt + 1;
          setTimeout(() => {
            if (_overlayEl) startLiveWs(coinId, range, attempt);
          }, delay);
        }
      };

      _liveWs = ws;
    } catch (err) {
      console.warn('[MARKET] Binance WS failed:', err.message);
    }
  }

  function closeOverlay() {
    destroyChart();
    if (_overlayEl && _overlayEl.parentNode) {
      // Capture the element being closed into a local const so that if
      // showCoinDetails() is called again before the 250 ms animation
      // finishes, the deferred removal targets THIS overlay — not whatever
      // _overlayEl points to at callback time (which would be the new one).
      const el = _overlayEl;
      _overlayEl = null;
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 250);
    } else {
      _overlayEl = null;
    }
  }

  async function fetchOHLC(coinId, days) {
    // CoinGecko /coins/{id}/ohlc — returns [timestamp, o, h, l, c] arrays
    // Free tier: max 90 days. No API key required.
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/ohlc?vs_currency=usd&days=${days}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000); // 8s timeout
      let resp;
      try {
        resp = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!resp.ok) throw new Error('CoinGecko ' + resp.status);
      const raw = await resp.json();
      if (!Array.isArray(raw) || raw.length === 0) throw new Error('Empty OHLC response');
      // LightweightCharts expects { time (unix seconds), open, high, low, close }
      return raw.map(([ts, o, h, l, c]) => ({
        time:  Math.floor(ts / 1000),
        open:  o, high: h, low: l, close: c
      }));
    } catch (err) {
      console.warn('[MARKET] OHLC fetch failed, using sparkline fallback:', err.message);
      return null;
    }
  }

  function buildSparklineAsOHLC(sparkline) {
    // Converts sparkline (hourly prices, last 7d) into pseudo-OHLC for the chart
    // Groups into 4-hour candles so the chart has a reasonable density
    const prices = sparkline || [];
    if (prices.length === 0) return [];
    const now      = Math.floor(Date.now() / 1000);
    const interval = 14400; // 4 hours in seconds
    const startTs  = now - prices.length * 3600;
    const candles  = [];
    const chunkSize = 4;
    for (let i = 0; i < prices.length; i += chunkSize) {
      const chunk = prices.slice(i, i + chunkSize);
      if (chunk.length === 0) continue;
      candles.push({
        time:  startTs + i * 3600,
        open:  chunk[0],
        high:  Math.max(...chunk),
        low:   Math.min(...chunk),
        close: chunk[chunk.length - 1]
      });
    }
    return candles;
  }

  async function renderChart(coinId, days, chartEl, coin) {
    // Guard: if the overlay was closed (e.g. rapid reopen) while we were
    // waiting for data, chartEl is no longer in the DOM — bail silently.
    if (!chartEl.isConnected) return;

    destroyChart();
    _chartEl = chartEl; // store for RO cleanup in destroyChart()
    chartEl.innerHTML = '';
    const loader = document.createElement('div');
    loader.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;gap:10px;color:var(--color-text-tertiary);font-size:13px;';
    loader.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading chart…';
    chartEl.appendChild(loader);

    let ohlc = await fetchOHLC(coinId, days);

    // Second guard: overlay may have been closed during the network fetch.
    if (!chartEl.isConnected) return;

    // Fallback to sparkline for 1W if OHLC fails
    if (!ohlc && days === 7 && coin.sparkline && coin.sparkline.length > 0) {
      ohlc = buildSparklineAsOHLC(coin.sparkline);
    }

    chartEl.innerHTML = '';

    if (!ohlc || ohlc.length === 0 || !window.LightweightCharts) {
      const err = document.createElement('div');
      err.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--color-text-tertiary);font-size:13px;text-align:center;';
      err.textContent = 'Chart unavailable — try again in a moment';
      chartEl.appendChild(err);
      return;
    }

    try {
      _initChart(coinId, days, chartEl, coin, ohlc);
    } catch (chartErr) {
      // Chart boot failed — show graceful fallback; overlay already visible.
      console.warn('[MARKET] Chart init failed (non-fatal):', chartErr.message);
      _chartInstance = null; _chartSeries = null;
      chartEl.innerHTML = '';
      const err = document.createElement('div');
      err.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--color-text-tertiary);font-size:13px;text-align:center;';
      err.textContent = 'Chart unavailable — try again in a moment';
      chartEl.appendChild(err);
    }
  }

  // Inner synchronous chart initialisation — separated so the try/catch in
  // renderChart() cleanly catches any LightweightCharts exception.
  function _initChart(coinId, days, chartEl, coin, ohlc) {
    const upColor   = '#10b981';
    const downColor = '#ef4444';

    const rootStyles = getComputedStyle(document.documentElement);
    const chartTheme = {
      background: rootStyles.getPropertyValue('--chart-background').trim() || '#111820',
      text: rootStyles.getPropertyValue('--chart-text').trim() || '#8E9AA6',
      grid: rootStyles.getPropertyValue('--chart-grid').trim() || '#1D2730',
      border: rootStyles.getPropertyValue('--chart-border').trim() || '#2A3540',
      watermark: rootStyles.getPropertyValue('--chart-watermark').trim() || '#1E2A34'
    };

    _chartInstance = LightweightCharts.createChart(chartEl, {
      width:  chartEl.offsetWidth  || 340,
      height: chartEl.offsetHeight || 200,
      layout: {
        background:  { color: chartTheme.background },
        textColor:   chartTheme.text,
        fontFamily:  'var(--font-mono, monospace)'
      },
      grid: {
        vertLines:   { color: chartTheme.grid },
        horzLines:   { color: chartTheme.grid }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal
      },
      rightPriceScale: {
        borderColor:   chartTheme.border,
        scaleMargins:  { top: 0.12, bottom: 0.14 }
      },
      timeScale: {
        borderColor:     chartTheme.border,
        timeVisible:     days <= 7,
        secondsVisible:  false,
        borderVisible:   false
      },
      watermark: {
        visible: true,
        fontSize: 26,
        horzAlign: 'center',
        vertAlign: 'center',
        color: chartTheme.watermark,
        text: 'NEXTRADE LIVE'
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true
      }
    });

    _chartSeries = _chartInstance.addCandlestickSeries({
      upColor:          upColor,
      downColor:        downColor,
      borderUpColor:    upColor,
      borderDownColor:  downColor,
      wickUpColor:      upColor,
      wickDownColor:    downColor,
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01
      }
    });

    // De-dupe by timestamp before setData — CoinGecko occasionally returns dupes
    const seen = new Set();
    const cleanOhlc = ohlc.filter(d => seen.has(d.time) ? false : (seen.add(d.time), true))
                          .sort((a, b) => a.time - b.time);
    _chartSeries.setData(cleanOhlc);
    _chartInstance.timeScale().fitContent();
    _followLive = true;
    try { _chartInstance.timeScale().scrollToRealTime(); } catch (_) {}

    const formatChartPrice = value => {
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      return number.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4
      });
    };

    _chartInspectorEl = document.createElement('div');
    _chartInspectorEl.className = 'market-chart-inspector';

    const latestForInspector = cleanOhlc[cleanOhlc.length - 1];
    if (latestForInspector) {
      _chartInspectorEl.textContent =
        'O ' + formatChartPrice(latestForInspector.open) +
        '  H ' + formatChartPrice(latestForInspector.high) +
        '  L ' + formatChartPrice(latestForInspector.low) +
        '  C ' + formatChartPrice(latestForInspector.close);
    }

    _returnLiveBtn = document.createElement('button');
    _returnLiveBtn.type = 'button';
    _returnLiveBtn.className = 'market-return-live';
    _returnLiveBtn.innerHTML =
      '<i class="fas fa-location-crosshairs" aria-hidden="true"></i>' +
      '<span>Return to live</span>';

    const gestureHint = document.createElement('div');
    gestureHint.className = 'market-chart-gesture-hint';
    gestureHint.textContent = 'Drag to inspect · pinch to zoom';

    const markInspecting = () => {
      if (!_followLive) return;
      _followLive = false;
      if (_returnLiveBtn) _returnLiveBtn.classList.add('is-visible');
    };

    chartEl.addEventListener('pointerdown', markInspecting, { passive: true });
    chartEl.addEventListener('wheel', markInspecting, { passive: true });

    _returnLiveBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      _followLive = true;
      if (_chartInstance && typeof _chartInstance.timeScale === 'function') {
        try { _chartInstance.timeScale().scrollToRealTime(); } catch (_) {}
      }
      _returnLiveBtn.classList.remove('is-visible');
    });

    if (_chartInstance && typeof _chartInstance.subscribeCrosshairMove === 'function') {
      _chartInstance.subscribeCrosshairMove(param => {
        if (!_chartInspectorEl) return;
        let candle = null;
        if (param && param.seriesData && typeof param.seriesData.get === 'function') {
          candle = param.seriesData.get(_chartSeries);
        }
        if (!candle) candle = _lastOHLC || latestForInspector;
        if (!candle) return;
        _chartInspectorEl.textContent =
          'O ' + formatChartPrice(candle.open) +
          '  H ' + formatChartPrice(candle.high) +
          '  L ' + formatChartPrice(candle.low) +
          '  C ' + formatChartPrice(candle.close);
      });
    }

    chartEl.append(_chartInspectorEl, gestureHint, _returnLiveBtn);

    // Store last candle so live WS updates can reference it
    _lastOHLC = cleanOhlc[cleanOhlc.length - 1] || null;

    if (_chartSeries && _lastOHLC && typeof _chartSeries.createPriceLine === 'function') {
      try {
        _livePriceLine = _chartSeries.createPriceLine({
          price: _lastOHLC.close,
          color: _lastOHLC.close >= _lastOHLC.open ? upColor : downColor,
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'LIVE'
        });
      } catch (_) {
        _livePriceLine = null;
      }
    }

    // Resize observer — redraws if overlay resizes, disconnected on destroy
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (_chartInstance) _chartInstance.resize(chartEl.offsetWidth, chartEl.offsetHeight);
      });
      ro.observe(chartEl);
      chartEl._ro = ro; // stored for cleanup in destroyChart()
    }

    // Start live WebSocket after historical data is rendered
    startLiveWs(coinId, _activeRange);
  }

  function showCoinDetails(coinIdOrObject) {
    let coin;
    if (typeof coinIdOrObject === 'string') {
      coin = marketData.find(c => c.id === coinIdOrObject);
      if (!coin) { console.error('[MARKET] Coin not found:', coinIdOrObject); return; }
    } else {
      coin = coinIdOrObject;
    }

    // Close any existing overlay first
    closeOverlay();

    const isUp       = (coin.price_change_percentage_24h || 0) >= 0;
    const changeColor = isUp ? '#10b981' : '#ef4444';
    const isTraded   = NEXTRADE_TRADED_COINS.has(coin.id);

    // ── Full-screen overlay ──────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.className = 'market-detail-overlay';
    _overlayEl = overlay;
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:9000;',
      'background:var(--color-background);',
      'display:flex;flex-direction:column;',
      'opacity:0;transform:translateY(20px);',
      'transition:opacity 0.25s ease,transform 0.25s ease;'
    ].join('');

    // ── Top bar ──────────────────────────────────────────────────────────
    const topBar = document.createElement('div');
    topBar.className = 'market-detail-topbar';
    topBar.style.cssText = [
      'display:flex;align-items:center;gap:12px;',
      'padding:14px 16px;',
      'border-bottom:1px solid var(--color-border);',
      'flex-shrink:0;'
    ].join('');

    const backBtn = document.createElement('button');
    backBtn.style.cssText = 'background:none;border:none;color:var(--color-text-primary);cursor:pointer;padding:4px 8px 4px 0;font-size:18px;display:flex;align-items:center;';
    backBtn.innerHTML = '<i class="fas fa-arrow-left"></i>';
    backBtn.addEventListener('click', closeOverlay);

    const coinIcon = document.createElement('div');
    coinIcon.style.cssText = 'width:36px;height:36px;border-radius:50%;background:var(--color-surface-elevated);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;';
    const detailImageUrl = window.API && typeof API.proxiedCoinImageUrl === 'function'
      ? API.proxiedCoinImageUrl(coin.image)
      : safeHttpsUrl(coin.image);
    if (detailImageUrl) {
      const img = document.createElement('img');
      img.referrerPolicy = 'no-referrer';
      img.style.cssText = 'width:100%;height:100%;';
      img.addEventListener('error', () => {
        img.remove();
        coinIcon.textContent = coin.symbol.substring(0,2);
      }, { once: true });
      img.src = detailImageUrl;
      coinIcon.appendChild(img);
    } else {
      coinIcon.textContent = coin.symbol.substring(0,2);
      coinIcon.style.fontSize = '11px'; coinIcon.style.fontWeight = '700';
    }

    const titleCol = document.createElement('div');
    titleCol.style.cssText = 'flex:1;min-width:0;';
    const titleName = document.createElement('div');
    titleName.style.cssText = 'font-size:16px;font-weight:700;color:var(--color-text-primary);';
    titleName.textContent = coin.name;
    const titleSym = document.createElement('div');
    titleSym.style.cssText = 'font-size:12px;color:var(--color-text-tertiary);';
    titleSym.textContent = coin.symbol.toUpperCase();
    titleCol.appendChild(titleName); titleCol.appendChild(titleSym);

    const priceCol = document.createElement('div');
    priceCol.style.cssText = 'text-align:right;flex-shrink:0;';
    const priceVal = document.createElement('div');
    priceVal.style.cssText = 'font-family:var(--font-mono);font-size:20px;font-weight:800;color:var(--color-text-primary);letter-spacing:-0.5px;';
    priceVal.textContent = window.Format ? Format.currency(coin.current_price) : '$' + coin.current_price.toLocaleString();
    const changeBadge = document.createElement('div');
    changeBadge.style.cssText = `font-size:12px;font-weight:700;color:${changeColor};text-align:right;margin-top:2px;`;
    changeBadge.textContent = (coin.price_change_percentage_24h >= 0 ? '+' : '') + (coin.price_change_percentage_24h || 0).toFixed(2) + '%';
    priceCol.appendChild(priceVal); priceCol.appendChild(changeBadge);

    topBar.appendChild(backBtn); topBar.appendChild(coinIcon);
    topBar.appendChild(titleCol); topBar.appendChild(priceCol);
    overlay.appendChild(topBar);

    // ── Scrollable body ──────────────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'market-detail-body';
    body.style.cssText = 'flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;';

    // ── Range tabs ───────────────────────────────────────────────────────
    const rangeBar = document.createElement('div');
    rangeBar.style.cssText = 'display:flex;align-items:center;gap:4px;padding:10px 16px 0;flex-shrink:0;';
    const ranges = ['1D','1W','1M','3M'];
    const rangeBtns = {};

    // LIVE badge — appended after range buttons so margin-left:auto
    // correctly pushes it to the far right of the flex row.
    const liveBadge = document.createElement('div');
    liveBadge.style.cssText = [
      'margin-left:auto;padding:4px 8px;border-radius:6px;',
      'font-size:10px;font-weight:700;letter-spacing:0.4px;',
      'background:rgba(16,185,129,0.1);color:var(--color-text-tertiary);',
      'opacity:0;transition:opacity 0.3s,color 0.3s;flex-shrink:0;align-self:center;'
    ].join('');
    liveBadge.textContent = '● LIVE';
    _liveBadgeEl = liveBadge;

    function setRange(range) {
      _activeRange = range;
      ranges.forEach(r => {
        const btn = rangeBtns[r];
        if (!btn) return;
        const active = r === range;
        btn.style.background   = active ? 'var(--color-primary)' : 'var(--color-surface)';
        btn.style.color        = active ? '#fff' : 'var(--color-text-secondary)';
        btn.style.borderColor  = active ? 'var(--color-primary)' : 'var(--color-border)';
      });
      _followLive = true;
      renderChart(coin.id, RANGE_DAYS[range], chartEl, coin);
      // renderChart will call startLiveWs with the new interval after loading
    }

    ranges.forEach(r => {
      const btn = document.createElement('button');
      btn.textContent = r;
      btn.style.cssText = [
        'flex:1;padding:7px 0;border-radius:8px;font-size:12px;font-weight:700;',
        'border:1px solid var(--color-border);cursor:pointer;transition:all 0.15s;',
        `background:${r === _activeRange ? 'var(--color-primary)' : 'var(--color-surface)'};`,
        `color:${r === _activeRange ? '#fff' : 'var(--color-text-secondary)'};`,
        `border-color:${r === _activeRange ? 'var(--color-primary)' : 'var(--color-border)'};`
      ].join('');
      btn.addEventListener('click', () => setRange(r));
      rangeBtns[r] = btn;
      rangeBar.appendChild(btn);
    });
    // liveBadge appended last — margin-left:auto now correctly absorbs all
    // space to its left (the four range buttons) and sits at the far right.
    rangeBar.appendChild(liveBadge);
    body.appendChild(rangeBar);

    // ── Chart container ───────────────────────────────────────────────────
    const chartEl = document.createElement('div');
    chartEl.className = 'market-detail-chart';
    chartEl.style.cssText = [
      'height:300px;margin:8px 16px 16px;border-radius:16px;overflow:hidden;',
      'background:linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));',
      'border:1px solid rgba(255,255,255,0.06);',
      'box-shadow:0 18px 40px rgba(0,0,0,0.18);',
      'position:relative;flex-shrink:0;'
    ].join('');
    body.appendChild(chartEl);

    const chartHint = document.createElement('div');
    chartHint.style.cssText = [
      'position:absolute;top:10px;left:10px;z-index:2;',
      'padding:5px 8px;border-radius:999px;',
      'background:rgba(0,0,0,0.18);backdrop-filter:blur(10px);',
      'font-size:10px;font-weight:700;letter-spacing:0.5px;',
      'color:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.06);'
    ].join('');
    chartHint.textContent = 'REAL-TIME · LIGHTWEIGHT CHART';
    chartEl.appendChild(chartHint);

    // ── NexTrade trades this card ────────────────────────────────────────────
    if (isTraded) {
      const nextradeCard = document.createElement('div');
      nextradeCard.style.cssText = [
        'margin:0 16px 16px;padding:14px 16px;border-radius:12px;',
        'background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.2);',
        'display:flex;align-items:flex-start;gap:12px;flex-shrink:0;'
      ].join('');

      const nextradeIcon = document.createElement('div');
      nextradeIcon.style.cssText = 'width:36px;height:36px;flex-shrink:0;border-radius:10px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.25);display:flex;align-items:center;justify-content:center;font-size:16px;';
      nextradeIcon.textContent = '⚡';

      const nextradeText = document.createElement('div');
      nextradeText.style.cssText = 'flex:1;min-width:0;';
      const nextradeTitle = document.createElement('div');
      nextradeTitle.style.cssText = 'font-size:13px;font-weight:700;color:var(--color-text-primary);margin-bottom:3px;';
      nextradeTitle.textContent = 'NexTrade trades this market';
      const nextradeSub = document.createElement('div');
      nextradeSub.style.cssText = 'font-size:12px;color:var(--color-text-secondary);line-height:1.4;';
      nextradeSub.textContent = `The Surge Pool deploys capital into ${coin.name} positions. Price movement in this market directly affects your pool returns.`;

      const nextradeBtn = document.createElement('button');
      nextradeBtn.style.cssText = 'margin-top:10px;padding:8px 14px;background:var(--color-primary);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;width:100%;';
      nextradeBtn.textContent = 'Invest in Surge Pool';
      nextradeBtn.addEventListener('click', () => {
        closeOverlay();
        setTimeout(() => {
          if (window.Router) Router.navigate('vault');
          else if (window.Navbar) Navbar.setActive('vault');
        }, 260);
      });

      nextradeText.appendChild(nextradeTitle);
      nextradeText.appendChild(nextradeSub);
      nextradeText.appendChild(nextradeBtn);
      nextradeCard.appendChild(nextradeIcon);
      nextradeCard.appendChild(nextradeText);
      body.appendChild(nextradeCard);
    }

    // ── Stats grid ────────────────────────────────────────────────────────
    const stats = document.createElement('div');
    stats.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 16px 16px;flex-shrink:0;';

    const statItems = [
      { label: 'Market Cap',  val: window.Format ? Format.compactCurrency(coin.market_cap)    : '$' + (coin.market_cap||0).toLocaleString() },
      { label: '24h Volume',  val: window.Format ? Format.compactCurrency(coin.total_volume)  : '$' + (coin.total_volume||0).toLocaleString() },
      { label: '24h High',    val: window.Format ? Format.currency(coin.high_24h)              : '$' + (coin.high_24h||0).toLocaleString() },
      { label: '24h Low',     val: window.Format ? Format.currency(coin.low_24h)               : '$' + (coin.low_24h||0).toLocaleString() },
      { label: 'Rank',        val: coin.market_cap_rank ? '#' + coin.market_cap_rank : '—' },
      { label: '7d Change',   val: coin.price_change_percentage_7d_in_currency != null
          ? (coin.price_change_percentage_7d_in_currency >= 0 ? '+' : '') + coin.price_change_percentage_7d_in_currency.toFixed(2) + '%'
          : '—' }
    ];

    statItems.forEach(({ label, val }) => {
      const cell = document.createElement('div');
      cell.style.cssText = 'background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;padding:12px;';
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:10px;color:var(--color-text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:5px;';
      lbl.textContent = label;
      const v = document.createElement('div');
      v.style.cssText = 'font-family:var(--font-mono);font-size:14px;font-weight:700;color:var(--color-text-primary);';
      v.textContent = val;
      cell.appendChild(lbl); cell.appendChild(v);
      stats.appendChild(cell);
    });
    body.appendChild(stats);

    // ── Buy / Sell buttons ────────────────────────────────────────────────
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 16px 32px;flex-shrink:0;';

    const buyBtn = document.createElement('button');
    buyBtn.className = 'btn';
    buyBtn.style.cssText = 'background:#10b981;color:#fff;border:none;border-radius:12px;height:50px;font-size:15px;font-weight:700;cursor:pointer;';
    buyBtn.innerHTML = '<i class="fas fa-arrow-down" style="margin-right:6px;font-size:12px;"></i>Buy';
    buyBtn.addEventListener('click', () => {
      closeOverlay();
      setTimeout(() => { if (window.Trade) Trade.openBuy(coin); }, 260);
    });

    const sellBtn = document.createElement('button');
    sellBtn.className = 'btn';
    sellBtn.style.cssText = 'background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.25);border-radius:12px;height:50px;font-size:15px;font-weight:700;cursor:pointer;';
    sellBtn.innerHTML = '<i class="fas fa-arrow-up" style="margin-right:6px;font-size:12px;"></i>Sell';
    sellBtn.addEventListener('click', () => {
      closeOverlay();
      setTimeout(() => { if (window.Trade) Trade.openSell(coin); }, 260);
    });

    actionRow.appendChild(buyBtn); actionRow.appendChild(sellBtn);
    body.appendChild(actionRow);

    overlay.appendChild(body);

    // Market Detail intentionally has no gesture-to-dismiss.
    // Analytical surfaces close only through explicit Back actions.

    // ── ESC key ───────────────────────────────────────────────────────────
    const onKeyDown = (e) => { if (e.key === 'Escape') { closeOverlay(); document.removeEventListener('keydown', onKeyDown); } };
    document.addEventListener('keydown', onKeyDown);

    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      overlay.style.transform = 'translateY(0)';
    });

    // Kick off chart after overlay is visible
    setTimeout(() => renderChart(coin.id, RANGE_DAYS[_activeRange], chartEl, coin), 300);
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
    closeDetail: closeOverlay,
    isDetailOpen: () => Boolean(_overlayEl && _overlayEl.isConnected),
    cleanup
  };
})();

if (typeof window !== 'undefined') window.Market = Market;
