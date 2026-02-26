/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NexTrade — Modal System v3.0 (Strict WebView Architecture)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CRITICAL FIX:
 * Implemented decoupled Backdrop Tracking to prevent Android WebView
 * layout-shift synthetic pointer events from instantly closing the modal 
 * when an <input> gains focus.
 *
 * DOM Structure:
 * .ntm-overlay (pointer-events: none, flex positioning)
 * ├── .ntm-backdrop (pointer-events: all, handles dismiss)
 * └── .ntm-card (pointer-events: all, z-index: 2, holds content)
 */

const Modal = (() => {
  'use strict';

  let overlay    = null;
  let backdrop   = null;
  let card       = null;
  let _resolver  = null;
  let _isClosing = false;

  // ── STYLES ─────────────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('modal-system-styles')) return;
    const s = document.createElement('style');
    s.id = 'modal-system-styles';
    s.textContent = `
      /* ── Wrapper ── */
      .ntm-overlay {
        position: fixed; inset: 0; z-index: 8000;
        display: flex; align-items: flex-end; justify-content: center;
        padding: 0;
        pointer-events: none; /* Let clicks pass through to backdrop/card */
      }

      /* ── Dedicated Backdrop ── */
      .ntm-backdrop {
        position: absolute; inset: 0; z-index: 1;
        background: rgba(0, 0, 0, 0);
        pointer-events: none;
        transition: background 0.28s ease;
      }
      .ntm-overlay.ntm-open .ntm-backdrop {
        background: rgba(0, 0, 0, 0.62);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        pointer-events: all; /* Only catch clicks when active */
      }

      /* ── Card — bottom sheet default ── */
      .ntm-card {
        position: relative; z-index: 2;
        width: 100%; max-width: 480px;
        background: #111621;
        border-radius: 24px 24px 0 0;
        border: 1px solid rgba(255,255,255,0.09);
        border-bottom: none;
        box-shadow:
          0 -8px 40px rgba(0,0,0,0.5),
          0 -1px 0   rgba(255,255,255,0.06) inset;
        padding: 0;
        overflow: hidden;
        pointer-events: all; /* Card captures its own interactions */
        transform: translateY(100%);
        transition: transform 0.38s cubic-bezier(0.32, 1.18, 0.58, 1), opacity 0.22s ease;
      }
      .ntm-overlay.ntm-open .ntm-card {
        transform: translateY(0);
      }

      /* Drag handle */
      .ntm-handle {
        width: 36px; height: 4px;
        background: rgba(255,255,255,0.14);
        border-radius: 99px;
        margin: 12px auto 0;
      }

      /* ── Card — centered modal for confirm + ≥560px ── */
      @media (min-width: 560px) {
        .ntm-overlay { align-items: center; padding: 24px; }
        .ntm-card {
          border-radius: 24px;
          border-bottom: 1px solid rgba(255,255,255,0.09);
          transform: translateY(16px) scale(0.97);
          opacity: 0;
        }
        .ntm-overlay.ntm-open .ntm-card {
          transform: translateY(0) scale(1);
          opacity: 1;
        }
        .ntm-handle { display: none; }
      }

      /* ── Confirm variant — always compact ── */
      .ntm-card.ntm-confirm { max-width: 340px; }
      @media (max-width: 559px) {
        .ntm-card.ntm-confirm { border-radius: 24px 24px 0 0; }
      }

      /* ── Inner layout ── */
      .ntm-body { padding: 20px 24px 28px; }
      .ntm-confirm .ntm-body { padding: 24px 24px 20px; text-align: center; }

      .ntm-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
      .ntm-title { font-family: 'DM Sans', sans-serif; font-size: 16px; font-weight: 700; color: #F8FAFC; letter-spacing: -0.2px; }
      .ntm-close-btn {
        width: 28px; height: 28px; border-radius: 8px;
        background: rgba(255,255,255,0.07); border: none; color: #94A3B8;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; flex-shrink: 0; transition: background 0.15s, color 0.15s; font-size: 12px;
      }
      .ntm-close-btn:hover { background: rgba(255,255,255,0.12); color: #F8FAFC; }

      .ntm-confirm-icon { width: 52px; height: 52px; border-radius: 16px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 20px; }
      .ntm-confirm-icon.danger { background: rgba(239, 68, 68, 0.1); color: #EF4444; box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.18); }
      .ntm-confirm-icon.info { background: rgba(59, 130, 246, 0.1); color: #3B82F6; box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.18); }
      .ntm-confirm-icon.warn { background: rgba(245, 158, 11, 0.1); color: #F59E0B; box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.18); }

      .ntm-confirm-title { font-family: 'DM Sans', sans-serif; font-size: 17px; font-weight: 700; color: #F8FAFC; letter-spacing: -0.2px; margin-bottom: 8px; }
      .ntm-confirm-msg { font-family: 'DM Sans', sans-serif; font-size: 13.5px; line-height: 1.55; color: #94A3B8; margin-bottom: 22px; }

      .ntm-confirm-btns { display: flex; gap: 10px; }
      .ntm-btn { flex: 1; height: 44px; border-radius: 12px; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 700; border: none; cursor: pointer; transition: all 0.18s ease; letter-spacing: -0.1px; }
      .ntm-btn-cancel { background: rgba(255,255,255,0.07); color: #CBD5E1; border: 1px solid rgba(255,255,255,0.08); }
      .ntm-btn-cancel:hover { background: rgba(255,255,255,0.11); }
      .ntm-btn-confirm { background: #3B82F6; color: #fff; box-shadow: 0 4px 14px rgba(59,130,246,0.35); }
      .ntm-btn-confirm:hover { background: #2563EB; transform: translateY(-1px); }
      .ntm-btn-confirm:active { transform: translateY(0); }
      .ntm-btn-danger { background: rgba(239, 68, 68, 0.12); color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.2); }
      .ntm-btn-danger:hover { background: rgba(239, 68, 68, 0.2); }

      .ntm-content { font-family: 'DM Sans', sans-serif; color: #CBD5E1; font-size: 14px; line-height: 1.6; }
      .ntm-content input, .ntm-content textarea, .ntm-content select, .ntm-content button { position: relative; z-index: 1; }
    `;
    document.head.appendChild(s);
  }

  // ── BUILD INFRASTRUCTURE ───────────────────────────────────────────────────

  function ensureInfrastructure() {
    if (overlay) return;
    injectStyles();
    
    overlay = document.createElement('div');
    overlay.className = 'ntm-overlay';
    
    backdrop = document.createElement('div');
    backdrop.className = 'ntm-backdrop';
    
    overlay.appendChild(backdrop);
    document.body.appendChild(overlay);

    // Strict pointer tracking to defeat synthetic layout-shift clicks
    let startedOnBackdrop = false;

    backdrop.addEventListener('pointerdown', (e) => {
      // Must originate directly on the backdrop layer
      if (e.target === backdrop) {
        startedOnBackdrop = true;
      }
    });

    backdrop.addEventListener('pointerup', (e) => {
      if (startedOnBackdrop && card && card.dataset.dismissible !== 'false') {
        close();
      }
      startedOnBackdrop = false;
    });

    // Failsafe: if the finger drags off the backdrop and releases
    backdrop.addEventListener('pointercancel', () => {
      startedOnBackdrop = false;
    });
  }

  // ── OPEN ───────────────────────────────────────────────────────────────────

  function open({ title = '', content = '', maxWidth = '480px', hideTitle = false, dismissible = true } = {}) {
    ensureInfrastructure();
    
    // Clear previous card if it somehow exists mid-transition
    if (card && card.parentNode) card.remove();
    _isClosing = false;

    card = document.createElement('div');
    card.className = 'ntm-card';
    card.dataset.dismissible = String(dismissible);
    card.style.maxWidth = maxWidth;

    // Card stops propagation as an extra safety measure, but the backdrop
    // logic above makes this nearly bulletproof regardless.
    card.addEventListener('pointerdown', e => e.stopPropagation());

    const handle = `<div class="ntm-handle"></div>`;
    const titleRow = hideTitle ? '' : `
      <div class="ntm-title-row">
        <span class="ntm-title">${title}</span>
        ${dismissible ? `<button class="ntm-close-btn" id="ntm-close"><i class="fa-solid fa-xmark"></i></button>` : ''}
      </div>
    `;

    card.innerHTML = `
      ${handle}
      <div class="ntm-body">
        ${titleRow}
        <div class="ntm-content">${typeof content === 'string' ? content : ''}</div>
      </div>
    `;

    if (typeof content !== 'string' && content instanceof Element) {
      card.querySelector('.ntm-content').innerHTML = '';
      card.querySelector('.ntm-content').appendChild(content);
    }

    overlay.appendChild(card);

    // Hardware-accelerated frame jump for CSS transition
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { 
        overlay.classList.add('ntm-open'); 
      });
    });

    const closeBtn = card.querySelector('#ntm-close');
    if (closeBtn) closeBtn.addEventListener('click', close);
  }

  // ── CONFIRM ────────────────────────────────────────────────────────────────

  function confirm({
    title       = 'Are you sure?',
    message     = '',
    content     = null,
    confirmText = 'Confirm',
    cancelText  = 'Cancel',
    dangerMode  = false,
    icon        = null,
  } = {}) {
    return new Promise(resolve => {
      ensureInfrastructure();
      
      if (card && card.parentNode) card.remove();
      _resolver = resolve;
      _isClosing = false;

      let iconClass = dangerMode ? 'danger' : 'info';
      let iconName  = dangerMode ? 'fa-arrow-right-from-bracket' : 'fa-circle-question';
      if (icon) iconName = icon;

      card = document.createElement('div');
      card.className = 'ntm-card ntm-confirm';
      card.dataset.dismissible = 'true';
      card.addEventListener('pointerdown', e => e.stopPropagation());

      const messageHTML = message
        ? `<p class="ntm-confirm-msg">${message}</p>`
        : (content && typeof content === 'string' ? `<div class="ntm-confirm-msg">${content}</div>` : '');

      card.innerHTML = `
        <div class="ntm-handle"></div>
        <div class="ntm-body">
          <div class="ntm-confirm-icon ${iconClass}">
            <i class="fa-solid ${iconName}"></i>
          </div>
          <div class="ntm-confirm-title">${title}</div>
          ${messageHTML}
          <div class="ntm-confirm-btns">
            <button class="ntm-btn ntm-btn-cancel" id="ntm-cancel">${cancelText}</button>
            <button class="ntm-btn ${dangerMode ? 'ntm-btn-danger' : 'ntm-btn-confirm'}" id="ntm-confirm">${confirmText}</button>
          </div>
        </div>
      `;

      overlay.appendChild(card);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => { 
          overlay.classList.add('ntm-open'); 
        });
      });

      card.querySelector('#ntm-cancel').addEventListener('click', () => _resolve(false));
      card.querySelector('#ntm-confirm').addEventListener('click', () => _resolve(true));
    });
  }

  function _resolve(value) {
    if (_resolver) { 
      _resolver(value); 
      _resolver = null; 
    }
    close();
  }

  // ── IDEMPOTENT TEARDOWN ────────────────────────────────────────────────────

  function close() {
    if (!overlay || _isClosing || !overlay.classList.contains('ntm-open')) return;
    
    _isClosing = true;
    overlay.classList.remove('ntm-open');

    const onEnd = (e) => {
      // Ignore inner bubbled transitions, only tear down on the main backdrop finish
      if (e && e.target !== backdrop && e.target !== card) return;

      backdrop.removeEventListener('transitionend', onEnd);
      if (card) {
        card.removeEventListener('transitionend', onEnd);
        if (card.parentNode) card.remove();
        card = null;
      }
      _isClosing = false;
    };

    backdrop.addEventListener('transitionend', onEnd);

    // Fallback if browser throttles the transition event
    setTimeout(() => {
      if (_isClosing) onEnd();
    }, 450);
  }

  return { open, confirm, close };
})();

if (typeof window !== 'undefined') window.Modal = Modal;
