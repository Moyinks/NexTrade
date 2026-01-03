/**
 * NexTrade — External API Integration (Institutional Grade)
 * Integrates CoinGecko Data, Supabase User Sync, and Market Simulation.
 * * FEATURES:
 * 1. Data Aggregation: Fetches and caches market data, details, and search results.
 * 2. Database Sync: Hydrates AppState using the robust 'supabaseClient' adapter.
 * 3. Market Simulation: Generates algorithmic activity feeds for UI liveliness.
 */

const API = (() => {
  'use strict';

  // ============================================
  // CONFIGURATION & CACHE
  // ============================================

  const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
  const CACHE_DURATION = 60000; // 1 minute

  const cache = {
    marketData: { data: null, timestamp: 0 },
    coinDetails: {},
    searchResults: {},
    trending: { data: null, timestamp: 0 }
  };

  // ============================================
  // CORE UTILITIES
  // ============================================

  function isCacheValid(timestamp) {
    return Date.now() - timestamp < CACHE_DURATION;
  }

  async function fetchWithErrorHandling(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.warn('API fetch warning:', error);
      throw error;
    }
  }

  // ============================================
  // MARKET DATA (COINGECKO)
  // ============================================

  async function getMarketData(limit = 50, currency = 'usd') {
    if (isCacheValid(cache.marketData.timestamp) && cache.marketData.data) {
      return { success: true, data: cache.marketData.data };
    }

    try {
      const url = `${COINGECKO_BASE_URL}/coins/markets?vs_currency=${currency}&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`;
      const data = await fetchWithErrorHandling(url);

      const transformed = data.map(coin => ({
        id: coin.id,
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        image: coin.image,
        current_price: coin.current_price,
        market_cap: coin.market_cap,
        market_cap_rank: coin.market_cap_rank,
        price_change_24h: coin.price_change_24h,
        price_change_percentage_24h: coin.price_change_percentage_24h,
        total_volume: coin.total_volume,
        high_24h: coin.high_24h,
        low_24h: coin.low_24h,
        circulating_supply: coin.circulating_supply,
        total_supply: coin.total_supply
      }));

      // Update Cache
      cache.marketData = { data: transformed, timestamp: Date.now() };
      
      // Update Global State
      if (window.AppState) AppState.set('marketData', transformed);

      return { success: true, data: transformed };
    } catch (error) {
      // Fallback to cache if API fails
      if (cache.marketData.data) return { success: true, data: cache.marketData.data };
      console.error('Get market data error:', error);
      return { success: false, data: [], error: error.message };
    }
  }

  async function searchCoins(query) {
    if (!query || query.trim().length === 0) return { success: true, data: [] };

    const cacheKey = query.toLowerCase();
    if (cache.searchResults[cacheKey] && isCacheValid(cache.searchResults[cacheKey].timestamp)) {
      return { success: true, data: cache.searchResults[cacheKey].data };
    }

    try {
      const url = `${COINGECKO_BASE_URL}/search?query=${encodeURIComponent(query)}`;
      const data = await fetchWithErrorHandling(url);

      const results = (data.coins || []).slice(0, 10).map(coin => ({
        id: coin.id,
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        thumb: coin.thumb,
        market_cap_rank: coin.market_cap_rank
      }));

      cache.searchResults[cacheKey] = { data: results, timestamp: Date.now() };
      return { success: true, data: results };
    } catch (error) {
      console.error('Search coins error:', error);
      return { success: false, data: [], error: error.message };
    }
  }

  async function getCoinDetails(coinId) {
    if (cache.coinDetails[coinId] && isCacheValid(cache.coinDetails[coinId].timestamp)) {
      return { success: true, data: cache.coinDetails[coinId].data };
    }

    try {
      const url = `${COINGECKO_BASE_URL}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`;
      const data = await fetchWithErrorHandling(url);

      const details = {
        id: data.id,
        symbol: data.symbol.toUpperCase(),
        name: data.name,
        image: data.image.large,
        description: data.description.en || 'No description available.',
        market_cap_rank: data.market_cap_rank,
        current_price: data.market_data.current_price.usd,
        market_cap: data.market_data.market_cap.usd,
        total_volume: data.market_data.total_volume.usd,
        high_24h: data.market_data.high_24h.usd,
        low_24h: data.market_data.low_24h.usd,
        price_change_24h: data.market_data.price_change_24h,
        price_change_percentage_24h: data.market_data.price_change_percentage_24h,
        circulating_supply: data.market_data.circulating_supply,
        total_supply: data.market_data.total_supply,
        ath: data.market_data.ath.usd,
        ath_date: data.market_data.ath_date.usd,
        atl: data.market_data.atl.usd,
        atl_date: data.market_data.atl_date.usd
      };

      cache.coinDetails[coinId] = { data: details, timestamp: Date.now() };
      return { success: true, data: details };
    } catch (error) {
      console.error('Get coin details error:', error);
      return { success: false, data: null, error: error.message };
    }
  }

  async function getPrices(coinIds, currency = 'usd') {
    if (!Array.isArray(coinIds) || coinIds.length === 0) return { success: false, error: 'Invalid coin IDs' };

    try {
      const url = `${COINGECKO_BASE_URL}/simple/price?ids=${coinIds.join(',')}&vs_currencies=${currency}&include_24hr_change=true`;
      const data = await fetchWithErrorHandling(url);
      return { success: true, data };
    } catch (error) {
      console.error('Get prices error:', error);
      return { success: false, data: {}, error: error.message };
    }
  }

  async function getTrendingCoins() {
    if (isCacheValid(cache.trending.timestamp) && cache.trending.data) {
      return { success: true, data: cache.trending.data };
    }

    try {
      const url = `${COINGECKO_BASE_URL}/search/trending`;
      const data = await fetchWithErrorHandling(url);

      const trending = data.coins.map(item => ({
        id: item.item.id,
        symbol: item.item.symbol.toUpperCase(),
        name: item.item.name,
        thumb: item.item.thumb,
        market_cap_rank: item.item.market_cap_rank,
        price_btc: item.item.price_btc
      }));

      cache.trending = { data: trending, timestamp: Date.now() };
      return { success: true, data: trending };
    } catch (error) {
      console.error('Get trending coins error:', error);
      return { success: false, data: [], error: error.message };
    }
  }

  // ============================================
  // DATABASE SYNC (CRITICAL REPAIR)
  // ============================================

  async function loadUserData(userId) {
    if (!window.supabaseClient) {
      console.warn('API: Supabase client not initialized. Skipping sync.');
      return { success: false, error: 'No client' };
    }

    try {
      console.log('🔄 API: Starting Full Database Sync...');

      // Parallel Fetch using the ROBUST ADAPTER methods
      // These methods handle the column mapping (spot_balance -> balances.spot)
      const [profileData, txsData, invsData] = await Promise.all([
        supabaseClient.getProfile(userId),
        supabaseClient.getTransactions(userId),
        supabaseClient.getInvestments(userId)
      ]);

      // 1. Hydrate Profile (Balances & Holdings)
      if (profileData) {
        if (profileData.balances) AppState.updateBalances(profileData.balances);
        if (profileData.holdings) AppState.set('holdings', profileData.holdings);
      }

      // 2. Hydrate Transactions (History)
      if (txsData && txsData.success && Array.isArray(txsData.data)) {
        AppState.set('transactions', txsData.data);
      }

      // 3. Hydrate Investments (Vault)
      if (invsData && invsData.success && Array.isArray(invsData.data)) {
        AppState.set('investments', invsData.data);
      }

      console.log('✅ API: Database Sync Complete.');
      return { success: true };

    } catch (err) {
      console.error('API.loadUserData failed:', err);
      return { success: false, error: err.message };
    }
  }

  // ============================================
  // MARKET SIMULATION (ACTIVITY FEED)
  // ============================================

  function generateSimulatedActivity(investment) {
    const activities = [
      {
        type: 'BUY',
        assets: ['BTC','ETH','SOL','MATIC','AVAX','DOT'],
        descriptions: ['Momentum signal detected','Support level bounce','Volume breakout','Moving average cross']
      },
      {
        type: 'SELL',
        assets: ['BTC','ETH','SOL','MATIC','AVAX','DOT'],
        descriptions: ['Resistance rejection','Profit target hit','RSI overbought','Trend reversal']
      },
      {
        type: 'YIELD',
        descriptions: ['Daily yield payout','Staking reward received','Interest accrual','Dividend distribution']
      }
    ];

    const category = activities[Math.floor(Math.random() * activities.length)];
    const asset = category.assets ? category.assets[Math.floor(Math.random() * category.assets.length)] : null;
    const description = category.descriptions[Math.floor(Math.random() * category.descriptions.length)];
    const amount = (investment.amount * (Math.random() * 0.02 + 0.005)).toFixed(2); // 0.5% - 2.5% variation

    return {
      id: 'act_' + Date.now() + Math.random().toString(36).substr(2, 5),
      investment_id: investment.id,
      type: category.type,
      title: asset ? `${category.type} ${asset}` : 'Yield Generated',
      description: description,
      amount: parseFloat(amount),
      timestamp: new Date().toISOString()
    };
  }

  function startSimulatedTrading(investment) {
    // Random interval between 30s and 90s for activity generation
    const intervalId = setInterval(() => {
      // 1. Generate Activity
      const activity = generateSimulatedActivity(investment);
      
      // 2. Add to Local State (Visual only)
      if (window.AppState) {
        const feed = AppState.get('activityFeed') || [];
        feed.unshift(activity);
        if (feed.length > 50) feed.pop(); // Keep list manageable
        AppState.set('activityFeed', feed);
      }
      
      // Note: We do NOT update the database here to avoid polluting real transaction logs
      // This is purely for UI liveliness in the Vault dashboard.

    }, Math.random() * 60000 + 30000);

    return intervalId;
  }

  function stopSimulatedTrading(intervalId) {
    if (intervalId) clearInterval(intervalId);
  }

  // ============================================
  // CACHE MANAGEMENT
  // ============================================

  function clearCache() {
    cache.marketData = { data: null, timestamp: 0 };
    cache.coinDetails = {};
    cache.searchResults = {};
    cache.trending = { data: null, timestamp: 0 };
  }

  function clearSpecificCache(type) {
    switch(type) {
      case 'market': cache.marketData = { data:null, timestamp:0 }; break;
      case 'details': cache.coinDetails = {}; break;
      case 'search': cache.searchResults = {}; break;
      case 'trending': cache.trending = { data:null, timestamp:0 }; break;
    }
  }

  // ============================================
  // EXPORT
  // ============================================

  return {
    // Market Data
    getMarketData,
    searchCoins,
    getCoinDetails,
    getPrices,
    getTrendingCoins,
    
    // Database Sync
    loadUserData,
    
    // Simulation
    generateSimulatedActivity,
    startSimulatedTrading,
    stopSimulatedTrading,
    
    // Utils
    clearCache,
    clearSpecificCache
  };

})();

// Attach to Window
if (typeof window !== 'undefined') window.API = API;
