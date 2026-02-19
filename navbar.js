/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NexTrade — Navbar & Profile System v2.0
 * ═══════════════════════════════════════════════════════════════════════════
 * ENHANCEMENTS: Hamburger menu, profile dropdown, verification badge
 * ═══════════════════════════════════════════════════════════════════════════
 */

const Navbar = (() => {
  'use strict';

  let headerEl = null;
  let footerEl = null;
  let activePage = 'home';
  let dropdownOpen = false;

  const PAGE_CONFIG = {
    'home':   { title: 'NexTrade', icon: 'fa-chart-line', isBrand: true },
    'market': { title: 'Market',   icon: 'fa-chart-bar',  isBrand: false },
    'vault':  { title: 'Vault',    icon: 'fa-layer-group',isBrand: false },
    'wallet': { title: 'Wallet',   icon: 'fa-wallet',     isBrand: false },
  };

  function init() {
    console.log('[Navbar] Initializing...');
    headerEl = document.querySelector('.app-header');
    footerEl = document.querySelector('.app-footer');
    
    if (!headerEl || !footerEl) {
      console.error('[Navbar] Missing shell elements');
      return;
    }
    
    renderFooter();
    updateHeader('home');
    injectDropdownStyles();
    
    console.log('[Navbar] Ready');
  }

  function renderFooter() {
    if (!footerEl) return;
    footerEl.innerHTML = '';
    
    const navItems = [
      { id: 'home',   icon: 'fa-home',       label: 'Home' },
      { id: 'market', icon: 'fa-chart-line', label: 'Market' },
      { id: 'vault',  icon: 'fa-layer-group',label: 'Vault' },
      { id: 'wallet', icon: 'fa-wallet',     label: 'Wallet' }
    ];
    
    navItems.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.dataset.target = item.id;
      btn.style.cssText = 'flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; background:none; border:none; color:var(--color-text-secondary, #94a3b8); font-family:inherit; font-size:0.75rem; padding:8px 0; cursor:pointer; -webkit-tap-highlight-color:transparent;';
      btn.innerHTML = `<i class="fas ${item.icon}" style="font-size:1.25rem; margin-bottom:4px; pointer-events:none;"></i><span style="font-weight:500; pointer-events:none;">${item.label}</span>`;
      btn.onclick = (e) => {
        e.preventDefault();
        if (window.App && typeof App.navigate === 'function') {
          App.navigate(item.id);
        } else if (window.Router) {
          window.Router.go(item.id);
        }
      };
      footerEl.appendChild(btn);
    });
  }

  function updateHeader(pageId) {
    if (!headerEl) return;
    const config = PAGE_CONFIG[pageId] || PAGE_CONFIG['home'];
    
    // Get user info from AppState
    let userName = 'User';
    let userEmail = '';
    let isVerified = false;
    
    if (window.AppState) {
      const user = AppState.get('user');
      if (user) {
        userName = user.user_metadata?.name || user.email?.split('@')[0] || 'User';
        userEmail = user.email || '';
        isVerified = user.user_metadata?.verified || false;
      }
    }
    
    const initials = userName.substring(0, 2).toUpperCase();
    
    headerEl.innerHTML = `
      <div class="header-identity" style="display:flex; align-items:center; gap:12px;">
        <i class="fas ${config.icon}" style="font-size:1.25rem; color:var(--color-primary, #4f46e5);"></i>
        <span style="font-size:1.125rem; font-weight:700; color:var(--color-text-primary, #fff); letter-spacing:-0.02em;">${config.title}</span>
      </div>
      
      <div class="header-actions" style="position:relative;">
        <button id="profile-menu-btn" style="width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:center; color:#fff; cursor:pointer; transition:all 0.2s;">
          <i class="fas fa-bars" style="font-size:1rem;"></i>
        </button>
        
        <!-- Profile Dropdown -->
        <div id="profile-dropdown" class="profile-dropdown">
          <!-- Header -->
          <div class="profile-header">
            <div class="profile-avatar">${initials}</div>
            <div class="profile-info">
              <div class="profile-name">${userName}</div>
              <div class="profile-email">${userEmail}</div>
            </div>
          </div>
          
          <!-- Verification Badge -->
          <div class="profile-verification ${isVerified ? 'verified' : 'unverified'}">
            <i class="fas ${isVerified ? 'fa-shield-check' : 'fa-shield-alt'}"></i>
            <span>${isVerified ? 'Verified Account' : 'Unverified Account'}</span>
          </div>
          
          <!-- Menu Items -->
          <div class="profile-menu">
            <button class="profile-menu-item" onclick="Navbar.handleSettings()">
              <i class="fas fa-user-circle"></i>
              <span>Account Settings</span>
              <i class="fas fa-chevron-right profile-menu-arrow"></i>
            </button>
            <button class="profile-menu-item" onclick="Navbar.handleNotifications()">
              <i class="fas fa-bell"></i>
              <span>Notifications</span>
              <i class="fas fa-chevron-right profile-menu-arrow"></i>
            </button>
            <button class="profile-menu-item" onclick="Navbar.handleHelp()">
              <i class="fas fa-question-circle"></i>
              <span>Help & Support</span>
              <i class="fas fa-chevron-right profile-menu-arrow"></i>
            </button>
            <div class="profile-menu-divider"></div>
            <button class="profile-menu-item danger" onclick="Navbar.handleSignOut()">
              <i class="fas fa-sign-out-alt"></i>
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Attach menu toggle
    const menuBtn = headerEl.querySelector('#profile-menu-btn');
    if (menuBtn) {
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        toggleProfileDropdown();
      };
    }
  }

  function toggleProfileDropdown() {
    const dropdown = document.getElementById('profile-dropdown');
    const menuBtn = document.getElementById('profile-menu-btn');
    
    if (!dropdown) return;
    
    dropdownOpen = !dropdownOpen;
    dropdown.classList.toggle('open', dropdownOpen);
    
    if (menuBtn) {
      menuBtn.style.background = dropdownOpen ? 'rgba(139, 92, 246, 0.2)' : 'rgba(255,255,255,0.1)';
      menuBtn.style.borderColor = dropdownOpen ? 'rgba(139, 92, 246, 0.4)' : 'rgba(255,255,255,0.1)';
    }
    
    if (dropdownOpen) {
      setTimeout(() => {
        document.addEventListener('click', handleOutsideClick);
      }, 0);
    } else {
      document.removeEventListener('click', handleOutsideClick);
    }
  }

  function handleOutsideClick(e) {
    const dropdown = document.getElementById('profile-dropdown');
    const menuBtn = document.getElementById('profile-menu-btn');
    
    if (dropdown && !dropdown.contains(e.target) && e.target !== menuBtn) {
      dropdownOpen = false;
      dropdown.classList.remove('open');
      if (menuBtn) {
        menuBtn.style.background = 'rgba(255,255,255,0.1)';
        menuBtn.style.borderColor = 'rgba(255,255,255,0.1)';
      }
      document.removeEventListener('click', handleOutsideClick);
    }
  }

  function injectDropdownStyles() {
    if (document.getElementById('navbar-dropdown-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'navbar-dropdown-styles';
    style.textContent = `
      .profile-dropdown {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        width: 280px;
        background: var(--color-surface, #1e293b);
        border: 1px solid var(--color-border, rgba(255,255,255,0.1));
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05);
        opacity: 0;
        transform: translateY(-10px);
        pointer-events: none;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 9999;
        overflow: hidden;
      }
      
      .profile-dropdown.open {
        opacity: 1;
        transform: translateY(0);
        pointer-events: all;
      }
      
      .profile-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px;
        border-bottom: 1px solid var(--color-border, rgba(255,255,255,0.1));
      }
      
      .profile-avatar {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: linear-gradient(135deg, #8b5cf6, #6366f1);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 16px;
        font-weight: 700;
        flex-shrink: 0;
      }
      
      .profile-info {
        flex: 1;
        min-width: 0;
      }
      
      .profile-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary, #fff);
        margin-bottom: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      
      .profile-email {
        font-size: 12px;
        color: var(--color-text-secondary, #94a3b8);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      
      .profile-verification {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        font-size: 12px;
        font-weight: 600;
        border-bottom: 1px solid var(--color-border, rgba(255,255,255,0.1));
      }
      
      .profile-verification.verified {
        color: #10b981;
        background: rgba(16, 185, 129, 0.1);
      }
      
      .profile-verification.unverified {
        color: #f59e0b;
        background: rgba(245, 158, 11, 0.1);
      }
      
      .profile-menu {
        padding: 8px 0;
      }
      
      .profile-menu-item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: none;
        border: none;
        color: var(--color-text-primary, #fff);
        font-family: inherit;
        font-size: 14px;
        text-align: left;
        cursor: pointer;
        transition: background 0.15s;
      }
      
      .profile-menu-item:hover {
        background: var(--color-surface-elevated, rgba(255,255,255,0.05));
      }
      
      .profile-menu-item i:first-child {
        width: 20px;
        text-align: center;
        color: var(--color-text-secondary, #94a3b8);
      }
      
      .profile-menu-item span {
        flex: 1;
      }
      
      .profile-menu-arrow {
        font-size: 10px;
        color: var(--color-text-tertiary, #64748b);
      }
      
      .profile-menu-item.danger {
        color: #ef4444;
      }
      
      .profile-menu-item.danger i {
        color: #ef4444;
      }
      
      .profile-menu-divider {
        height: 1px;
        background: var(--color-border, rgba(255,255,255,0.1));
        margin: 8px 0;
      }
    `;
    document.head.appendChild(style);
  }

  function setActive(pageId) {
    if (!footerEl) return;
    activePage = pageId;
    
    const buttons = footerEl.querySelectorAll('button');
    buttons.forEach(btn => {
      const icon = btn.querySelector('i');
      if (btn.dataset.target === pageId) {
        btn.style.color = 'var(--color-primary, #4f46e5)';
        if (icon) {
          icon.style.transform = 'translateY(-2px)';
          icon.style.transition = 'transform 0.2s';
        }
      } else {
        btn.style.color = 'var(--color-text-secondary, #94a3b8)';
        if (icon) icon.style.transform = 'none';
      }
    });
    
    updateHeader(pageId);
  }

  // Menu Actions
  function handleSettings() {
    toggleProfileDropdown();
    if (window.App) App.showError('Settings coming soon');
  }

  function handleNotifications() {
    toggleProfileDropdown();
    if (window.App) App.showError('Notifications coming soon');
  }

  function handleHelp() {
    toggleProfileDropdown();
    if (window.App) App.showError('Help center coming soon');
  }

  async function handleSignOut() {
  toggleProfileDropdown();
  if (!window.Modal) return;
  const confirmed = await Modal.confirm({
    title: 'Sign Out',
    message: 'Are you sure you want to sign out?',
    confirmText: 'Sign Out',
    cancelText: 'Cancel',
    dangerMode: true
  });
  if (confirmed) {
    if (window.AppState) AppState.clear();
    if (window.supabaseClient) {
      await supabaseClient.auth.signOut();
    }
    window.location.href = 'login.html';
  }
}

  return {
    init,
    setActive,
    handleSettings,
    handleNotifications,
    handleHelp,
    handleSignOut
  };
})();

if (typeof window !== 'undefined') window.Navbar = Navbar;