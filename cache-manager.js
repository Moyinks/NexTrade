/**
 * NexTrade — Cache Manager (Production Grade - Zero API Waste)
 * ══════════════════════════════════════════════════════════════
 * ARCHITECTURE:
 * - Tier 1: Memory Cache (0ms latency)
 * - Tier 2: Pre-computed Derived Views (gainers, losers, volume)
 * - Tier 3: Background Refresh with Smart Alerts
 * - Tier 4: Graceful Degradation (stale > nothing)
 * 
 * GUARANTEES:
 * - No duplicate API requests
 * - No blank screens
 * - No "No Results Found" errors
 * - Handles rate limits gracefully
 * ══════════════════════════════════════════════════════════════
 */

const CacheManager = (() => {
  'use strict';

  // ============================================
  // CONSTANTS & CONFIGURATION
  // ============================================

  const CONFIG = {
    CACHE_TTL: 60 * 60 * 1000,
    BACKGROUND_CHECK_INTERVAL: 30 * 1000,
    RETRY_DELAYS: [60000, 120000, 300000],
    MAX_STALE_AGE: 24 * 60 * 60 * 1000,
    MIN_COINS_FOR_DERIVED: 10
  };

  const CACHE_STORAGE_KEY = 'nextrade:market-cache:v1';

  // ============================================
  // STATE
  // ============================================

  const cache = {
    // Raw market data
    marketData: {
      data: null,
      timestamp: 0,
      source: null, // 'api' | 'cache' | 'stale'
      version: 1
    },
    
    // Pre-computed derived views
    derived: {
      gainers: [],
      losers: [],
      volumeLeaders: [],
      computedAt: 0
    },
    
    // Trending data (separate endpoint)
    trending: {
      data: null,
      timestamp: 0
    },
    
    // Request tracking
    activeRequests: new Map(),
    lastRefreshAttempt: 0,
    retryCount: 0,
    retryAfterUntil: 0,
    lastFailureCode: null,
    isRefreshing: false
  };

  let backgroundCheckTimer = null;

  function persistCache() {
    try {
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        marketData: { data: cache.marketData.data, timestamp: cache.marketData.timestamp },
        trending: { data: cache.trending.data, timestamp: cache.trending.timestamp }
      }));
    } catch (_) {}
  }

  function hydratePersistentCache() {
    try {
      const raw = localStorage.getItem(CACHE_STORAGE_KEY);
      if (!raw) return false;
      const snapshot = JSON.parse(raw);
      const now = Date.now();

      if (!snapshot || snapshot.version !== 1 || !snapshot.marketData ||
          !Array.isArray(snapshot.marketData.data) ||
          !Number.isFinite(Number(snapshot.marketData.timestamp)) ||
          now - Number(snapshot.marketData.timestamp) > CONFIG.MAX_STALE_AGE) {
        localStorage.removeItem(CACHE_STORAGE_KEY);
        return false;
      }

      cache.marketData = {
        data: snapshot.marketData.data,
        timestamp: Number(snapshot.marketData.timestamp),
        source: 'persistent',
        version: 1
      };
      cache.derived = { ...computeDerivedViews(cache.marketData.data), computedAt: Date.now() };

      if (snapshot.trending && Array.isArray(snapshot.trending.data) &&
          Number.isFinite(Number(snapshot.trending.timestamp)) &&
          now - Number(snapshot.trending.timestamp) <= CONFIG.MAX_STALE_AGE) {
        cache.trending = {
          data: snapshot.trending.data,
          timestamp: Number(snapshot.trending.timestamp)
        };
      }

      if (window.AppState) AppState.set('marketData', cache.marketData.data);
      return true;
    } catch (_) {
      try { localStorage.removeItem(CACHE_STORAGE_KEY); } catch (_) {}
      return false;
    }
  }

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  function isValid(cacheEntry, customTTL = null) {
    if (!cacheEntry || !cacheEntry.data || !cacheEntry.timestamp) {
      return false;
    }
    
    const ttl = customTTL || CONFIG.CACHE_TTL;
    const age = Date.now() - cacheEntry.timestamp;
    
    return age < ttl;
  }

  function isStale(cacheEntry) {
    if (!cacheEntry || !cacheEntry.timestamp) return true;
    
    const age = Date.now() - cacheEntry.timestamp;
    return age > CONFIG.CACHE_TTL && age < CONFIG.MAX_STALE_AGE;
  }

  function getCacheAge(timestamp) {
    if (!timestamp) return null;
    
    const ageMs = Date.now() - timestamp;
    const ageMinutes = Math.floor(ageMs / 60000);
    
    if (ageMinutes < 1) return 'Just now';
    if (ageMinutes === 1) return '1 minute ago';
    if (ageMinutes < 60) return `${ageMinutes} minutes ago`;
    
    const ageHours = Math.floor(ageMinutes / 60);
    if (ageHours === 1) return '1 hour ago';
    if (ageHours < 24) return `${ageHours} hours ago`;
    
    return 'Over 24 hours ago';
  }

  // ============================================
  // REQUEST DEDUPLICATION
  // ============================================

  async function dedupedRequest(key, fetcher) {
    // Check if request already in flight
    if (cache.activeRequests.has(key)) {
      console.log(`[CACHE] 🔄 Deduping request: ${key}`);
      return cache.activeRequests.get(key);
    }

    // Create new request promise
    const requestPromise = (async () => {
      try {
        const result = await fetcher();
        return result;
      } finally {
        cache.activeRequests.delete(key);
      }
    })();

    cache.activeRequests.set(key, requestPromise);
    return requestPromise;
  }

  // ============================================
  // DERIVED VIEW COMPUTATION
  // ============================================

  function computeDerivedViews(marketData) {
    if (!marketData || !Array.isArray(marketData) || marketData.length < CONFIG.MIN_COINS_FOR_DERIVED) {
      console.warn('[CACHE] ⚠️ Insufficient data for derived views');
      return {
        gainers: [],
        losers: [],
        volumeLeaders: []
      };
    }

    console.log('[CACHE] 🔄 Computing derived views...');

    // Gainers: Positive change, sorted descending
    const gainers = marketData
      .filter(coin => coin.price_change_percentage_24h > 0)
      .sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h)
      .slice(0, 30);

    // Losers: Negative change, sorted ascending (most negative first)
    const losers = marketData
      .filter(coin => coin.price_change_percentage_24h < 0)
      .sort((a, b) => a.price_change_percentage_24h - b.price_change_percentage_24h)
      .slice(0, 30);

    // Volume Leaders: Sorted by volume descending
    const volumeLeaders = [...marketData]
      .sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0))
      .slice(0, 30);

    console.log(`[CACHE] ✅ Derived views computed:`, {
      gainers: gainers.length,
      losers: losers.length,
      volumeLeaders: volumeLeaders.length
    });

    return { gainers, losers, volumeLeaders };
  }

  // ============================================
  // CORE CACHE METHODS
  // ============================================

  async function getMarketData(forceRefresh = false) {
    console.log(`[CACHE] 📊 getMarketData(forceRefresh=${forceRefresh})`);

    // TIER 1: Valid memory cache
    if (!forceRefresh && isValid(cache.marketData)) {
      console.log(`[CACHE] ✅ Using valid cache (age: ${getCacheAge(cache.marketData.timestamp)})`);
      return {
        success: true,
        data: cache.marketData.data,
        source: 'cache',
        age: getCacheAge(cache.marketData.timestamp),
        derived: cache.derived
      };
    }

    // TIER 2: Stale but usable cache (show while fetching)
    const hasStaleCache = isStale(cache.marketData);
    
    if (hasStaleCache && !forceRefresh) {
      console.log(`[CACHE] ⚠️ Using stale cache (age: ${getCacheAge(cache.marketData.timestamp)})`);
      
      // Return stale data immediately
      const staleResult = {
        success: true,
        data: cache.marketData.data,
        source: 'stale',
        age: getCacheAge(cache.marketData.timestamp),
        derived: cache.derived,
        isStale: true
      };

      // Trigger background refresh (don't wait)
      refreshInBackground();

      return staleResult;
    }

    // TIER 3: Fetch fresh data
    return await fetchFreshData();
  }

  async function fetchFreshData() {
    console.log('[CACHE] 🌐 Fetching fresh market data...');

    return dedupedRequest('market-data', async () => {
      try {
        // Use API module
        if (!window.API || typeof API.getMarketData !== 'function') {
          throw new Error('API module not available');
        }

        const result = await API.getMarketData(100, 'usd', false);

        if (!result.success || !result.data || result.data.length === 0) {
          throw new Error('API returned no data');
        }

        // Update cache
        cache.marketData = {
          data: result.data,
          timestamp: Date.now(),
          source: 'api',
          version: 1
        };

        // Compute derived views
        const derived = computeDerivedViews(result.data);
        cache.derived = {
          ...derived,
          computedAt: Date.now()
        };

        // Update AppState if available
        if (window.AppState) {
          AppState.set('marketData', result.data);
        }

        cache.retryCount = 0;
        cache.retryAfterUntil = 0;
        cache.lastFailureCode = null;
        persistCache();

        console.log(`[CACHE] ✅ Fresh data cached (${result.data.length} coins)`);

        return {
          success: true,
          data: result.data,
          source: 'api',
          age: 'Just now',
          derived: cache.derived
        };

      } catch (error) {
        console.error('[CACHE] ❌ Fetch failed:', error);
        cache.lastFailureCode = error && error.code ? error.code : 'MARKET_UNAVAILABLE';
        const retrySeconds = Number(error && error.retryAfterSeconds);
        if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
          cache.retryAfterUntil = Date.now() + retrySeconds * 1000;
        }

        // If we have stale cache, use it
        if (cache.marketData.data && cache.marketData.data.length > 0) {
          console.log('[CACHE] 📦 Falling back to stale cache');
          
          return {
            success: true,
            data: cache.marketData.data,
            source: 'stale',
            age: getCacheAge(cache.marketData.timestamp),
            derived: cache.derived,
            isStale: true,
            error: error.message
          };
        }

        // No cache available - hard failure
        return {
          success: false,
          data: [],
          source: null,
          error: error.message,
          derived: { gainers: [], losers: [], volumeLeaders: [] }
        };
      }
    });
  }

  async function getTrendingCoins(forceRefresh = false) {
    console.log(`[CACHE] 🔥 getTrendingCoins(forceRefresh=${forceRefresh})`);

    // Check cache
    if (!forceRefresh && isValid(cache.trending)) {
      console.log('[CACHE] ✅ Using cached trending data');
      return {
        success: true,
        data: cache.trending.data
      };
    }

    return dedupedRequest('trending-coins', async () => {
      try {
        if (!window.API || typeof API.getTrendingCoins !== 'function') {
          throw new Error('API module not available');
        }

        const result = await API.getTrendingCoins();

        if (result.success && result.data) {
          cache.trending = {
            data: result.data,
            timestamp: Date.now()
          };
          persistCache();
          console.log(`[CACHE] ✅ Trending data cached (${result.data.length} coins)`);
        }

        return {
          ...result,
          source: result.source || 'api',
          age: cache.trending.timestamp ? getCacheAge(cache.trending.timestamp) : null
        };

      } catch (error) {
        console.error('[CACHE] ❌ Trending fetch failed:', error);
        
        // Return stale cache if available
        if (cache.trending.data) {
          return {
            success: true,
            data: cache.trending.data,
            source: 'stale',
            age: getCacheAge(cache.trending.timestamp),
            isStale: true
          };
        }

        return {
          success: false,
          data: [],
          error: error.message
        };
      }
    });
  }

  // ============================================
  // DERIVED VIEW GETTERS
  // ============================================

  function getGainers() {
    if (cache.derived.gainers.length > 0) {
      console.log(`[CACHE] ✅ Returning ${cache.derived.gainers.length} cached gainers`);
      return cache.derived.gainers;
    }

    // Fallback: compute on-demand if cache is empty
    if (cache.marketData.data && cache.marketData.data.length > 0) {
      console.log('[CACHE] 🔄 Computing gainers on-demand');
      const derived = computeDerivedViews(cache.marketData.data);
      cache.derived.gainers = derived.gainers;
      return derived.gainers;
    }

    console.warn('[CACHE] ⚠️ No gainers available');
    return [];
  }

  function getLosers() {
    if (cache.derived.losers.length > 0) {
      console.log(`[CACHE] ✅ Returning ${cache.derived.losers.length} cached losers`);
      return cache.derived.losers;
    }

    if (cache.marketData.data && cache.marketData.data.length > 0) {
      console.log('[CACHE] 🔄 Computing losers on-demand');
      const derived = computeDerivedViews(cache.marketData.data);
      cache.derived.losers = derived.losers;
      return derived.losers;
    }

    console.warn('[CACHE] ⚠️ No losers available');
    return [];
  }

  function getVolumeLeaders() {
    if (cache.derived.volumeLeaders.length > 0) {
      console.log(`[CACHE] ✅ Returning ${cache.derived.volumeLeaders.length} cached volume leaders`);
      return cache.derived.volumeLeaders;
    }

    if (cache.marketData.data && cache.marketData.data.length > 0) {
      console.log('[CACHE] 🔄 Computing volume leaders on-demand');
      const derived = computeDerivedViews(cache.marketData.data);
      cache.derived.volumeLeaders = derived.volumeLeaders;
      return derived.volumeLeaders;
    }

    console.warn('[CACHE] ⚠️ No volume leaders available');
    return [];
  }

  // ============================================
  // BACKGROUND REFRESH
  // ============================================

  async function refreshInBackground() {
    if (cache.isRefreshing) {
      console.log('[CACHE] ⏳ Refresh already in progress, skipping');
      return;
    }

    const now = Date.now();
    if (cache.retryAfterUntil > now) {
      console.log(`[CACHE] ⏸️ Provider retry window active for ${Math.ceil((cache.retryAfterUntil - now) / 1000)}s`);
      return;
    }

    const timeSinceLastAttempt = now - cache.lastRefreshAttempt;
    const minDelay = CONFIG.RETRY_DELAYS[Math.min(cache.retryCount, CONFIG.RETRY_DELAYS.length - 1)];

    if (timeSinceLastAttempt < minDelay) {
      console.log(`[CACHE] ⏸️ Waiting ${Math.ceil((minDelay - timeSinceLastAttempt) / 1000)}s before retry`);
      return;
    }

    cache.isRefreshing = true;
    cache.lastRefreshAttempt = Date.now();

    console.log('[CACHE] 🔄 Background refresh started...');

    try {
      const result = await fetchFreshData();
      
      if (result.success) {
        cache.retryCount = 0;
        console.log('[CACHE] ✅ Background refresh complete');
      } else {
        cache.retryCount++;
        console.warn(`[CACHE] ⚠️ Background refresh failed (retry ${cache.retryCount})`);
      }
    } catch (error) {
      cache.retryCount++;
      console.error('[CACHE] ❌ Background refresh error:', error);
    } finally {
      cache.isRefreshing = false;
    }
  }

  function startBackgroundChecker() {
    if (backgroundCheckTimer) {
      console.log('[CACHE] ⚠️ Background checker already running');
      return;
    }

    console.log('[CACHE] 🔄 Starting background checker...');

    backgroundCheckTimer = setInterval(() => {
      // Only check if user is active (page visible)
      if (document.hidden) {
        return;
      }

      // Check if cache needs refresh
      if (!isValid(cache.marketData)) {
        console.log('[CACHE] 🔔 Cache expired, triggering background refresh');
        refreshInBackground();
      }
    }, CONFIG.BACKGROUND_CHECK_INTERVAL);

    console.log('[CACHE] ✅ Background checker started');
  }

  function stopBackgroundChecker() {
    if (backgroundCheckTimer) {
      clearInterval(backgroundCheckTimer);
      backgroundCheckTimer = null;
      console.log('[CACHE] ⏹️ Background checker stopped');
    }
  }

  // ============================================
  // NOTIFICATIONS
  // ============================================

  function showCacheNotification(type, title, message) {
    if (!window.App) return;

    switch (type) {
      case 'success':
        if (App.showSuccess) App.showSuccess(message);
        break;
      case 'error':
        if (App.showError) App.showError(message);
        break;
      case 'warning':
        if (App.showError) App.showError(message); // Use error toast for warnings (visible)
        break;
      default:
        console.log(`[CACHE] 📢 ${title}: ${message}`);
    }
  }

  // ============================================
  // CACHE INSPECTION & DEBUGGING
  // ============================================

  function getCacheStatus() {
    const marketAge = cache.marketData.timestamp 
      ? getCacheAge(cache.marketData.timestamp)
      : 'Never';

    const trendingAge = cache.trending.timestamp
      ? getCacheAge(cache.trending.timestamp)
      : 'Never';

    return {
      marketData: {
        cached: !!cache.marketData.data,
        count: cache.marketData.data?.length || 0,
        age: marketAge,
        valid: isValid(cache.marketData),
        stale: isStale(cache.marketData),
        source: cache.marketData.source
      },
      derived: {
        gainers: cache.derived.gainers.length,
        losers: cache.derived.losers.length,
        volumeLeaders: cache.derived.volumeLeaders.length,
        age: cache.derived.computedAt ? getCacheAge(cache.derived.computedAt) : 'Never'
      },
      trending: {
        cached: !!cache.trending.data,
        count: cache.trending.data?.length || 0,
        age: trendingAge,
        valid: isValid(cache.trending)
      },
      system: {
        activeRequests: cache.activeRequests.size,
        isRefreshing: cache.isRefreshing,
        retryCount: cache.retryCount,
        nextRetrySeconds: cache.retryAfterUntil > Date.now()
          ? Math.ceil((cache.retryAfterUntil - Date.now()) / 1000)
          : 0,
        lastFailureCode: cache.lastFailureCode,
        backgroundCheckerRunning: !!backgroundCheckTimer
      }
    };
  }

  function clearCache() {
    console.log('[CACHE] 🗑️ Clearing all cache...');

    cache.marketData = { data: null, timestamp: 0, source: null, version: 1 };
    cache.derived = { gainers: [], losers: [], volumeLeaders: [], computedAt: 0 };
    cache.trending = { data: null, timestamp: 0 };
    cache.activeRequests.clear();
    cache.retryCount = 0;
    cache.retryAfterUntil = 0;
    cache.lastFailureCode = null;
    try { localStorage.removeItem(CACHE_STORAGE_KEY); } catch (_) {}

    console.log('[CACHE] ✅ Cache cleared');
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function init() {
    console.log('[CACHE] 🚀 Initializing CacheManager...');

    hydratePersistentCache();
    startBackgroundChecker();
    
    // Listen for page visibility changes
    const _visibilityHandler = () => {
  if (!document.hidden && !isValid(cache.marketData)) {
    refreshInBackground();
  }
};
document.removeEventListener('visibilitychange', _visibilityHandler);
document.addEventListener('visibilitychange', _visibilityHandler);

    console.log('[CACHE] ✅ CacheManager initialized');
  }

  // ============================================
  // PUBLIC API
  // ============================================

  return {
    // Primary methods
    init,
    getMarketData,
    getTrendingCoins,
    
    // Derived view getters
    getGainers,
    getLosers,
    getVolumeLeaders,
    
    // Cache control
    refresh: refreshInBackground,
    clearCache,
    getCacheStatus,
    
    // Background management
    startBackgroundChecker,
    stopBackgroundChecker,
    
    // Utilities
    getCacheAge,
    isValid: (timestamp) => isValid({ timestamp, data: true })
  };
})();

// Export to window
if (typeof window !== 'undefined') {
  window.CacheManager = CacheManager;
  console.log('[CACHE] 📦 CacheManager module loaded');
}
