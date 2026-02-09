/**
 * NexTrade — Router (FIXED - Proper Bootstraps Integration)
 * ══════════════════════════════════════════════════════════════
 * CRITICAL FIX: Waits for Bootstraps.init() before doing anything
 * ══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  let appMain = null;
  let currentPage = null;
  let currentPageName = null;
  let initialized = false;
  let navigationQueue = Promise.resolve();

  // ==============================
  // 1. DOM BINDING (WITH RETRY)
  // ==============================

  async function bindMain() {
    if (appMain instanceof HTMLElement) return appMain;

    // Wait for Bootstraps if not ready
    let attempts = 0;
    while (attempts < 50) { // 5 seconds max
      if (window.Bootstraps && typeof Bootstraps.getMain === 'function') {
        const el = Bootstraps.getMain();
        if (el instanceof HTMLElement) {
          appMain = el;
          console.log('[ROUTER] ✅ Bound to .app-main');
          return appMain;
        }
      }

      // Fallback direct query
      const fallback = document.querySelector('.app-main');
      if (fallback) {
        appMain = fallback;
        console.log('[ROUTER] ✅ Bound to .app-main (fallback)');
        return appMain;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    console.error('[ROUTER] ❌ Failed to bind .app-main after 5s');
    return null;
  }

  // ==============================
  // 2. PAGE RESOLUTION
  // ==============================

  function resolvePage(name) {
    if (!name || typeof name !== 'string') return null;
    const key = name.charAt(0).toUpperCase() + name.slice(1);
    return window[key] || null;
  }

  // ==============================
  // 3. LOADING STATES (SMOOTH)
  // ==============================

  function showSkeletonLoader(container, pageName) {
    if (!container) return;

    const skeletons = {
      home: createHomeSkeleton(),
      market: createMarketSkeleton(),
      vault: createVaultSkeleton(),
      wallet: createWalletSkeleton()
    };

    const skeleton = skeletons[pageName] || createGenericSkeleton(pageName);
    
    container.innerHTML = '';
    container.style.opacity = '0';
    container.appendChild(skeleton);
    
    requestAnimationFrame(() => {
      container.style.transition = 'opacity 0.15s ease-out';
      container.style.opacity = '1';
    });
  }

  function createHomeSkeleton() {
    const div = document.createElement('div');
    div.style.cssText = 'padding: 16px; padding-bottom: 100px;';
    div.innerHTML = `
      <div class="skeleton-pulse" style="height: 180px; border-radius: 16px; margin-bottom: 20px;"></div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 24px;">
        <div class="skeleton-pulse" style="height: 72px; border-radius: 12px;"></div>
        <div class="skeleton-pulse" style="height: 72px; border-radius: 12px;"></div>
        <div class="skeleton-pulse" style="height: 72px; border-radius: 12px;"></div>
      </div>
      <div class="skeleton-pulse" style="height: 200px; border-radius: 12px; margin-bottom: 20px;"></div>
      <div class="skeleton-pulse" style="height: 300px; border-radius: 12px;"></div>
    `;
    return div;
  }

  function createMarketSkeleton() {
    const div = document.createElement('div');
    div.style.cssText = 'padding: 16px; padding-bottom: 100px;';
    div.innerHTML = `
      <div class="skeleton-pulse" style="height: 120px; border-radius: 12px; margin-bottom: 16px;"></div>
      <div class="skeleton-pulse" style="height: 48px; border-radius: 12px; margin-bottom: 12px;"></div>
      ${Array(5).fill(0).map(() => `
        <div class="skeleton-pulse" style="height: 100px; border-radius: 12px; margin-bottom: 10px;"></div>
      `).join('')}
    `;
    return div;
  }

  function createVaultSkeleton() {
    const div = document.createElement('div');
    div.style.cssText = 'padding: 16px; padding-bottom: 100px;';
    div.innerHTML = `
      <div class="skeleton-pulse" style="height: 180px; border-radius: 16px; margin-bottom: 24px;"></div>
      ${Array(3).fill(0).map(() => `
        <div class="skeleton-pulse" style="height: 140px; border-radius: 12px; margin-bottom: 12px;"></div>
      `).join('')}
    `;
    return div;
  }

  function createWalletSkeleton() {
    const div = document.createElement('div');
    div.style.cssText = 'padding: 16px; padding-bottom: 100px;';
    div.innerHTML = `
      <div class="skeleton-pulse" style="height: 200px; border-radius: 16px; margin-bottom: 24px;"></div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 32px;">
        <div class="skeleton-pulse" style="height: 56px; border-radius: 16px;"></div>
        <div class="skeleton-pulse" style="height: 56px; border-radius: 16px;"></div>
      </div>
      ${Array(4).fill(0).map(() => `
        <div class="skeleton-pulse" style="height: 80px; border-radius: 12px; margin-bottom: 8px;"></div>
      `).join('')}
    `;
    return div;
  }

  function createGenericSkeleton(pageName) {
    const div = document.createElement('div');
    div.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 50vh; padding: 20px;';
    div.innerHTML = `
      <i class="fas fa-spinner fa-spin" style="font-size: 32px; color: var(--color-primary); margin-bottom: 16px;"></i>
      <div style="font-size: 14px; font-weight: 600; color: var(--color-text-primary);">Loading ${pageName}...</div>
    `;
    return div;
  }

  function showErrorState(container, pageName, error) {
    if (!container) return;

    container.innerHTML = '';
    container.scrollTop = 0;

    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 50vh; padding: 20px; text-align: center;
    `;

    errorDiv.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;">
        <i class="fas fa-exclamation-triangle" style="color: #ef4444;"></i>
      </div>
      <div style="font-size: 16px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 8px;">
        Failed to Load Page
      </div>
      <div style="font-size: 13px; color: var(--color-text-secondary); margin-bottom: 20px; max-width: 300px;">
        ${error || 'Something went wrong loading this page.'}
      </div>
      <button 
        onclick="Router.navigate('home')" 
        class="btn btn-primary" 
        style="padding: 10px 24px; border-radius: 8px;"
      >
        Go to Home
      </button>
    `;

    container.appendChild(errorDiv);
  }

  function show404(container, pageName) {
    if (!container) return;

    container.innerHTML = '';
    container.scrollTop = 0;

    const notFound = document.createElement('div');
    notFound.style.cssText = `
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 50vh; padding: 20px; text-align: center;
    `;

    notFound.innerHTML = `
      <div style="font-size: 72px; font-weight: 700; color: var(--color-text-tertiary); margin-bottom: 16px;">404</div>
      <div style="font-size: 18px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 8px;">Page Not Found</div>
      <div style="font-size: 13px; color: var(--color-text-secondary); margin-bottom: 20px; max-width: 300px;">
        The module <strong>${pageName}</strong> could not be loaded.
      </div>
      <button onclick="Router.navigate('home')" class="btn btn-primary" style="padding: 10px 24px;">Go to Home</button>
    `;

    container.appendChild(notFound);
  }

  // ==============================
  // 4. CLEANUP
  // ==============================

  function unmount() {
    if (currentPage && typeof currentPage.cleanup === 'function') {
      try {
        currentPage.cleanup();
        console.log(`[ROUTER] 🧹 Cleaned up ${currentPageName}`);
      } catch (err) {
        console.warn(`[ROUTER] ⚠️ Cleanup error in ${currentPageName}:`, err);
      }
    }

    currentPage = null;
    currentPageName = null;
  }

  // ==============================
  // 5. RENDER ENGINE (QUEUED)
  // ==============================

  async function render(pageName) {
    navigationQueue = navigationQueue.then(() => executeNavigation(pageName));
    return navigationQueue;
  }

  async function executeNavigation(pageName) {
    const container = await bindMain();
    
    if (!container) {
      console.error('[ROUTER] ❌ Cannot render - container not found');
      return;
    }

    if (!pageName) {
      console.warn('[ROUTER] ⚠️ No page name provided');
      return;
    }

    console.log(`[ROUTER] 📄 Navigating to "${pageName}"`);

    const pageModule = resolvePage(pageName);

    if (!pageModule || typeof pageModule.render !== 'function') {
      console.error(`[ROUTER] ❌ Module "${pageName}" not found`);
      show404(container, pageName);
      return;
    }

    unmount();

    showSkeletonLoader(container, pageName);

    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      const renderPromise = pageModule.render(container);
      
      if (renderPromise instanceof Promise) {
        await renderPromise;
      }

      container.style.transition = 'opacity 0.2s ease-in';
      container.style.opacity = '1';

      currentPage = pageModule;
      currentPageName = pageName;

      if (window.Navbar && typeof window.Navbar.setActive === 'function') {
        window.Navbar.setActive(pageName);
      }

      console.log(`[ROUTER] ✅ ${pageName} loaded successfully`);

    } catch (err) {
      console.error(`[ROUTER] ❌ Render error in ${pageName}:`, err);
      showErrorState(container, pageName, err.message);
    }
  }

  // ==============================
  // 6. NAVIGATION EVENTS
  // ==============================

  function bindNavEvents() {
    document.addEventListener('click', e => {
      const link = e.target.closest('[data-page]');
      if (!link) return;

      e.preventDefault();
      const target = link.dataset.page;
      
      if (window.App && typeof window.App.navigate === 'function') {
        window.App.navigate(target);
      } else {
        render(target);
      }
    });

    console.log('[ROUTER] ✅ Navigation events bound');
  }

  // ==============================
  // 7. INITIALIZATION (ASYNC)
  // ==============================

  async function init() {
    if (initialized) {
      console.warn('[ROUTER] ⚠️ Already initialized');
      return;
    }

    console.log('[ROUTER] 🔄 Initializing...');

    // CRITICAL: Wait for Bootstraps first
    if (!window.Bootstraps || typeof Bootstraps.getMain !== 'function') {
      console.log('[ROUTER] ⏳ Waiting for Bootstraps...');
      
      let attempts = 0;
      while (attempts < 50) { // 5 second timeout
        if (window.Bootstraps && typeof Bootstraps.getMain === 'function') {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      
      if (!window.Bootstraps) {
        console.error('[ROUTER] ❌ Bootstraps not available after 5s');
        return;
      }
    }

    // Now bind events (DOM should be ready)
    bindNavEvents();
    
    // Verify we can bind to main
    const mainElement = await bindMain();
    
    if (mainElement) {
      initialized = true;
      console.log('[ROUTER] ✅ Initialized successfully');
    } else {
      console.error('[ROUTER] ❌ Initialization failed - no .app-main element');
    }
  }

  // ==============================
  // 8. EXPORTS
  // ==============================

  window.Router = {
    init,
    navigate: render,
    go: render,
    getCurrentPage: () => currentPageName,
    isNavigating: () => navigationQueue
  };

  // Add CSS for skeleton animation
  if (!document.getElementById('router-styles')) {
    const style = document.createElement('style');
    style.id = 'router-styles';
    style.textContent = `
      @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
      .skeleton-pulse {
        background: linear-gradient(90deg, var(--color-surface) 0%, var(--color-surface-elevated) 50%, var(--color-surface) 100%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
      }
    `;
    document.head.appendChild(style);
  }

  console.log('[ROUTER] 📦 Module loaded (waiting for init call)');

})();
