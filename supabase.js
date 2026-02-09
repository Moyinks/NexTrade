/**
 * NexTrade — Supabase Connection Module (Infrastructure Layer)
 * * RESPONSIBILITIES:
 * 1. Validates configuration credentials (URL/Key).
 * 2. Initializes the Supabase JS Client using the global SDK.
 * 3. Exposes the authenticated client as a global singleton: 'window.supabaseClient'.
 * 4. Fails loudly if dependencies are missing to prevent silent runtime errors.
 */

(function () {
  'use strict';

  // 1. Dependency Check: Ensure the Supabase SDK script is loaded in index.html
  if (typeof window.supabase === 'undefined') {
    console.error('❌ Supabase: SDK not found. Please ensure the CDN script is loaded before this file.');
    return;
  }

  // 2. Configuration Check: Ensure Config.js has loaded
  // We check for both window.Config and the specific keys to be safe.
  const config = window.Config || {};
  const SUPABASE_URL = config.SUPABASE_URL;
  const SUPABASE_KEY = config.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL.includes('YOUR_')) {
    console.error('❌ Supabase: Invalid or missing API credentials in Config.js.');
    return;
  }

  // 3. Client Initialization
  // Options allow for better session persistence and auto-refresh handling.
  try {
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    // 4. Global Exposure
    // This is the variable consistent with app.js and wallet.js
    window.supabaseClient = client;
    
    console.log('⚡ Supabase: Connection initialized successfully.');

  } catch (err) {
    console.error('❌ Supabase: Client initialization failed.', err);
  }

})();
