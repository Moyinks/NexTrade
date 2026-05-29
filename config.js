/**
 * NexTrade — Configuration
 * ══════════════════════════════════════════════════════════════════════════════
 * DEPLOYMENT SETUP
 * ─────────────────────────────────────────────────────────────────────────────
 * For production deployment on Vercel, set these environment variables:
 *
 *   SUPABASE_URL          → your Supabase project URL
 *   SUPABASE_ANON_KEY     → your public anon key (safe to ship client-side)
 *   SUPABASE_SERVICE_KEY  → service role key  (api/ functions only — NEVER client-side)
 *   HD_WALLET_XPUB        → xpub from MetaMask/Ledger (api/ functions only)
 *   BTC_ADDRESS           → your real Bitcoin address
 *   TRC20_ADDRESS         → your real TRC-20 / Tron address
 *
 * DEPLOYMENT CHECKLIST
 * ─────────────────────────────────────────────────────────────────────────────
 *   [ ] Run SCHEMA.sql in Supabase SQL Editor (safe on existing data)
 *   [ ] Set all env vars in Vercel dashboard
 *   [ ] Export xpub from your wallet and set HD_WALLET_XPUB
 *   [ ] Replace depositAddresses below with your real wallet addresses
 *   [ ] Set realDeposit: true and hdWallet: true when ready
 *   [ ] Set environment: 'production' below
 *   [ ] Create the 'kyc-docs' storage bucket in Supabase (private)
 */

// ═══════════════════════════════════════
// SUPABASE CONFIG
// ═══════════════════════════════════════
const SUPABASE_CONFIG = {
  url:     'https://qniujskyexxlgoyrcmmt.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuaXVqc2t5ZXh4bGdveXJjbW10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5OTIyNDAsImV4cCI6MjA4MjU2ODI0MH0.Al4E6yNmA2SEiIJ70tdiHJWVIvMdrStHNqxa0UwModE'
  // anonKey is the public API key — safe to ship client-side.
  // Security is enforced by Supabase RLS policies and server-side guard triggers.
};

// ═══════════════════════════════════════
// CLIENT INITIALIZATION
// ═══════════════════════════════════════
let supabaseClient = null;
const MAX_INIT_ATTEMPTS = 20;

function initializeSupabase() {
  return new Promise((resolve, reject) => {
    let initAttempts = 0;

    function attemptInit() {
      initAttempts++;

      if (window.supabase && typeof window.supabase.createClient === 'function') {
        try {
          if (!SUPABASE_CONFIG.url) {
            console.error('❌ Supabase URL not configured in config.js');
            reject(new Error('Supabase URL not configured'));
            return;
          }
          if (!SUPABASE_CONFIG.anonKey) {
            console.error('❌ Supabase anon key not configured in config.js');
            reject(new Error('Supabase anon key not configured'));
            return;
          }

          supabaseClient = window.supabase.createClient(
            SUPABASE_CONFIG.url,
            SUPABASE_CONFIG.anonKey,
            {
              auth: {
                persistSession:     true,
                autoRefreshToken:   true,
                detectSessionInUrl: true
              }
            }
          );

          window.supabaseClient = supabaseClient;
          window.SUPABASE_CONFIG = SUPABASE_CONFIG;
          console.log('✅ Supabase client initialized');
          resolve(window.supabaseClient);

        } catch (error) {
          console.error('❌ Supabase initialization error:', error);
          reject(error);
        }
      } else {
        if (initAttempts < MAX_INIT_ATTEMPTS) {
          setTimeout(attemptInit, 100);
        } else {
          console.error('❌ Supabase library failed to load after ' + MAX_INIT_ATTEMPTS + ' attempts');
          reject(new Error('Supabase library not loaded'));
        }
      }
    }

    attemptInit();
  });
}

if (typeof window !== 'undefined') {
  initializeSupabase().catch(error => {
    console.error('Failed to initialize Supabase:', error);
    window.supabaseInitError = error.message;
  });
}

// ═══════════════════════════════════════
// APP CONFIG
// ═══════════════════════════════════════
const APP_CONFIG = {
  name:        'NexTrade',
  version:     '2.0.0',
  environment: 'production',

  features: {
    // realDeposit: set true once real addresses are in depositAddresses below.
    realDeposit:       true,
    emailVerification: false,
    // hdWallet: drives the /api/generate-address call for ETH deposits.
    // Set true only after HD_WALLET_XPUB is configured in Vercel env vars
    // and SCHEMA.sql has been run (deposit_addresses table + sequence required).
    hdWallet:          false
  },

  apis: {
    coingecko:       'https://api.coingecko.com/api/v3',
    generateAddress: '/api/generate-address'   // Vercel serverless — api/generate-address.js
  },

  defaults: {
    currency:      'USD',
    minDeposit:    10,
    minWithdraw:   10,
    minInvestment: 100
  },

  // ── Deposit addresses ───────────────────────────────────────────────────────
  // Replace with your real wallet addresses before setting realDeposit: true.
  // ETH_ERC20 is generated per-user by /api/generate-address when hdWallet is true.
  // When hdWallet is false, ETH_ERC20.address is used as a static fallback.
  depositAddresses: {
    ETH_ERC20: {
      address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',   // ← replace with your address
      label:   'USDT / ETH (ERC-20)',
      network: 'Ethereum Network',
      icon:    'fa-ethereum',
      color:   '#627eea'
    },
    USDT_TRC20: {
      address: 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7',           // ← replace with your Tron address
      label:   'USDT (TRC-20 / Tron)',
      network: 'Tron Network',
      icon:    'fa-coins',
      color:   '#ef0027'
    },
    BTC: {
      address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf',              // ← replace with your BTC address
      label:   'Bitcoin (BTC)',
      network: 'Bitcoin Network',
      icon:    'fa-bitcoin',
      color:   '#f7931a'
    }
  }
};

if (typeof window !== 'undefined') {
  window.APP_CONFIG         = APP_CONFIG;
  window.initializeSupabase = initializeSupabase;
}
