/* ── SERVICE WORKER ─────────────────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) {
              w.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch(err => console.warn('[SW]', err));
  });
  // NOTE: intentionally no controllerchange → reload here.
  // Triggering location.reload() from controllerchange fires while the user
  // is already scrolling the landing, causing the visible scroll-jump.
  // index.html handles its own SW-update reload independently.
}

/* ── PWA INSTALL ────────────────────────────────────────────────────────── */
const PWA_DISMISSED_KEY = 'nextrade_pwa_dismissed';
let androidInstallEvent = null;

function shouldShowBanner() {
  if (window.matchMedia('(display-mode: standalone)').matches) return false;
  if (window.navigator.standalone === true) return false;
  const ts = localStorage.getItem(PWA_DISMISSED_KEY);
  if (ts && (Date.now() - Number(ts)) / 86400000 < 7) return false;
  return true;
}

function dismissPWABanner() {
  localStorage.setItem(PWA_DISMISSED_KEY, String(Date.now()));
  const ios = document.getElementById('pwa-ios-banner');
  const and = document.getElementById('pwa-android-banner');
  if (ios) ios.classList.remove('show');
  if (and) and.style.display = 'none';
}
window.dismissPWABanner = dismissPWABanner;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  androidInstallEvent = e;
  if (!shouldShowBanner()) return;
  setTimeout(() => {
    const b = document.getElementById('pwa-android-banner');
    if (b) b.style.display = 'flex';
  }, 2800);
});

window.triggerAndroidInstall = async () => {
  if (!androidInstallEvent) return;
  dismissPWABanner();
  androidInstallEvent.prompt();
  const { outcome } = await androidInstallEvent.userChoice;
  androidInstallEvent = null;
};

window.addEventListener('appinstalled', () => { dismissPWABanner(); androidInstallEvent = null; });

function isIosSafari() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/crios|fxios|opios|mercury/i.test(ua);
}
if (isIosSafari() && shouldShowBanner()) {
  setTimeout(() => {
    const b = document.getElementById('pwa-ios-banner');
    if (b) b.classList.add('show');
  }, 2800);
}

/* ── LIVE TICKER ────────────────────────────────────────────────────────── */
const TICKERS = [
  { sym: 'BTC',  price: 67842.50, chg: +2.14 },
  { sym: 'ETH',  price:  3521.80, chg: +1.32 },
  { sym: 'SOL',  price:   168.42, chg: +3.81 },
  { sym: 'BNB',  price:   584.10, chg: +0.87 },
  { sym: 'XRP',  price:    0.6218, chg: -0.43 },
  { sym: 'ADA',  price:    0.4512, chg: +0.72 },
  { sym: 'AVAX', price:    38.75, chg: +2.21 },
  { sym: 'DOGE', price:    0.1642, chg: +1.95 },
  { sym: 'LINK', price:    14.87, chg: +0.64 },
  { sym: 'DOT',  price:     7.14, chg: -1.08 },
  { sym: 'UNI',  price:     9.34, chg: +1.23 },
  { sym: 'MATIC',price:    0.8812, chg: -0.54 },
];

function fmtP(p) {
  return p < 1 ? p.toFixed(4) : p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildTicker() {
  const el = document.getElementById('tickerEl');
  if (!el) return;
  // Double the list so the seamless loop has content to scroll into.
  const items = [...TICKERS, ...TICKERS];
  el.innerHTML = items.map((t, i) => `
    <div class="t-item">
      <span class="t-sym">${t.sym}/USDT</span>
      <span class="t-price" data-i="${i % TICKERS.length}">${fmtP(t.price)}</span>
      <span class="${t.chg >= 0 ? 't-up' : 't-dn'} t-chg" data-i="${i % TICKERS.length}">${t.chg >= 0 ? '+' : ''}${t.chg.toFixed(2)}%</span>
    </div>`).join('');

  // Calibrate scroll speed to actual rendered content width so the ticker
  // reads at ~80px/s regardless of screen width. Must run after paint so
  // scrollWidth reflects real layout.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const totalW = el.scrollWidth; // full doubled content
      const halfW  = totalW / 2;     // one loop cycle width
      const PX_PER_SECOND = 80;
      const duration = Math.round(halfW / PX_PER_SECOND);
      el.style.animationDuration = Math.max(duration, 12) + 's';
    });
  });
}
buildTicker();

// Update prices in-place — never touch innerHTML or animationDuration again.
// Querying existing spans avoids any animation reset on iOS WebKit.
setInterval(() => {
  TICKERS.forEach((t, i) => {
    t.price *= 1 + (Math.random() - 0.5) * 0.004;
    t.chg = parseFloat((t.chg + (Math.random() - 0.5) * 0.09).toFixed(2));
  });

  const el = document.getElementById('tickerEl');
  if (!el) return;

  el.querySelectorAll('.t-price').forEach(span => {
    const i = parseInt(span.dataset.i, 10);
    span.textContent = fmtP(TICKERS[i].price);
  });
  el.querySelectorAll('.t-chg').forEach(span => {
    const i = parseInt(span.dataset.i, 10);
    const t = TICKERS[i];
    span.className = (t.chg >= 0 ? 't-up' : 't-dn') + ' t-chg';
    span.textContent = (t.chg >= 0 ? '+' : '') + t.chg.toFixed(2) + '%';
  });
}, 3500);

/* ── DATE ───────────────────────────────────────────────────────────────── */
(function () {
  const el = document.getElementById('dateEl');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  }).toUpperCase();
})();

/* ── SCROLL REVEAL ──────────────────────────────────────────────────────── */
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); revealObserver.unobserve(e.target); }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

/* ── FEE BAR ANIMATION ──────────────────────────────────────────────────── */
const barObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      const bar = e.target.querySelector('.fee-bar-you');
      if (bar) { setTimeout(() => { bar.style.width = bar.dataset.width; }, 300); }
      barObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.3 });
const feeSection = document.querySelector('.fee-split');
if (feeSection) barObserver.observe(feeSection);


/* CSP-safe action delegation for login/landing controls. */
(function wireLoginActions() {
  const actions = {
    'dismiss-pwa': () => dismissPWABanner(),
    'install-pwa': () => window.triggerAndroidInstall(),
    'enter-auth': (el) => enterAuth(el.dataset.mode),
    'reset-view': () => resetView(),
    'toggle-pw': (el) => togglePw(el.dataset.target, el),
    'open-legal': () => openLegal(),
    'forgot-password': () => handleForgotPassword(),
    'resend-otp': () => handleResendOtp(),
    'show-login': () => window.showLogin(),
    'show-signup': () => window.showSignup(),
    'resend-reset-otp': () => handleResendResetOtp(),
    'handle-action': () => handleAction(),
    'confirm-legal': () => confirmLegal()
  };
  function invoke(target) {
    const el = target && target.closest ? target.closest('[data-login-action]') : null;
    if (!el) return false;
    const fn = actions[el.dataset.loginAction];
    if (!fn) return false;
    fn(el);
    return true;
  }
  document.addEventListener('click', (event) => { invoke(event.target); });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const el = event.target && event.target.closest ? event.target.closest('[data-login-action][role="button"]') : null;
    if (!el) return;
    event.preventDefault();
    invoke(el);
  });
  const iosImg = document.getElementById('login-pwa-ios-img');
  if (iosImg) iosImg.addEventListener('error', () => {
    iosImg.style.display = 'none';
    if (iosImg.nextElementSibling) iosImg.nextElementSibling.style.display = 'flex';
  });
})();
