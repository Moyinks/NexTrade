if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((reg) => {
          console.log('[PWA] Service worker registered. Scope:', reg.scope);

          // When a new SW is found, activate it immediately
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New content available — reload silently so user always has latest
                console.log('[PWA] New version available — activating.');
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
        })
        .catch((err) => console.warn('[PWA] Service worker registration failed:', err));
    });

    // When a new SW takes over, reload the page once
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }
  

  const PWA_DISMISSED_KEY = 'nextrade_pwa_dismissed';
  let androidInstallEvent = null;

  // Don't show banners if already installed or dismissed in last 7 days
  function shouldShowBanner() {
    if (window.matchMedia('(display-mode: standalone)').matches) return false;
    if (window.navigator.standalone === true) return false; // iOS standalone
    const dismissed = localStorage.getItem(PWA_DISMISSED_KEY);
    if (dismissed) {
      const daysSince = (Date.now() - Number(dismissed)) / 86400000;
      if (daysSince < 7) return false; // Re-ask after 7 days
    }
    return true;
  }

  function dismissPWABanner() {
    localStorage.setItem(PWA_DISMISSED_KEY, String(Date.now()));
    const ios     = document.getElementById('pwa-ios-banner');
    const android = document.getElementById('pwa-android-banner');
    if (ios)     { ios.classList.remove('show'); }
    if (android) { android.style.display = 'none'; }
  }

  // Expose for the delegated install controls and any future module integration
  window.dismissPWABanner = dismissPWABanner;

  // ── ANDROID / CHROME ────────────────────────────────────────────────────
  // beforeinstallprompt fires when Chrome decides the app is installable.
  // We capture it so we can trigger it on our own button instead of the browser mini-bar.

  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the default mini-infobar from Chrome (we show our own)
    e.preventDefault();
    androidInstallEvent = e;

    if (!shouldShowBanner()) return;

    // Show our custom Android banner after a short delay (user has had a moment to see the page)
    setTimeout(() => {
      const banner = document.getElementById('pwa-android-banner');
      if (banner) banner.style.display = 'flex';
    }, 2500);
  });

  window.triggerAndroidInstall = async () => {
    if (!androidInstallEvent) return;
    dismissPWABanner();
    androidInstallEvent.prompt();
    const { outcome } = await androidInstallEvent.userChoice;
    console.log('[PWA] Install outcome:', outcome);
    androidInstallEvent = null;
  };

  // Clean up after install — hide banner if they installed from elsewhere
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App installed.');
    dismissPWABanner();
    androidInstallEvent = null;
  });


  // ── iOS / SAFARI ────────────────────────────────────────────────────────
  // Safari never fires beforeinstallprompt.
  // We detect iOS Safari explicitly and show our custom instruction banner.

  function isIosSafari() {
    const ua  = window.navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua);
    // Check it's Safari and NOT a webview (Chrome on iOS, Firefox on iOS etc.)
    const safari = /safari/i.test(ua) && !/crios|fxios|opios|mercury/i.test(ua);
    return ios && safari;
  }

  if (isIosSafari() && shouldShowBanner()) {
    // Wait 2.5 seconds so user can see the page first
    setTimeout(() => {
      const banner = document.getElementById('pwa-ios-banner');
      if (banner) banner.classList.add('show');
    }, 2500);
  }


// CSP-safe event wiring: no inline handlers in index.html.
const iosCloseButton = document.getElementById('pwa-ios-close');
const androidInstallButton = document.getElementById('pwa-android-install');
const androidCloseButton = document.getElementById('pwa-android-close');
const iosIconImage = document.getElementById('pwa-ios-icon-img');
const loaderBrandImage = document.getElementById('loader-brand-img');
if (iosCloseButton) iosCloseButton.addEventListener('click', dismissPWABanner);
if (androidInstallButton) androidInstallButton.addEventListener('click', () => window.triggerAndroidInstall());
if (androidCloseButton) androidCloseButton.addEventListener('click', dismissPWABanner);
if (iosIconImage) iosIconImage.addEventListener('error', () => { iosIconImage.style.display = 'none'; });
if (loaderBrandImage) loaderBrandImage.addEventListener('error', () => {
  loaderBrandImage.classList.add('errored');
  loaderBrandImage.style.display = 'none';
});
