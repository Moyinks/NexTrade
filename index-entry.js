(async () => {// 1. Wait for Dependencies
      const waitFor = async (cond, t = 6000) => {
        const s = Date.now();
        while (!cond()) {
          if (Date.now() - s > t) return false;
          await new Promise(r => setTimeout(r, 50));
        }
        return true;
      };

      const ok = await waitFor(() =>
        window.supabaseClient &&
        window.Bootstraps &&
        window.App &&
        typeof App.init === 'function'
      );

      if (!ok) {
        console.error('❌ App failed to initialize in time');
        const errText = document.getElementById('loaderText');
        if (errText) { errText.textContent = 'Connection error'; errText.style.color = '#ef4444'; }
        return;
      }

      // 2. Initialize App (calls Bootstraps.init() internally at step 1)
      try {
        await App.init();

        // 3. Complete progress bar then dismiss
        const bar = document.getElementById('loaderBar');
        if (bar) { bar.style.transition = 'width 0.25s ease'; bar.style.width = '100%'; }

        setTimeout(() => {
          const screen = document.getElementById('loading-screen');
          if (screen) {
            screen.classList.add('hidden');
            setTimeout(() => screen.remove(), 500);
          }
        }, 350);

        console.log('NexTrade Ready');
      } catch (err) {
        console.error('Init Error:', err);
        // Auth errors handled internally — app redirects to login
      }
    })();
    window.addEventListener('beforeunload', () => {
  if (window.API) API.unsubscribeTicker();
  if (window.CacheManager) CacheManager.stopBackgroundChecker();
});

