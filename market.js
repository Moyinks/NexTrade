/**
 * NexTrade — Market Module (Institutional Premium)
 * * VISUALS: Area Chart Sparklines, Glass Headers, Responsive Grid.
 * * LOGIC: Full integration with Trade.js for instant Buy/Sell execution.
 * * FIXES: Corrected syntax errors and event binding logic.
 */

const Market = (() => {
  'use strict';

  // ============================================
  // STATE
  // ============================================
  let container = null;
  let unsubscribe = null;
  let searchTimeout = null;
  let currentFilter = 'all'; // 'all' = Market Cap
  let isLoading = false;

  // ============================================
  // SPARKLINE ENGINE V2 (Area Chart)
  // ============================================
  function generateSparkline(data, isUp) {
    // Fallback if no data
    if (!data || data.length < 2) return '';

    const width = 120;
    const height = 40;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    
    // Color Palette (Obsidian Neon)
    const strokeColor = isUp ? '#10B981' : '#EF4444'; 
    const fillColor = isUp ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';

    // 1. Generate Line Path
    const step = width / (data.length - 1);
    let pathPoints = data.map((val, i) => {
      const x = i * step;
      const y = height - ((val - min) / range) * height; // Invert Y for SVG
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' L ');

    const linePath = `M ${pathPoints}`;

    // 2. Generate Fill Path (Close the loop)
    const fillPath = `${linePath} L ${width},${height} L 0,${height} Z`;

    return `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%; height:100%; display:block;">
        <path d="${fillPath}" fill="${fillColor}" stroke="none" />
        <path d="${linePath}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
  }

  // ============================================
  // RENDER ENTRY
  // ============================================
  function render(element) {
    if (!element) return;
    container = element;
    container.className = 'market-page';
    container.innerHTML = '';

    // 1. Header (Search & Filters)
    container.appendChild(createHeader());

    // 2. List Container
    const list = document.createElement('div');
    list.className = 'market-list';
    list.id = 'market-list';
    // Add extra padding for bottom nav
    list.style.paddingBottom = '120px'; 
    container.appendChild(list);

    // 3. Load Data
    loadMarketData();
  }

  // ============================================
  // HEADER & FILTERS
  // ============================================
  function createHeader() {
    const header = document.createElement('div');
    header.className = 'market-header';
    header.style.background = 'rgba(11, 14, 17, 0.95)';
    header.style.backdropFilter = 'blur(12px)';

    // Search Bar
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'market-search';
    searchWrapper.innerHTML = `
      <span class="market-search-icon">🔍</span>
      <input type="text" class="market-search-input" placeholder="Search assets..." id="market-search">
    `;
    searchWrapper.querySelector('input').addEventListener('input', (e) => handleSearch(e.target.value));

    // Filters Row
    const filters = document.createElement('div');
    filters.className = 'market-filters';
    
    const options = [
      { id: 'all', label: 'Market Cap' },
      { id: 'gainers', label: 'Top Gainers' },
      { id: 'losers', label: 'Top Losers' },
      { id: 'volume', label: 'Volume' }
    ];

    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = `market-filter-btn ${currentFilter === opt.id ? 'active' : ''}`;
      btn.textContent = opt.label;
      btn.onclick = () => {
        currentFilter = opt.id;
        // Visual toggle
        filters.querySelectorAll('.market-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Logic execution
        const data = AppState.get('marketData') || [];
        renderMarketItems(applyFilter(data, currentFilter));
      };
      filters.appendChild(btn);
    });

    header.appendChild(searchWrapper);
    header.appendChild(filters);
    return header;
  }

  // ============================================
  // DATA CONTROLLER
  // ============================================
  async function loadMarketData() {
    const list = document.getElementById('market-list');
    if (!list) return;

    list.innerHTML = `
      <div style="padding:60px; text-align:center;">
        <div class="spinner" style="margin:0 auto 16px auto;"></div>
        <div style="font-size:12px; color:var(--color-text-tertiary);">Live Prices & Charts...</div>
      </div>
    `;

    // Fetch new data via API
    if (window.API) {
      // Ensure your API.js is set to fetch 100 coins with sparklines
      const res = await API.getMarketData(100);
      if (res.success) {
        renderMarketItems(applyFilter(res.data, currentFilter));
      } else {
        list.innerHTML = `<div class="empty-state">Failed to load market data.</div>`;
      }
    }
  }

  function handleSearch(query) {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const term = query.toLowerCase().trim();
      const allData = AppState.get('marketData') || [];
      
      if (!term) {
        renderMarketItems(applyFilter(allData, currentFilter));
        return;
      }

      // If searching, ignore filters and search everything
      const filtered = allData.filter(c => 
        (c.name || '').toLowerCase().includes(term) || 
        (c.symbol || '').toLowerCase().includes(term)
      );
      renderMarketItems(filtered);
    }, 250);
  }

  function applyFilter(data, filter) {
    if (!data || !Array.isArray(data)) return [];
    
    // Create a shallow copy to sort safely
    let sorted = [...data];

    switch (filter) {
      case 'gainers':
        return sorted
          .filter(c => (c.price_change_percentage_24h || 0) > 0)
          .sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h);
      
      case 'losers':
        return sorted
          .filter(c => (c.price_change_percentage_24h || 0) < 0)
          .sort((a, b) => a.price_change_percentage_24h - b.price_change_percentage_24h);
      
      case 'volume':
        return sorted.sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0));
      
      case 'all':
      default:
        // Default API order (Market Cap Desc)
        return sorted.sort((a, b) => (a.market_cap_rank || 999) - (b.market_cap_rank || 999));
    }
  }

  // ============================================
  // RENDERER (The Grid Layout)
  // ============================================
  function renderMarketItems(coins) {
    const list = document.getElementById('market-list');
    if (!list) return;
    
    list.innerHTML = '';

    if (!coins || coins.length === 0) {
      list.innerHTML = `<div class="empty-state" style="text-align:center; padding:40px; color:var(--color-text-tertiary);">No results found.</div>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    coins.forEach(coin => {
      const isUp = (coin.price_change_percentage_24h || 0) >= 0;
      const colorClass = isUp ? 'text-success' : 'text-danger';
      const chartSVG = generateSparkline(coin.sparkline, isUp);

      const item = document.createElement('div');
      item.className = 'market-item';
      
      // GRID LAYOUT: [Icon] [Name/Sym] [Chart] [Price/Change]
      item.style.cssText = `
        display: grid;
        grid-template-columns: 44px 1.5fr 2fr 1.5fr; 
        align-items: center;
        gap: 12px;
        padding: 16px;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-surface);
        height: 80px; 
        cursor: pointer;
        transition: background-color 0.2s;
      `;
      
      // Hover Effect
      item.onmouseenter = () => item.style.backgroundColor = 'var(--color-surface-elevated)';
      item.onmouseleave = () => item.style.backgroundColor = 'var(--color-surface)';

      item.innerHTML = `
        <div style="position:relative;">
          <img src="${coin.image}" alt="${coin.symbol}" loading="lazy" style="width:40px; height:40px; border-radius:50%; background:var(--color-surface-elevated);">
          <div style="position:absolute; bottom:-2px; right:-2px; background:var(--color-surface); border-radius:4px; padding:0 2px; font-size:9px; color:var(--color-text-tertiary); border:1px solid var(--color-border);">${coin.market_cap_rank}</div>
        </div>
        
        <div style="min-width:0; display:flex; flex-direction:column; justify-content:center;">
          <div style="font-weight:700; color:var(--color-text-primary); font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${coin.symbol}</div>
          <div style="font-size:12px; color:var(--color-text-tertiary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${coin.name}</div>
        </div>

        <div style="width:100%; height:36px; overflow:hidden; display:flex; align-items:center;">
          ${chartSVG}
        </div>

        <div style="text-align:right; display:flex; flex-direction:column; justify-content:center;">
          <div class="financial-data" style="color:var(--color-text-primary); font-weight:700; font-size:15px;">
            $${coin.current_price < 1 ? coin.current_price.toFixed(4) : coin.current_price.toLocaleString()}
          </div>
          <div class="financial-data ${colorClass}" style="font-size:12px; font-weight:600; margin-top:2px;">
            ${isUp ? '▲' : '▼'} ${Math.abs(coin.price_change_percentage_24h || 0).toFixed(2)}%
          </div>
        </div>
      `;

      item.onclick = () => showDetails(coin);
      fragment.appendChild(item);
    });

    list.appendChild(fragment);
  }

  // ============================================
  // DETAILS MODAL (Corrected Button Logic)
  // ============================================
  function showDetails(coin) {
    const content = document.createElement('div');
    content.className = 'market-detail-modal';
    content.style.cssText = 'display:flex; flex-direction:column; gap:24px;';

    // Header & Stats
    content.innerHTML = `
      <div style="display:flex; align-items:center; gap:16px;">
        <img src="${coin.image}" style="width:56px; height:56px; border-radius:50%;">
        <div>
          <div style="font-size:24px; font-weight:800; color:var(--color-text-primary); line-height:1;">${coin.name}</div>
          <div style="color:var(--color-text-secondary); font-size:16px; margin-top:4px;">${coin.symbol} • Rank #${coin.market_cap_rank}</div>
        </div>
      </div>

      <div class="card" style="padding:24px; text-align:center;">
        <div style="font-size:14px; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.05em;">Current Price</div>
        <div class="financial-data" style="font-size:36px; font-weight:700; color:var(--color-text-primary); margin:8px 0;">
          $${coin.current_price.toLocaleString()}
        </div>
        <div class="badge ${coin.price_change_percentage_24h >= 0 ? 'badge-success' : 'badge-danger'}">
          24h: ${(coin.price_change_percentage_24h || 0).toFixed(2)}%
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="stat-card">
          <div class="stat-label">Market Cap</div>
          <div class="stat-value" style="font-size:16px;">$${(coin.market_cap / 1e9).toFixed(2)}B</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Volume (24h)</div>
          <div class="stat-value" style="font-size:16px;">$${(coin.total_volume / 1e6).toFixed(2)}M</div>
        </div>
      </div>

      <div id="modal-actions" style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:auto;"></div>
    `;

    // CREATE BUTTONS SECURELY (No String Interpolation for Objects)
    const actionsDiv = content.querySelector('#modal-actions');

    const buyBtn = document.createElement('button');
    buyBtn.className = 'btn btn-lg btn-success';
    buyBtn.textContent = 'Buy';
    // Connect to Trade Engine
    buyBtn.onclick = () => {
      if (window.Trade) Trade.openBuy(coin);
      else alert('Trade module not loaded');
    };

    const sellBtn = document.createElement('button');
    sellBtn.className = 'btn btn-lg btn-danger';
    sellBtn.textContent = 'Sell';
    // Connect to Trade Engine
    sellBtn.onclick = () => {
      if (window.Trade) Trade.openSell(coin);
      else alert('Trade module not loaded');
    };

    actionsDiv.appendChild(buyBtn);
    actionsDiv.appendChild(sellBtn);

    if (window.Modal) Modal.open({ title: '', content, maxWidth: '480px', showCloseButton: true });
  }

  function cleanup() {
    if (searchTimeout) clearTimeout(searchTimeout);
    container = null;
  }

  return { render, refresh: loadMarketData, cleanup };
})();

if (typeof window !== 'undefined') window.Market = Market;
