/**
 * NexTrade — Market Module (Full Mobile-Ready)
 * Cryptocurrency market explorer with search and filtering
 * Self-invoking module pattern
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

  // ============================================
  // RENDER FUNCTIONS
  // ============================================

  /**
   * Render market page
   * @param {HTMLElement} element - Container element
   */
  function render(element) {
    if (!element) {
      console.error('Market container not found');
      return;
    }

    container = element;
    container.className = 'market-page';

    // Make container scrollable
    container.style.overflowY = 'auto';
    container.style.webkitOverflowScrolling = 'touch';
    container.style.height = 'calc(100vh - var(--navbar-height-mobile) - var(--space-4))';

    // Header with search
    const header = createHeader();
    container.appendChild(header);

    // Market list
    const marketList = createMarketList();
    container.appendChild(marketList);

    // Load market data if empty
    const marketData = AppState.get('marketData');
    if (!marketData || marketData.length === 0) {
      loadMarketData();
    } else {
      renderMarketItems(marketData);
    }

    // Subscribe to state changes
    subscribeToUpdates();
  }

  /**
   * Create header with search and filters
   * @returns {HTMLElement} Header element
   */
  function createHeader() {
    const header = document.createElement('div');
    header.className = 'market-header flex flex-col gap-4 p-4 sticky';
    header.style.top = '0';
    header.style.background = 'var(--color-background)';
    header.style.zIndex = '30';

    // Search input
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'market-search flex items-center gap-2';

    const searchIcon = document.createElement('span');
    searchIcon.className = 'market-search-icon';
    searchIcon.textContent = '🔍';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'market-search-input flex-1 p-2 rounded border border-gray-300';
    searchInput.placeholder = 'Search cryptocurrencies...';
    searchInput.id = 'market-search';

    searchInput.addEventListener('input', (e) => {
      handleSearch(e.target.value);
    });

    searchWrapper.appendChild(searchIcon);
    searchWrapper.appendChild(searchInput);

    // Filters
    const filters = createFilters();

    header.appendChild(searchWrapper);
    header.appendChild(filters);

    return header;
  }

  /**
   * Create filter buttons
   * @returns {HTMLElement} Filters element
   */
  function createFilters() {
    const filters = document.createElement('div');
    filters.className = 'market-filters flex gap-2 overflow-x-auto pb-2';
    filters.id = 'market-filters';

    const filterOptions = [
      { id: 'all', label: 'All' },
      { id: 'gainers', label: 'Top Gainers' },
      { id: 'losers', label: 'Top Losers' },
      { id: 'volume', label: 'Volume' }
    ];

    filterOptions.forEach(option => {
      const btn = document.createElement('button');
      btn.className = 'market-filter-btn px-4 py-2 rounded border border-gray-300 whitespace-nowrap';
      btn.textContent = option.label;
      btn.setAttribute('data-filter', option.id);

      if (option.id === currentFilter) {
        btn.classList.add('active');
        btn.style.background = 'var(--color-primary)';
        btn.style.color = '#fff';
      }

      btn.addEventListener('click', () => {
        handleFilterChange(option.id);
      });

      filters.appendChild(btn);
    });

    return filters;
  }

  /**
   * Create market list container
   * @returns {HTMLElement} Market list element
   */
  function createMarketList() {
    const list = document.createElement('div');
    list.className = 'market-list flex flex-col gap-2 p-2';
    list.id = 'market-list';

    // Show loading skeleton initially
    showLoading();

    return list;
  }

  /**
   * Render market items
   * @param {array} coins - Array of coin data
   */
  function renderMarketItems(coins) {
    const list = document.getElementById('market-list');
    if (!list) return;

    list.innerHTML = '';

    if (!coins || coins.length === 0) {
      showEmptyState();
      return;
    }

    coins.forEach(coin => {
      const item = Card.createMarketItem(coin, () => {
        showCoinDetails(coin);
      });
      list.appendChild(item);
    });
  }

  /**
   * Show loading skeleton
   */
  function showLoading() {
    const list = document.getElementById('market-list');
    if (!list) return;

    list.innerHTML = '';

    for (let i = 0; i < 10; i++) {
      const skeleton = Card.createSkeleton();
      list.appendChild(skeleton);
    }
  }

  /**
   * Show empty state
   */
  function showEmptyState() {
    const list = document.getElementById('market-list');
    if (!list) return;

    list.innerHTML = '';

    const empty = document.createElement('div');
    empty.className = 'empty-state flex flex-col items-center justify-center mt-12';
    empty.style.opacity = '0.5';

    const icon = document.createElement('div');
    icon.style.fontSize = '64px';
    icon.textContent = '🔍';

    const title = document.createElement('div');
    title.className = 'empty-state-title';
    title.textContent = 'No Results Found';

    const description = document.createElement('div');
    description.className = 'empty-state-description';
    description.textContent = 'Try adjusting your search or filters';

    empty.appendChild(icon);
    empty.appendChild(title);
    empty.appendChild(description);

    list.appendChild(empty);
  }

  // ============================================
  // EVENT HANDLERS
  // ============================================

  function handleSearch(query) {
    if (searchTimeout) clearTimeout(searchTimeout);

    searchTimeout = setTimeout(() => {
      const trimmed = query.trim().toLowerCase();
      AppState.setSearchQuery(trimmed);

      const marketData = AppState.get('marketData');
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

    // Update filter buttons
    const filterBtns = document.querySelectorAll('.market-filter-btn');
    filterBtns.forEach(btn => {
      if (btn.getAttribute('data-filter') === filterId) {
        btn.classList.add('active');
        btn.style.background = 'var(--color-primary)';
        btn.style.color = '#fff';
      } else {
        btn.classList.remove('active');
        btn.style.background = '';
        btn.style.color = '';
      }
    });

    const marketData = AppState.get('marketData');
    const searchQuery = AppState.get('ui').searchQuery;
    let filtered = applyFilter(marketData, filterId);

    if (searchQuery && searchQuery.length > 0) {
      filtered = filtered.filter(coin =>
        coin.name.toLowerCase().includes(searchQuery) ||
        coin.symbol.toLowerCase().includes(searchQuery)
      );
    }

    renderMarketItems(filtered);
  }

  function applyFilter(data, filterId) {
    if (!data) return [];

    let filtered = [...data];

    switch (filterId) {
      case 'gainers':
        filtered = filtered
          .filter(coin => coin.price_change_percentage_24h > 0)
          .sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h)
          .slice(0, 20);
        break;

      case 'losers':
        filtered = filtered
          .filter(coin => coin.price_change_percentage_24h < 0)
          .sort((a, b) => a.price_change_percentage_24h - b.price_change_percentage_24h)
          .slice(0, 20);
        break;

      case 'volume':
        filtered = filtered
          .sort((a, b) => b.total_volume - a.total_volume)
          .slice(0, 20);
        break;

      case 'all':
      default:
        break;
    }

    return filtered;
  }

  // ============================================
  // DATA LOADING
  // ============================================

  async function loadMarketData() {
    showLoading();

    try {
      const result = await API.getMarketData(50);

      if (result.success) {
        const filtered = applyFilter(result.data, currentFilter);
        renderMarketItems(filtered);
      } else {
        App.showError('Failed to load market data. Please try again.');
      }
    } catch (error) {
      console.error('Load market data error:', error);
      App.showError('Failed to load market data. Please try again.');
    }
  }

  async function refresh() {
    await loadMarketData();
  }

  // ============================================
  // COIN DETAILS MODAL
  // ============================================

  async function showCoinDetails(coin) {
    const content = document.createElement('div');
    content.className = 'flex flex-col gap-4';

    const header = document.createElement('div');
    header.className = 'flex items-center gap-3 pb-4 border-b border-gray-300';

    const icon = document.createElement('div');
    icon.className = 'w-12 h-12 rounded-full flex items-center justify-center bg-gray-100 font-bold';
    icon.textContent = coin.symbol.substring(0, 3).toUpperCase();

    const info = document.createElement('div');
    info.className = 'flex flex-col flex-1';

    const name = document.createElement('div');
    name.className = 'font-semibold text-lg';
    name.textContent = coin.name;

    const symbol = document.createElement('div');
    symbol.className = 'text-sm text-gray-500';
    symbol.textContent = coin.symbol.toUpperCase();

    info.appendChild(name);
    info.appendChild(symbol);
    header.appendChild(icon);
    header.appendChild(info);
    content.appendChild(header);

    const stats = document.createElement('div');
    stats.className = 'grid grid-cols-2 gap-4';

    const statsData = [
      { label: 'Price', value: Format.currency(coin.current_price) },
      { label: '24h Change', value: Format.percentage(coin.price_change_percentage_24h), color: coin.price_change_percentage_24h >= 0 ? 'var(--color-success)' : 'var(--color-danger)' },
      { label: 'Market Cap', value: Format.compactCurrency(coin.market_cap) },
      { label: '24h Volume', value: Format.compactCurrency(coin.total_volume) },
      { label: '24h High', value: Format.currency(coin.high_24h) },
      { label: '24h Low', value: Format.currency(coin.low_24h) }
    ];

    statsData.forEach(stat => {
      const statDiv = document.createElement('div');

      const label = document.createElement('div');
      label.className = 'text-xs text-gray-500 mb-1';
      label.textContent = stat.label;

      const value = document.createElement('div');
      value.className = 'font-semibold';
      value.style.color = stat.color || 'var(--color-text-primary)';
      value.textContent = stat.value;

      statDiv.appendChild(label);
      statDiv.appendChild(value);
      stats.appendChild(statDiv);
    });

    content.appendChild(stats);

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

    unsubscribe = AppState.subscribe((state) => {
      if (state.marketData && state.marketData.length > 0) {
        const filtered = applyFilter(state.marketData, currentFilter);
        renderMarketItems(filtered);
      }
    });
  }

  function cleanup() {
    if (unsubscribe) unsubscribe();
    if (searchTimeout) clearTimeout(searchTimeout);
  }

  // ============================================
  // PUBLIC API
  // ============================================

  return {
    render,
    refresh,
    cleanup
  };
})();

// ============================================
// EXPORT FOR OTHER MODULES
// ============================================

if (typeof window !== 'undefined') window.Market = Market;