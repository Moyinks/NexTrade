/**
 * NexTrade — Navigation Module (Full Senior Architect Rewrite)
 * * RESPONSIBILITIES:
 * 1. Top Header: Logo and Profile/Settings dropdown.
 * 2. Bottom Nav: Tab switching for Home, Market, Vault, and Wallet.
 * 3. Interaction: Isolated event handling to prevent "Ghost Clicks" and Router conflicts.
 * * ARCHITECTURE:
 * - Designed for a Flexbox Shell (app-wrapper).
 * - Removes all manual 'fixed' or 'sticky' inline styles to prevent layout clipping.
 */

const Navbar = (() => {
  'use strict';

  // ============================================
  // CONFIGURATION & STATE
  // ============================================

  const navItems = [
    { id: 'home', label: 'Home', icon: '🏠', page: 'home' },
    { id: 'market', label: 'Market', icon: '📊', page: 'market' },
    { id: 'vault', label: 'Vault', icon: '🔒', page: 'vault' },
    { id: 'wallet', label: 'Wallet', icon: '💼', page: 'wallet' }
  ];

  let state = {
    activePage: 'home',
    isMenuOpen: false,
    elements: {
      header: null,
      footer: null,
      menuDropdown: null
    }
  };

  // ============================================
  // COMPONENT: TOP HEADER
  // ============================================

  function createTopHeader() {
    const header = document.createElement('header');
    header.className = 'app-header';
    
    // Internal layout only; positioning is handled by the CSS Flex shell
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      height: 64px;
      padding: 0 var(--space-4);
      background-color: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
    `;

    // 1. Branding
    const brand = document.createElement('div');
    brand.style.cssText = `display: flex; align-items: center; gap: var(--space-2); cursor: pointer;`;
    brand.onclick = (e) => {
      e.stopPropagation();
      window.App.navigate('home');
    };
    brand.innerHTML = `
      <span style="font-size: 1.5rem;">📈</span>
      <span style="font-weight: 800; color: var(--color-text-primary); font-size: 1.1rem; letter-spacing: -0.02em;">NexTrade</span>
    `;

    // 2. Profile Action
    const actionArea = document.createElement('div');
    actionArea.style.position = 'relative';

    const menuBtn = document.createElement('button');
    menuBtn.className = 'btn-icon';
    menuBtn.innerHTML = '☰';
    menuBtn.style.cssText = `
      font-size: 1.5rem;
      color: var(--color-text-secondary);
      background: none;
      border: none;
      padding: 8px;
      cursor: pointer;
    `;
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      toggleMenu();
    };

    // 3. Dropdown (Built and hidden)
    const dropdown = createDropdownMenu();
    state.elements.menuDropdown = dropdown;

    actionArea.appendChild(menuBtn);
    actionArea.appendChild(dropdown);
    header.appendChild(brand);
    header.appendChild(actionArea);

    return header;
  }

  function createDropdownMenu() {
    const menu = document.createElement('div');
    menu.className = 'nav-dropdown';
    menu.style.cssText = `
      position: absolute;
      top: 100%;
      right: 0;
      width: 220px;
      background-color: var(--color-surface-elevated);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      display: none;
      flex-direction: column;
      z-index: 1000;
      overflow: hidden;
      pointer-events: none; /* Prevents blocking clicks when hidden */
    `;

    const items = [
      { icon: '👤', label: 'My Profile', action: () => Navbar.showProfileModal() },
      { icon: '🛡️', label: 'Security & KYC', action: () => Navbar.showProfileModal() },
      { icon: '🚪', label: 'Sign Out', action: () => handleSignOut(), danger: true }
    ];

    items.forEach(item => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        display: flex; align-items: center; gap: 12px;
        padding: 14px 16px;
        width: 100%; text-align: left;
        background: none; border: none;
        color: ${item.danger ? 'var(--color-danger, #ef4444)' : 'var(--color-text-primary)'};
        font-size: 0.9rem;
        cursor: pointer;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      `;
      btn.innerHTML = `<span>${item.icon}</span> ${item.label}`;
      btn.onclick = (e) => {
        e.stopPropagation();
        toggleMenu(false);
        item.action();
      };
      menu.appendChild(btn);
    });

    return menu;
  }

  // ============================================
  // COMPONENT: BOTTOM NAV
  // ============================================

  function createBottomNav() {
    const nav = document.createElement('nav');
    nav.className = 'app-footer';
    
    // Use Flex flow; position handled by CSS shell
    nav.style.cssText = `
      display: flex;
      justify-content: space-around;
      align-items: center;
      width: 100%;
      height: 64px;
      background-color: var(--color-surface);
      border-top: 1px solid var(--color-border);
      padding-bottom: env(safe-area-inset-bottom);
    `;

    navItems.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.dataset.page = item.page;
      btn.style.cssText = `
        flex: 1;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        background: none;
        border: none;
        cursor: pointer;
        position: relative;
        -webkit-tap-highlight-color: transparent;
      `;

      btn.innerHTML = `
        <div class="nav-indicator" style="position: absolute; top: 0; width: 40%; height: 3px; background: var(--color-primary); transform: scaleX(0); transition: transform 0.2s;"></div>
        <span class="nav-icon" style="font-size: 1.4rem;">${item.icon}</span>
        <span class="nav-label" style="font-size: 0.7rem; font-weight: 500; color: var(--color-text-secondary);">${item.label}</span>
      `;

      btn.onclick = (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (window.App && typeof window.App.navigate === 'function') {
          window.App.navigate(item.page);
        }
      };

      nav.appendChild(btn);
    });

    state.elements.footer = nav;
    return nav;
  }

  // ============================================
  // LOGIC & UTILITIES
  // ============================================

  function toggleMenu(force) {
    const menu = state.elements.menuDropdown;
    if (!menu) return;

    state.isMenuOpen = force !== undefined ? force : !state.isMenuOpen;
    menu.style.display = state.isMenuOpen ? 'flex' : 'none';
    menu.style.pointerEvents = state.isMenuOpen ? 'auto' : 'none';

    if (state.isMenuOpen) {
      setTimeout(() => document.addEventListener('click', () => toggleMenu(false), { once: true }), 0);
    }
  }

  function setActive(page) {
    state.activePage = page;
    if (!state.elements.footer) return;

    const btns = state.elements.footer.querySelectorAll('.nav-item');
    btns.forEach(btn => {
      const active = btn.dataset.page === page;
      const indicator = btn.querySelector('.nav-indicator');
      const label = btn.querySelector('.nav-label');
      const icon = btn.querySelector('.nav-icon');

      if (active) {
        indicator.style.transform = 'scaleX(1)';
        label.style.color = 'var(--color-primary)';
        icon.style.transform = 'translateY(-2px)';
      } else {
        indicator.style.transform = 'scaleX(0)';
        label.style.color = 'var(--color-text-secondary)';
        icon.style.transform = 'translateY(0)';
      }
    });
  }

  function showProfileModal() {
    if (window.Modal) {
      const user = (window.AppState && typeof AppState.get === 'function') ? AppState.get('user') : {};
      const content = document.createElement('div');
      content.style.textAlign = 'center';
      content.innerHTML = `
        <div style="font-size: 3.5rem; margin-bottom: 1rem;">👤</div>
        <h3 style="color: var(--color-text-primary); margin-bottom: 0.5rem;">${user.user_metadata?.full_name || 'NexTrade Investor'}</h3>
        <p style="color: var(--color-text-secondary); font-size: 0.9rem;">${user.email || ''}</p>
        <div style="margin-top: 1.5rem; display: flex; justify-content: center; gap: 8px;">
          <span class="badge badge-success" style="font-size: 11px;">Identity Verified</span>
          <span class="badge" style="font-size: 11px; background: rgba(79, 70, 229, 0.1); color: var(--color-primary);">Pro Account</span>
        </div>
      `;
      Modal.open({ title: 'My Profile', content, showCloseButton: true });
    }
  }

  async function handleSignOut() {
    if (window.supabaseClient) {
      await window.supabaseClient.auth.signOut();
    }
    window.location.href = 'login.html';
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function init(targetContainer) {
    // 1. Determine safe parent (prefer .app-wrapper for Flex flow)
    const container = document.querySelector('.app-wrapper') || targetContainer || document.body;
    
    // 2. Clear stale instances
    document.querySelectorAll('.app-header, .app-footer').forEach(el => el.remove());

    // 3. Construct Components
    state.elements.header = createTopHeader();
    state.elements.footer = createBottomNav();

    // 4. Inject into Flex Structure (Header top, Footer bottom)
    container.prepend(state.elements.header);
    container.appendChild(state.elements.footer);

    // 5. Initial state sync
    const startPage = (window.AppState && typeof AppState.get === 'function') ? AppState.get('ui.currentPage') : 'home';
    setActive(startPage);

    console.log('✅ Navbar: Strict Flex Shell initialized.');
  }

  return {
    init,
    setActive,
    showProfileModal
  };

})();

if (typeof window !== 'undefined') window.Navbar = Navbar;
