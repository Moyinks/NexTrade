/**
 * NexTrade — Local Storage Wrapper
 * Safe localStorage wrapper with error handling and JSON serialization
 * Self-invoking module pattern
 */

const Storage = (() => {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================

  const PREFIX = 'nextrade_';
  const EXPIRY_KEY_SUFFIX = '_expiry';

  // ============================================
  // STORAGE AVAILABILITY CHECK
  // ============================================

  /**
   * Check if localStorage is available
   * @returns {boolean} True if localStorage is available
   */
  function isAvailable() {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (error) {
      return false;
    }
  }

  // ============================================
  // CORE STORAGE OPERATIONS
  // ============================================

  /**
   * Set item in localStorage
   * @param {string} key - Storage key
   * @param {*} value - Value to store (will be JSON stringified)
   * @param {number} ttl - Time to live in milliseconds (optional)
   * @returns {boolean} Success status
   */
  function set(key, value, ttl = null) {
    if (!isAvailable()) {
      console.warn('localStorage is not available');
      return false;
    }

    try {
      const prefixedKey = PREFIX + key;
      const serialized = JSON.stringify(value);
      localStorage.setItem(prefixedKey, serialized);

      // Set expiry if TTL provided
      if (ttl && typeof ttl === 'number' && ttl > 0) {
        const expiryTime = Date.now() + ttl;
        localStorage.setItem(prefixedKey + EXPIRY_KEY_SUFFIX, expiryTime.toString());
      }

      return true;
    } catch (error) {
      console.error('Storage set error:', error);
      
      // Handle quota exceeded error
      if (error.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, attempting cleanup...');
        cleanup();
        
        // Retry once after cleanup
        try {
          localStorage.setItem(PREFIX + key, JSON.stringify(value));
          return true;
        } catch (retryError) {
          console.error('Storage set retry failed:', retryError);
        }
      }
      
      return false;
    }
  }

  /**
   * Get item from localStorage
   * @param {string} key - Storage key
   * @param {*} defaultValue - Default value if key doesn't exist
   * @returns {*} Parsed value or defaultValue
   */
  function get(key, defaultValue = null) {
    if (!isAvailable()) {
      return defaultValue;
    }

    try {
      const prefixedKey = PREFIX + key;
      
      // Check if item has expired
      const expiryTime = localStorage.getItem(prefixedKey + EXPIRY_KEY_SUFFIX);
      if (expiryTime) {
        const expiry = parseInt(expiryTime, 10);
        if (Date.now() > expiry) {
          // Item has expired, remove it
          remove(key);
          return defaultValue;
        }
      }

      const item = localStorage.getItem(prefixedKey);
      
      if (item === null) {
        return defaultValue;
      }

      return JSON.parse(item);
    } catch (error) {
      console.error('Storage get error:', error);
      return defaultValue;
    }
  }

  /**
   * Remove item from localStorage
   * @param {string} key - Storage key
   * @returns {boolean} Success status
   */
  function remove(key) {
    if (!isAvailable()) {
      return false;
    }

    try {
      const prefixedKey = PREFIX + key;
      localStorage.removeItem(prefixedKey);
      localStorage.removeItem(prefixedKey + EXPIRY_KEY_SUFFIX);
      return true;
    } catch (error) {
      console.error('Storage remove error:', error);
      return false;
    }
  }

  /**
   * Check if key exists in localStorage
   * @param {string} key - Storage key
   * @returns {boolean} True if key exists and hasn't expired
   */
  function has(key) {
    if (!isAvailable()) {
      return false;
    }

    try {
      const prefixedKey = PREFIX + key;
      
      // Check expiry
      const expiryTime = localStorage.getItem(prefixedKey + EXPIRY_KEY_SUFFIX);
      if (expiryTime) {
        const expiry = parseInt(expiryTime, 10);
        if (Date.now() > expiry) {
          remove(key);
          return false;
        }
      }

      return localStorage.getItem(prefixedKey) !== null;
    } catch (error) {
      console.error('Storage has error:', error);
      return false;
    }
  }

  // ============================================
  // BATCH OPERATIONS
  // ============================================

  /**
   * Set multiple items at once
   * @param {object} items - Object with key-value pairs
   * @returns {boolean} Success status
   */
  function setMultiple(items) {
    if (!items || typeof items !== 'object') {
      return false;
    }

    let success = true;
    for (const key in items) {
      if (items.hasOwnProperty(key)) {
        if (!set(key, items[key])) {
          success = false;
        }
      }
    }

    return success;
  }

  /**
   * Get multiple items at once
   * @param {array} keys - Array of keys to retrieve
   * @returns {object} Object with key-value pairs
   */
  function getMultiple(keys) {
    if (!Array.isArray(keys)) {
      return {};
    }

    const result = {};
    keys.forEach(key => {
      result[key] = get(key);
    });

    return result;
  }

  /**
   * Remove multiple items at once
   * @param {array} keys - Array of keys to remove
   * @returns {boolean} Success status
   */
  function removeMultiple(keys) {
    if (!Array.isArray(keys)) {
      return false;
    }

    let success = true;
    keys.forEach(key => {
      if (!remove(key)) {
        success = false;
      }
    });

    return success;
  }

  // ============================================
  // UTILITY OPERATIONS
  // ============================================

  /**
   * Clear all NexTrade items from localStorage
   * @returns {boolean} Success status
   */
  function clear() {
    if (!isAvailable()) {
      return false;
    }

    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(PREFIX)) {
          localStorage.removeItem(key);
        }
      });
      return true;
    } catch (error) {
      console.error('Storage clear error:', error);
      return false;
    }
  }

  /**
   * Get all NexTrade keys from localStorage
   * @returns {array} Array of keys (without prefix)
   */
  function keys() {
    if (!isAvailable()) {
      return [];
    }

    try {
      const allKeys = Object.keys(localStorage);
      return allKeys
        .filter(key => key.startsWith(PREFIX) && !key.endsWith(EXPIRY_KEY_SUFFIX))
        .map(key => key.substring(PREFIX.length));
    } catch (error) {
      console.error('Storage keys error:', error);
      return [];
    }
  }

  /**
   * Get total size of NexTrade storage in bytes
   * @returns {number} Size in bytes
   */
  function size() {
    if (!isAvailable()) {
      return 0;
    }

    try {
      let total = 0;
      const allKeys = Object.keys(localStorage);
      
      allKeys.forEach(key => {
        if (key.startsWith(PREFIX)) {
          const value = localStorage.getItem(key);
          if (value) {
            total += key.length + value.length;
          }
        }
      });

      return total;
    } catch (error) {
      console.error('Storage size error:', error);
      return 0;
    }
  }

  /**
   * Clean up expired items from localStorage
   * @returns {number} Number of items cleaned up
   */
  function cleanup() {
    if (!isAvailable()) {
      return 0;
    }

    try {
      let cleanedCount = 0;
      const allKeys = Object.keys(localStorage);
      const now = Date.now();

      allKeys.forEach(key => {
        if (key.startsWith(PREFIX) && key.endsWith(EXPIRY_KEY_SUFFIX)) {
          const expiryTime = parseInt(localStorage.getItem(key), 10);
          if (now > expiryTime) {
            const originalKey = key.substring(PREFIX.length, key.length - EXPIRY_KEY_SUFFIX.length);
            remove(originalKey);
            cleanedCount++;
          }
        }
      });

      return cleanedCount;
    } catch (error) {
      console.error('Storage cleanup error:', error);
      return 0;
    }
  }

  // ============================================
  // SPECIALIZED GETTERS/SETTERS
  // ============================================

  /**
   * Store user session token
   * @param {string} token - Session token
   * @param {number} ttl - Time to live in milliseconds (default: 24 hours)
   * @returns {boolean} Success status
   */
  function setToken(token, ttl = 24 * 60 * 60 * 1000) {
    return set('auth_token', token, ttl);
  }

  /**
   * Get user session token
   * @returns {string|null} Session token or null
   */
  function getToken() {
    return get('auth_token', null);
  }

  /**
   * Remove user session token
   * @returns {boolean} Success status
   */
  function removeToken() {
    return remove('auth_token');
  }

  /**
   * Store user preferences
   * @param {object} preferences - User preferences object
   * @returns {boolean} Success status
   */
  function setPreferences(preferences) {
    return set('user_preferences', preferences);
  }

  /**
   * Get user preferences
   * @returns {object} User preferences or default object
   */
  function getPreferences() {
    return get('user_preferences', {
      theme: 'dark',
      notifications: true,
      currency: 'USD'
    });
  }

  /**
   * Store last visited page
   * @param {string} page - Page identifier
   * @returns {boolean} Success status
   */
  function setLastPage(page) {
    return set('last_page', page);
  }

  /**
   * Get last visited page
   * @returns {string} Page identifier or 'home'
   */
  function getLastPage() {
    return get('last_page', 'home');
  }

  // ============================================
  // EXPORT PUBLIC API
  // ============================================

  return {
    // Core operations
    set,
    get,
    remove,
    has,
    
    // Batch operations
    setMultiple,
    getMultiple,
    removeMultiple,
    
    // Utility operations
    clear,
    keys,
    size,
    cleanup,
    isAvailable,
    
    // Specialized operations
    setToken,
    getToken,
    removeToken,
    setPreferences,
    getPreferences,
    setLastPage,
    getLastPage
  };
})();

// ============================================
// AUTO-CLEANUP ON INIT
// ============================================

if (Storage.isAvailable()) {
  // Clean up expired items on load
  Storage.cleanup();
}

// ============================================
// PERIODIC CLEANUP (Every 5 minutes)
// ============================================

if (typeof window !== 'undefined') {
  setInterval(() => {
    Storage.cleanup();
  }, 5 * 60 * 1000);
}

// ============================================
// EXPORT FOR OTHER MODULES
// ============================================

if (typeof window !== 'undefined') {
  window.Storage = Storage;
}