/**
 * NexTrade — Bootstraps (DOM & Layout Controller)
 * * CRITICAL FIX APPLIED:
 * 1. REMOVED: `dom.main.style.height = '100%'` (This was pushing the footer off-screen).
 * 2. RETAINED: Scroll locking on body to prevent rubber-banding.
 * 3. RETAINED: Native touch scrolling enablement for .app-main.
 */

'use strict';

const Bootstraps = (() => {
  let initialized = false;

  // Internal references to shell elements
  const dom = {
    wrapper: null,
    header: null,
    main: null,
    footer: null
  };

  // ============================================
  // 1. DOM READINESS
  // ============================================

  /**
   * Returns a promise that resolves when the DOM is fully interactive.
   */
  function domReady() {
    return new Promise(resolve => {
      if (document.readyState === 'interactive' || document.readyState === 'complete') {
        resolve();
      } else {
        document.addEventListener('DOMContentLoaded', resolve, { once: true });
      }
    });
  }

  // ============================================
  // 2. DOM BINDING
  // ============================================

  /**
   * Locates and validates the core App Shell elements.
   * Fails loudly if the HTML structure is incorrect (missing header/footer).
   */
  function bindDOM() {
    console.log('📦 Bootstraps: Binding shell elements...');

    const wrapper = document.querySelector('.app-wrapper');
    const header = document.querySelector('.app-header');
    const main = document.querySelector('.app-main');
    const footer = document.querySelector('.app-footer');

    // Strict Validation
    if (!wrapper || !main || !footer) {
      console.error('❌ Bootstraps: Critical DOM elements missing. Check index.html.');
      console.error({ wrapper, header, main, footer });
      return false;
    }

    dom.wrapper = wrapper;
    dom.header = header;
    dom.main = main;
    dom.footer = footer;

    console.log('✅ Bootstraps: Shell bound successfully.');
    return true;
  }

  // ============================================
  // 3. LAYOUT & SCROLL ENGINE
  // ============================================

  /**
   * Applies strictly necessary scroll rules.
   * DELETED: Height overrides that break Flexbox layout.
   */
  function configureLayout() {
    // 1. Lock the Root (Prevent Body Scroll)
    // We let layout.css handle 'height: 100dvh', we just enforce overflow.
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.margin = '0';
    
    // 2. Enable Internal Scrolling for Main
    // This ensures that while the body is locked, the content area can still scroll.
    if (dom.main) {
      dom.main.style.overflowY = 'auto';
      dom.main.style.overflowX = 'hidden';
      dom.main.style.webkitOverflowScrolling = 'touch'; // iOS Momentum
      
      // CRITICAL: We do NOT set height='100%' here. 
      // We rely on .app-wrapper { display: flex } in layout.css to size this correctly.
    }

    console.log('📦 Bootstraps: Scroll engine active.');
  }

  // ============================================
  // 4. INITIALIZATION SEQUENCE
  // ============================================

  async function init() {
    if (initialized) {
      console.log('Bootstraps: Already initialized.');
      return;
    }

    await domReady();
    
    const success = bindDOM();
    if (success) {
      configureLayout();
      initialized = true;
    } else {
      console.error('❌ Bootstraps: Initialization failed due to missing DOM.');
    }
  }

  // ============================================
  // 5. PUBLIC API (GETTERS)
  // ============================================

  return {
    init,
    isReady: () => initialized,
    
    // Authoritative Getters for other modules (Router/Navbar)
    getMain: () => dom.main,
    getHeader: () => dom.header,
    getFooter: () => dom.footer,
    getWrapper: () => dom.wrapper
  };
})();

// Expose to Window
if (typeof window !== 'undefined') {
  window.Bootstraps = Bootstraps;
}
