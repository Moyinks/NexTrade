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
let supabaseLibraryPromise = null;

const SUPABASE_CDN_SOURCES = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0',
  'https://unpkg.com/@supabase/supabase-js@2.116.0'
];

function hasSupabaseLibrary() {
  return Boolean(
    window.supabase &&
    typeof window.supabase.createClient === 'function'
  );
}

function loadExternalScript(src, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      script.remove();
      reject(new Error('Timed out loading Supabase browser library'));
    }, timeoutMs);

    script.src = src;
    script.async = true;
    script.dataset.nextradeDependency = 'supabase';

    script.addEventListener('load', () => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      if (hasSupabaseLibrary()) resolve();
      else reject(new Error('Supabase browser library loaded without createClient'));
    }, { once: true });

    script.addEventListener('error', () => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      script.remove();
      reject(new Error('Failed to load Supabase browser library'));
    }, { once: true });

    document.head.appendChild(script);
  });
}

function ensureSupabaseLibrary() {
  if (hasSupabaseLibrary()) return Promise.resolve();
  if (supabaseLibraryPromise) return supabaseLibraryPromise;

  supabaseLibraryPromise = (async () => {
    let lastError = null;
    for (const src of SUPABASE_CDN_SOURCES) {
      try {
        await loadExternalScript(src);
        if (hasSupabaseLibrary()) return;
      } catch (error) {
        lastError = error;
        console.warn('[CONFIG] Supabase CDN source failed:', src, error.message);
      }
    }
    throw lastError || new Error('Supabase browser library unavailable');
  })();

  return supabaseLibraryPromise;
}

function initializeSupabase() {
  if (supabaseClient) return Promise.resolve(supabaseClient);
  if (supabaseInitPromise) return supabaseInitPromise;

  supabaseInitPromise = (async () => {
    if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
      throw new Error('Supabase public configuration is missing');
    }

    await ensureSupabaseLibrary();

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
  })();

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
    emailVerification: false,
    hdWallet: false
  },

  apis: {
    coingecko: 'https://api.coingecko.com/api/v3',
    generateAddress: '/api/generate-address',
    executeTrade: '/api/execute-trade'
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
      address: 'YourAddressHere_ETH_ERC20',
      label: 'USDT / ETH (ERC-20)',
      network: 'Ethereum Network',
      icon: 'fa-ethereum',
      color: '#627eea'
    },
    USDT_TRC20: {
      address: 'YourAddressHere_USDT_TRC20',
      label: 'USDT (TRC-20 / Tron)',
      network: 'Tron Network',
      icon: 'fa-coins',
      color: '#ef0027'
    },
    BTC: {
      address: 'YourAddressHere_BTC',
      label: 'Bitcoin (BTC)',
      network: 'Bitcoin Network',
      icon: 'fa-bitcoin',
      color: '#f7931a'
    }
  }
};

if (typeof window !== 'undefined') {
  window.APP_CONFIG = APP_CONFIG;
}
