/**
 * NexTrade — Navbar v5.0  (Direct Pill Navigation)
 * ═══════════════════════════════════════════════════════════════════════════
 * v5.0 changes:
 *   • Replaced radial burst orb with a direct-tap pill nav bar.
 *     Navigation is now a single tap — no expand/collapse, no extra step.
 *   • All 4 destinations (Home, Market, Vault, Wallet) are always visible.
 *   • Active item has a tinted background chip + colored icon + colored label.
 *   • The last nav item (Wallet) sits inside the pill at an exact, fixed
 *     position guaranteed by CSS flexbox — zero floating-point alignment risk,
 *     consistent across all routes, states, scroll positions, and screen sizes.
 *   • Header and profile dropdown are unchanged from v4.1.
 */

// HARD PREBOOT — hide any default .app-footer before first paint
(function () {
  const s = document.createElement('style');
  s.textContent = '.app-footer{display:none!important;}';
  document.head.appendChild(s);
})();

const Navbar = (() => {
  'use strict';

  let footerEl     = null;
  let headerEl     = null;
  let activePage   = 'home';
  let dropdownOpen = false;

  // ── DESIGN TOKENS (mirrors core.css) ──────────────────────────────────
  const SURFACE          = '#151921';
  const SURFACE_ELEVATED = '#1E232F';
  const BORDER_HOVER     = 'rgba(255,255,255,0.15)';
  const TOP_EDGE         = 'inset 0 1px 0 rgba(255,255,255,0.09)';

  const PAGES = {
    home:   { label: 'Home',   icon: 'fa-house',       color: '#3B82F6' },
    market: { label: 'Market', icon: 'fa-chart-line',  color: '#3B82F6' },
    vault:  { label: 'Vault',  icon: 'fa-layer-group', color: '#10B981' },
    wallet: { label: 'Wallet', icon: 'fa-wallet',      color: '#3B82F6' },
  };

  // ── USER HELPERS ───────────────────────────────────────────────────────

  function toTitleCase(s) {
    return (!s || typeof s !== 'string') ? '' :
      s.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  function resolveDisplayName() {
    let n = '';
    if (window.AppState) {
      const p = AppState.get('profile');
      if (p?.full_name?.trim()) n = p.full_name.trim();
      if (!n) {
        const u = AppState.get('user');
        if (u?.user_metadata?.full_name?.trim()) n = u.user_metadata.full_name.trim();
        if (!n && u?.email) n = u.email.split('@')[0].replace(/[._\-+]/g, ' ').trim();
      }
    }
    return n ? toTitleCase(n) : 'You';
  }

  function resolveEmail() {
    return window.AppState ? (AppState.get('user')?.email || '') : '';
  }

  function resolveVerified() {
    if (!window.AppState) return false;
    const u = AppState.get('user');
    return u?.user_metadata?.verified === true || u?.user_metadata?.email_verified === true;
  }

  function buildInitials(name) {
    const w = name.trim().split(/\s+/).filter(Boolean);
    if (!w.length) return 'ME';
    return w.length === 1
      ? w[0].substring(0, 2).toUpperCase()
      : (w[0][0] + w[w.length - 1][0]).toUpperCase();
  }

  // ── INIT ──────────────────────────────────────────────────────────────

  function init() {
    headerEl = document.querySelector('.app-header');
    if (!headerEl) { console.warn('[Navbar] Header not found.'); return; }

    const wrapper = document.querySelector('.app-wrapper');
    if (!wrapper) { console.warn('[Navbar] app-wrapper not found.'); return; }

    footerEl = document.createElement('div');
    footerEl.id = 'ntm-nav-root';
    wrapper.appendChild(footerEl);

    injectStyles();
    buildPill();
    injectDropdownStyles();

    // Close profile dropdown on outside click
    document.addEventListener('click', e => {
      if (dropdownOpen && headerEl && !headerEl.contains(e.target)) {
        closeDropdown();
      }
    });

    // Sync active state with current page
    const currentPage = (window.AppState && AppState.get('ui.currentPage')) || 'home';
    setActive(currentPage);
  }

  // ── PILL STYLES ────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('ntm-pill-styles')) return;
    const s = document.createElement('style');
    s.id = 'ntm-pill-styles';
    s.textContent = `
      /* ── PILL ROOT ── */
      #ntm-nav-root {
        position: fixed;
        left: 50%;
        bottom: calc(14px + env(safe-area-inset-bottom, 0px));
        transform: translateX(-50%);
        width: calc(100% - 32px);
        max-width: 440px;
        z-index: 9000;
        pointer-events: none;
      }

      /* ── PILL CONTAINER ── */
      .ntm-pill {
        display: flex;
        align-items: center;
        background: ${SURFACE};
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 22px;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.07),
          0 8px 32px rgba(0,0,0,0.75),
          0 2px 8px rgba(0,0,0,0.5);
        padding: 5px;
        pointer-events: all;
        animation: ntm-pill-in 0.45s cubic-bezier(0.34,1.3,0.64,1) both;
      }
      @keyframes ntm-pill-in {
        from { transform: translateY(22px); opacity: 0; }
        to   { transform: translateY(0);    opacity: 1; }
      }

      /* ── NAV ITEM ── */
      .ntm-pill-item {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 9px 4px 8px;
        border-radius: 17px;
        border: none;
        background: transparent;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        transition: background 0.2s ease, transform 0.15s ease;
        position: relative;
        min-width: 0;
      }
      .ntm-pill-item:active {
        transform: scale(0.90);
      }
      .ntm-pill-item.active {
        background: var(--ntm-color-a, rgba(59,130,246,0.13));
      }

      /* ── ICON ── */
      .ntm-pill-icon {
        width: 26px;
        height: 26px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s ease;
      }
      .ntm-pill-item.active .ntm-pill-icon {
        background: var(--ntm-color-a, rgba(59,130,246,0.16));
      }
      .ntm-pill-icon i {
        font-size: 12px;
        line-height: 1;
        display: block;
        color: #64748b;
        transition: color 0.2s ease;
      }
      .ntm-pill-item.active .ntm-pill-icon i {
        color: var(--ntm-color, #3B82F6);
      }

      /* ── LABEL ── */
      .ntm-pill-label {
        font-family: 'DM Sans', sans-serif;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: #4B5563;
        line-height: 1;
        transition: color 0.2s ease;
        pointer-events: none;
        white-space: nowrap;
      }
      .ntm-pill-item.active .ntm-pill-label {
        color: var(--ntm-color, #3B82F6);
      }
    `;
    document.head.appendChild(s);
  }

  // ── BUILD PILL ────────────────────────────────────────────────────────

  function buildPill() {
    footerEl.innerHTML = '';
    const pill = document.createElement('div');
    pill.className = 'ntm-pill';

    Object.entries(PAGES).forEach(([id, cfg]) => {
      const item = document.createElement('button');
      item.className = 'ntm-pill-item' + (id === activePage ? ' active' : '');
      item.dataset.id = id;
      // CSS custom properties for color theming per item
      item.style.setProperty('--ntm-color',   cfg.color);
      item.style.setProperty('--ntm-color-a', cfg.color + '1A'); // 10% opacity

      item.innerHTML = `
        <div class="ntm-pill-icon">
          <i class="fa-solid ${cfg.icon}"></i>
        </div>
        <span class="ntm-pill-label">${cfg.label}</span>
      `;

      item.addEventListener('click', e => {
        e.stopPropagation();
        if (window.App && typeof App.navigate === 'function') {
          App.navigate(id);
        } else if (window.Router) {
          window.Router.go(id);
        }
      });

      pill.appendChild(item);
    });

    footerEl.appendChild(pill);
  }

  // ── SET ACTIVE ────────────────────────────────────────────────────────

  function setActive(pageId) {
    if (!footerEl) return;
    activePage = pageId;

    footerEl.querySelectorAll('.ntm-pill-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === pageId);
    });

    updateHeader(pageId);
  }

  // ── HEADER ────────────────────────────────────────────────────────────

  function updateHeader(pageId) {
    if (!headerEl) return;
    const cfg         = PAGES[pageId] || PAGES.home;
    const displayName = resolveDisplayName();
    const userEmail   = resolveEmail();
    const isVerified  = resolveVerified();
    const initials    = buildInitials(displayName);

    const titleHTML = pageId === 'home'
      ? `<span style="font-size:17px;font-weight:800;letter-spacing:-0.3px;">Nex<span style="color:#3B82F6;">Trade</span></span>`
      : `<span style="font-size:17px;font-weight:700;letter-spacing:-0.3px;">${cfg.label}</span>`;

    headerEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:9px;font-family:'DM Sans',sans-serif;">
        <img src="NexTrade-192.png" alt="NexTrade"
             style="width:28px;height:28px;border-radius:8px;object-fit:cover;flex-shrink:0;display:block;"
             onerror="this.style.display='none'">
        ${titleHTML}
      </div>
      <div style="position:relative;">
        <button id="profile-menu-btn" style="width:38px;height:38px;border-radius:12px;background:${SURFACE};border:1px solid ${BORDER_HOVER};display:flex;align-items:center;justify-content:center;color:#F8FAFC;cursor:pointer;transition:all 0.2s;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;letter-spacing:0.5px;box-shadow:${TOP_EDGE};">
          ${initials}
        </button>
        <div id="profile-dropdown" class="profile-dropdown">
          <div class="profile-header">
            <div class="profile-avatar">${initials}</div>
            <div class="profile-info">
              <div class="profile-name">${displayName}</div>
              <div class="profile-email">${userEmail}</div>
            </div>
          </div>
          <div class="profile-verification ${isVerified ? 'verified' : 'unverified'}">
            <i class="fa-solid ${isVerified ? 'fa-shield-check' : 'fa-shield-halved'}"></i>
            <span>${isVerified ? 'Verified Account' : 'Action Required: Verify Identity'}</span>
          </div>
          <div class="profile-menu">
            <button class="profile-menu-item" onclick="Navbar.handleSettings()">
              <div class="menu-icon"><i class="fa-solid fa-gear"></i></div><span>Settings</span>
            </button>
            <button class="profile-menu-item" onclick="Navbar.handleHelp()">
              <div class="menu-icon"><i class="fa-solid fa-headset"></i></div><span>Support</span>
            </button>
            <div class="profile-menu-divider"></div>
            <button class="profile-menu-item danger" onclick="Navbar.handleSignOut()">
              <div class="menu-icon"><i class="fa-solid fa-arrow-right-from-bracket"></i></div><span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    `;

    headerEl.querySelector('#profile-menu-btn').onclick = e => {
      e.stopPropagation();
      toggleProfileDropdown();
    };
  }

  // ── PROFILE DROPDOWN ──────────────────────────────────────────────────

  function toggleProfileDropdown() {
    const dd  = document.getElementById('profile-dropdown');
    const btn = document.getElementById('profile-menu-btn');
    if (!dd) return;
    dropdownOpen = !dropdownOpen;
    dd.classList.toggle('open', dropdownOpen);
    if (btn) {
      btn.style.background  = dropdownOpen ? 'rgba(59,130,246,0.1)' : SURFACE;
      btn.style.borderColor = dropdownOpen ? 'rgba(59,130,246,0.3)' : BORDER_HOVER;
      btn.style.color       = dropdownOpen ? '#3B82F6' : '#F8FAFC';
    }
  }

  function closeDropdown() {
    dropdownOpen = false;
    const dd  = document.getElementById('profile-dropdown');
    const btn = document.getElementById('profile-menu-btn');
    if (dd)  dd.classList.remove('open');
    if (btn) {
      btn.style.background  = SURFACE;
      btn.style.borderColor = BORDER_HOVER;
      btn.style.color       = '#F8FAFC';
    }
  }

  function injectDropdownStyles() {
    if (document.getElementById('navbar-premium-styles')) return;
    const s = document.createElement('style');
    s.id = 'navbar-premium-styles';
    s.textContent = `
      .profile-dropdown{position:absolute;top:calc(100% + 12px);right:0;width:260px;background:rgba(21,25,33,0.97);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.09);border-radius:20px;box-shadow:0 12px 40px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.08);opacity:0;transform:translateY(-10px);pointer-events:none;transition:all 0.3s cubic-bezier(0.34,1.2,0.64,1);z-index:9999;overflow:hidden;font-family:'DM Sans',sans-serif;}
      .profile-dropdown.open{opacity:1;transform:translateY(0);pointer-events:all;}
      .profile-header{display:flex;align-items:center;gap:12px;padding:18px;border-bottom:1px solid rgba(255,255,255,0.06);}
      .profile-avatar{width:44px;height:44px;border-radius:12px;background:#3B82F6;display:flex;align-items:center;justify-content:center;color:white;font-size:15px;font-weight:700;flex-shrink:0;letter-spacing:0.5px;}
      .profile-info{flex:1;min-width:0;}
      .profile-name{font-size:15px;font-weight:700;color:#F8FAFC;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-0.2px;}
      .profile-email{font-size:12px;color:#94A3B8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .profile-verification{display:flex;align-items:center;gap:8px;padding:12px 18px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(255,255,255,0.06);}
      .profile-verification.verified{color:#10b981;background:rgba(16,185,129,0.05);}
      .profile-verification.unverified{color:#f59e0b;background:rgba(245,158,11,0.05);}
      .profile-menu{padding:8px 0;}
      .profile-menu-item{width:100%;display:flex;align-items:center;gap:12px;padding:10px 18px;background:none;border:none;color:#F8FAFC;font-family:inherit;font-size:14px;font-weight:600;text-align:left;cursor:pointer;transition:background 0.15s;}
      .profile-menu-item:hover{background:rgba(255,255,255,0.04);}
      .menu-icon{width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;color:#94A3B8;font-size:12px;}
      .profile-menu-item.danger{color:#EF4444;}
      .profile-menu-item.danger .menu-icon{background:rgba(239,68,68,0.1);color:#EF4444;}
      .profile-menu-divider{height:1px;background:rgba(255,255,255,0.06);margin:6px 0;}
    `;
    document.head.appendChild(s);
  }

  // ── MENU ACTIONS ──────────────────────────────────────────────────────

  function handleSettings() {
    closeDropdown();
    if (window.App) App.showError('Settings coming soon');
  }

  function handleHelp() {
    closeDropdown();
    if (window.App) App.showError('Help center coming soon');
  }

  async function handleSignOut() {
    closeDropdown();
    if (!window.Modal) return;
    const ok = await Modal.confirm({
      title: 'Sign Out',
      message: 'Are you sure you want to sign out?',
      confirmText: 'Sign Out',
      cancelText: 'Cancel',
      dangerMode: true
    });
    if (ok) {
      if (window.AppState) AppState.clear();
      sessionStorage.removeItem('saved_auth_mode');
      sessionStorage.removeItem('saved_auth_email');
      if (window.supabaseClient) await supabaseClient.auth.signOut();
      window.location.href = 'login.html';
    }
  }

  return { init, setActive, handleSettings, handleHelp, handleSignOut };
})();

if (typeof window !== 'undefined') window.Navbar = Navbar;
