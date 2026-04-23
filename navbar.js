/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NexTrade — Navbar v4.1  (Radial Burst · Obsidian Theme)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * v4.1 changes:
 *   • Style injection runs at MODULE PARSE TIME — kills the rectangular
 *     footer flash before the first paint, not after init()
 *   • Orbital buttons redesigned to match the Obsidian card system:
 *       - #151921 surface, inset top-edge highlight
 *       - Icon in a coloured chip (matches wallet action buttons)
 *       - Active: radial accent glow + coloured border + larger icon chip
 *   • Orb: obsidian + top-edge highlight + page-colour ambient glow
 *   • First-time onboarding nudge (localStorage-gated, 4s auto-dismiss)
 */
// HARD PREBOOT FOOTER FIX — prevents rectangular flash
(function () {
  const s = document.createElement('style');
  s.textContent = `
    .app-footer {
      background: transparent !important;
      border: none !important;
    }
    .app-footer button {
      background: transparent;
      border: none;
      outline: none;
    }
  `;
  document.head.appendChild(s);
})();
// ── MODULE ─────────────────────────────────────────────────────────────────

const Navbar = (() => {
  'use strict';

  let footerEl     = null;
  let headerEl     = null;
  let orbEl        = null;
  let isOpen       = false;
  let activePage   = 'home';
  let dropdownOpen = false;

  // ── DESIGN SYSTEM (mirrors core.css tokens) ──────────────────────────────
  const SURFACE          = '#151921';
  const SURFACE_ELEVATED = '#1E232F';
  const BG               = '#0B0E11';
  const BORDER           = 'rgba(255,255,255,0.08)';
  const BORDER_HOVER     = 'rgba(255,255,255,0.15)';
  const TOP_EDGE         = 'inset 0 1px 0 rgba(255,255,255,0.09)';

  // Each page: accent colour matches the app's semantic palette
  const PAGES = {
    home:   { label: 'Home',   icon: 'fa-house',       color: '#3B82F6', glow: 'rgba(59,130,246,0.22)'   },
    market: { label: 'Market', icon: 'fa-chart-line',  color: '#8B5CF6', glow: 'rgba(139,92,246,0.22)'   },
    vault:  { label: 'Vault',  icon: 'fa-layer-group', color: '#10B981', glow: 'rgba(16,185,129,0.22)'   },
    wallet: { label: 'Wallet', icon: 'fa-wallet',      color: '#F59E0B', glow: 'rgba(245,158,11,0.22)'   },
  };

  // Fan arc: 4 positions at r≈92px above the orb centre
  const ARC = {
    home:   { tx: -94, ty: -54 },
    market: { tx: -37, ty: -101 },
    vault:  { tx:  37, ty: -101 },
    wallet: { tx:  94, ty:  -54 },
  };

  // ── USER HELPERS ──────────────────────────────────────────────────────────

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
        if (!n && u?.email) n = u.email.split('@')[0].replace(/[._\-+]/g,' ').trim();
      }
    }
    return n ? toTitleCase(n) : 'You';
  }
  function resolveEmail()    { return window.AppState ? (AppState.get('user')?.email || '') : ''; }
  function resolveVerified() {
    if (!window.AppState) return false;
    const u = AppState.get('user');
    return u?.user_metadata?.verified === true || u?.user_metadata?.email_verified === true;
  }
  function buildInitials(name) {
    const w = name.trim().split(/\s+/).filter(Boolean);
    if (!w.length) return 'ME';
    return w.length === 1 ? w[0].substring(0,2).toUpperCase()
                          : (w[0][0] + w[w.length-1][0]).toUpperCase();
  }

  // ── INIT ──────────────────────────────────────────────────────────────────

  function init() {
    headerEl = document.querySelector('.app-header');
    if (!headerEl) { console.warn('[Navbar] Header not found.'); return; }

    // .app-footer is hidden via display:none in <head> CSS — no flex space, no background.
    // We append our orb container inside .app-wrapper which is position:fixed; inset:0
    // = full viewport. Fixed positioning within it is viewport-relative. This avoids
    // the Android WebView bug where body { position:fixed } creates a broken containing block.
    const wrapper = document.querySelector('.app-wrapper');
    if (!wrapper) { console.warn('[Navbar] app-wrapper not found.'); return; }

    footerEl = document.createElement('div');
    footerEl.id = 'ntm-nav-root';
    wrapper.appendChild(footerEl);

    injectStyles();
    buildOrb();
    injectDropdownStyles();

    // Collapse on outside click
    document.addEventListener('click', e => {
      if (isOpen && !footerEl.contains(e.target)) collapse();
    });

    // App.navigate(lastPage) fires BEFORE Navbar.init(), so setActive was a no-op then.
    // Read the actual current page from AppState now that the orb exists and sync it.
    const currentPage = (window.AppState && AppState.get('ui.currentPage')) || 'home';
    setActive(currentPage);

    // First-time onboarding nudge
    if (!localStorage.getItem('ntm_onboarded')) showOnboardingNudge();
  }

  // ── COMPONENT STYLES ──────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('ntm-radial-styles')) return;
    const s = document.createElement('style');
    s.id = 'ntm-radial-styles';
    s.textContent = `

      /* ── NAV ROOT ── */
      #ntm-nav-root {
        position: fixed;
        left: 50%;
        bottom: calc(28px + env(safe-area-inset-bottom, 0px));
        transform: translateX(-50%);
        width: auto;
        height: auto;
        display: block;
        overflow: visible;
        z-index: 9000;
        padding: 0;
        margin: 0;
        background: none;
        border: none;
      }

      /* ── ORB ── */
      .ntm-orb {
        position: relative; z-index: 2;
        width: 58px; height: 58px; border-radius: 50%;
        background: ${SURFACE};
        border: 1px solid rgba(255,255,255,0.13);
        box-shadow:
          0 2px 0 rgba(255,255,255,0.07) inset,
          0 12px 32px rgba(0,0,0,0.7),
          0 4px 10px rgba(0,0,0,0.5);
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: transform 0.3s cubic-bezier(0.34,1.4,0.64,1), box-shadow 0.25s ease;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        animation: ntm-orb-in 0.55s cubic-bezier(0.34,1.4,0.64,1) both;
      }
      @keyframes ntm-orb-in {
        from { transform: translateY(32px) scale(0.55); opacity: 0; }
        to   { transform: translateY(0)    scale(1);    opacity: 1; }
      }
      .ntm-orb:active { transform: scale(0.88) !important; }

      /* Orb icon chip */
      .ntm-orb-chip {
        width: 34px; height: 34px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        pointer-events: none;
        transition: transform 0.3s cubic-bezier(0.34,1.4,0.64,1);
      }
      .ntm-orb-chip i {
        font-size: 1.1rem; line-height: 1; display: block;
      }

      /* ── ORBITAL ITEM BUTTONS ── */
      .ntm-nav-item {
        position: absolute; z-index: 1;
        top: 50%; left: 50%;
        width: 58px; height: 58px;
        margin-top: -29px; margin-left: -29px;
        border-radius: 50%;
        background: ${SURFACE};
        border: 1.5px solid rgba(255,255,255,0.10);
        box-shadow:
          0 2px 0 rgba(255,255,255,0.07) inset,
          0 12px 28px rgba(0,0,0,0.7),
          0 4px 10px rgba(0,0,0,0.45);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 5px;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent; user-select: none;
        pointer-events: none;
        transform: scale(0) translate(0, 0);
        opacity: 0;
        transition:
          transform 0.38s cubic-bezier(0.34, 1.5, 0.64, 1),
          opacity   0.22s ease;
      }
      .ntm-nav-item.vis { pointer-events: all; opacity: 1; }

      /* Active: clean coloured border only — no gradients, no glow spread */
      .ntm-nav-item.active {
        border-color: var(--item-color, #3B82F6);
        border-width: 1.5px;
      }

      /* Icon chip */
      .ntm-item-chip {
        width: 26px; height: 26px; border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        pointer-events: none;
        transition: transform 0.25s ease;
      }
      .ntm-nav-item.active .ntm-item-chip { transform: scale(1.1); }
      .ntm-item-chip i { font-size: 12px; line-height: 1; display: block; pointer-events: none; }

      /* Label */
      .ntm-nav-label {
        font-family: 'DM Sans', sans-serif;
        font-size: 7.5px; font-weight: 800;
        letter-spacing: 0.8px; text-transform: uppercase;
        pointer-events: none; line-height: 1;
        opacity: 0;
        transition: opacity 0.18s ease 0.08s;
      }
      .ntm-nav-item.vis    .ntm-nav-label { opacity: 0.65; }
      .ntm-nav-item.active .ntm-nav-label { opacity: 1; }

      /* ── PAGE LABEL (above orb) ── */
      .ntm-page-label {
        position: absolute; bottom: 68px; left: 50%; transform: translateX(-50%);
        font-family: 'DM Sans', sans-serif;
        font-size: 9px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase;
        color: rgba(255,255,255,0.32); white-space: nowrap; pointer-events: none;
        transition: color 0.3s ease;
      }

      /* ── ONBOARDING NUDGE ── */
      .ntm-nudge {
        position: absolute; bottom: 74px; left: 50%; transform: translateX(-50%);
        background: ${SURFACE_ELEVATED};
        border: 1px solid rgba(255,255,255,0.11);
        border-radius: 20px;
        padding: 7px 14px 7px 9px;
        display: flex; align-items: center; gap: 8px;
        white-space: nowrap;
        box-shadow: 0 8px 24px rgba(0,0,0,0.55), 0 2px 0 rgba(255,255,255,0.06) inset;
        opacity: 0;
        animation: ntm-nudge-in 0.45s 1.2s cubic-bezier(0.34,1.2,0.64,1) forwards;
        pointer-events: none;
        z-index: 10;
      }
      @keyframes ntm-nudge-in {
        from { opacity:0; transform: translateX(-50%) translateY(6px); }
        to   { opacity:1; transform: translateX(-50%) translateY(0);   }
      }
      .ntm-nudge.hiding {
        animation: ntm-nudge-out 0.35s ease forwards;
      }
      @keyframes ntm-nudge-out {
        to { opacity:0; transform: translateX(-50%) translateY(5px); }
      }
      .ntm-nudge-icon {
        width: 22px; height: 22px; border-radius: 7px;
        background: rgba(59,130,246,0.14);
        border: 1px solid rgba(59,130,246,0.22);
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; color: #3B82F6;
        animation: ntm-tap-bounce 1.3s ease 2s infinite;
      }
      @keyframes ntm-tap-bounce {
        0%,100% { transform: scale(1);    }
        50%      { transform: scale(1.2);  }
      }
      .ntm-nudge-text {
        font-family: 'DM Sans', sans-serif;
        font-size: 11.5px; font-weight: 600; color: rgba(255,255,255,0.72);
      }
      .ntm-nudge::after {
        content: '';
        position: absolute; bottom: -5px; left: 50%; transform: translateX(-50%);
        width: 9px; height: 5px;
        background: ${SURFACE_ELEVATED};
        clip-path: polygon(0 0, 100% 0, 50% 100%);
      }
    `;
    document.head.appendChild(s);
  }

  // ── BUILD ORB ─────────────────────────────────────────────────────────────

  function buildOrb() {
    footerEl.innerHTML = '';

    // Page label
    const lbl = document.createElement('div');
    lbl.className = 'ntm-page-label'; lbl.id = 'ntm-page-label';
    lbl.textContent = PAGES[activePage].label;
    footerEl.appendChild(lbl);

    // 4 orbital items
    Object.entries(PAGES).forEach(([id, cfg]) => {
      const el = document.createElement('button');
      el.className = 'ntm-nav-item' + (id === activePage ? ' active' : '');
      el.dataset.id = id;
      el.style.setProperty('--item-color', cfg.color);
      el.innerHTML = `
        <div class="ntm-item-chip" style="background:${cfg.color}20;">
          <i class="fa-solid ${cfg.icon}" style="color:${cfg.color};"></i>
        </div>
        <span class="ntm-nav-label" style="color:${cfg.color};">${cfg.label}</span>
      `;
      el.addEventListener('click', e => { e.stopPropagation(); navigateTo(id); });
      footerEl.appendChild(el);
    });

    // Orb
    orbEl = document.createElement('div');
    orbEl.className = 'ntm-orb'; orbEl.id = 'ntm-orb';
    const c = PAGES[activePage];
    orbEl.innerHTML = `
      <div class="ntm-orb-chip" style="background:${c.color}20;">
        <i class="fa-solid ${c.icon}" style="color:${c.color};"></i>
      </div>
    `;
    orbEl.addEventListener('click', e => { e.stopPropagation(); toggleBurst(); });
    footerEl.appendChild(orbEl);
  }

  // ── ONBOARDING NUDGE ──────────────────────────────────────────────────────

  function showOnboardingNudge() {
    const nudge = document.createElement('div');
    nudge.className = 'ntm-nudge'; nudge.id = 'ntm-nudge';
    nudge.innerHTML = `
      <div class="ntm-nudge-icon"><i class="fa-solid fa-hand-pointer"></i></div>
      <span class="ntm-nudge-text">Tap to navigate</span>
    `;
    footerEl.appendChild(nudge);

    // Dismiss after 4.5s
    setTimeout(() => {
      nudge.classList.add('hiding');
      setTimeout(() => { nudge.remove(); }, 400);
      localStorage.setItem('ntm_onboarded', '1');
    }, 4500);
  }

  // ── BURST ─────────────────────────────────────────────────────────────────

  function toggleBurst() { isOpen ? collapse() : expand(); }

  function expand() {
    if (isOpen) return;
    isOpen = true;
    orbEl.classList.add('open');

    // Rotate orb chip icon
    const chip = orbEl.querySelector('.ntm-orb-chip');
    if (chip) chip.style.transform = 'rotate(45deg) scale(0.82)';

    footerEl.querySelectorAll('.ntm-nav-item').forEach((el, i) => {
      const { tx, ty } = ARC[el.dataset.id];
      el.style.transitionDelay = (i * 30) + 'ms,' + (i * 30) + 'ms,0ms,0ms,0ms,0ms';
      el.style.transform = `scale(1) translate(${tx}px,${ty}px)`;
      el.classList.add('vis');
    });

    // Dismiss nudge if showing
    const nudge = document.getElementById('ntm-nudge');
    if (nudge) { nudge.classList.add('hiding'); setTimeout(() => nudge.remove(), 400); localStorage.setItem('ntm_onboarded','1'); }
  }

  function collapse() {
    if (!isOpen) return;
    isOpen = false;
    orbEl.classList.remove('open');

    const chip = orbEl.querySelector('.ntm-orb-chip');
    if (chip) chip.style.transform = 'rotate(0deg) scale(1)';

    footerEl.querySelectorAll('.ntm-nav-item').forEach((el, i) => {
      el.style.transitionDelay = (i * 18) + 'ms,' + (i * 18) + 'ms,0ms,0ms,0ms,0ms';
      el.style.transform = 'scale(0) translate(0,0)';
      el.classList.remove('vis');
    });
  }

  function navigateTo(pageId) {
    collapse();
    setTimeout(() => {
      if (window.App && typeof App.navigate === 'function') App.navigate(pageId);
      else if (window.Router) window.Router.go(pageId);
    }, 80);
  }

  // ── SET ACTIVE ────────────────────────────────────────────────────────────

  function setActive(pageId) {
    if (!footerEl || !orbEl) return;
    activePage = pageId;
    const cfg = PAGES[pageId] || PAGES.home;

    // Update orb glow + chip colour
    const chip = orbEl.querySelector('.ntm-orb-chip');
    if (chip) {
      chip.style.background = cfg.color + '20';
      chip.querySelector('i').style.color = cfg.color;
      chip.querySelector('i').className = `fa-solid ${cfg.icon}`;
    }

    // Page label
    const lbl = document.getElementById('ntm-page-label');
    if (lbl) { lbl.textContent = cfg.label; lbl.style.color = cfg.color; }

    // Active ring on items
    footerEl.querySelectorAll('.ntm-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === pageId);
    });

    updateHeader(pageId);
  }

  // ── HEADER ────────────────────────────────────────────────────────────────

  function updateHeader(pageId) {
    if (!headerEl) return;
    const cfg = PAGES[pageId] || PAGES.home;
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
          <div class="profile-verification ${isVerified?'verified':'unverified'}">
            <i class="fa-solid ${isVerified?'fa-shield-check':'fa-shield-halved'}"></i>
            <span>${isVerified?'Verified Account':'Action Required: Verify Identity'}</span>
          </div>
          <div class="profile-menu">
            <button class="profile-menu-item" onclick="Navbar.handleSettings()"><div class="menu-icon"><i class="fa-solid fa-gear"></i></div><span>Settings</span></button>
            <button class="profile-menu-item" onclick="Navbar.handleHelp()"><div class="menu-icon"><i class="fa-solid fa-headset"></i></div><span>Support</span></button>
            <div class="profile-menu-divider"></div>
            <button class="profile-menu-item danger" onclick="Navbar.handleSignOut()"><div class="menu-icon"><i class="fa-solid fa-arrow-right-from-bracket"></i></div><span>Sign Out</span></button>
          </div>
        </div>
      </div>
    `;
    headerEl.querySelector('#profile-menu-btn').onclick = e => { e.stopPropagation(); toggleProfileDropdown(); };
  }

  // ── DROPDOWN ─────────────────────────────────────────────────────────────

  function toggleProfileDropdown() {
    const dd=document.getElementById('profile-dropdown'), btn=document.getElementById('profile-menu-btn');
    if (!dd) return;
    dropdownOpen = !dropdownOpen;
    dd.classList.toggle('open', dropdownOpen);
    if (btn) {
      btn.style.background  = dropdownOpen ? 'rgba(59,130,246,0.1)' : SURFACE;
      btn.style.borderColor = dropdownOpen ? 'rgba(59,130,246,0.3)' : BORDER_HOVER;
      btn.style.color       = dropdownOpen ? '#3B82F6' : '#F8FAFC';
    }
    if (dropdownOpen) setTimeout(() => document.addEventListener('click', handleOutsideClick), 0);
    else document.removeEventListener('click', handleOutsideClick);
  }
  function handleOutsideClick(e) {
    const dd=document.getElementById('profile-dropdown'), btn=document.getElementById('profile-menu-btn');
    if (dd && !dd.contains(e.target) && e.target !== btn) {
      dropdownOpen = false; dd.classList.remove('open');
      if (btn) { btn.style.background=SURFACE; btn.style.borderColor=BORDER_HOVER; btn.style.color='#F8FAFC'; }
      document.removeEventListener('click', handleOutsideClick);
    }
  }
  function injectDropdownStyles() {
    if (document.getElementById('navbar-premium-styles')) return;
    const s = document.createElement('style'); s.id = 'navbar-premium-styles';
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

  // ── MENU ACTIONS ──────────────────────────────────────────────────────────

  function handleSettings() { toggleProfileDropdown(); if(window.App) App.showError('Settings coming soon'); }
  function handleHelp()     { toggleProfileDropdown(); if(window.App) App.showError('Help center coming soon'); }
  async function handleSignOut() {
    toggleProfileDropdown();
    if (!window.Modal) return;
    const ok = await Modal.confirm({
      title:'Sign Out', message:'Are you sure you want to sign out?',
      confirmText:'Sign Out', cancelText:'Cancel', dangerMode:true
    });
    if (ok) {
      if (window.AppState) AppState.clear();
      sessionStorage.removeItem('saved_auth_mode'); sessionStorage.removeItem('saved_auth_email');
      if (window.supabaseClient) await supabaseClient.auth.signOut();
      window.location.href = 'login.html';
    }
  }

  return { init, setActive, handleSettings, handleHelp, handleSignOut };
})();

if (typeof window !== 'undefined') window.Navbar = Navbar;
