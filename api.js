/**
 * NexTrade — External API Integration (Production Grade - Real Data Only)
 * ══════════════════════════════════════════════════════════════════════
 * FEATURES:
 * 1. Real-time market data from CoinGecko with forced refresh
 * 2. Live price feeds from Binance WebSocket
 * 3. OHLC candle data from Binance REST API
 * 4. Trending coins and news integration
 * 5. Comprehensive error handling and logging
 * ══════════════════════════════════════════════════════════════════════
 */

const API = (() => {
  'use strict';

  // ============================================
  // CONFIGURATION & CACHE
  // ============================================

  const BINANCE_REST_URL = 'https://api.binance.com/api/v3';
  const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws';
  const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
  const FEAR_GREED_URL = 'https://api.alternative.me/fng/';
  const COIN_IMAGE_HOSTS = new Set(['assets.coingecko.com', 'coin-images.coingecko.com']);

  function proxiedCoinImageUrl(value) {
    try {
      const source = new URL(String(value || ''), window.location.origin);

      // Idempotent: already normalized same-origin proxy URLs stay unchanged.
      if (source.origin === window.location.origin && source.pathname === '/api/coin-image') {
        return source.href;
      }

      if (source.protocol !== 'https:' || source.username || source.password || source.port) return '';
      if (!COIN_IMAGE_HOSTS.has(source.hostname.toLowerCase())) return '';
      if (!source.pathname.startsWith('/coins/images/')) return '';

      return new URL('/api/coin-image?url=' + encodeURIComponent(source.href), window.location.origin).href;
    } catch (_) {
      return '';
    }
  }

  const CACHE_DURATION = 60000; // 1 minute

  // Map App IDs to Binance Symbols for Real-Time Feeds
  const SYMBOL_MAP = {
    'bitcoin': 'BTCUSDT',
    'ethereum': 'ETHUSDT',
    'solana': 'SOLUSDT',
    'binancecoin': 'BNBUSDT',
    'ripple': 'XRPUSDT',
    'cardano': 'ADAUSDT',
    'avalanche-2': 'AVAXUSDT',
    'polkadot': 'DOTUSDT',
    'matic-network': 'MATICUSDT',
    'dogecoin': 'DOGEUSDT',
    'shiba-inu': 'SHIBUSDT',
    'tron': 'TRXUSDT',
    'litecoin': 'LTCUSDT',
    'chainlink': 'LINKUSDT',
    'uniswap': 'UNIUSDT'
  };

  const cache = {
    marketData: { data: null, timestamp: 0 },
    coinDetails: {},
    searchResults: {},
    trending: { data: null, timestamp: 0 },
    fearGreed: { data: null, timestamp: 0 }
  };

  let activeSocket = null;
  let requestLog = [];

  // ============================================
  // LOGGING & DEBUGGING
  // ============================================

  function logRequest(endpoint, params = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      endpoint,
      params,
      status: 'pending'
    };
    if (requestLog.length >= 200) requestLog.splice(0, 100); // keep last 100 on overflow
    requestLog.push(entry);
    console.log(`[API] 📡 Requesting: ${endpoint}`, params);
    return entry;
  }

  function logResponse(entry, success, data = null, error = null) {
    entry.status = success ? 'success' : 'failed';
    entry.dataSize = data ? (Array.isArray(data) ? data.length : 'object') : 0;
    entry.error = error;
    
    if (success) {
      console.log(`[API] ✅ Success: ${entry.endpoint}`, { dataSize: entry.dataSize });
    } else {
      console.error(`[API] ❌ Failed: ${entry.endpoint}`, error);
    }
  }

  // ============================================
  // CORE UTILITIES
  // ============================================

  function isCacheValid(timestamp) {
    return Date.now() - timestamp < CACHE_DURATION;
  }

  async function fetchWithErrorHandling(url, logEntry = null) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        const retryHeader = response.headers && response.headers.get
          ? response.headers.get('retry-after')
          : null;
        const parsedRetry = retryHeader ? Number(retryHeader) : NaN;
        const error = new Error(
          response.status === 429
            ? 'Market data is temporarily rate limited'
            : 'Market data request failed'
        );
        error.status = response.status;
        error.code = response.status === 429 ? 'RATE_LIMITED' : 'MARKET_HTTP_ERROR';
        error.retryAfterSeconds = Number.isFinite(parsedRetry) && parsedRetry > 0
          ? Math.ceil(parsedRetry)
          : null;
        throw error;
      }

      const data = await response.json();
      if (logEntry) logResponse(logEntry, true, data);
      return data;
    } catch (error) {
      if (!error.code) {
        error.code = error && error.name === 'AbortError'
          ? 'MARKET_TIMEOUT'
          : 'MARKET_NETWORK_ERROR';
      }
      if (logEntry) logResponse(logEntry, false, null, error.message);
      throw error;
    }
  }

  async function retryFetch(url, maxRetries = 3, delayMs = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[API] 🔄 Attempt ${attempt}/${maxRetries}: ${url}`);
        return await fetchWithErrorHandling(url);
      } catch (error) {
        lastError = error;
        console.warn(`[API] ⚠️ Attempt ${attempt} failed:`, error.message);

        if (error && error.status === 429) break;

        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
        }
      }
    }
    
    throw lastError;
  }

  // ============================================
  // 1. BINANCE REAL-TIME DATA (INSTITUTIONAL)
  // ============================================

  async function getCandles(coinId, interval = '1D') {
    const symbol = SYMBOL_MAP[coinId] || 'BTCUSDT';
    
    const intervalMap = { 
      '1H': '1m', 
      '1D': '15m', 
      '1W': '1h', 
      '1M': '4h', 
      '1Y': '1d' 
    };
    
    const binanceInterval = intervalMap[interval] || '1h';
    const limit = 300;

    const logEntry = logRequest('Binance Candles', { symbol, interval: binanceInterval, limit });

    try {
      const url = `${BINANCE_REST_URL}/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;
      const data = await retryFetch(url, 2, 500);
      
      const candles = data.map(d => ({
        time: d[0] / 1000,
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        value: parseFloat(d[4]),
        volume: parseFloat(d[5])
      }));
      
      logResponse(logEntry, true, candles);
      return candles;
      
    } catch (err) {
      logResponse(logEntry, false, null, err.message);
      console.warn(`[API] Binance candles unavailable for ${symbol}, using fallback`);
      return [];
    }
  }

  async function getLivePrice(coinId) {
    const symbol = SYMBOL_MAP[coinId] || 'BTCUSDT';
    const logEntry = logRequest('Binance Price', { symbol });
    
    try {
      const url = `${BINANCE_REST_URL}/ticker/price?symbol=${symbol}`;
      const data = await fetchWithErrorHandling(url, logEntry);
      return parseFloat(data.price);
    } catch (err) {
      logResponse(logEntry, false, null, err.message);
      return null;
    }
  }

  function subscribeToTicker(coinId, callback) {
    if (activeSocket) {
      activeSocket.close();
      activeSocket = null;
    }

    const symbol = (SYMBOL_MAP[coinId] || 'BTCUSDT').toLowerCase();
    const wsUrl = `${BINANCE_WS_URL}/${symbol}@trade`;
    
    console.log(`[API] 🔌 WebSocket connecting: ${symbol}`);
    
    try {
      activeSocket = new WebSocket(wsUrl);

      activeSocket.onopen = () => {
        console.log(`[API] ✅ WebSocket connected: ${symbol}`);
      };

      activeSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.p) {
            const price = parseFloat(message.p);
            callback(price);
          }
        } catch (err) {
          console.error('[API] WebSocket parse error:', err);
        }
      };

      activeSocket.onerror = (err) => {
        console.error('[API] ❌ WebSocket error:', err);
      };

      activeSocket.onclose = () => {
        console.log(`[API] 🔌 WebSocket closed: ${symbol}`);
      };
      
    } catch (err) {
      console.error('[API] WebSocket setup failed:', err);
    }
  }

  function unsubscribeTicker() {
  if (activeSocket) {
    console.log('[API] 🔌 Closing WebSocket');
    activeSocket.onmessage = null;
    activeSocket.onerror = null;
    activeSocket.onclose = null;
    activeSocket.close();
    activeSocket = null;
  }
}

  // ============================================
  // 2. MARKET DATA (COINGECKO AGGREGATION)
  // ============================================

  async function getMarketData(limit = 50, currency = 'usd', forceRefresh = false) {
    if (!forceRefresh && isCacheValid(cache.marketData.timestamp) && cache.marketData.data) {
      console.log('[API] 📦 Using cached market data');
      return { success: true, data: cache.marketData.data };
    }

    const logEntry = logRequest('CoinGecko Markets', { limit, currency, forceRefresh });

    try {
      const url = `${COINGECKO_BASE_URL}/coins/markets?vs_currency=${currency}&order=market_cap_desc&per_page=${limit}&page=1&sparkline=true&price_change_percentage=24h`;
      const data = await retryFetch(url, 3, 2000);

      if (!data || !Array.isArray(data) || data.length === 0) {
        throw new Error('Empty response from CoinGecko');
      }

      const transformed = data.map(coin => ({
        id: coin.id,
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        image: proxiedCoinImageUrl(coin.image),
        current_price: coin.current_price || 0,
        market_cap: coin.market_cap || 0,
        market_cap_rank: coin.market_cap_rank || 0,
        price_change_24h: coin.price_change_24h || 0,
        price_change_percentage_24h: coin.price_change_percentage_24h || 0,
        total_volume: coin.total_volume || 0,
        high_24h: coin.high_24h || 0,
        low_24h: coin.low_24h || 0,
        circulating_supply: coin.circulating_supply || 0,
        total_supply: coin.total_supply || 0,
        sparkline: (coin.sparkline_in_7d && coin.sparkline_in_7d.price) ? coin.sparkline_in_7d.price : []
      }));

      cache.marketData = { data: transformed, timestamp: Date.now() };
      
      if (window.AppState) {
        AppState.set('marketData', transformed);
      }

      logResponse(logEntry, true, transformed);
      console.log(`[API] 💾 Cached ${transformed.length} coins`);

      return { success: true, data: transformed };
      
    } catch (error) {
      logResponse(logEntry, false, null, error.message);
      
      if (cache.marketData.data) {
        console.warn('[API] ⚠️ Using stale cache due to API error');
        return { success: true, data: cache.marketData.data };
      }
      
      console.error('[API] ❌ Market data fetch failed completely:', error);
      return {
        success: false,
        data: [],
        error: error.message,
        code: error.code || 'MARKET_UNAVAILABLE',
        status: Number(error.status) || null,
        retryAfterSeconds: Number(error.retryAfterSeconds) || null,
        rateLimited: Number(error.status) === 429
      };
    }
  }

  async function ensureCoinLoaded(coinId) {
    console.log(`[API] 🎯 Ensuring ${coinId} is loaded`);
    
    const currentData = cache.marketData.data || [];
    const existing = currentData.find(c => c.id === coinId);
    
    if (existing && existing.current_price > 0) {
      console.log(`[API] ✅ ${coinId} already in cache`);
      return existing;
    }

    console.log(`[API] 📥 Fetching detailed data for ${coinId}`);
    
    const logEntry = logRequest('CoinGecko Coin Detail', { coinId });
    
    try {
      const url = `${COINGECKO_BASE_URL}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=true`;
      const data = await retryFetch(url, 3, 2000);

      const coinData = {
        id: data.id,
        symbol: data.symbol.toUpperCase(),
        name: data.name,
        image: proxiedCoinImageUrl(data.image?.large || data.image?.small || null),
        current_price: data.market_data?.current_price?.usd || 0,
        market_cap: data.market_data?.market_cap?.usd || 0,
        market_cap_rank: data.market_cap_rank || 0,
        price_change_24h: data.market_data?.price_change_24h || 0,
        price_change_percentage_24h: data.market_data?.price_change_percentage_24h || 0,
        total_volume: data.market_data?.total_volume?.usd || 0,
        high_24h: data.market_data?.high_24h?.usd || 0,
        low_24h: data.market_data?.low_24h?.usd || 0,
        circulating_supply: data.market_data?.circulating_supply || 0,
        total_supply: data.market_data?.total_supply || 0,
        sparkline: data.market_data?.sparkline_7d?.price || []
      };

      cache.coinDetails[coinId] = { data: coinData, timestamp: Date.now() };
      
      const updatedCache = [...currentData.filter(c => c.id !== coinId), coinData];
      cache.marketData.data = updatedCache;
      
      if (window.AppState) {
        AppState.set('marketData', updatedCache);
      }

      logResponse(logEntry, true, coinData);
      return coinData;
      
    } catch (error) {
      logResponse(logEntry, false, null, error.message);
      console.error(`[API] Failed to load ${coinId}:`, error);
      return null;
    }
  }

  async function searchCoins(query) {
    if (!query || query.trim().length === 0) {
      return { success: true, data: [] };
    }

    const cacheKey = query.toLowerCase();
    if (cache.searchResults[cacheKey] && isCacheValid(cache.searchResults[cacheKey].timestamp)) {
      return { success: true, data: cache.searchResults[cacheKey].data };
    }

    const logEntry = logRequest('CoinGecko Search', { query });

    try {
      const url = `${COINGECKO_BASE_URL}/search?query=${encodeURIComponent(query)}`;
      const data = await fetchWithErrorHandling(url, logEntry);

      const results = (data.coins || []).slice(0, 10).map(coin => ({
        id: coin.id,
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        thumb: proxiedCoinImageUrl(coin.thumb),
        market_cap_rank: coin.market_cap_rank
      }));

      cache.searchResults[cacheKey] = { data: results, timestamp: Date.now() };

      // Evict oldest entries when cache exceeds 50 keys to prevent unbounded growth
      const srKeys = Object.keys(cache.searchResults);
      if (srKeys.length > 50) {
        srKeys
          .sort((a, b) => cache.searchResults[a].timestamp - cache.searchResults[b].timestamp)
          .slice(0, 25)
          .forEach(k => delete cache.searchResults[k]);
      }

      return { success: true, data: results };
      
    } catch (error) {
      logResponse(logEntry, false, null, error.message);
      return { success: false, data: [], error: error.message };
    }
  }

  async function getCoinDetails(coinId) {
    if (cache.coinDetails[coinId] && isCacheValid(cache.coinDetails[coinId].timestamp)) {
      return { success: true, data: cache.coinDetails[coinId].data };
    }

    const logEntry = logRequest('CoinGecko Details', { coinId });

    try {
      const url = `${COINGECKO_BASE_URL}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`;
      const data = await fetchWithErrorHandling(url, logEntry);

      const details = {
        id: data.id,
        symbol: data.symbol.toUpperCase(),
        name: data.name,
        image: proxiedCoinImageUrl(data.image?.large || data.image?.small || null),
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

      // Evict oldest entries when cache exceeds 100 keys
      const cdKeys = Object.keys(cache.coinDetails);
      if (cdKeys.length > 100) {
        cdKeys
          .sort((a, b) => cache.coinDetails[a].timestamp - cache.coinDetails[b].timestamp)
          .slice(0, 50)
          .forEach(k => delete cache.coinDetails[k]);
      }

      return { success: true, data: details };
      
    } catch (error) {
      logResponse(logEntry, false, null, error.message);
      return { success: false, data: null, error: error.message };
    }
  }

  async function getPrices(coinIds, currency = 'usd') {
    if (!Array.isArray(coinIds) || coinIds.length === 0) {
      return { success: false, error: 'Invalid coin IDs' };
    }

    const logEntry = logRequest('CoinGecko Prices', { coinIds, currency });

    try {
      const url = `${COINGECKO_BASE_URL}/simple/price?ids=${coinIds.join(',')}&vs_currencies=${currency}&include_24hr_change=true`;
      const data = await fetchWithErrorHandling(url, logEntry);
      return { success: true, data };
    } catch (error) {
      logResponse(logEntry, false, null, error.message);
      return { success: false, data: {}, error: error.message };
    }
  }

  async function getTrendingCoins() {
    if (isCacheValid(cache.trending.timestamp) && cache.trending.data) {
      console.log('[API] 📦 Using cached trending data');
      return { success: true, data: cache.trending.data, source: 'cache' };
    }

    const logEntry = logRequest('CoinGecko Trending', {});

    try {
      const url = `${COINGECKO_BASE_URL}/search/trending`;
      const data = await retryFetch(url, 3, 2000);

      const trending = data.coins.map(item => ({
        id: item.item.id,
        symbol: item.item.symbol.toUpperCase(),
        name: item.item.name,
        thumb: proxiedCoinImageUrl(item.item.thumb),
        market_cap_rank: item.item.market_cap_rank,
        price_btc: item.item.price_btc,
        score: item.item.score || 0
      }));

      cache.trending = { data: trending, timestamp: Date.now() };
      logResponse(logEntry, true, trending);
      return { success: true, data: trending, source: 'api' };
      
    } catch (error) {
      logResponse(logEntry, false, null, error.message);
      
      if (cache.trending.data) {
        return { success: true, data: cache.trending.data, source: 'stale', isStale: true };
      }

      return {
        success: false,
        data: [],
        error: error.message,
        code: error.code || 'MARKET_UNAVAILABLE',
        status: Number(error.status) || null,
        retryAfterSeconds: Number(error.retryAfterSeconds) || null,
        rateLimited: Number(error.status) === 429
      };
    }
  }

  async function getFearGreedIndex() {
    if (isCacheValid(cache.fearGreed.timestamp) && cache.fearGreed.data) {
      console.log('[API] 📦 Using cached Fear & Greed data');
      return { success: true, data: cache.fearGreed.data };
    }

    const logEntry = logRequest('Alternative.me Fear & Greed', {});

    try {
      const url = `${FEAR_GREED_URL}?limit=1`;
      const response = await fetchWithErrorHandling(url, logEntry);

      if (response && response.data && response.data.length > 0) {
        const fngData = response.data[0];
        const result = {
          value: parseInt(fngData.value),
          classification: fngData.value_classification,
          timestamp: fngData.timestamp
        };

        cache.fearGreed = { data: result, timestamp: Date.now() };
        return { success: true, data: result };
      }

      throw new Error('Invalid response format');
      
    } catch (error) {
      logResponse(logEntry, false, null, error.message);
      
      if (cache.fearGreed.data) {
        return { success: true, data: cache.fearGreed.data };
      }
      
      return { success: false, data: null, error: error.message };
    }
  }

  // ============================================
  // 3. DATABASE SYNC (PRESERVED LOGIC)
  // ============================================

  async function loadUserData(userId) {
    if (!window.supabaseClient) return { success: false, error: 'No client' };
    try {
      const [profileRes, txsRes, invsRes, spotRes, vaultRes] = await Promise.all([
        window.supabaseClient
          .from('profiles')
          .select('holdings, kyc_status, role, full_name, avatar_url')
          .eq('id', userId)
          .single(),
        window.supabaseClient
          .from('transactions')
          .select('id, user_id, type, amount, status, description, metadata, created_at, updated_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        window.supabaseClient
          .from('investments')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        window.supabaseClient.rpc('derive_spot_balance', { p_user_id: userId }),
        window.supabaseClient.rpc('derive_vault_cash', { p_user_id: userId })
      ]);
      for (const response of [profileRes, txsRes, invsRes, spotRes, vaultRes]) {
        if (response.error) throw response.error;
      }

      const spot = Number(spotRes.data);
      const vaultCash = Number(vaultRes.data);
      if (!Number.isFinite(spot) || spot < 0 || !Number.isFinite(vaultCash) || vaultCash < 0) {
        throw new Error('Invalid authoritative balance response');
      }

      if (window.AppState) {
        await AppState.batch(async () => {
          AppState.set('profile', profileRes.data || null);
          AppState.set('holdings', (profileRes.data && profileRes.data.holdings) || {});
          AppState.set('transactions', txsRes.data || []);
          AppState.set('investments', invsRes.data || []);
          AppState.updateBalances({ spot, vaultCash });
        });
      }
      return { success: true };
    } catch (error) {
      console.error('[API] Database sync failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // 4. MARKET SIMULATION (ACTIVITY FEED ONLY)
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
    const amount = (investment.amount * (Math.random() * 0.02 + 0.005)).toFixed(2);

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
    const intervalId = setInterval(() => {
      const activity = generateSimulatedActivity(investment);
      
      if (window.AppState) {
        const feed = AppState.get('activityFeed') || [];
        feed.unshift(activity);
        if (feed.length > 50) feed.pop();
        AppState.set('activityFeed', feed);
      }
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
    cache.fearGreed = { data: null, timestamp: 0 };
    console.log('[API] 🗑️ Cache cleared');
  }

  function clearSpecificCache(type) {
    switch(type) {
      case 'market': 
        cache.marketData = { data: null, timestamp: 0 }; 
        break;
      case 'details': 
        cache.coinDetails = {}; 
        break;
      case 'search': 
        cache.searchResults = {}; 
        break;
      case 'trending': 
        cache.trending = { data: null, timestamp: 0 }; 
        break;
      case 'feargreed':
        cache.fearGreed = { data: null, timestamp: 0 };
        break;
    }
    console.log(`[API] 🗑️ Cleared ${type} cache`);
  }

  function getRequestLog() {
    return requestLog;
  }

  function clearRequestLog() {
    requestLog = [];
    console.log('[API] 🗑️ Request log cleared');
  }

  // ============================================
  // EXPORT
  // ============================================

  return {
    // Real-Time (Binance)
    getCandles,
    getLivePrice,
    subscribeToTicker,
    unsubscribeTicker,

    // Aggregated (CoinGecko)
    getMarketData,
    ensureCoinLoaded,
    searchCoins,
    getCoinDetails,
    getPrices,
    getTrendingCoins,
    getFearGreedIndex,
    proxiedCoinImageUrl,
    
    // Database Sync
    loadUserData,
    
    // Simulation (Vault Activity)
    generateSimulatedActivity,
    startSimulatedTrading,
    stopSimulatedTrading,
    
    // Utils
    clearCache,
    clearSpecificCache,
    getRequestLog,
    clearRequestLog
  };

})();

if (typeof window !== 'undefined') window.API = API;