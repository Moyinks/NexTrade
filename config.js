/**
 * NexTrade — Configuration File
 * Supabase credentials and app configuration
 * IMPORTANT: Replace with your actual Supabase credentials
 */

// ============================================
// SUPABASE CONFIGURATION
// ============================================

// TODO: Replace these with your actual Supabase project credentials
// Get these from: https://app.supabase.com/project/_/settings/api

const SUPABASE_CONFIG = {
  url: 'https://qniujskyexxlgoyrcmmt.supabase.co',  // Example: https://xxxxxxxxxxxxx.supabase.co
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuaXVqc2t5ZXh4bGdveXJjbW10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5OTIyNDAsImV4cCI6MjA4MjU2ODI0MH0.Al4E6yNmA2SEiIJ70tdiHJWVIvMdrStHNqxa0UwModE'  // Your anon/public key
};

// ============================================
// INITIALIZE SUPABASE CLIENT WITH RETRY LOGIC
// ============================================

let SupabaseClient = null;
let initAttempts = 0;
const MAX_INIT_ATTEMPTS = 20;

/**
 * Initialize Supabase client with retry mechanism
 * Waits for Supabase CDN to load before initializing
 */
function initializeSupabase() {
  return new Promise((resolve, reject) => {
    function attemptInit() {
      initAttempts++;

      // Check if Supabase library is loaded
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        try {
          // Validate configuration
          if (!SUPABASE_CONFIG.url || SUPABASE_CONFIG.url === 'YOUR_SUPABASE_URL') {
            console.error('❌ Supabase URL not configured in config.js');
            reject(new Error('Supabase URL not configured'));
            return;
          }

          if (!SUPABASE_CONFIG.anonKey || SUPABASE_CONFIG.anonKey === 'YOUR_SUPABASE_ANON_KEY') {
            console.error('❌ Supabase anon key not configured in config.js');
            reject(new Error('Supabase anon key not configured'));
            return;
          }

          // Initialize client
          supabaseClient = window.supabase.createClient(
            SUPABASE_CONFIG.url,
            SUPABASE_CONFIG.anonKey
          );

          // Expose to global scope
          window.supabaseClient = supabaseClient;
          window.SUPABASE_CONFIG = SUPABASE_CONFIG;

          console.log('✅ Supabase client initialized successfully');
          resolve(window.supabaseClient);

        } catch (error) {
          console.error('❌ Supabase initialization error:', error);
          reject(error);
        }
      } else {
        // Supabase not loaded yet
        if (initAttempts < MAX_INIT_ATTEMPTS) {
          setTimeout(attemptInit, 100);
        } else {
          console.error('❌ Supabase library failed to load after ' + MAX_INIT_ATTEMPTS + ' attempts');
          reject(new Error('Supabase library not loaded'));
        }
      }
    }

    // Start initialization attempts
    attemptInit();
  });
}

// ============================================
// AUTO-INITIALIZE ON SCRIPT LOAD
// ============================================

if (typeof window !== 'undefined') {
  // Start initialization process
  initializeSupabase().catch(error => {
    console.error('Failed to initialize Supabase:', error);
    window.supabaseInitError = error.message;
  });
}

// ============================================
// APP CONFIGURATION
// ============================================

const APP_CONFIG = {
  name: 'NexTrade',
  version: '1.0.0',
  environment: 'production', // 'development' or 'production'

  // Feature flags
  features: {
    demoDeposit: true,
    realDeposit: false,
    emailVerification: false
  },

  // API endpoints
  apis: {
    coingecko: 'https://api.coingecko.com/api/v3'
  },

  // Default values
  defaults: {
    currency: 'USD',
    minDeposit: 10,
    minWithdraw: 10,
    minInvestment: 100
  }
};

// Expose to global scope
if (typeof window !== 'undefined') {
  window.APP_CONFIG = APP_CONFIG;
  window.initializeSupabase = initializeSupabase;
}