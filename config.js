/**
 * NexTrade — Configuration File
 *
 * FIXES:
 * 1. Variable name bug — `let SupabaseClient = null` (capitalized) was declared
 *    at module scope but never assigned. Inside initializeSupabase(), the
 *    assignment `supabaseClient = window.supabase.createClient(...)` went to a
 *    different identifier (lowercase), creating an implicit global in sloppy mode
 *    and a ReferenceError in strict mode. All other files reference
 *    window.supabaseClient (lowercase). Fixed: declaration renamed to
 *    `supabaseClient` to match every usage site.
 *
 * 2. initAttempts scope bug — initAttempts was declared at module scope. If
 *    initializeSupabase() was called a second time (e.g., after a connection
 *    error or in a reconnect flow), the counter would start from wherever the
 *    first call left it. If the first call exhausted all 20 attempts, any
 *    subsequent call would start at 20 and reject immediately on the first
 *    attemptInit(). Fixed: initAttempts declared inside initializeSupabase()
 *    so it resets to 0 on every call.
 *
 * 3. Dead feature flag removed — `demoDeposit: true` was never read anywhere
 *    in the codebase (confirmed by grep across all .js and .html files). It
 *    existed alongside `realDeposit: false` and implied a runtime mode switch
 *    that does not exist. Removed to eliminate false confidence.
 *
 * 4. Honest environment flag — `environment: 'production'` was set while
 *    deposit addresses are placeholder strings and realDeposit is false.
 *    No code currently reads APP_CONFIG.environment, but the value is visible
 *    to any developer reading the config and contradicts the actual state.
 *    Set to 'development' until the DEPLOYMENT_CHECKLIST below is completed.
 *
 * 5. Misleading comments cleaned up — SUPABASE_CONFIG block previously said
 *    "TODO: Replace these" and "Example:" on the credentials that ARE the live
 *    project credentials. Comments updated to reflect reality.
 */

// ============================================
// SUPABASE CONFIGURATION
// ============================================

const SUPABASE_CONFIG = {
  url:     'https://qniujskyexxlgoyrcmmt.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuaXVqc2t5ZXh4bGdveXJjbW10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5OTIyNDAsImV4cCI6MjA4MjU2ODI0MH0.Al4E6yNmA2SEiIJ70tdiHJWVIvMdrStHNqxa0UwModE'
  // The anonKey is the public API key. It is safe to ship client-side.
  // Security is enforced by Supabase Row Level Security (RLS) policies,
  // NOT by keeping this key secret. Ensure RLS is correctly configured
  // for every table before accepting real user funds.
};

// ============================================
// INITIALIZE SUPABASE CLIENT WITH RETRY LOGIC
// ============================================

// FIX (bug 1): renamed from `SupabaseClient` (capitalized) to `supabaseClient`
// (lowercase) to match every usage in the codebase. The old capitalized name
// was declared here but never assigned — the assignment inside
// initializeSupabase() used lowercase and created an implicit global.
let supabaseClient = null;

const MAX_INIT_ATTEMPTS = 20;

/**
 * Initialize Supabase client with retry mechanism.
 * Waits for Supabase CDN to load before initializing.
 * Safe to call multiple times — retry counter resets on each call.
 */
function initializeSupabase() {
  return new Promise((resolve, reject) => {
    // FIX (bug 2): initAttempts declared inside the function, not at module
    // scope. This ensures the counter resets to 0 on every call to
    // initializeSupabase(), so a second call (e.g., reconnect) gets the full
    // 20 retry budget rather than starting from wherever the first call left off.
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

          console.log('✅ Supabase client initialized successfully');
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

// ============================================
// AUTO-INITIALIZE ON SCRIPT LOAD
// ============================================

if (typeof window !== 'undefined') {
  initializeSupabase().catch(error => {
    console.error('Failed to initialize Supabase:', error);
    window.supabaseInitError = error.message;
  });
}

// ============================================
// APP CONFIGURATION
// ============================================

// ── DEPLOYMENT CHECKLIST ───────────────────────────────────────────────────
// Before setting realDeposit: true and environment: 'production':
//
//   [ ] Replace all three placeholder addresses in trade.js DEPOSIT_ADDRESSES:
//         USDT_ERC20.address  → real ERC-20 wallet address
//         BTC.address         → real Bitcoin wallet address
//         USDT_TRC20.address  → real TRC-20 wallet address
//
//   [ ] Verify Supabase RLS policies on all tables:
//         transactions — users can only INSERT their own rows; SELECT own rows only
//         profiles     — users can only SELECT/UPDATE their own row
//         investments  — users can only INSERT/SELECT their own rows
//
//   [ ] Set realDeposit: true below
//   [ ] Set environment: 'production' below
//
// trade.js openDeposit() reads APP_CONFIG.features.realDeposit at runtime.
// If false, the deposit UI is blocked before any address is shown to the user.
// If true but addresses still contain placeholder strings, the secondary
// runtime check in trade.js (PLACEHOLDER_PATTERNS scan) will also block it.
// ──────────────────────────────────────────────────────────────────────────

const APP_CONFIG = {
  name:    'NexTrade',
  version: '1.0.0',

  // FIX (bug 4): was 'production'. Deposit addresses are placeholder strings
  // and realDeposit is false — this is not a production deployment.
  // No code currently reads this field; it is informational only.
  // Change to 'production' only after completing the DEPLOYMENT CHECKLIST above.
  environment: 'development',

  // Feature flags
  features: {
    // FIX (bug 3): demoDeposit removed. It was never read by any code in the
    // codebase — confirmed grep across all .js and .html files. It implied a
    // demo/real mode switch that does not exist and gave false confidence that
    // some runtime guard was in place.

    // realDeposit: controls whether the deposit UI is accessible.
    // trade.js openDeposit() gates on this flag. Set to true only after
    // real deposit addresses are in place (see DEPLOYMENT CHECKLIST above).
    realDeposit: false,

    emailVerification: false
  },

  // API endpoints
  apis: {
    coingecko: 'https://api.coingecko.com/api/v3'
  },

  // Default values
  defaults: {
    currency:      'USD',
    minDeposit:    10,
    minWithdraw:   10,
    minInvestment: 100
  }
};

// Expose to global scope
if (typeof window !== 'undefined') {
  window.APP_CONFIG = APP_CONFIG;
  window.initializeSupabase = initializeSupabase;
}
