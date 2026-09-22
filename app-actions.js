/** NexTrade — CSP-safe delegated UI actions. */
(function () {
  'use strict';
  const actions = Object.freeze({
    'market-refresh': () => window.Market && window.Market.refresh(),
    'market-refresh-trending': () => window.Market && window.Market.refreshTrending(),
    'navbar-review-queue': () => window.Navbar && window.Navbar.handleReviewQueue(),
    'navbar-settings': () => window.Navbar && window.Navbar.handleSettings(),
    'navbar-help': () => window.Navbar && window.Navbar.handleHelp(),
    'navbar-signout': () => window.Navbar && window.Navbar.handleSignOut(),
    'router-home': () => window.Router && window.Router.navigate('home'),
    'wallet-activity': () => window.Wallet && window.Wallet.switchToActivity(),
    'modal-close': () => window.Modal && window.Modal.close()
  });

  document.addEventListener('click', (event) => {
    const el = event.target && event.target.closest ? event.target.closest('[data-app-action]') : null;
    if (!el) return;
    const fn = actions[el.dataset.appAction];
    if (typeof fn !== 'function') return;
    event.preventDefault();
    fn();
  });
})();
