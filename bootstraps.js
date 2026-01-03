/**
 * NexTrade — Bootstraps (AUTHORITATIVE DOM OWNER)
 * Responsibilities:
 * - Wait for real DOM readiness.
 * - Bind and OWN app shell nodes exactly once.
 * - Enforce scroll + layout rules to provide an "App-like" feel on mobile.
 * - FIXES:
 * - Enhanced bindDOM with strict HTMLElement validation to prevent "String" corruption.
 * - Exposed authoritative getters to prevent Router/Module namespace collisions.
 * - Added a singleton guard to prevent double-initialization.
 */

'use strict';

const Bootstraps = (() => {
  let initialized = false;

  const dom = {
    wrapper: null,
    header: null,
    main: null,
    footer: null
  };

  // ============================================
  // DOM READY (NO GUESSING)
  // ============================================

  /**
   * Promise that resolves when the DOM is interactive or complete.
   * @returns {Promise}
   */
  function domReady() {
    return new Promise(resolve => {
      if (
        document.readyState === 'interactive' ||
        document.readyState === 'complete'
      ) {
        resolve();
      } else {
        document.addEventListener('DOMContentLoaded', resolve, { once: true });
      }
    });
  }

  // ============================================
  // STRICT DOM BIND
  // ============================================

  /**
   * Identifies core app nodes and validates their types.
   * Prevents modules from working with "undefined" or corrupted string references.
   */
  function bindDOM() {
    const wrapper = document.querySelector('.app-wrapper');
    const header = document.querySelector('.app-header');
    const main = document.querySelector('.app-main');
    const footer = document.querySelector('.app-footer');

    // Strict validation: Must exist and be HTMLElements
    if (!(wrapper instanceof HTMLElement) || !(main instanceof HTMLElement)) {
      console.error('❌ FATAL: App shell missing or invalid structure.');
      console.error('Wrapper:', wrapper);
      console.error('Main:', main);
      throw new Error('Bootstraps failed: .app-wrapper or .app-main not found in DOM.');
    }

    // Assign to internal state
    dom.wrapper = wrapper;
    dom.header = header;
    dom.main = main;
    dom.footer = footer;

    console.log('📦 Bootstraps: DOM shell successfully bound');
  }

  // ============================================
  // UI / SCROLL LOCK
  // ============================================

  /**
   * Locks the viewport to prevent "rubber-banding" on mobile and forces
   * scrolling to occur specifically within the .app-main container.
   */
  function lockUI() {
    // Lock the root and body
    document.documentElement.style.height = '100%';
    document.body.style.height = '100%';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';

    // Enable internal scrolling for the main view only
    if (dom.main) {
      dom.main.style.overflowY = 'auto';
      dom.main.style.overflowX = 'hidden';
      dom.main.style.webkitOverflowScrolling = 'touch';
      dom.main.style.height = '100%'; 
      // Ensure flex behavior is consistent across browsers
      dom.main.style.display = 'block';
    }

    console.log('📦 Bootstraps: UI layout rules enforced');
  }

  // ============================================
  // INIT
  // ============================================

  /**
   * Master initialization for the app layout.
   */
  async function init() {
    if (initialized) {
      console.warn('Bootstraps: Already initialized, skipping.');
      return;
    }

    console.log('🚀 Bootstraps: Initializing layout…');

    await domReady();
    bindDOM();
    lockUI();

    initialized = true;
    console.log('📦 Bootstraps: Completed successfully');
  }

  // ============================================
  // SAFE GETTERS (SINGLE SOURCE OF TRUTH)
  // ============================================

  /**
   * Authoritative getter for the main render container.
   * @returns {HTMLElement|null}
   */
  function getMain() {
    if (!initialized) {
      const fallback = document.querySelector('.app-main');
      return fallback instanceof HTMLElement ? fallback : null;
    }
    return dom.main;
  }

  function getHeader() {
    return dom.header;
  }

  function getFooter() {
    return dom.footer;
  }

  function getWrapper() {
    return dom.wrapper;
  }

  function isReady() {
    return initialized;
  }

  // ============================================
  // EXPORT
  // ============================================

  return {
    init,
    isReady,
    getMain,
    getHeader,
    getFooter,
    getWrapper
  };
})();

// Global exposure
if (typeof window !== 'undefined') {
  window.Bootstraps = Bootstraps;
}
