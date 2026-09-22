const ThemeManager = (() => {
  'use strict';
  const VALID = new Set(['dark', 'light', 'system']);
  function preferred() {
    return window.Preferences && Preferences.getThemePreference
      ? (Preferences.getThemePreference() || 'dark')
      : 'dark';
  }
  function resolve(preference) {
    const choice = VALID.has(preference) ? preference : 'dark';
    if (choice !== 'system') return choice;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function updateBrowserChrome() {
    const color = getComputedStyle(document.documentElement).getPropertyValue('--color-background').trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && color) meta.setAttribute('content', color);
  }
  function apply(preference, options = {}) {
    const choice = VALID.has(preference) ? preference : 'dark';
    const resolved = resolve(choice);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = choice;
    if (options.animate !== false) {
      document.documentElement.classList.add('theme-switching');
      window.setTimeout(() => document.documentElement.classList.remove('theme-switching'), 260);
    }
    requestAnimationFrame(updateBrowserChrome);
    window.dispatchEvent(new CustomEvent('nextrade:themechange', { detail: { preference: choice, resolved } }));
    return resolved;
  }
  function setPreference(preference, options = {}) {
    if (!VALID.has(preference)) throw new Error('Invalid theme preference');
    if (window.Preferences && Preferences.setThemePreference) Preferences.setThemePreference(preference);
    const resolved = apply(preference, options);
    if (window.ExperienceOrchestrator && ExperienceOrchestrator.onThemeChosen) ExperienceOrchestrator.onThemeChosen(preference);
    return resolved;
  }
  function getPreference() { return preferred(); }
  function getResolved() { return document.documentElement.dataset.theme || resolve(preferred()); }
  function hasExplicitPreference() {
    return Boolean(window.Preferences && Preferences.hasExplicitThemePreference && Preferences.hasExplicitThemePreference());
  }
  function bindSystem() {
    if (!window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const listener = () => { if (preferred() === 'system') apply('system', { animate: true }); };
    if (media.addEventListener) media.addEventListener('change', listener);
    else if (media.addListener) media.addListener(listener);
  }
  apply(preferred(), { animate: false });
  bindSystem();
  return Object.freeze({ setPreference, getPreference, getResolved, hasExplicitPreference, apply });
})();
if (typeof window !== 'undefined') window.ThemeManager = ThemeManager;
