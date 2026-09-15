(async () => {
  // Supabase initialization is asynchronous and resilient to a failed CDN.
  // Await its explicit readiness promise instead of racing it with a short poll.
  try {
    if (window.supabaseReady) {
      await window.supabaseReady;
    } else if (typeof window.initializeSupabase === 'function') {
      await window.initializeSupabase();
    }
  } catch (error) {
    console.error('❌ Supabase initialization failed:', error);
    const errText = document.getElementById('loaderText');
    if (errText) {
      errText.textContent = 'Connection unavailable';
      errText.style.color = '#ef4444';
    }
    return;
  }

  const waitFor = async (cond, t = 12000) => {
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
    console.error('❌ App dependencies failed to initialize in time');
    const errText = document.getElementById('loaderText');
    if (errText) {
      errText.textContent = 'App failed to start';
      errText.style.color = '#ef4444';
    }
    return;
  }

  try {
    await App.init();

    const bar = document.getElementById('loaderBar');
    if (bar) {
      bar.style.transition = 'width 0.25s ease';
      bar.style.width = '100%';
    }

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
    // Auth redirects and application errors are handled by App.init().
  }
})();
