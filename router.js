/**
 * NexTrade — Router (AUTHORITATIVE, INTEGRATED)
 * Guarantees:
 * - Pages NEVER overlap
 * - Bootstraps.getMain() is the single source of truth for the render target
 * - Synchronized initialization with App and Bootstraps
 * - Robust error handling for missing modules or invalid DOM nodes
 */

(function () {
  'use strict';

  let appMain = null;
  let currentPage = null;
  let currentPageName = null;
  let initialized = false;

  // ==============================
  // DOM BIND
  // ==============================

  /**
   * Binds the main render container using Bootstraps authority.
   * Prevents "String" corruption by validating against HTMLElement.
   */
  function bindMain() {
    // If already bound and valid, return
    if (appMain instanceof HTMLElement) return appMain;

    // Use Bootstraps as the Authoritative DOM Owner
    if (window.Bootstraps && typeof window.Bootstraps.getMain === 'function') {
      appMain = window.Bootstraps.getMain();
    }

    // Fallback if Bootstraps isn't ready, but with strict validation
    if (!(appMain instanceof HTMLElement)) {
      appMain = document.querySelector('.app-main');
    }

    if (!(appMain instanceof HTMLElement)) {
      console.error('❌ Router fatal: .app-main is not a valid HTMLElement');
      return null;
    }

    console.log('📄 Router: .app-main bound successfully');
    return appMain;
  }

  // ==============================
  // PAGE RESOLVE
  // ==============================

  function resolvePage(name) {
    if (!name || typeof name !== 'string') return null;
    const key = name.charAt(0).toUpperCase() + name.slice(1);
    return window[key] || null;
  }

  // ==============================
  // UNMOUNT
  // ==============================

  function unmount() {
    if (currentPage && typeof currentPage.cleanup === 'function') {
      try {
        currentPage.cleanup();
      } catch (err) {
        console.warn(`Router: Cleanup failed for ${currentPageName}`, err);
      }
    }

    const container = bindMain();
    if (container) {
      container.innerHTML = '';
      container.scrollTop = 0;
    }

    currentPage = null;
    currentPageName = null;
  }

  // ==============================
  // RENDER
  // ==============================

  /**
   * Primary render function.
   * @param {string} pageName - The name of the module to render.
   */
  function render(pageName) {
    const container = bindMain();
    
    if (!container) {
      console.error('Router: Cannot render, target container missing.');
      return;
    }

    if (!pageName) return;

    // Prevent redundant renders of the same page
    if (pageName === currentPageName) {
      container.scrollTop = 0;
      return;
    }

    console.log(`📄 Router: Navigating to "${pageName}"`);

    const page = resolvePage(pageName);

    if (!page || typeof page.render !== 'function') {
      console.error(`Router: Page module "${pageName}" not found or invalid.`);
      container.innerHTML = `
        <div style="padding:2rem; color:var(--color-danger, #ff5555); text-align:center;">
          <h3>Page Not Found</h3>
          <p>The module "${pageName}" could not be resolved.</p>
          <button class="btn btn-primary" onclick="App.navigate('home')">Return Home</button>
        </div>
      `;
      return;
    }

    // Step 1: Cleanup previous page
    unmount();

    // Step 2: Render new page into the validated container
    try {
      page.render(container);
      currentPage = page;
      currentPageName = pageName;
      
      // Step 3: Sync Navbar if applicable
      if (window.Navbar && typeof window.Navbar.setActive === 'function') {
        window.Navbar.setActive(pageName);
      }
    } catch (err) {
      console.error(`Router: Execution error in ${pageName}.render()`, err);
      container.innerHTML = `<div style="padding:2rem; color:#ff5555;">Critical error loading ${pageName}.</div>`;
    }
  }

  // ==============================
  // NAV EVENTS
  // ==============================

  function bindNav() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-page]');
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      const targetPage = btn.dataset.page;
      
      // Use App.navigate if available to ensure state consistency
      if (window.App && typeof window.App.navigate === 'function') {
        window.App.navigate(targetPage);
      } else {
        render(targetPage);
      }
    });
  }

  // ==============================
  // INITIALIZATION
  // ==============================

  /**
   * Initialization sequence coordinated with App.js
   */
  async function init() {
    if (initialized) return;

    bindNav();
    
    // Ensure container is ready before first render
    if (bindMain()) {
      initialized = true;
      console.log('📄 Router: Initialized');
    }
  }

  // ==============================
  // EXPORT & GLOBAL SYNC
  // ==============================

  // Export the Router object
  window.Router = {
    go: render,
    init: init,
    getCurrentPage: () => currentPageName
  };

  // Provide the specific hook expected by app.js
  window.routerRenderPage = render;

  // Manual trigger if DOM is already loaded, otherwise wait for DOMContentLoaded
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

})();
