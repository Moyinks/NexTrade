const ExperienceOrchestrator = (() => {
  'use strict';
  const PRIMARY_ROUTES = new Set(['home', 'market', 'vault', 'wallet']);
  const state = {
    readyAt: null,
    currentRoute: null,
    navigationCount: 0,
    installEligible: false,
    installVisible: false,
    installCooldownUntil: 0,
    timer: null,
    promptTimer: null,
    prompt: null,
    themeShownThisSession: false
  };
  const experienceState = () => window.Preferences && Preferences.getExperienceState ? Preferences.getExperienceState() : {};
  const updateExperience = patch => window.Preferences && Preferences.updateExperienceState ? Preferences.updateExperienceState(patch) : {};
  function clearTimer() { if (state.timer) { clearTimeout(state.timer); state.timer = null; } }
  function removePrompt() {
    if (state.promptTimer) { clearTimeout(state.promptTimer); state.promptTimer = null; }
    if (state.prompt) { state.prompt.remove(); state.prompt = null; }
  }
  function activeBlockingUI() {
    return document.body.classList.contains('route-immersive') || Boolean(document.querySelector('.ntm-overlay.ntm-open'));
  }
  function themeEligible() {
    if (!window.ThemeManager || ThemeManager.hasExplicitPreference()) return false;
    if (state.themeHintShownThisSession) return false;
    const x = experienceState();
    if (x.themeHintRetired || x.themeHintAccepted || Number(x.themeHintShows || 0) >= 2) return false;
    if (!PRIMARY_ROUTES.has(state.currentRoute)) return false;
    if (state.installEligible || state.installVisible || Date.now() < state.installCooldownUntil) return false;
    if (activeBlockingUI() || !state.readyAt) return false;
    return state.navigationCount >= 2 || (Date.now() - state.readyAt) >= 12000;
  }
  function retireThemeHint(accepted) {
    const previous = experienceState();
    updateExperience({
      themeHintShows: Number(previous.themeHintShows || 0) + 1,
      themeHintRetired: true,
      themeHintAccepted: accepted === true
    });
    removePrompt();
  }
  function ignoreThemeHint() {
    const previous = experienceState();
    const shows = Number(previous.themeHintShows || 0) + 1;
    updateExperience({ themeHintShows: shows, themeHintRetired: shows >= 2 });
    removePrompt();
  }
  function buildThemePrompt() {
    const wrap = document.createElement('aside');
    wrap.className = 'experience-prompt';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    const icon = document.createElement('div');
    icon.className = 'experience-prompt__icon';
    const glyph = document.createElement('i');
    glyph.className = 'fas fa-circle-half-stroke';
    icon.appendChild(glyph);
    const body = document.createElement('div');
    body.className = 'experience-prompt__body';
    const title = document.createElement('div');
    title.className = 'experience-prompt__title';
    title.textContent = 'Prefer a lighter workspace?';
    const copy = document.createElement('div');
    copy.className = 'experience-prompt__copy';
    copy.textContent = 'Light keeps the landing’s calmer visual language while preserving the same financial workspace.';
    body.append(title, copy);
    const actions = document.createElement('div');
    actions.className = 'experience-prompt__actions';
    const light = document.createElement('button');
    light.type = 'button';
    light.className = 'experience-prompt__primary';
    light.textContent = 'Try Light';
    light.addEventListener('click', () => {
      ThemeManager.setPreference('light');
      retireThemeHint(true);
      if (window.App) App.showSuccess('Light workspace enabled');
    });
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'experience-prompt__secondary';
    keep.textContent = 'Keep Dark';
    keep.addEventListener('click', () => { ThemeManager.setPreference('dark'); retireThemeHint(false); });
    actions.append(light, keep);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'experience-prompt__close';
    close.setAttribute('aria-label', 'Dismiss theme suggestion');
    const closeIcon = document.createElement('i');
    closeIcon.className = 'fas fa-xmark';
    close.appendChild(closeIcon);
    close.addEventListener('click', () => retireThemeHint(false));
    wrap.append(icon, body, actions, close);
    return wrap;
  }
  function showThemeHint() {
    if (!themeEligible() || state.prompt) return;
    state.themeShownThisSession = true;
    state.themeHintShownThisSession = true;
    state.prompt = buildThemePrompt();
    document.body.appendChild(state.prompt);
    requestAnimationFrame(() => { if (state.prompt) state.prompt.classList.add('is-visible'); });
    state.promptTimer = window.setTimeout(() => { if (state.prompt) ignoreThemeHint(); }, 9000);
  }
  function schedule() {
    clearTimer();
    if (!state.readyAt) return;
    const elapsed = Date.now() - state.readyAt;
    const remaining = state.navigationCount >= 2 ? 700 : Math.max(700, 12000 - elapsed);
    state.timer = window.setTimeout(() => {
      state.timer = null;
      if (themeEligible()) showThemeHint();
    }, remaining);
  }
  function markAppReady(route) {
    state.readyAt = Date.now();
    state.currentRoute = route || state.currentRoute;
    const previous = experienceState();
    if (!previous.firstReadyAt) updateExperience({ firstReadyAt: state.readyAt });
    schedule();
  }
  function noteNavigation(route) {
    state.currentRoute = route;
    state.navigationCount += 1;
    if (state.prompt && !PRIMARY_ROUTES.has(route)) removePrompt();
    schedule();
  }
  function setInstallState(patch) {
    const next = patch || {};
    if ('eligible' in next) state.installEligible = Boolean(next.eligible);
    if ('visible' in next) state.installVisible = Boolean(next.visible);
    if (next.visible) removePrompt();
    if (next.dismissed) state.installCooldownUntil = Date.now() + 45000;
    if (next.installed) {
      state.installEligible = false;
      state.installVisible = false;
      state.installCooldownUntil = Date.now() + 8000;
    }
    schedule();
  }
  function onThemeChosen() { removePrompt(); }
  return Object.freeze({ markAppReady, noteNavigation, setInstallState, onThemeChosen });
})();
if (typeof window !== 'undefined') window.ExperienceOrchestrator = ExperienceOrchestrator;
