/**
 * NexTrade — Session Manager
 * ══════════════════════════════════════════════════════════════
 * PURPOSE: Ensures clean state on fresh login/signup
 * RUNS: After Supabase auth but BEFORE app initialization
 * ══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // This module runs IMMEDIATELY when loaded
  console.log('[SESSION] 🔍 Checking session state...');

  // Check if this is a fresh login from login.html
  const isFreshLogin = document.referrer.includes('login.html') || 
                       sessionStorage.getItem('nextrade_fresh_login') === 'true';

  if (isFreshLogin) {
    console.log('[SESSION] 🧹 Fresh login detected - clearing stale data...');
    
    // Clear ONLY app state, preserve Supabase auth token
    const keysToRemove = [
      'nextrade_state_v1',
      'nextrade_last_page',
      'nextrade_cache',
      'nextrade_market_cache',
      'nextrade_user_preferences'
    ];
    
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
      console.log(`[SESSION] 🗑️ Removed: ${key}`);
    });
    
    // Clear the fresh login flag
    sessionStorage.removeItem('nextrade_fresh_login');
    
    console.log('[SESSION] ✅ Stale data cleared');
  } else {
    console.log('[SESSION] ℹ️ Normal session continuation');
  }

  // Export a cleanup function for manual use
  window.SessionManager = {
    clearAppData: () => {
      console.log('[SESSION] 🧹 Manual cleanup triggered...');
      const keysToRemove = [
        'nextrade_state_v1',
        'nextrade_last_page',
        'nextrade_cache',
        'nextrade_market_cache',
        'nextrade_user_preferences'
      ];
      keysToRemove.forEach(key => localStorage.removeItem(key));
      console.log('[SESSION] ✅ App data cleared');
    },
    
    markFreshLogin: () => {
      sessionStorage.setItem('nextrade_fresh_login', 'true');
    }
  };

  console.log('[SESSION] 📦 Session Manager loaded');

})();
