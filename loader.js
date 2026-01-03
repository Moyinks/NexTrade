/**
 * Simple Loader Module
 */
const Loader = (() => {
  let loaderEl = null;

  function create() {
    loaderEl = document.createElement('div');
    loaderEl.id = 'loader';
    loaderEl.style.position = 'fixed';
    loaderEl.style.top = 0;
    loaderEl.style.left = 0;
    loaderEl.style.width = '100%';
    loaderEl.style.height = '100%';
    loaderEl.style.background = 'rgba(0,0,0,0.5)';
    loaderEl.style.display = 'flex';
    loaderEl.style.alignItems = 'center';
    loaderEl.style.justifyContent = 'center';
    loaderEl.style.zIndex = 9999;
    loaderEl.innerHTML = `<div style="border: 6px solid #f3f3f3; border-top: 6px solid #2563eb; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite;"></div>`;

    document.body.appendChild(loaderEl);

    // Spinner animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    hide();
  }

  function show() {
    if (!loaderEl) create();
    loaderEl.style.display = 'flex';
  }

  function hide() {
    if (loaderEl) loaderEl.style.display = 'none';
  }

  return { show, hide };
})();

window.Loader = Loader;