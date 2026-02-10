/**
 * NexTrade — Modal Component (REPAIRED)
 * Reusable modal/dialog system with overlay
 * Self-invoking module pattern
 * * FIXES:
 * - Modal.close() now returns a Promise to prevent UI thread freezing.
 * - Sequential modal handling: ensures DOM cleanup before next modal opens.
 * - Added safe body scroll restoration.
 */

const Modal = (() => {
  'use strict';

  // ============================================
  // MODAL STATE
  // ============================================

  let activeModal = null;
  let modalOverlay = null;

  // ============================================
  // MODAL CREATION
  // ============================================

  /**
   * Create modal overlay
   * @returns {HTMLElement} Overlay element
   */
  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.8);
backdrop-filter: blur(8px);
-webkit-backdrop-filter: blur(8px); /* iOS Safari */
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: var(--space-4);
      opacity: 0;
      transition: opacity var(--transition-base);
    `;

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        close();
      }
    });

    return overlay;
  }

  /**
   * Create modal container
   * @param {object} options - Modal options
   * @returns {HTMLElement} Modal element
   */
  function createModal(options = {}) {
    const defaults = {
      title: '',
      content: '',
      maxWidth: '500px',
      showCloseButton: true,
      closeOnEscape: true,
      className: ''
    };

    const opts = { ...defaults, ...options };

    const modal = document.createElement('div');
    modal.className = 'modal-container';
    modal.style.cssText = `
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      max-width: ${opts.maxWidth};
      width: 100%;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      transform: scale(0.9);
      transition: transform var(--transition-base);
    `;

    if (opts.className) {
      modal.classList.add(opts.className);
    }

    // Header
    if (opts.title || opts.showCloseButton) {
      const header = document.createElement('div');
      header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-6);
        border-bottom: 1px solid var(--color-border);
      `;

      const title = document.createElement('h3');
      title.style.cssText = `
        font-size: var(--text-xl);
        font-weight: var(--weight-semibold);
        color: var(--color-text-primary);
        margin: 0;
      `;
      title.textContent = opts.title;

      header.appendChild(title);

      if (opts.showCloseButton) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'btn-icon btn-ghost';
        closeBtn.innerHTML = '✕';
        closeBtn.style.cssText = `
          font-size: var(--text-xl);
          padding: var(--space-2);
          min-width: 36px;
          min-height: 36px;
          cursor: pointer;
        `;
        closeBtn.setAttribute('aria-label', 'Close modal');
        closeBtn.addEventListener('click', close);
        closeBtn.addEventListener('touchend', (e) => {
          e.preventDefault();
          close();
        });

        header.appendChild(closeBtn);
      }

      modal.appendChild(header);
    }

    // Content
    const content = document.createElement('div');
    content.className = 'modal-content';
    content.style.cssText = `
      padding: var(--space-6);
      overflow-y: auto;
      flex: 1;
    `;

    if (typeof opts.content === 'string') {
      content.innerHTML = opts.content;
    } else if (opts.content instanceof HTMLElement) {
      content.appendChild(opts.content);
    }

    modal.appendChild(content);

    // Handle escape key
    if (opts.closeOnEscape) {
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          close();
          document.removeEventListener('keydown', handleEscape);
        }
      };
      document.addEventListener('keydown', handleEscape);
    }

    return modal;
  }

  // ============================================
  // MODAL CONTROL
  // ============================================

  /**
   * Open modal
   * @param {object} options - Modal options
   * @returns {HTMLElement} Modal element
   */
  async function open(options) {
    // Ensure any existing modal is closed and cleaned up before proceeding
    if (activeModal) {
      await close();
    }

    // Create overlay
    modalOverlay = createOverlay();
    document.body.appendChild(modalOverlay);

    // Create modal
    activeModal = createModal(options);
    modalOverlay.appendChild(activeModal);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Animate in
    requestAnimationFrame(() => {
      if (modalOverlay) modalOverlay.style.opacity = '1';
      if (activeModal) activeModal.style.transform = 'scale(1)';
    });

    // Update app state if module exists
    if (window.AppState && typeof window.AppState.openModal === 'function') {
      window.AppState.openModal(options.id || 'modal');
    }

    return activeModal;
  }

  /**
   * Close active modal
   * @returns {Promise} Resolves when the modal is fully removed from DOM
   */
  function close() {
    return new Promise((resolve) => {
      if (!activeModal || !modalOverlay) {
        resolve();
        return;
      }

      // Animate out
      modalOverlay.style.opacity = '0';
      activeModal.style.transform = 'scale(0.9)';

      // Wait for the transition to finish (250ms per CSS vars)
      setTimeout(() => {
        if (modalOverlay && modalOverlay.parentNode) {
          modalOverlay.parentNode.removeChild(modalOverlay);
        }
        
        activeModal = null;
        modalOverlay = null;

        // Restore body scroll
        document.body.style.overflow = '';

        // Update app state
        if (window.AppState && typeof window.AppState.closeModal === 'function') {
          window.AppState.closeModal();
        }

        resolve();
      }, 250);
    });
  }

  /**
   * Check if modal is open
   * @returns {boolean} True if modal is open
   */
  function isOpen() {
    return activeModal !== null;
  }

  // ============================================
  // SPECIALIZED MODALS (Integrated with async close)
  // ============================================

  function confirm(options = {}) {
    const defaults = {
      title: 'Confirm Action',
      message: 'Are you sure?',
      confirmText: 'Confirm',
      cancelText: 'Cancel',
      confirmClass: 'btn-primary',
      dangerMode: false
    };

    const opts = { ...defaults, ...options };

    return new Promise((resolve) => {
      const content = document.createElement('div');
      content.style.cssText = `display:flex;flex-direction:column;gap:var(--space-6);`;

      const message = document.createElement('p');
      message.style.cssText = `color:var(--color-text-secondary);margin:0;`;
      message.textContent = opts.message;

      const buttons = document.createElement('div');
      buttons.style.cssText = `display:flex;gap:var(--space-3);justify-content:flex-end;`;

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = opts.cancelText;
      cancelBtn.onclick = async () => { await close(); resolve(false); };

      const confirmBtn = document.createElement('button');
      confirmBtn.className = `btn ${opts.dangerMode ? 'btn-danger' : opts.confirmClass}`;
      confirmBtn.textContent = opts.confirmText;
      confirmBtn.onclick = async () => { await close(); resolve(true); };

      buttons.appendChild(cancelBtn);
      buttons.appendChild(confirmBtn);
      content.appendChild(message);
      content.appendChild(buttons);

      open({ title: opts.title, content: content, maxWidth: '400px', showCloseButton: true });
    });
  }

  function alert(options = {}) {
    const defaults = {
      title: 'Alert',
      message: '',
      buttonText: 'OK',
      type: 'info'
    };

    const opts = { ...defaults, ...options };

    return new Promise((resolve) => {
      const content = document.createElement('div');
      content.style.cssText = `display:flex;flex-direction:column;gap:var(--space-6);`;

      const messageWrapper = document.createElement('div');
      messageWrapper.style.cssText = `display:flex;align-items:flex-start;gap:var(--space-3);`;

      const icon = document.createElement('div');
      icon.style.cssText = `font-size:var(--text-2xl);`;
      const iconMap = { info: 'ℹ️', success: '✅', warning: '⚠️', danger: '❌' };
      icon.textContent = iconMap[opts.type] || iconMap.info;

      const message = document.createElement('p');
      message.style.cssText = `color:var(--color-text-secondary);margin:0;flex:1;`;
      message.textContent = opts.message;

      messageWrapper.appendChild(icon);
      messageWrapper.appendChild(message);

      const button = document.createElement('button');
      button.className = 'btn btn-primary btn-full';
      button.textContent = opts.buttonText;
      button.onclick = async () => { await close(); resolve(); };

      content.appendChild(messageWrapper);
      content.appendChild(button);

      open({ title: opts.title, content: content, maxWidth: '400px', showCloseButton: false });
    });
  }

  function showInvestmentModal(strategy) {
    return new Promise((resolve) => {
      const content = document.createElement('div');
      content.style.cssText = `display:flex;flex-direction:column;gap:var(--space-6);`;

      const strategyInfo = document.createElement('div');
      strategyInfo.style.cssText = `padding:var(--space-4);background-color:var(--color-surface-elevated);border-radius:var(--radius-base);`;

      const strategyName = document.createElement('div');
      strategyName.style.cssText = `font-weight:var(--weight-semibold);color:var(--color-text-primary);margin-bottom:var(--space-2);`;
      strategyName.textContent = `${strategy.icon} ${strategy.name}`;

      const strategyDesc = document.createElement('div');
      strategyDesc.style.cssText = `font-size:var(--text-sm);color:var(--color-text-secondary);`;
      strategyDesc.textContent = strategy.description;

      strategyInfo.appendChild(strategyName);
      strategyInfo.appendChild(strategyDesc);

      const form = document.createElement('form');
      form.style.cssText = `display:flex;flex-direction:column;gap:var(--space-4);`;

      const amountGroup = document.createElement('div');
      amountGroup.className = 'input-group';

      const amountLabel = document.createElement('label');
      amountLabel.className = 'input-label';
      amountLabel.textContent = 'Investment Amount';

      const amountInput = document.createElement('input');
      amountInput.type = 'number';
      amountInput.className = 'input-field financial-data';
      amountInput.placeholder = `Min: ${window.Format ? Format.currency(strategy.minInvestment) : strategy.minInvestment}`;
      amountInput.min = strategy.minInvestment;
      amountInput.step = '0.01';

      const errorMsg = document.createElement('span');
      errorMsg.className = 'input-error-message';
      errorMsg.style.display = 'none';

      amountGroup.appendChild(amountLabel);
      amountGroup.appendChild(amountInput);
      amountGroup.appendChild(errorMsg);

      const balanceInfo = document.createElement('div');
      balanceInfo.style.cssText = `font-size:var(--text-sm);color:var(--color-text-secondary);`;
      const availableBalance = window.AppState ? AppState.get('balances').spot : 0;
      balanceInfo.innerHTML = `Available: <span class="financial-data" style="color:var(--color-text-primary);">${window.Format ? Format.currency(availableBalance) : availableBalance}</span>`;

      const buttons = document.createElement('div');
      buttons.style.cssText = `display:flex;gap:var(--space-3);margin-top:var(--space-2);`;

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.flex = '1';
      cancelBtn.onclick = async () => { await close(); resolve(null); };

      const investBtn = document.createElement('button');
      investBtn.type = 'submit';
      investBtn.className = 'btn btn-primary';
      investBtn.textContent = 'Invest Now';
      investBtn.style.flex = '1';

      buttons.appendChild(cancelBtn);
      buttons.appendChild(investBtn);
      form.appendChild(amountGroup);
      form.appendChild(balanceInfo);
      form.appendChild(buttons);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = parseFloat(amountInput.value);
        
        if (window.Validation && typeof Validation.investmentAmount === 'function') {
          const validation = Validation.investmentAmount(amount, strategy, availableBalance);
          if (!validation.isValid) {
            errorMsg.textContent = validation.error;
            errorMsg.style.display = 'block';
            amountInput.classList.add('error');
            return;
          }
        }

        await close();
        resolve({
          strategy_id: strategy.id,
          strategy_name: strategy.name,
          amount: amount,
          locked_until: new Date(Date.now() + strategy.lockPeriod * 24 * 60 * 60 * 1000).toISOString()
        });
      });

      amountInput.addEventListener('input', () => {
        errorMsg.style.display = 'none';
        amountInput.classList.remove('error');
      });

      content.appendChild(strategyInfo);
      content.appendChild(form);

      open({ title: 'New Investment', content: content, maxWidth: '500px', showCloseButton: true });
      setTimeout(() => amountInput.focus(), 100);
    });
  }

  // ============================================
  // EXPORT PUBLIC API
  // ============================================

  return {
    open,
    close,
    isOpen,
    confirm,
    alert,
    showInvestmentModal
  };
})();

if (typeof window !== 'undefined') {
  window.Modal = Modal;
}
