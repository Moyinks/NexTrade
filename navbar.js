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
    vault:  { label: 'Earn',   icon: 'fa-layer-group', color: '#10B981' },
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
    publishNavFootprint();

    // Close profile dropdown on outside click
    document.addEventListener('click', e => {
      if (dropdownOpen && headerEl && !headerEl.contains(e.target)) {
        closeDropdown();
      }
    });

    // Sync active state with current page
    const currentPage = (window.AppState && AppState.get('ui.currentPage')) || 'home';
    setActive(currentPage);

    // ── KEYBOARD HIDE/SHOW ─────────────────────────────────────────────
    // When the soft keyboard opens on mobile, window.innerHeight stays fixed
    // but visualViewport.height shrinks to the visible area.  The pill nav is
    // position:fixed so it would otherwise sit on top of the search/filter UI.
    // Hide it while the keyboard is open; restore it the moment it closes.
    if (window.visualViewport) {
      const _onViewportResize = () => {
        // Keyboard is open when the visible height is materially smaller than
        // the full window height.  0.75 threshold is reliable across iOS/Android.
        const keyboardOpen = window.visualViewport.height < window.innerHeight * 0.75;
        if (footerEl) footerEl.style.display = keyboardOpen ? 'none' : '';
        publishNavFootprint();
      };
      window.visualViewport.addEventListener('resize', _onViewportResize);
    }
  }

  // ── NAV FOOTPRINT — measured, not estimated ─────────────────────────────
  // Every scrollable page needs to know how much room the floating pill
  // occupies so its last item can clear it. Rather than hand-calculating
  // that from padding/font-size/line-height on paper (an estimate that can
  // only ever be as accurate as the guess, and drifts the moment the pill's
  // design changes, or a font metric renders slightly differently on a given
  // device), this reads the pill's REAL on-screen box with
  // getBoundingClientRect() and publishes it as a CSS variable every other
  // page already consumes. getBoundingClientRect() returns fully-resolved
  // device pixels — the browser has already done the safe-area-inset-bottom
  // math, the font-metric math, everything — so this is exact by
  // construction, not an approximation of one. It re-measures on resize,
  // orientation change, and webfont load (icon glyphs can resize the pill
  // slightly the moment Font Awesome finishes loading, after first paint),
  // so it self-corrects instead of needing to be re-guessed for every phone.
  let _navFootprintRaf = null;
  function publishNavFootprint() {
    if (_navFootprintRaf) cancelAnimationFrame(_navFootprintRaf);
    _navFootprintRaf = requestAnimationFrame(() => {
      if (!footerEl || footerEl.style.display === 'none') return;
      const rect = footerEl.getBoundingClientRect();
      if (rect.height === 0) return; // not laid out yet — a later event will re-measure
      const footprintPx = Math.ceil(window.innerHeight - rect.top);
      document.documentElement.style.setProperty('--nav-footprint-live', `${footprintPx}px`);
    });
  }

  window.addEventListener('resize', publishNavFootprint);
  window.addEventListener('orientationchange', () => setTimeout(publishNavFootprint, 60));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(publishNavFootprint);
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
        border-radius: var(--nt-radius-sheet);
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
        border-radius: var(--nt-radius-card);
        border: none;
        background: transparent;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        transition: background var(--nt-motion-state) var(--nt-ease-standard), transform var(--nt-motion-press) var(--nt-ease-standard);
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
        border-radius: var(--nt-radius-compact);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background var(--nt-motion-state) var(--nt-ease-standard);
      }
      .ntm-pill-item.active .ntm-pill-icon {
        background: var(--ntm-color-a, rgba(59,130,246,0.16));
      }
      .ntm-pill-icon i {
        font-size: 12px;
        line-height: 1;
        display: block;
        color: var(--color-text-secondary);
        transition: color var(--nt-motion-state) var(--nt-ease-standard);
      }
      .ntm-pill-item.active .ntm-pill-icon i {
        color: var(--ntm-color, #3B82F6);
      }

      /* ── LABEL ── */
      .ntm-pill-label {
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.3px;
        text-transform: uppercase;
        color: var(--color-text-secondary);
        line-height: 1;
        transition: color var(--nt-motion-state) var(--nt-ease-standard);
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
    const esc = window.SafeDOM && SafeDOM.text ? SafeDOM.text : (v => String(v == null ? '' : v));
    const safeDisplayName = esc(displayName);
    const safeEmail = esc(userEmail);
    const safeInitials = esc(initials);

    const titleHTML = pageId === 'home'
      ? `<span style="font-size:17px;font-weight:800;letter-spacing:-0.5px;font-family:'Inter',system-ui,sans-serif;color:#F8FAFC;">NexTrade</span>`
      : `<span style="font-size:16px;font-weight:600;letter-spacing:-0.3px;font-family:'Inter',system-ui,sans-serif;color:#F8FAFC;">${cfg.label}</span>`;

    headerEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;font-family:'Inter',system-ui,sans-serif;">
        <img class="navbar-brand-image" src="pwa2.png" alt="NexTrade"
             style="width:28px;height:28px;border-radius:8px;object-fit:cover;flex-shrink:0;display:block;">
        ${titleHTML}
      </div>
      <div style="position:relative;">
        <button id="profile-menu-btn" style="width:36px;height:36px;border-radius:10px;background:${SURFACE};border:1px solid rgba(255,255,255,0.10);display:flex;align-items:center;justify-content:center;color:#F8FAFC;cursor:pointer;transition:all 0.2s;font-family:'Inter',system-ui,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.3px;box-shadow:${TOP_EDGE};">
          ${safeInitials}
        </button>
        <div id="profile-dropdown" class="profile-dropdown">
          <div class="profile-header">
            <div class="profile-avatar">${safeInitials}</div>
            <div class="profile-info">
              <div class="profile-name">${safeDisplayName}</div>
              <div class="profile-email">${safeEmail}</div>
            </div>
          </div>
          <div class="profile-verification ${isVerified ? 'verified' : 'unverified'}">
            <i class="fa-solid ${isVerified ? 'fa-shield-check' : 'fa-shield-halved'}"></i>
            <span>${isVerified ? 'Verified Account' : 'Action Required: Verify Identity'}</span>
          </div>
          <div class="profile-menu">
            <button class="profile-menu-item" data-app-action="navbar-settings">
              <div class="menu-icon"><i class="fa-solid fa-gear"></i></div><span>Settings</span>
            </button>
            <button class="profile-menu-item" data-app-action="navbar-help">
              <div class="menu-icon"><i class="fa-solid fa-headset"></i></div><span>Support</span>
            </button>
            <div class="profile-menu-divider"></div>
            <button class="profile-menu-item danger" data-app-action="navbar-signout">
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
    const brandImage = headerEl.querySelector('.navbar-brand-image');
    if (brandImage) brandImage.addEventListener('error', () => { brandImage.style.display = 'none'; });
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
      .profile-dropdown{position:absolute;top:calc(100% + 10px);right:0;width:256px;background:rgba(21,25,33,0.97);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.09);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.07);opacity:0;transform:translateY(-8px);pointer-events:none;transition:all 0.25s cubic-bezier(0.25,0,0.15,1);z-index:9999;overflow:hidden;font-family:'Inter',system-ui,sans-serif;}
      .profile-dropdown.open{opacity:1;transform:translateY(0);pointer-events:all;}
      .profile-header{display:flex;align-items:center;gap:12px;padding:16px;border-bottom:1px solid rgba(255,255,255,0.06);}
      .profile-avatar{width:40px;height:40px;border-radius:10px;background:#3B82F6;display:flex;align-items:center;justify-content:center;color:white;font-size:14px;font-weight:700;flex-shrink:0;}
      .profile-info{flex:1;min-width:0;}
      .profile-name{font-size:14px;font-weight:600;color:#F8FAFC;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-0.2px;}
      .profile-email{font-size:11px;color:#64748B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .profile-verification{display:flex;align-items:center;gap:8px;padding:10px 16px;font-size:11px;font-weight:600;letter-spacing:0.02em;border-bottom:1px solid rgba(255,255,255,0.06);}
      .profile-verification.verified{color:#10b981;background:rgba(16,185,129,0.05);}
      .profile-verification.unverified{color:#f59e0b;background:rgba(245,158,11,0.05);}
      .profile-menu{padding:6px 0;}
      .profile-menu-item{width:100%;display:flex;align-items:center;gap:10px;padding:10px 16px;background:none;border:none;color:#F8FAFC;font-family:'Inter',system-ui,sans-serif;font-size:14px;font-weight:500;text-align:left;cursor:pointer;transition:background 0.12s;}
      .profile-menu-item:active{background:rgba(255,255,255,0.05);}
      .menu-icon{width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;color:#94A3B8;font-size:12px;flex-shrink:0;}
      .profile-menu-item.danger{color:#EF4444;}
      .profile-menu-item.danger .menu-icon{background:rgba(239,68,68,0.10);color:#EF4444;}
      .profile-menu-divider{height:1px;background:rgba(255,255,255,0.06);margin:4px 0;}
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
      window.location.replace('login.html');
    }
  }

  return { init, setActive, handleSettings, handleHelp, handleSignOut };
})();

if (typeof window !== 'undefined') window.Navbar = Navbar;
