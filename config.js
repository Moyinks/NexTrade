/**
 * NexTrade — public portfolio configuration
 *
 * This repository is intentionally safe-by-default. The browser only contains
 * NexTrade's public Supabase project URL/anon key. Service-role credentials,
 * wallet xpubs and other privileged values belong only in Vercel environment
 * variables consumed by /api functions.
 */

const SUPABASE_CONFIG = {
  url: 'https://qniujskyexxlgoyrcmmt.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuaXVqc2t5ZXh4bGdveXJjbW10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5OTIyNDAsImV4cCI6MjA4MjU2ODI0MH0.Al4E6yNmA2SEiIJ70tdiHJWVIvMdrStHNqxa0UwModE'
};

let supabaseClient = null;
let supabaseInitPromise = null;

function hasSupabaseLibrary() {
  return Boolean(
    window.supabase &&
    typeof window.supabase.createClient === 'function'
  );
}

function initializeSupabase() {
  if (supabaseClient) return Promise.resolve(supabaseClient);
  if (supabaseInitPromise) return supabaseInitPromise;

  supabaseInitPromise = Promise.resolve().then(() => {
    if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
      throw new Error('Supabase public configuration is missing');
    }

    // The browser SDK is vendored into the deployment at build time.
    // Authentication must never depend on a third-party CDN being reachable.
    if (!hasSupabaseLibrary()) {
      throw new Error('Bundled Supabase browser runtime is unavailable');
    }

    supabaseClient = window.supabase.createClient(
      SUPABASE_CONFIG.url,
      SUPABASE_CONFIG.anonKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    window.supabaseClient = supabaseClient;
    window.SUPABASE_CONFIG = SUPABASE_CONFIG;
    return supabaseClient;
  });

  return supabaseInitPromise;
}

if (typeof window !== 'undefined') {
  window.SUPABASE_CONFIG = SUPABASE_CONFIG;
  window.initializeSupabase = initializeSupabase;
  window.supabaseReady = initializeSupabase();
  window.supabaseReady.catch((error) => {
    console.error('[CONFIG] Supabase initialization failed:', error);
    window.supabaseInitError = error.message;
  });
}

const APP_CONFIG = {
  name: 'NexTrade',
  version: '2.1.0',
  environment: 'portfolio',

  features: {
    // Public repository ships fail-closed. Enable only in a private deployment
    // after configuring the server-side wallet and operational controls.
    realDeposit: false,
    manualDepositTest: true,
    emailVerification: false,
    hdWallet: false
  },

  apis: {
    coingecko: 'https://api.coingecko.com/api/v3',
    generateAddress: '/api/generate-address',
    executeTrade: '/api/execute-trade',
    requestManualDeposit: '/api/test-manual-deposit'
  },

  defaults: {
    currency: 'USD',
    minDeposit: 10,
    minWithdraw: 10,
    minInvestment: 100,
    maxTransaction: 1000000000
  },

  // Deliberately invalid in the public build. openDeposit() is also disabled.
  // Never commit real receiving addresses to a public portfolio repository.
  depositAddresses: {
    ETH_ERC20: {
      address: 'TEST_ONLY_DO_NOT_SEND_REAL_FUNDS_ERC20',
      label: 'TEST ONLY — ERC-20',
      network: 'Manual deposit smoke test — no real transfer',
      icon: 'fa-ethereum',
      color: '#627eea'
    },
    USDT_TRC20: {
      address: 'TEST_ONLY_DO_NOT_SEND_REAL_FUNDS_TRC20',
      label: 'TEST ONLY — TRC-20',
      network: 'Manual deposit smoke test — no real transfer',
      icon: 'fa-coins',
      color: '#ef0027'
    },
    BTC: {
      address: 'TEST_ONLY_DO_NOT_SEND_REAL_FUNDS_BTC',
      label: 'TEST ONLY — BTC',
      network: 'Manual deposit smoke test — no real transfer',
      icon: 'fa-bitcoin',
      color: '#f7931a'
    }
  }
};

if (typeof window !== 'undefined') {
  window.APP_CONFIG = APP_CONFIG;
}
