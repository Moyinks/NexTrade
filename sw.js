/**
 * NexTrade — Service Worker  v1.0
 *
 * Strategy:
 *   - Static local assets   → Cache First  (instant loads)
 *   - CDN assets (fonts etc) → Stale While Revalidate
 *   - Supabase API calls     → Network Only (never cache auth/data)
 *   - Everything else        → Network First, fallback to cache
 *   - Offline fallback       → /login.html
 *
 * Bump CACHE_VERSION whenever you deploy changes so users get fresh files.
 */

const CACHE_VERSION  = 'nextrade-premium-auth-finish-v1';
const OFFLINE_URL    = '/login.html';

// ── FILES TO PRECACHE ON INSTALL ──────────────────────────────────────────────
// All local static files. SW install uses Promise.allSettled so one 404
// does not abort the rest — but every path here should be valid.

const PRECACHE_URLS = [
  // Pages
  '/login.html',
  '/index.html',
  // Stylesheets
  '/brand-system.css',
  '/core.css',
  '/components.css',
  '/design-system.css',
  '/demo-deposit.css',
  '/admin-review.css',
  '/hero-card.css',
  '/layout.css',
  '/pages.css',
  '/mobile.css',
  // Core scripts (load-order independent — all deferred)
  '/vendor/supabase/supabase.js',
  '/vendor/fontawesome/css/all.min.css',
  '/vendor/fontawesome/webfonts/fa-solid-900.woff2',
  '/vendor/fontawesome/webfonts/fa-regular-400.woff2',
  '/vendor/lightweight-charts/lightweight-charts.standalone.production.js',
  '/config.js',
  '/auth.js',
  '/login-page.js',
  '/index-pwa.js',
  '/index-entry.js',
  '/app-actions.js',
  '/format.js',
  '/transaction-ui.js',
  '/theme-bootstrap.js',
  '/preferences.js',
  '/theme.js',
  '/experience.js',
  '/themes.css',
  '/legacy-theme-bridge.css',
  '/experience.css',
  '/settings.js',
  '/settings.css',
  '/transaction-detail.js',
  '/transaction-detail.css',
  '/interaction-system.css',
  '/surface-spatial.css',
  '/mobile-product-finish.css',
  '/demo-deposit.js',
  '/admin-review.js',
  '/validation.js',
  '/safe-dom.js',
  '/storage.js',
  '/finance.js',
  '/request-id.js',
  '/state.js',
  '/supabase.js',
  '/api.js',
  '/session-manager.js',
  '/bootstraps.js',
  '/router.js',
  '/app.js',
  // Page module scripts
  '/home.js',
  '/market.js',
  '/vault.js',
  '/wallet.js',
  '/kyc.js',
  '/withdrawal-auth.js',
  '/trade.js',
  '/feed.js',
  '/card.js',
  '/modals.js',
  '/navbar.js',
  '/loader.js',
  '/cache-manager.js',
  '/virtual-scroller.js',
  // Assets
  '/manifest.json',
  '/pwa1.png',
  '/pwa2.png',
];

// ── CDN HOSTS TO CACHE (stale-while-revalidate) ───────────────────────────────

const CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// ── NEVER CACHE THESE (Supabase auth + realtime) ─────────────────────────────

const BYPASS_HOSTS = [
  'supabase.co',
  'supabase.com',
];


// ═══════════════════════════════════════════════════════════════════════════════
//  MESSAGE — handle SKIP_WAITING so new SW activates immediately
//  The page posts { type: 'SKIP_WAITING' } when a new SW is found.
//  Without this handler, the new SW sits in 'waiting' forever and Chrome
//  may not consider the PWA installable on subsequent visits.
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
//  INSTALL — precache all local static assets
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => {
        // Cache each URL individually so one 404 doesn't break everything
        return Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('[SW] Failed to precache:', url, err.message);
            })
          )
        );
      })
      .then(() => {
        // Take control immediately — don't wait for old SW to die
        return self.skipWaiting();
      })
  );
});


// ═══════════════════════════════════════════════════════════════════════════════
//  ACTIVATE — delete old caches, claim all clients
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});


// ═══════════════════════════════════════════════════════════════════════════════
//  FETCH — route every request through the right strategy
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle http/https
  if (!request.url.startsWith('http')) return;

  // Mutations and serverless API requests are never cacheable. CacheStorage
  // accepts only GET/HEAD requests, and financial responses must never be
  // replayed from a service-worker cache.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    event.respondWith(fetch(request));
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // ── 1. Supabase: always network, never cache ───────────────────────────────
  if (BYPASS_HOSTS.some((host) => url.hostname.includes(host))) {
    event.respondWith(fetch(request));
    return;
  }

  // ── 2. CDN assets: stale-while-revalidate ─────────────────────────────────
  if (CDN_HOSTS.some((host) => url.hostname.includes(host))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // ── 3. Other cross-origin resources: network only ──────────────────────────
  // Market data, QR images, third-party APIs and arbitrary remote resources must
  // never become hidden stale application state. Only the explicit CDN allowlist
  // above may be cached cross-origin.
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(request));
    return;
  }

  // ── 4. Local HTML pages: network-first so deploys show immediately ─────────
  if (request.destination === 'document') {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }

  // ── 5. Local static assets (js, css, images): cache-first ─────────────────
  if (
    request.destination === 'script'   ||
    request.destination === 'style'    ||
    request.destination === 'image'    ||
    request.destination === 'font'     ||
    request.destination === 'manifest'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ── 6. Everything else: network-first ─────────────────────────────────────
  event.respondWith(networkFirstWithOfflineFallback(request));
});


// ═══════════════════════════════════════════════════════════════════════════════
//  STRATEGY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cache First — serve from cache immediately, fall back to network + cache the result.
 * Best for versioned static assets that rarely change.
 */
async function cacheFirst(request) {
  const cache    = await caches.open(CACHE_VERSION);
  const cached   = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Asset not available offline.', { status: 503 });
  }
}

/**
 * Stale While Revalidate — return cache immediately, refresh cache in background.
 * Best for CDN fonts/icons — instant, always eventually fresh.
 */
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise;
}

/**
 * Network First — try network, fall back to cache, then offline page.
 * Best for HTML documents so deploys show immediately.
 */
async function networkFirstWithOfflineFallback(request) {
  const cache = await caches.open(CACHE_VERSION);

  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    // Last resort: serve the offline/login page
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response(
      '<html><body style="background:#0B0E11;color:#F8FAFC;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;"><div><h2>You\'re offline</h2><p>Check your connection and try again.</p></div></body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}


// ADMIN WEB PUSH — demo-review queue only.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'NexTrade Review';
  const options = {
    body: data.body || 'A demo settlement needs review.',
    icon: '/pwa1.png', badge: '/pwa1.png',
    tag: data.tag || 'nextrade-demo-review', renotify: true,
    data: { url: data.url || '/index.html?route=adminreview' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/index.html?route=adminreview';
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async (clients) => {
    for (const client of clients) {
      if ('navigate' in client) { await client.navigate(target); return client.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
