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
      if (window.App) App.showError('A trade is already in progress. Please wait.');
      return;
    }

    if (!coinInput) {
      if (window.App) App.showError('No coin selected');
      return;
    }

    let coin = coinInput;
    if (typeof coinInput === 'string') {
      const marketData = window.AppState ? AppState.get('marketData') : [];
      if (!marketData || marketData.length === 0) {
        if (window.App) App.showError('Market data is loading. Please try again.');
        return;
      }
      coin = marketData.find(c => c && c.id === coinInput);
      if (!coin) {
        if (window.App) App.showError('Coin data not available. Please refresh.');
        return;
      }
    }

    if (!coin || !coin.id || !coin.symbol || typeof coin.current_price !== 'number') {
      if (window.App) App.showError('Invalid coin data. Please try again.');
      return;
    }

    const { balances, holdings, user } = getUserState();

    if (!user || !user.id) {
      if (window.App) App.showError('User session not found. Please refresh.');
      return;
    }

    const isBuy      = type === 'buy';
    const assetKey   = coin.symbol.toLowerCase();
    const available  = isBuy ? balances.spot : (holdings[assetKey] || 0);
    const availLabel = isBuy ? 'USD' : coin.symbol.toUpperCase();
    const color      = isBuy ? 'var(--color-success)' : 'var(--color-danger)';

    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;gap:20px;';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;gap:16px;padding-bottom:16px;border-bottom:1px solid var(--color-border);';
    const tradeCoinImageUrl = window.API && typeof API.proxiedCoinImageUrl === 'function'
      ? API.proxiedCoinImageUrl(coin.image)
      : '';
    if (tradeCoinImageUrl) {
      const img = document.createElement('img');
      img.src = tradeCoinImageUrl; img.alt = coin.name;
      img.style.cssText = 'width:48px;height:48px;border-radius:50%;background:var(--color-surface-elevated);';
      img.onerror = () => img.style.display = 'none';
      headerRow.appendChild(img);
    }
    const headerText  = document.createElement('div');
    const headerTitle = document.createElement('div');
    headerTitle.style.cssText = 'font-size:18px;font-weight:700;color:var(--color-text-primary);';
    headerTitle.textContent   = type.toUpperCase() + ' ' + coin.name;
    const headerPrice = document.createElement('div');
    headerPrice.style.cssText = 'font-size:13px;color:var(--color-text-secondary);';
    headerPrice.textContent   = '$' + coin.current_price.toLocaleString();
    headerText.appendChild(headerTitle); headerText.appendChild(headerPrice);
    headerRow.appendChild(headerText);
    content.appendChild(headerRow);

    const amtBlock = document.createElement('div');
    amtBlock.style.cssText = 'position:relative;margin-top:8px;';
    const amtLblEl = document.createElement('label');
    amtLblEl.style.cssText = 'font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.5px;';
    amtLblEl.textContent   = 'Amount in ' + (isBuy ? 'USD' : coin.symbol);
    const amtRow = document.createElement('div');
    amtRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const tradeAmt = document.createElement('input');
    tradeAmt.type        = 'number';
    tradeAmt.id          = 'trade-amt';
    tradeAmt.className   = 'financial-data';
    tradeAmt.setAttribute('inputmode', 'decimal');
    tradeAmt.style.cssText = 'font-size:32px;font-weight:700;background:transparent;border:none;color:var(--color-text-primary);width:100%;padding:12px 0;outline:none;';
    tradeAmt.placeholder = '0.00';
    const unitLabel = document.createElement('span');
    unitLabel.style.cssText = 'font-size:14px;font-weight:700;color:var(--color-text-secondary);';
    unitLabel.textContent   = isBuy ? 'USD' : coin.symbol;
    amtRow.appendChild(tradeAmt); amtRow.appendChild(unitLabel);
    const divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:var(--color-border);width:100%;';
    amtBlock.appendChild(amtLblEl); amtBlock.appendChild(amtRow); amtBlock.appendChild(divider);
    content.appendChild(amtBlock);

    const availRow = document.createElement('div');
    availRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    const availText = document.createElement('div');
    availText.style.cssText = 'font-size:12px;color:var(--color-text-secondary);';
    availText.innerHTML = 'Available: <span style="font-weight:700;color:var(--color-text-primary);">' + available.toFixed(isBuy ? 2 : 6) + ' ' + availLabel + '</span>';
    const maxBtn = document.createElement('button');
    maxBtn.style.cssText = 'font-size:11px;color:' + color + ';background:' + color + '15;border:1px solid ' + color + '30;padding:0 14px;border-radius:8px;font-weight:700;cursor:pointer;min-height:44px;display:inline-flex;align-items:center;';
    maxBtn.textContent   = 'MAX';
    availRow.appendChild(availText); availRow.appendChild(maxBtn);
    content.appendChild(availRow);

    const estBox = document.createElement('div');
    estBox.style.cssText = 'background:var(--color-surface-elevated);padding:16px;border-radius:12px;font-size:13px;color:var(--color-text-secondary);display:flex;justify-content:space-between;align-items:center;';
    const estLabel = document.createElement('span');
    estLabel.textContent = 'Estimated Receive:';
    const estVal = document.createElement('span');
    estVal.id          = 'trade-est';
    estVal.style.cssText = 'font-weight:700;color:var(--color-text-primary);font-family:var(--font-mono);font-size:15px;';
    estVal.textContent = '0.00';
    estBox.appendChild(estLabel); estBox.appendChild(estVal);
    content.appendChild(estBox);

    const confirmBtn   = document.createElement('button');
    const btnClass     = isBuy ? 'btn-success' : 'btn-danger';
    confirmBtn.className   = 'btn ' + btnClass + ' btn-full';
    confirmBtn.style.cssText = 'height:56px;font-size:16px;';
    confirmBtn.textContent = type.toUpperCase() + ' NOW';
    content.appendChild(confirmBtn);

    const updateEst = () => {
      const val = parseFloat(tradeAmt.value) || 0;
      estVal.textContent = isBuy
        ? (val / coin.current_price).toFixed(6) + ' ' + coin.symbol
        : '$' + (val * coin.current_price).toFixed(2);
    };

    tradeAmt.addEventListener('input', updateEst);
    maxBtn.addEventListener('click', () => { tradeAmt.value = available; updateEst(); });

    // ── TRADE EXECUTION (extracted so both the review confirm and direct path use it) ──
    async function executeTrade(val) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>Executing...';
      _isTradingLocked = true;

      try {
        const { user: freshUser } = getUserState();
        if (!freshUser || !freshUser.id) throw new Error('User session lost');
        if (!window.supabaseClient) throw new Error('Secure trade service unavailable');

        const { data: sessionData, error: sessionError } = await window.supabaseClient.auth.getSession();
        if (sessionError) throw sessionError;
        const session = sessionData && sessionData.session;
        if (!session || !session.access_token) throw new Error('Session expired. Sign in again.');

        // Fresh server-derived balances are pre-flight UX only. The Postgres RPC
        // repeats validation under a row lock, so this cannot be the authority.
        const [freshSpot, holdingsResult] = await Promise.all([
          deriveSpotBalance(freshUser.id),
          window.supabaseClient.from('profiles').select('holdings').eq('id', freshUser.id).single()
        ]);
        if (holdingsResult.error) throw holdingsResult.error;
        const freshHoldings = holdingsResult.data && holdingsResult.data.holdings || {};
        const freshAvailable = isBuy ? freshSpot : Number(freshHoldings[assetKey] || 0);
        if (val > freshAvailable) throw new Error('Insufficient available balance');

        const tradeFingerprint = `${type}|${assetKey}|${coin.id}|${val.toFixed(8)}`;
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
            amount: val,
            idempotencyKey: tradeKey
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Trade execution failed');
        if (!payload.tx_id || !Number.isFinite(Number(payload.spot_balance))) {
          throw new Error('Trade authority returned an invalid response');
        }

        const executedPrice = Number(payload.executed_price);
        const executedUsd = Number(payload.executed_usd_amount);
        const quantity = Number(payload.asset_quantity);
        if (!Number.isFinite(executedPrice) || executedPrice <= 0 || !Number.isFinite(executedUsd) || executedUsd <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
          throw new Error('Invalid execution response');
        }
        RequestId.clear('trade', tradeKey);

        if (window.AppState) {
          AppState.set('holdings', payload.holdings || freshHoldings);
          AppState.updateBalances({ spot: Number(payload.spot_balance) });
          AppState.addTransaction({
            id: payload.tx_id,
            type,
            amount: executedUsd,
            status: 'completed',
            description: type.toUpperCase() + ' ' + coin.symbol.toUpperCase() + ' @ $' + executedPrice.toLocaleString(),
            metadata: { asset: assetKey, quantity, executed_price: executedPrice },
            created_at: new Date().toISOString()
          });
        }

        const action = isBuy ? 'Bought' : 'Sold';
        if (window.App) App.showSuccess(
          action + ' at server-verified market price $' + executedPrice.toLocaleString(undefined, { maximumFractionDigits: 8 }) + '.',
          type.toUpperCase() + ' ' + coin.symbol.toUpperCase()
        );
        if (window.Modal) Modal.close();
      } catch (err) {
        console.error('[TRADE] Trade execution failed:', err);
        if (window.App) App.showError(err.message || 'Trade execution failed');
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = type.toUpperCase() + ' NOW';
        _isTradingLocked = false;
      }
    }

    confirmBtn.addEventListener('click', async () => {
      if (confirmBtn.disabled || _isTradingLocked) return;

      const checked = validateAmount(tradeAmt.value, available);
      if (!checked.valid) { if (window.App) App.showError(checked.msg); return; }
      const val = checked.num;

      // ── REVIEW STEP: show confirmation card before executing ─────────────
      const estQty   = isBuy ? (val / coin.current_price) : (val * coin.current_price);
      const estLabel = isBuy
        ? (val / coin.current_price).toFixed(6) + ' ' + coin.symbol.toUpperCase()
        : '$' + (val * coin.current_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const amtFmt   = '$' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const priceFmt = '$' + coin.current_price.toLocaleString() + ' (quote)';

      const reviewMsg = [
        '<div style="display:flex;flex-direction:column;gap:10px;text-align:left;">',
        '  <div style="display:flex;justify-content:space-between;font-size:13.5px;">',
        '    <span style="color:#94A3B8;">Amount</span>',
        '    <span style="font-weight:700;color:#F8FAFC;">' + amtFmt + '</span>',
        '  </div>',
        '  <div style="display:flex;justify-content:space-between;font-size:13.5px;">',
        '    <span style="color:#94A3B8;">Price</span>',
        '    <span style="font-weight:700;color:#F8FAFC;">' + priceFmt + '</span>',
        '  </div>',
        '  <div style="display:flex;justify-content:space-between;font-size:13.5px;">',
        '    <span style="color:#94A3B8;">You receive</span>',
        '    <span style="font-weight:700;color:#F8FAFC;">' + estLabel + '</span>',
        '  </div>',
        '</div>'
      ].join('');

      if (!window.Modal) {
        // Fallback if modal system unavailable — execute directly
        await executeTrade(val);
        return;
      }

      const confirmed = await Modal.confirm({
        title:       (isBuy ? 'Confirm Purchase' : 'Confirm Sale'),
        content:     reviewMsg,
        confirmText: type.toUpperCase() + ' NOW',
        cancelText:  'Go Back',
        dangerMode:  !isBuy,
        icon:        isBuy ? 'fa-circle-check' : 'fa-circle-arrow-up',
      });

      if (!confirmed) return;

      await executeTrade(val);
    });

    if (window.Modal) Modal.open({ title: '', content, showCloseButton: true });
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
