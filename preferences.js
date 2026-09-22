const Preferences = (() => {
  'use strict';
  const THEME_KEY = 'theme_preference';
  const EXPERIENCE_KEY = 'experience_state';
  const VALID_THEMES = new Set(['dark', 'light', 'system']);
  const read = (key, fallback) => window.Storage && Storage.get ? Storage.get(key, fallback) : fallback;
  const write = (key, value) => window.Storage && Storage.set ? Storage.set(key, value) : false;
  const has = key => Boolean(window.Storage && Storage.has && Storage.has(key));
  function getThemePreference() {
    const value = read(THEME_KEY, null);
    return VALID_THEMES.has(value) ? value : null;
  }
  function hasExplicitThemePreference() {
    return has(THEME_KEY) && Boolean(getThemePreference());
  }
  function setThemePreference(value) {
    if (!VALID_THEMES.has(value)) throw new Error('Invalid theme preference');
    return write(THEME_KEY, value);
  }
  function getExperienceState() {
    const value = read(EXPERIENCE_KEY, {});
    if (!value || typeof value !== 'object') return {};
    return {
      themeHintShows: Number.isFinite(Number(value.themeHintShows)) ? Number(value.themeHintShows) : 0,
      themeHintRetired: value.themeHintRetired === true,
      themeHintAccepted: value.themeHintAccepted === true,
      firstReadyAt: Number.isFinite(Number(value.firstReadyAt)) ? Number(value.firstReadyAt) : null
    };
  }
  function updateExperienceState(patch) {
    const next = { ...getExperienceState(), ...(patch || {}) };
    write(EXPERIENCE_KEY, next);
    return next;
  }
  return Object.freeze({
    getThemePreference,
    hasExplicitThemePreference,
    setThemePreference,
    getExperienceState,
    updateExperienceState
  });
})();
if (typeof window !== 'undefined') window.Preferences = Preferences;
