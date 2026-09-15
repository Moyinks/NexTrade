/**
 * NexTrade — Supabase Verification Module
 * config.js owns the single browser client. This module only reports whether
 * the explicit readiness promise succeeded; it never creates a second client.
 */
(function () {
  'use strict';

  async function verify() {
    try {
      if (window.supabaseReady) await window.supabaseReady;
      else if (typeof window.initializeSupabase === 'function') await window.initializeSupabase();

      if (!window.supabaseClient) throw new Error('Supabase client unavailable');
      console.log('[SUPABASE] ✅ Client verified — initialized by config.js');
    } catch (error) {
      console.error('[SUPABASE] ❌ Client initialization failed:', error);
    }
  }

  verify();
})();
