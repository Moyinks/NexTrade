const Settings = (() => {
  'use strict';
  let container = null;
  let returnRoute = 'home';
  const OPTIONS = Object.freeze([
    { id: 'dark', title: 'Dark', copy: 'Institutional Obsidian. NexTrade’s first-entry default.' },
    { id: 'light', title: 'Light', copy: 'A calmer financial workspace with the landing’s visual ancestry.' },
    { id: 'system', title: 'System', copy: 'Follow your device after you have explicitly chosen to do so.' }
  ]);
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function back() {
    if (window.App && typeof App.back === 'function') {
      App.back('home');
      return;
    }
    if (window.App && App.navigate) App.navigate(returnRoute || 'home');
  }
  function open() {
    const current = window.Router && Router.getCurrentPage ? Router.getCurrentPage() : null;
    if (current && current !== 'settings') returnRoute = current;
    if (window.App && App.navigate) App.navigate('settings');
  }
  function refreshSelection(host) {
    const selected = window.ThemeManager ? ThemeManager.getPreference() : 'dark';
    host.querySelectorAll('.theme-choice').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === selected));
    });
  }
  function render(target) {
    container = target;
    if (!container) return;
    container.innerHTML = '';
    const page = node('section', 'settings-page');
    const backButton = node('button', 'btn btn-ghost btn-sm settings-back', 'Back');
    backButton.type = 'button';
    const backIcon = node('i');
    backIcon.className = 'fas fa-arrow-left';
    backButton.prepend(backIcon);
    backButton.addEventListener('click', back);
    const heading = node('div', 'settings-heading');
    heading.append(node('div', 'settings-eyebrow', 'Workspace'));
    heading.append(node('h1', 'settings-title', 'Settings'));
    heading.append(node('p', 'settings-copy', 'Personal preferences change presentation, never financial meaning or ledger behaviour.'));
    const section = node('section', 'settings-section');
    section.append(node('div', 'settings-section__label', 'Appearance'));
    section.append(node('div', 'settings-section__sub', 'Dark is the intentional first-entry experience. Your explicit choice is remembered on this device.'));
    const grid = node('div', 'theme-choice-grid');
    OPTIONS.forEach(option => {
      const button = node('button', 'theme-choice');
      button.type = 'button';
      button.dataset.themeChoice = option.id;
      const preview = node('span', 'theme-choice__preview');
      preview.dataset.preview = option.id;
      const body = node('span');
      body.append(node('span', 'theme-choice__title', option.title));
      body.append(node('span', 'theme-choice__copy', option.copy));
      const check = node('span', 'theme-choice__check');
      const icon = node('i');
      icon.className = 'fas fa-check';
      check.appendChild(icon);
      button.append(preview, body, check);
      button.addEventListener('click', () => {
        if (!window.ThemeManager) return;
        ThemeManager.setPreference(option.id);
        refreshSelection(grid);
      });
      grid.appendChild(button);
    });
    section.appendChild(grid);
    section.append(node('div', 'settings-principle', 'Different surfaces may have different personalities. They must not have different laws.'));
    page.append(backButton, heading, section);
    container.appendChild(page);
    refreshSelection(grid);
  }
  function cleanup() { container = null; }
  return Object.freeze({ open, back, render, cleanup });
})();
if (typeof window !== 'undefined') window.Settings = Settings;
