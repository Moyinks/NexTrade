(function () {
  'use strict';
  const KEY = 'nextrade_theme_preference';
  const VALID = new Set(['dark', 'light', 'system']);
  let preference = 'dark';
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (VALID.has(parsed)) preference = parsed;
    }
  } catch (_) {
    preference = 'dark';
  }
  const resolved = preference === 'system'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
})();
