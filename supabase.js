/**
 * NexTrade — Supabase Verification Module
 * ══════════════════════════════════════════════════════════════════════════════
 * HISTORY:
 * The original supabase.js tried to read window.Config.SUPABASE_URL, which was
 * never set — config.js sets window.SUPABASE_CONFIG and window.supabaseClient
 * directly. The result was that supabase.js always failed its own guard and
 * exited silently, making the entire module dead code while still being loaded.
 *
 * FIX:
 * config.js is the single place the Supabase client is initialized. This module
 * now simply verifies that initialization succeeded and logs a clear error if it
 * didn't, so failures are visible instead of silent. It does NOT create a second
 * client — duplicate clients cause session conflicts.
 */

(function () {
  'use strict';

  // config.js initializes supabaseClient before this file loads (see index.html
  // script order). Give it a short polling window in case of timing edge cases.
  let attempts = 0;
  const MAX_ATTEMPTS = 20; // 2 seconds total

  function verify() {
    if (window.supabaseClient) {
      console.log('[SUPABASE] ✅ Client verified — initialized by config.js');
      return;
    }

    attempts++;
    if (attempts < MAX_ATTEMPTS) {
      setTimeout(verify, 100);
    } else {
      console.error(
        '[SUPABASE] ❌ Client not initialized after ' + MAX_ATTEMPTS + ' attempts. ' +
        'Check config.js — SUPABASE_CONFIG.url and .anonKey must be set correctly.'
      );
    }
  }

  verify();

})();
