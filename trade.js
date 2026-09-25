/**
 * NexTrade — Trade & Transaction Engine v2.4
 * ══════════════════════════════════════════════════════════════════════════════
 * CHANGES (v2.3 → v2.4):
 * 15. KYC gate added to openWithdraw(). Checks profiles.kyc_status before
 *     allowing withdrawal flow. 'none' → shows KYC submission screen.
 *     'pending' → shows under-review screen. 'rejected' → resubmit screen.
 *     'approved' → proceeds normally. Gate is async, function now async.
 *
 * CHANGES (v2.2 → v2.3):
 * 12. HD wallet deposit addresses — ETH/ERC-20 now calls the Vercel serverless
 *     function /api/generate-address (api/generate-address.js) to obtain a
 *     fresh child address derived from HD_WALLET_XPUB on every deposit request.
 *     Every address is unique per transaction and all funds arrive in the same
 *     master wallet. BTC and TRC-20 remain static (configurable via build.sh).
 *     Falls back to showing an error if the API is unavailable rather than
 *     showing a placeholder or stale address.
 *
 * 13. Deposit addresses moved to APP_CONFIG.depositAddresses (config.js) so
 *     BTC and TRC-20 values are injected at build time via build.sh rather than
 *     being hardcoded in this file.
 *
 * 14. realDeposit flag check updated — now also reads APP_CONFIG.features.hdWallet
 *     to guard the HD wallet API call path separately from the static fallback.
 *
 * FIXES (v2.1 → v2.2, carried forward):
 * 10. Optimistic UI for sell/buy.
 * 11. Double-trigger prevention (_isTradingLocked).
 *
 * FIXES (v2.0 → v2.1, carried forward):
 * 6–9. Deposit gating, pending withdrawals, fatal ledger errors,
 *      transfer type registration.
 *
 * FIXES (v1 → v2.0, carried forward):
 * 1–5. Stripe removal, deposit reference, ledger-first writes,
 *      double-spend guard, placeholder address detection.
 */

const Trade = (() => {
  'use strict';

  // ============================================
  // MODULE-LEVEL PROCESSING LOCK
  // ============================================
  let _isTradingLocked = false;

  // ============================================
  // PLACEHOLDER GUARD (for static BTC / TRC20 addresses)
  // ============================================
  const PLACEHOLDER_PATTERNS = [
    '%%', 'YourEth', 'yourBitcoin', 'yourTron',
    'YourERC', 'YourTRC', 'AddressHere', 'YourAddress'
  ];

  function isPlaceholder(address) {
    return !address || PLACEHOLDER_PATTERNS.some(p => address.includes(p));
  }

  // ============================================
  // LEDGER DERIVATION — delegate to app.js
  // ============================================
  async function deriveSpotBalance(userId) {
    if (window.App && typeof App.deriveSpotBalance === 'function') {
      return App.deriveSpotBalance(userId);
    }
    throw new Error('Balance authority unavailable');
  }

  // ============================================
  // HELPERS
  // ============================================
  function getUserState() {
    if (!window.AppState) return { user: null, balances: { spot: 0 }, holdings: {} };
    return {
      user:     AppState.get('user'),
      balances: AppState.get('balances') || { spot: 0 },
      holdings: AppState.get('holdings') || {}
    };
  }

  function validateAmount(val, max) {
    const num = Number(val);
    const cap = Number((window.APP_CONFIG && APP_CONFIG.defaults && APP_CONFIG.defaults.maxTransaction) || 1e9);
    if (!Number.isFinite(num) || num <= 0 || num > cap) return { valid: false, msg: 'Enter a valid amount' };
    if (max !== undefined && num > Number(max)) return { valid: false, msg: 'Insufficient balance' };
    return { valid: true, num };
  }

  function getIdempotencyKey(kind, fingerprint) {
    if (!window.RequestId) throw new Error('Secure request identifier unavailable');
    return RequestId.get(kind, fingerprint);
  }

  function generateDepositReference(userId) {
    const prefix = userId ? userId.slice(0, 8).toUpperCase() : 'ANON';
    const ts     = Date.now().toString(36).toUpperCase();
    return 'NXT-' + prefix + '-' + ts;
  }

  // ============================================
  // 1. DEPOSIT FLOW
  // ============================================

  function openDeposit() {
    if (window.App && typeof App.navigate === 'function') {
      App.navigate('deposit');
      return;
    }
    if (window.Router && typeof Router.navigate === 'function') {
      Router.navigate('deposit');
      return;
    }
    if (window.App) App.showError('Deposit page unavailable');
  }

  // ============================================
  // 2. WITHDRAW FLOW — LEDGER-FIRST
  // ============================================

  async function openWithdraw() {
    const { balances, user } = getUserState();

    if (!user || !user.id) {
      if (window.App) App.showError('User session not found. Please refresh.');
      return;
    }

    // ── KYC gate — required before first withdrawal ──────────────────────
    if (window.KYC) {
      const kycPassed = await KYC.gate(user.id);
      if (!kycPassed) return; // KYC screen shown instead
    }

    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;gap:16px;';

    const balRow = document.createElement('div');
    balRow.style.cssText = 'background:var(--color-surface-elevated);padding:16px;border-radius:12px;border:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;';
    const balLabel = document.createElement('span');
    balLabel.style.cssText = 'font-size:13px;color:var(--color-text-secondary);';
    balLabel.textContent = 'Available Balance';
    const balValue = document.createElement('span');
    balValue.style.cssText = 'font-size:18px;font-weight:700;color:var(--color-text-primary);font-family:var(--font-mono);';
    balValue.textContent = window.Format ? Format.currency(balances.spot) : '$' + (balances.spot || 0).toFixed(2);
    balRow.appendChild(balLabel); balRow.appendChild(balValue);
    content.appendChild(balRow);

    const addrGroup = document.createElement('div');
    addrGroup.className = 'input-group';
    const addrLabel = document.createElement('label');
    addrLabel.className   = 'input-label';
    addrLabel.textContent = 'Destination Address (USDT/ERC20)';
    const addrInput = document.createElement('input');
    addrInput.type        = 'text';
    addrInput.id          = 'wd-addr';
    addrInput.className   = 'input-field';
    addrInput.placeholder = 'Paste wallet address';
    addrGroup.appendChild(addrLabel); addrGroup.appendChild(addrInput);
    content.appendChild(addrGroup);

    const amtGroup = document.createElement('div');
    amtGroup.className = 'input-group';
    const amtLabel = document.createElement('label');
    amtLabel.className   = 'input-label';
    amtLabel.textContent = 'Amount to Withdraw (USD)';
    const amtInput = document.createElement('input');
    amtInput.type        = 'number';
    amtInput.id          = 'wd-amount';
    amtInput.className   = 'input-field financial-data';
    amtInput.placeholder = '0.00';
    amtGroup.appendChild(amtLabel); amtGroup.appendChild(amtInput);
    content.appendChild(amtGroup);

    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary btn-full';
    btn.style.cssText = 'border-color:var(--color-border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    btn.textContent = 'Request Withdrawal';
    content.appendChild(btn);

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const { valid, num, msg } = validateAmount(amtInput.value, balances.spot);
      if (!valid) { if (window.App) App.showError(msg); return; }

      const addr = addrInput.value.trim();
      if (window.Validation) {
        const addrValidation = Validation.walletAddress(addr, 'ETH');
        if (!addrValidation.isValid) { if (window.App) App.showError(addrValidation.error); return; }
      }

      // ── Withdrawal passphrase gate — final confirmation before submit ────
      // Runs after KYC (already passed to reach this modal) and after
      // amount/address are validated, before the request actually goes out.
      if (window.WithdrawalAuth) {
        const { user: gateUser } = getUserState();
        const authOk = await WithdrawalAuth.confirm(gateUser && gateUser.id);
        if (!authOk) return; // user cancelled — nothing submitted
        // WithdrawalAuth's own modal has just closed itself on success, which
        // (single-modal system) already replaced this withdraw form — so the
        // "Processing..." state below would otherwise update a detached
        // button no one can see. Show a lightweight processing modal instead.
        if (window.Modal) {
          const processing = document.createElement('div');
          processing.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px 0;';
          processing.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--color-primary);"></i>' +
            '<span style="font-size:13px;color:var(--color-text-secondary);">Processing withdrawal…</span>';
          Modal.open({ title: '', content: processing, maxWidth: '320px', hideTitle: true, dismissible: false });
        }
      } else {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>Processing...';
      }

      try {
        const { user: freshUser } = getUserState();
        if (!freshUser || !freshUser.id) throw new Error('User session lost');
        if (!window.supabaseClient) throw new Error('Secure withdrawal service unavailable');

        const freshSpot = await deriveSpotBalance(freshUser.id);
        if (num > freshSpot) throw new Error('Insufficient balance. Your balance changed before submission.');

        const withdrawFingerprint = `${num.toFixed(8)}|${addr.toLowerCase()}`;
        const withdrawKey = getIdempotencyKey('withdraw', withdrawFingerprint);
        const { data, error } = await window.supabaseClient.rpc('request_withdrawal', {
          p_amount: num,
          p_destination_address: addr,
          p_idempotency_key: withdrawKey
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row || !row.tx_id) throw new Error('Withdrawal authority returned an invalid response');
        RequestId.clear('withdraw', withdrawKey);

        if (window.AppState) {
          AppState.updateBalances({ spot: Number(row.spot_balance) });
          AppState.addTransaction({
            id: row.tx_id,
            type: 'withdraw',
            amount: num,
            status: 'pending',
            description: 'Withdraw to ' + addr.substring(0, 6) + '…',
            created_at: row.created_at || new Date().toISOString()
          });
        }

        if (window.Modal) Modal.close();
        if (window.App)   App.showSuccess('Withdrawal request submitted. Pending admin approval.');

      } catch (err) {
        console.error('[TRADE] Withdrawal failed:', err);
        if (window.Modal) Modal.close(); // closes the processing modal if the passphrase branch opened one; harmless no-op otherwise
        if (window.App) App.showError(err.message || 'Error processing withdrawal');
        btn.disabled  = false;
        btn.textContent = 'Request Withdrawal';
      }
    });

    if (window.Modal) Modal.open({ title: 'Withdraw Funds', content });
  }

  // ============================================
  // 3. SPOT TRADE — OPTIMISTIC UI + LEDGER-FIRST
  // ============================================


  async function openSpotTrade(coinInput, type) {
    if (_isTradingLocked) {
      if (window.App) App.showWarning('A trade is already being processed. Please wait.');
      return;
    }

    if (!coinInput) {
      if (window.App) App.showError('No market selected.');
      return;
    }

    let coin = coinInput;
    if (typeof coinInput === 'string') {
      const marketData = window.AppState ? AppState.get('marketData') : [];
      coin = Array.isArray(marketData)
        ? marketData.find((entry) => entry && entry.id === coinInput)
        : null;
      if (!coin) {
        if (window.App) App.showError('This market is not available yet. Refresh Market and try again.');
        return;
      }
    }

    if (!coin || !coin.id || !coin.symbol || !Number.isFinite(Number(coin.current_price)) || Number(coin.current_price) <= 0) {
      if (window.App) App.showError('A reliable quote is not available for this market yet.');
      return;
    }

    const { balances, holdings, user } = getUserState();
    if (!user || !user.id) {
      if (window.App) App.showError('Your session is no longer available. Sign in again.');
      return;
    }

    const isBuy = type === 'buy';
    const assetKey = String(coin.symbol).toLowerCase();
    const assetSymbol = String(coin.symbol).toUpperCase();
    const availableUsd = Number(balances.spot || 0);
    const availableAsset = Number(holdings[assetKey] || 0);
    let amountUnit = isBuy ? 'usd' : 'asset';
    let quotePrice = Number(coin.current_price);

    const content = document.createElement('div');
    content.className = 'trade-sheet';

    const head = document.createElement('div');
    head.className = 'trade-coin-head';

    const tradeCoinImageUrl = window.API && typeof API.proxiedCoinImageUrl === 'function'
      ? API.proxiedCoinImageUrl(coin.image)
      : '';
    if (tradeCoinImageUrl) {
      const img = document.createElement('img');
      img.className = 'trade-coin-head__image';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.remove(), { once: true });
      img.src = tradeCoinImageUrl;
      head.appendChild(img);
    }

    const headCopy = document.createElement('div');
    const headTitle = document.createElement('div');
    headTitle.className = 'trade-coin-head__title';
    headTitle.textContent = (isBuy ? 'Buy ' : 'Sell ') + coin.name;

    const headPrice = document.createElement('div');
    headPrice.className = 'trade-coin-head__price';
    headCopy.append(headTitle, headPrice);
    head.appendChild(headCopy);
    content.appendChild(head);

    const modeSwitch = document.createElement('div');
    modeSwitch.className = 'trade-mode-switch';
    modeSwitch.setAttribute('role', 'group');
    modeSwitch.setAttribute('aria-label', 'Amount denomination');

    const usdMode = document.createElement('button');
    usdMode.type = 'button';
    usdMode.dataset.unit = 'usd';
    usdMode.textContent = '$ USD';

    const assetMode = document.createElement('button');
    assetMode.type = 'button';
    assetMode.dataset.unit = 'asset';
    assetMode.textContent = assetSymbol;

    modeSwitch.append(usdMode, assetMode);
    content.appendChild(modeSwitch);

    const amountBlock = document.createElement('div');
    amountBlock.className = 'trade-amount-block';

    const amountLabel = document.createElement('label');
    amountLabel.className = 'trade-amount-label';
    amountLabel.htmlFor = 'trade-amt';
    amountLabel.textContent = 'Amount';

    const amountRow = document.createElement('div');
    amountRow.className = 'trade-amount-row';

    const tradeAmt = document.createElement('input');
    tradeAmt.type = 'text';
    tradeAmt.id = 'trade-amt';
    tradeAmt.className = 'trade-amount-input financial-data';
    tradeAmt.inputMode = 'decimal';
    tradeAmt.autocomplete = 'off';
    tradeAmt.spellcheck = false;
    tradeAmt.placeholder = '0.00';
    tradeAmt.setAttribute('aria-describedby', 'trade-estimate trade-validation');

    const unitLabel = document.createElement('span');
    unitLabel.className = 'trade-amount-unit';

    amountRow.append(tradeAmt, unitLabel);
    amountBlock.append(amountLabel, amountRow);
    content.appendChild(amountBlock);

    const balanceRow = document.createElement('div');
    balanceRow.className = 'trade-balance-row';

    const balanceCopy = document.createElement('div');
    balanceCopy.className = 'trade-balance-copy';

    const maxBtn = document.createElement('button');
    maxBtn.type = 'button';
    maxBtn.className = 'trade-max';
    maxBtn.textContent = 'MAX';

    balanceRow.append(balanceCopy, maxBtn);
    content.appendChild(balanceRow);

    const estimate = document.createElement('div');
    estimate.className = 'trade-estimate';
    estimate.id = 'trade-estimate';

    const estimateLabel = document.createElement('div');
    estimateLabel.className = 'trade-estimate__label';

    const estimateValue = document.createElement('div');
    estimateValue.className = 'trade-estimate__value';

    estimate.append(estimateLabel, estimateValue);
    content.appendChild(estimate);

    const quoteNote = document.createElement('div');
    quoteNote.className = 'trade-quote-note';
    quoteNote.textContent = 'Indicative market quote. NexTrade verifies the execution price again before changing the ledger.';
    content.appendChild(quoteNote);

    const validation = document.createElement('div');
    validation.className = 'trade-validation';
    validation.id = 'trade-validation';
    validation.setAttribute('aria-live', 'polite');
    content.appendChild(validation);

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn ' + (isBuy ? 'btn-success' : 'btn-danger') + ' btn-full trade-submit';
    confirmBtn.textContent = isBuy ? 'Review purchase' : 'Review sale';
    content.appendChild(confirmBtn);

    function latestQuote() {
      const stateData = window.AppState ? AppState.get('marketData') : [];
      if (Array.isArray(stateData)) {
        const latest = stateData.find((entry) => entry && entry.id === coin.id);
        const candidate = Number(latest && latest.current_price);
        if (Number.isFinite(candidate) && candidate > 0) quotePrice = candidate;
      }
      return quotePrice;
    }

    function sanitizeAmount(value) {
      let clean = String(value || '').replace(/[^0-9.]/g, '');
      const dot = clean.indexOf('.');
      if (dot >= 0) {
        clean = clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, '');
      }
      return clean.slice(0, 24);
    }

    function parseAmount() {
      const n = Number(tradeAmt.value);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function conversion(value, unit, price) {
      if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(price) || price <= 0) {
        return { usd: 0, asset: 0 };
      }
      return unit === 'usd'
        ? { usd: value, asset: value / price }
        : { usd: value * price, asset: value };
    }

    function formatUsd(value) {
      return '$' + Number(value || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    function formatAsset(value) {
      const n = Number(value || 0);
      const digits = n >= 1 ? 6 : 8;
      return n.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits
      }) + ' ' + assetSymbol;
    }

    function maxForMode(price) {
      if (isBuy) {
        return amountUnit === 'usd'
          ? availableUsd
          : (price > 0 ? availableUsd / price : 0);
      }
      return amountUnit === 'asset'
        ? availableAsset
        : availableAsset * price;
    }

    function validateCurrent(value, price) {
      if (!Number.isFinite(value) || value <= 0) return 'Enter an amount to continue.';
      const converted = conversion(value, amountUnit, price);
      if (isBuy && converted.usd > availableUsd + 1e-8) return 'Amount exceeds your available Spot Wallet balance.';
      if (!isBuy && converted.asset > availableAsset + 1e-12) return 'Amount exceeds your available ' + assetSymbol + ' balance.';
      return '';
    }

    function paint() {
      const price = latestQuote();
      const value = parseAmount();
      const converted = conversion(value, amountUnit, price);
      const error = value > 0 ? validateCurrent(value, price) : '';

      headPrice.textContent = formatUsd(price) + ' · indicative';
      usdMode.setAttribute('aria-pressed', String(amountUnit === 'usd'));
      assetMode.setAttribute('aria-pressed', String(amountUnit === 'asset'));
      unitLabel.textContent = amountUnit === 'usd' ? 'USD' : assetSymbol;

      if (isBuy) {
        balanceCopy.innerHTML = 'Available <strong>' + formatUsd(availableUsd) + '</strong>';
        estimateLabel.textContent = amountUnit === 'usd'
          ? 'Estimated ' + assetSymbol + ' received'
          : 'Estimated cash required';
        estimateValue.textContent = amountUnit === 'usd'
          ? formatAsset(converted.asset)
          : formatUsd(converted.usd);
      } else {
        balanceCopy.innerHTML = 'Available <strong>' + formatAsset(availableAsset) + '</strong>';
        estimateLabel.textContent = amountUnit === 'asset'
          ? 'Estimated cash received'
          : 'Estimated ' + assetSymbol + ' sold';
        estimateValue.textContent = amountUnit === 'asset'
          ? formatUsd(converted.usd)
          : formatAsset(converted.asset);
      }

      validation.textContent = error;
      confirmBtn.disabled = !value || Boolean(error) || _isTradingLocked;
      return { value, price, converted, error };
    }

    function setMode(nextUnit) {
      if (!['usd', 'asset'].includes(nextUnit) || nextUnit === amountUnit) return;
      const current = paint();
      const oldUnit = amountUnit;
      amountUnit = nextUnit;

      if (current.value > 0) {
        const converted = conversion(current.value, oldUnit, current.price);
        const nextValue = nextUnit === 'usd' ? converted.usd : converted.asset;
        tradeAmt.value = nextValue ? String(Number(nextValue.toPrecision(10))) : '';
      }

      paint();
      tradeAmt.focus({ preventScroll: true });
    }

    usdMode.addEventListener('click', () => setMode('usd'));
    assetMode.addEventListener('click', () => setMode('asset'));

    tradeAmt.addEventListener('input', () => {
      const clean = sanitizeAmount(tradeAmt.value);
      if (clean !== tradeAmt.value) tradeAmt.value = clean;
      paint();
    });

    tradeAmt.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!confirmBtn.disabled) confirmBtn.click();
        return;
      }

      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();

      const current = parseAmount();
      const step = amountUnit === 'usd'
        ? 1
        : Math.max(0.000001, Number((1 / Math.max(latestQuote(), 1)).toPrecision(2)));

      const next = event.key === 'ArrowUp'
        ? current + step
        : Math.max(0, current - step);

      tradeAmt.value = next ? String(Number(next.toPrecision(10))) : '';
      paint();
    });

    maxBtn.addEventListener('click', () => {
      const max = maxForMode(latestQuote());
      tradeAmt.value = max > 0 ? String(Number(max.toPrecision(10))) : '';
      paint();
      tradeAmt.focus({ preventScroll: true });
    });

    async function executeTrade(requestValue, requestUnit) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Executing…';
      _isTradingLocked = true;

      try {
        const { user: freshUser } = getUserState();
        if (!freshUser || !freshUser.id) throw new Error('Your session expired. Sign in again.');
        if (!window.supabaseClient) throw new Error('Secure trade service is unavailable.');

        const { data: sessionData, error: sessionError } = await window.supabaseClient.auth.getSession();
        if (sessionError) throw sessionError;
        const session = sessionData && sessionData.session;
        if (!session || !session.access_token) throw new Error('Your session expired. Sign in again.');

        const tradeFingerprint = [type, assetKey, coin.id, requestUnit, Number(requestValue).toPrecision(12)].join('|');
        const tradeKey = getIdempotencyKey('trade', tradeFingerprint);

        const response = await fetch((APP_CONFIG.apis && APP_CONFIG.apis.executeTrade) || '/api/execute-trade', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + session.access_token
          },
          body: JSON.stringify({
            side: type,
            asset: assetKey,
            coinId: coin.id,
            amount: requestValue,
            amountUnit: requestUnit,
            idempotencyKey: tradeKey
          })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Trade execution failed.');

        const executedPrice = Number(payload.executed_price);
        const executedUsd = Number(payload.executed_usd_amount);
        const quantity = Number(payload.asset_quantity);

        if (
          !payload.tx_id ||
          !Number.isFinite(Number(payload.spot_balance)) ||
          !Number.isFinite(executedPrice) ||
          executedPrice <= 0 ||
          !Number.isFinite(executedUsd) ||
          executedUsd <= 0 ||
          !Number.isFinite(quantity) ||
          quantity <= 0
        ) {
          throw new Error('Trade authority returned an invalid execution.');
        }

        RequestId.clear('trade', tradeKey);

        if (window.AppState) {
          AppState.set('holdings', payload.holdings || {});
          AppState.updateBalances({ spot: Number(payload.spot_balance) });
          AppState.addTransaction({
            id: payload.tx_id,
            type,
            amount: executedUsd,
            status: 'completed',
            description: type.toUpperCase() + ' ' + assetSymbol + ' @ ' + formatUsd(executedPrice),
            metadata: {
              asset: assetKey,
              quantity,
              executed_price: executedPrice,
              requested_amount: requestValue,
              requested_unit: requestUnit
            },
            created_at: new Date().toISOString()
          });
        }

        if (window.Modal) Modal.close();
        if (window.App) {
          App.showSuccess(
            (isBuy ? 'Bought ' : 'Sold ') + formatAsset(quantity) + ' at ' + formatUsd(executedPrice) + '.',
            isBuy ? 'Purchase complete' : 'Sale complete'
          );
        }
      } catch (error) {
        console.error('[TRADE] Trade execution failed:', error);
        if (window.App) App.showError(error.message || 'Trade execution failed.');
      } finally {
        _isTradingLocked = false;
        confirmBtn.textContent = isBuy ? 'Review purchase' : 'Review sale';
        paint();
      }
    }

    confirmBtn.addEventListener('click', async () => {
      if (_isTradingLocked || confirmBtn.disabled) return;

      const current = paint();
      if (!current.value || current.error) return;

      const entered = amountUnit === 'usd'
        ? formatUsd(current.value)
        : formatAsset(current.value);

      const counterpart = amountUnit === 'usd'
        ? formatAsset(current.converted.asset)
        : formatUsd(current.converted.usd);

      const directionLabel = isBuy
        ? (amountUnit === 'usd' ? 'Estimated receive' : 'Estimated cost')
        : (amountUnit === 'asset' ? 'Estimated receive' : 'Estimated quantity');

      const reviewMsg = [
        '<div class="ntm-review-grid">',
        '  <div class="ntm-review-row">',
        '    <span class="ntm-review-label">You entered</span>',
        '    <strong class="ntm-review-value">' + entered + '</strong>',
        '  </div>',
        '  <div class="ntm-review-row">',
        '    <span class="ntm-review-label">' + directionLabel + '</span>',
        '    <strong class="ntm-review-value">' + counterpart + '</strong>',
        '  </div>',
        '  <div class="ntm-review-row">',
        '    <span class="ntm-review-label">Indicative price</span>',
        '    <strong class="ntm-review-value">' + formatUsd(current.price) + '</strong>',
        '  </div>',
        '</div>'
      ].join('');

      if (!window.Modal) {
        await executeTrade(current.value, amountUnit);
        return;
      }

      const confirmed = await Modal.confirm({
        title: isBuy ? 'Confirm Purchase' : 'Confirm Sale',
        content: reviewMsg,
        confirmText: isBuy ? 'BUY NOW' : 'SELL NOW',
        cancelText: 'Go Back',
        dangerMode: !isBuy,
        icon: isBuy ? 'fa-circle-check' : 'fa-circle-arrow-up'
      });

      if (!confirmed) return;
      await executeTrade(current.value, amountUnit);
    });

    paint();

    if (window.Modal) {
      Modal.open({ title: '', content, showCloseButton: true });
      setTimeout(() => tradeAmt.focus({ preventScroll: true }), 180);
    }
  }


  // ============================================
  // EXPORTS
  // ============================================
  return {
    openDeposit,
    openWithdraw,
    openBuy:  (coin) => openSpotTrade(coin, 'buy'),
    openSell: (coin) => openSpotTrade(coin, 'sell')
  };

})();

if (typeof window !== 'undefined') window.Trade = Trade;
