/**
 * NexTrade — Router Module
 * Handles client-side page routing and navigation
 * Mobile-first, SPA friendly
 */

const Router = (() => {
  'use strict';

  // ============================================
  // ROUTE CONFIGURATION
  // ============================================
  const routes = {
    login: { render: () => Auth.render(document.getElementById('app')) },
    home: { render: () => Home.render(document.getElementById('app')) },
    market: { render: () => Market.render(document.getElementById('app')) },
    vault: { render: () => Vault.render(document.getElementById('app')) },
    wallet: { render: () => Wallet.render(document.getElementById('app')) },
  };

  let currentPage = null;

  // ============================================
  // PRIVATE UTILITIES
  // ============================================

  /**
   * Get page element container
   * @returns {HTMLElement|null}
   */
  function getAppContainer() {
    const container = document.getElementById('app');
    if (!container) console.error('❌ Router: #app container not found');
    return container;
  }

  /**
   * Clear existing page content
   */
  function clearPage() {
    const container = getAppContainer();
    if (container) container.innerHTML = '';
  }

  /**
   * Scroll to top
   */
  function scrollTop() {
    const container = getAppContainer();
    if (container) container.scrollTop = 0;
  }

  /**
   * Validate route exists
   * @param {string} page
   * @returns {boolean}
   */
  function isValidRoute(page) {
    return routes.hasOwnProperty(page);
  }

  // ============================================
  // ROUTER PUBLIC API
  // ============================================

  /**
   * Render page by name
   * @param {string} page
   */
  async function renderPage(page) {
    if (!isValidRoute(page)) {
      console.warn(`❌ Router: Unknown page "${page}"`);
      return;
    }

    const container = getAppContainer();
    if (!container) return;

    try {
      // Cleanup previous page if applicable
      if (currentPage && typeof currentPage.cleanup === 'function') {
        currentPage.cleanup();
      }

      clearPage();
      scrollTop();

      const route = routes[page];
      if (!route || typeof route.render !== 'function') return;

      // Render the page
      currentPage = route;
      await route.render();

      // Update URL hash without reload
      window.location.hash = `#${page}`;

      // Update active navbar
      if (window.Navbar) Navbar.setActive(page);

    } catch (error) {
      console.error('❌ Router renderPage error:', error);
      App.showError('Failed to load page. Please try again.');
    }
  }

  // ============================================
  // HASH CHANGE HANDLER
  // ============================================

  function handleHashChange() {
    const hash = window.location.hash.replace('#', '');
    if (hash && isValidRoute(hash)) {
      renderPage(hash);
    } else {
      // Default route
      renderPage('home');
    }
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function init() {
    if (!getAppContainer()) return;

    // Attach hashchange listener
    window.addEventListener('hashchange', handleHashChange);

    // Render default or current hash
    handleHashChange();
  }

  // ============================================
  // PUBLIC API
  // ============================================

  return {
    init,
    renderPage,
  };
})();

// Export globally
if (typeof window !== 'undefined') window.routerRenderPage = Router.renderPage;
/**
 * Router — Part 2 Enhancements
 * Handles SPA scroll, stage locking, and fallback rendering
 */

(() => {
  'use strict';

  // ============================================
  // STAGE SCROLL FIX (Mobile)
  // ============================================

  /**
   * Enable smooth scrolling in #app while keeping navbar fixed
   */
  function enableAppScroll() {
    const app = document.getElementById('app');
    if (!app) return;

    const mainWrapper = app.closest('.app-main');
    if (!mainWrapper) return;

    // Ensure wrapper scrolls independently
    mainWrapper.style.overflowY = 'auto';
    mainWrapper.style.overflowX = 'hidden';
    mainWrapper.style.height = 'calc(100vh - var(--navbar-height-mobile))';
    mainWrapper.style.webkitOverflowScrolling = 'touch';

    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }

  // ============================================
  // FALLBACK PAGE RENDER (if App not ready)
  // ============================================

  function fallbackRender() {
    const container = document.getElementById('app');
    if (!container) return;

    container.innerHTML = `
      <div class="flex flex-col items-center justify-center" style="height:100vh; padding: var(--space-6);">
        <div style="font-size: var(--text-2xl); margin-bottom: var(--space-4); color: var(--color-text-secondary);">
          Loading NexTrade…
        </div>
        <div class="loader"></div>
      </div>
    `;
  }

  // ============================================
  // ROUTER INIT OVERRIDE
  // ============================================

  const originalInit = Router.init;

  Router.init = function() {
    // Render fallback immediately
    fallbackRender();

    // Ensure scrollable stage is active
    enableAppScroll();

    // Call original router init after DOM ready
    originalInit();
  };

  // ============================================
  // EXPORT SCROLL HELPER
  // ============================================

  if (typeof window !== 'undefined') window.RouterEnableScroll = enableAppScroll;
})();