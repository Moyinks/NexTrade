// safe-dom.js
// Small encoding helpers for the few UI paths that intentionally use HTML
// templates. Prefer textContent/createElement; use these when interpolation is
// unavoidable.
(function () {
  'use strict';

  function text(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function httpsUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:') return '';
      return text(url.href);
    } catch (_) {
      return '';
    }
  }

  function cssClassToken(value) {
    const token = String(value || '');
    return /^[A-Za-z0-9_-]+$/.test(token) ? token : '';
  }

  window.SafeDOM = Object.freeze({ text, httpsUrl, cssClassToken });
})();
