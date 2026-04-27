/**
 * NexTrade — Trade & Transaction Engine v2.2
 * ══════════════════════════════════════════════════════════════════════════════
 * FIXES (v2.1 → v2.2):
 * 10. Optimistic UI for sell/buy — AppState.set('holdings') and
 *     AppState.updateBalances() are now called BEFORE the Supabase DB
 *     operations begin, not after they complete. This eliminates the visible
 *     lag where a sold asset remained in the holdings list for the full
 *     duration of the ledger insert + balance derivation + profiles update
 *     round-trip. On DB failure, both are rolled back to the pre-operation
 *     snapshot values. No fake data is ever shown — the optimistic values
 *     are computed from a fresh DB read (double-spend guard), so they are
 *     financially accurate at the moment of display.
 *
 * 11. Double-trigger prevention — a module-level _isTradingLocked flag
 *     prevents a second openSpotTrade execution while one is already in
 *     flight. The confirmBtn.disabled guard in the modal only covers
 *     same-modal re-tap; the module-level lock covers the case where the
 *     user taps the coin list while a trade modal is mid-flight.
 *
 * FIXES (v2.0 → v2.1, carried forward):
 * 6–9. Deposit gating, pending withdrawals, fatal ledger errors,
 *      transfer type registration. See v2.1 header.
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
  // Prevents concurrent trade executions regardless of how many modals
  // or UI paths the user opens. Complementary to per-button disabled state.
  let _isTradingLocked = false;

  // ============================================
  // CONFIGURATION
  // ============================================

  const DEPOSIT_ADDRESSES = {
    USDT_ERC20: {
      address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      label:   'USDT (ERC-20 / Ethereum)',
      network: 'Ethereum Network',
      icon:    'fa-ethereum',
      color:   '#627eea'
    },
    BTC: {
      address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf',
      label:   'Bitcoin (BTC)',
      network: 'Bitcoin Network',
      icon:    'fa-bitcoin',
      color:   '#f7931a'
    },
    USDT_TRC20: {
      address: 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7',
      label:   'USDT (TRC-20 / Tron)',
      network: 'Tron Network',
      icon:    'fa-coins',
      color:   '#ef0027'
    }
  };

  const PLACEHOLDER_PATTERNS = [
    'YourEth', 'yourBitcoin', 'yourTron',
    'YourERC', 'YourTRC', 'AddressHere', 'YourAddress'
  ];

  // ============================================
  // LEDGER DERIVATION
  // ============================================

  const CREDIT_TYPES = new Set(['deposit', 'sell', 'claim', 'transfer_in']);
  const DEBIT_TYPES  = new Set(['withdraw', 'buy', 'investment', 'transfer_out']);

  async function deriveSpotBalance(userId, storedBalance) {
    const { data: completedTxs, error: err1 } = await window.supabaseClient
      .from('transactions')
      .select('type, amount')
      .eq('user_id', userId)
      .in('status', ['completed', 'approved']);

    if (err1) throw err1;

    const { data: pendingWithdrawals, error: err2 } = await window.supabaseClient
      .from('transactions')
      .select('type, amount')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .in('type', ['withdraw']);

    if (err2) throw err2;

    const rows = [...(completedTxs || []), ...(pendingWithdrawals || [])];

    const hasDepositTx = (completedTxs || []).some(tx => tx.type === 'deposit');

    if (!hasDepositTx) {
      return Math.max(0, rows.reduce((bal, tx) => {
        const amt = parseFloat(tx.amount) || 0;
        if (CREDIT_TYPES.has(tx.type)) return bal + amt;
        if (DEBIT_TYPES.has(tx.type))  return bal - amt;
        return bal;
      }, Math.max(0, parseFloat(storedBalance) || 0)));
    }

    return Math.max(0, rows.reduce((bal, tx) => {
      const amt = parseFloat(tx.amount) || 0;
      if (CREDIT_TYPES.has(tx.type)) return bal + amt;
      if (DEBIT_TYPES.has(tx.type))  return bal - amt;
      return bal;
    }, 0));
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
    const num = parseFloat(val);
    if (isNaN(num) || num <= 0) return { valid: false, msg: 'Enter a valid amount' };
    if (max !== undefined && num > max) return { valid: false, msg: 'Insufficient balance' };
    return { valid: true, num };
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
    const { user } = getUserState();
    if (!user || !user.id) {
      if (window.App) App.showError('Session not found. Please refresh.');
      return;
    }

    if (!window.APP_CONFIG || !APP_CONFIG.features || !APP_CONFIG.features.realDeposit) {
      if (window.App) App.showError('Deposits are not currently available. Please contact support.');
      return;
    }

    const hasPlaceholder = Object.values(DEPOSIT_ADDRESSES).some(coin =>
      PLACEHOLDER_PATTERNS.some(p => coin.address.includes(p))
    );
    if (hasPlaceholder) {
      if (window.App) App.showError('Deposit addresses are not configured. Contact the administrator.');
      console.error('[TRADE] openDeposit blocked: placeholder addresses detected.');
      return;
    }

    const depositRef = generateDepositReference(user.id);
    let selectedCoin = 'USDT_ERC20';

    function buildCryptoView(coinKey) {
      const coin   = DEPOSIT_ADDRESSES[coinKey];
      const qrData = encodeURIComponent(coin.address);
      const qrUrl  = 'https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=' + qrData;

      const wrap = document.createElement('div');
      wrap.style.cssText = 'text-align:center;padding:16px;background:var(--color-surface);border-radius:12px;border:1px solid var(--color-border);';

      const qrBox = document.createElement('div');
      qrBox.style.cssText = 'width:160px;height:160px;background:white;margin:0 auto 12px;padding:8px;border-radius:8px;';
      const qrImg = document.createElement('img');
      qrImg.src = qrUrl; qrImg.alt = 'QR Code';
      qrImg.style.cssText = 'width:100%;height:100%;';
      qrBox.appendChild(qrImg);
      wrap.appendChild(qrBox);

      const networkLabel = document.createElement('div');
      networkLabel.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;margin-bottom:8px;color:' + coin.color + ';';
      networkLabel.innerHTML = '<i class="fas ' + coin.icon + '"></i>';
      networkLabel.appendChild(document.createTextNode(coin.label));
      wrap.appendChild(networkLabel);

      const netSub = document.createElement('div');
      netSub.style.cssText = 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:10px;';
      netSub.textContent = coin.network;
      wrap.appendChild(netSub);

      const addrRow = document.createElement('div');
      addrRow.style.cssText = 'font-family:var(--font-mono);font-size:12px;color:var(--color-text-primary);background:var(--color-surface-elevated);padding:10px 12px;border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--color-border);word-break:break-all;text-align:left;';
      const addrText = document.createElement('span');
      addrText.id = 'dep-addr-text';
      addrText.textContent = coin.address;
      const copyBtn = document.createElement('button');
      copyBtn.style.cssText = 'flex-shrink:0;background:none;border:none;color:var(--color-primary);cursor:pointer;padding:4px;';
      copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
      copyBtn.addEventListener('click', () => {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(coin.address)
            .then(() => { if (window.App) App.showSuccess('Address copied'); });
        }
      });
      addrRow.appendChild(addrText);
      addrRow.appendChild(copyBtn);
      wrap.appendChild(addrRow);

      const warning = document.createElement('div');
      warning.style.cssText = 'margin-top:10px;font-size:11px;color:#f59e0b;display:flex;align-items:center;gap:6px;';
      warning.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
      warning.appendChild(document.createTextNode('Only send ' + coin.label.split('(')[0].trim() + ' to this address'));
      wrap.appendChild(warning);

      return wrap;
    }

    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;gap:16px;';

    const refBanner = document.createElement('div');
    refBanner.style.cssText = 'background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.25);border-radius:12px;padding:12px 14px;';
    const refTitle = document.createElement('div');
    refTitle.style.cssText = 'font-size:11px;font-weight:700;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;';
    refTitle.textContent = 'Your Deposit Reference';
    const refRow = document.createElement('div');
    refRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
    const refCode = document.createElement('span');
    refCode.style.cssText = 'font-family:var(--font-mono);font-size:14px;font-weight:700;color:#3b82f6;letter-spacing:1px;';
    refCode.textContent = depositRef;
    const copyRefBtn = document.createElement('button');
    copyRefBtn.style.cssText = 'flex-shrink:0;background:none;border:none;color:var(--color-primary);cursor:pointer;padding:4px;font-size:13px;';
    copyRefBtn.innerHTML = '<i class="fas fa-copy"></i>';
    copyRefBtn.addEventListener('click', () => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(depositRef)
          .then(() => { if (window.App) App.showSuccess('Reference copied'); });
      }
    });
    refRow.appendChild(refCode);
    refRow.appendChild(copyRefBtn);
    const refNote = document.createElement('div');
    refNote.style.cssText = 'font-size:11px;color:var(--color-text-secondary);margin-top:6px;line-height:1.5;';
    refNote.textContent = 'Include this code in your transfer memo. Admin uses it to match your payment to your account.';
    refBanner.appendChild(refTitle);
    refBanner.appendChild(refRow);
    refBanner.appendChild(refNote);
    content.appendChild(refBanner);

    const tabRow = document.createElement('div');
    tabRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';
    const tabCrypto = document.createElement('button');
    tabCrypto.className = 'btn btn-primary';
    tabCrypto.style.fontSize = '13px';
    tabCrypto.innerHTML = '<i class="fas fa-qrcode"></i> Crypto';
    const tabCard = document.createElement('button');
    tabCard.className = 'btn btn-secondary';
    tabCard.style.fontSize = '13px';
    tabCard.innerHTML = '<i class="fas fa-credit-card"></i> Card / Bank';
    tabRow.appendChild(tabCrypto);
    tabRow.appendChild(tabCard);
    content.appendChild(tabRow);

    const panelCrypto = document.createElement('div');

    const coinSelect = document.createElement('select');
    coinSelect.className = 'input-field';
    coinSelect.style.cssText = 'margin-bottom:12px;padding:10px;';
    [
      { value: 'USDT_ERC20', label: 'USDT — ERC-20 (Ethereum)' },
      { value: 'BTC',        label: 'Bitcoin — BTC' },
      { value: 'USDT_TRC20', label: 'USDT — TRC-20 (Tron)' }
    ].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      coinSelect.appendChild(opt);
    });
    panelCrypto.appendChild(coinSelect);

    const cryptoView = document.createElement('div');
    cryptoView.id = 'crypto-view';
    cryptoView.appendChild(buildCryptoView('USDT_ERC20'));
    panelCrypto.appendChild(cryptoView);

    coinSelect.addEventListener('change', (e) => {
      selectedCoin = e.target.value;
      cryptoView.innerHTML = '';
      cryptoView.appendChild(buildCryptoView(selectedCoin));
    });

    const amtGroup = document.createElement('div');
    amtGroup.className = 'input-group';
    amtGroup.style.marginTop = '12px;';
    const amtLabel = document.createElement('label');
    amtLabel.className = 'input-label';
    amtLabel.textContent = 'Amount Sent (USD equivalent)';
    const amtInput = document.createElement('input');
    amtInput.type = 'number'; amtInput.id = 'dep-amount'; amtInput.className = 'input-field financial-data';
    amtInput.placeholder = '0.00'; amtInput.min = '10';
    const amtNote = document.createElement('div');
    amtNote.style.cssText = 'font-size:11px;color:var(--color-text-secondary);margin-top:6px;';
    amtNote.innerHTML = '<i class="fas fa-info-circle"></i> Balance updates after admin confirms your transfer.';
    amtGroup.appendChild(amtLabel);
    amtGroup.appendChild(amtInput);
    amtGroup.appendChild(amtNote);
    panelCrypto.appendChild(amtGroup);

    const confirmDepBtn = document.createElement('button');
    confirmDepBtn.className = 'btn btn-primary btn-full';
    confirmDepBtn.textContent = 'I Have Made The Transfer';
    confirmDepBtn.addEventListener('click', async () => {
      const { valid, num, msg } = validateAmount(amtInput.value);
      if (!valid) return window.App ? App.showError(msg) : alert(msg);

      const { user } = getUserState();
      if (!user || !user.id) return window.App ? App.showError('Session not found. Please refresh.') : alert('Session error');

      confirmDepBtn.disabled = true;
      confirmDepBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>Submitting...';

      try {
        if (window.supabaseClient) {
          const { error } = await window.supabaseClient
            .from('transactions')
            .insert({
              user_id:     user.id,
              type:        'deposit',
              amount:      num,
              status:      'pending',
              description: 'Deposit (' + DEPOSIT_ADDRESSES[selectedCoin].label + ') — Ref: ' + depositRef,
              created_at:  new Date().toISOString()
            });
          if (error) throw error;
        }

        if (window.AppState) {
          AppState.addTransaction({
            id:          'temp_' + Date.now(),
            type:        'deposit',
            amount:      num,
            status:      'pending',
            description: 'Deposit (' + DEPOSIT_ADDRESSES[selectedCoin].label + ') — Ref: ' + depositRef,
            created_at:  new Date().toISOString()
          });
        }

        if (window.Modal) Modal.close();
        if (window.App) App.showSuccess('Transfer submitted. Reference: ' + depositRef);

      } catch (err) {
        if (window.App) App.showError(err.message || 'Submission failed');
        confirmDepBtn.disabled = false;
        confirmDepBtn.textContent = 'I Have Made The Transfer';
      }
    });
    panelCrypto.appendChild(confirmDepBtn);
    content.appendChild(panelCrypto);

    const panelCard = document.createElement('div');
    panelCard.style.display = 'none';
    const cardPlaceholder = document.createElement('div');
    cardPlaceholder.style.cssText = 'text-align:center;padding:24px;background:var(--color-surface-elevated);border-radius:12px;border:1px solid var(--color-border);';
    const cardIcon = document.createElement('i');
    cardIcon.className = 'fas fa-credit-card';
    cardIcon.style.cssText = 'font-size:36px;color:var(--color-text-tertiary);margin-bottom:14px;display:block;opacity:0.5;';
    const cardTitle = document.createElement('div');
    cardTitle.style.cssText = 'font-size:15px;font-weight:700;color:var(--color-text-primary);margin-bottom:8px;';
    cardTitle.textContent = 'Card & Bank Deposit';
    const cardMsg = document.createElement('div');
    cardMsg.style.cssText = 'font-size:13px;color:var(--color-text-secondary);line-height:1.5;';
    cardMsg.textContent = 'Card and bank deposit is not yet available. Use the Crypto tab to deposit via blockchain transfer.';
    cardPlaceholder.appendChild(cardIcon);
    cardPlaceholder.appendChild(cardTitle);
    cardPlaceholder.appendChild(cardMsg);
    panelCard.appendChild(cardPlaceholder);
    content.appendChild(panelCard);

    tabCrypto.addEventListener('click', () => {
      panelCrypto.style.display = 'block'; panelCard.style.display = 'none';
      tabCrypto.className = 'btn btn-primary'; tabCard.className = 'btn btn-secondary';
    });
    tabCard.addEventListener('click', () => {
      panelCrypto.style.display = 'none'; panelCard.style.display = 'block';
      tabCard.className = 'btn btn-primary'; tabCrypto.className = 'btn btn-secondary';
    });

    if (window.Modal) Modal.open({ title: 'Deposit Funds', content, maxWidth: '480px' });
  }

  // ============================================
  // 2. WITHDRAW FLOW — LEDGER-FIRST
  // ============================================

  function openWithdraw() {
    const { balances, user } = getUserState();

    if (!user || !user.id) {
      if (window.App) App.showError('User session not found. Please refresh.');
      return;
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
    addrLabel.className = 'input-label';
    addrLabel.textContent = 'Destination Address (USDT/ERC20)';
    const addrInput = document.createElement('input');
    addrInput.type = 'text'; addrInput.id = 'wd-addr'; addrInput.className = 'input-field';
    addrInput.placeholder = 'Paste wallet address';
    addrGroup.appendChild(addrLabel); addrGroup.appendChild(addrInput);
    content.appendChild(addrGroup);

    const amtGroup = document.createElement('div');
    amtGroup.className = 'input-group';
    const amtLabel = document.createElement('label');
    amtLabel.className = 'input-label';
    amtLabel.textContent = 'Amount to Withdraw (USD)';
    const amtInput = document.createElement('input');
    amtInput.type = 'number'; amtInput.id = 'wd-amount'; amtInput.className = 'input-field financial-data';
    amtInput.placeholder = '0.00';
    amtGroup.appendChild(amtLabel); amtGroup.appendChild(amtInput);
    content.appendChild(amtGroup);

    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary btn-full';
    btn.style.borderColor = 'var(--color-border)';
    btn.textContent = 'Request Withdrawal';
    content.appendChild(btn);

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const { valid, num, msg } = validateAmount(amtInput.value, balances.spot);
      if (!valid) return window.App ? App.showError(msg) : alert(msg);

      const addr = addrInput.value.trim();
      if (window.Validation) {
        const addrValidation = Validation.walletAddress(addr, 'ETH');
        if (!addrValidation.isValid) return window.App ? App.showError(addrValidation.error) : alert(addrValidation.error);
      }

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>Processing...';

      try {
        const { user: freshUser } = getUserState();
        if (!freshUser || !freshUser.id) throw new Error('User session lost');

        if (window.supabaseClient) {
          const { error: txError } = await window.supabaseClient
            .from('transactions')
            .insert({
              user_id:     freshUser.id,
              type:        'withdraw',
              amount:      num,
              status:      'pending',
              description: 'Withdraw to ' + addr.substring(0, 6) + '...',
              created_at:  new Date().toISOString()
            });
          if (txError) throw txError;

          const currentSpot = parseFloat((getUserState().balances || {}).spot || 0);
          const lockedSpot  = Math.max(0, currentSpot - num);

          const { error: balError } = await window.supabaseClient
            .from('profiles')
            .update({ spot_balance: lockedSpot, updated_at: new Date().toISOString() })
            .eq('id', freshUser.id);
          if (balError) throw balError;

          if (window.AppState) AppState.updateBalances({ spot: lockedSpot });
        }

        if (window.AppState) {
          AppState.addTransaction({
            id:         'tx_' + Date.now(),
            type:       'withdraw',
            amount:     num,
            status:     'pending',
            created_at: new Date().toISOString()
          });
        }

        if (window.Modal) Modal.close();
        if (window.App) App.showSuccess('Withdrawal request submitted. Pending admin approval.');

      } catch (err) {
        console.error('[TRADE] Withdrawal failed:', err);
        if (window.App) App.showError(err.message || 'Error processing withdrawal');
        btn.disabled = false;
        btn.textContent = 'Request Withdrawal';
      }
    });

    if (window.Modal) Modal.open({ title: 'Withdraw Funds', content });
  }

  // ============================================
  // 3. SPOT TRADE — OPTIMISTIC UI + LEDGER-FIRST
  // ============================================

  async function openSpotTrade(coinInput, type) {
    // Module-level lock — prevents concurrent trade executions
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
    if (coin.image) {
      const img = document.createElement('img');
      img.src = coin.image; img.alt = coin.name;
      img.style.cssText = 'width:48px;height:48px;border-radius:50%;background:var(--color-surface-elevated);';
      img.onerror = () => img.style.display = 'none';
      headerRow.appendChild(img);
    }
    const headerText  = document.createElement('div');
    const headerTitle = document.createElement('div');
    headerTitle.style.cssText = 'font-size:18px;font-weight:700;color:var(--color-text-primary);';
    headerTitle.textContent = type.toUpperCase() + ' ' + coin.name;
    const headerPrice = document.createElement('div');
    headerPrice.style.cssText = 'font-size:13px;color:var(--color-text-secondary);';
    headerPrice.textContent = '$' + coin.current_price.toLocaleString();
    headerText.appendChild(headerTitle); headerText.appendChild(headerPrice);
    headerRow.appendChild(headerText);
    content.appendChild(headerRow);

    const amtBlock = document.createElement('div');
    amtBlock.style.cssText = 'position:relative;margin-top:8px;';
    const amtLblEl = document.createElement('label');
    amtLblEl.style.cssText = 'font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.5px;';
    amtLblEl.textContent = 'Amount in ' + (isBuy ? 'USD' : coin.symbol);
    const amtRow = document.createElement('div');
    amtRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const tradeAmt = document.createElement('input');
    tradeAmt.type = 'number'; tradeAmt.id = 'trade-amt'; tradeAmt.className = 'financial-data';
    tradeAmt.style.cssText = 'font-size:32px;font-weight:700;background:transparent;border:none;color:var(--color-text-primary);width:100%;padding:12px 0;outline:none;';
    tradeAmt.placeholder = '0.00';
    const unitLabel = document.createElement('span');
    unitLabel.style.cssText = 'font-size:14px;font-weight:700;color:var(--color-text-secondary);';
    unitLabel.textContent = isBuy ? 'USD' : coin.symbol;
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
    maxBtn.style.cssText = 'font-size:11px;color:' + color + ';background:' + color + '15;border:1px solid ' + color + '30;padding:4px 10px;border-radius:6px;font-weight:700;cursor:pointer;';
    maxBtn.textContent = 'MAX';
    availRow.appendChild(availText); availRow.appendChild(maxBtn);
    content.appendChild(availRow);

    const estBox = document.createElement('div');
    estBox.style.cssText = 'background:var(--color-surface-elevated);padding:16px;border-radius:12px;font-size:13px;color:var(--color-text-secondary);display:flex;justify-content:space-between;align-items:center;';
    const estLabel = document.createElement('span');
    estLabel.textContent = 'Estimated Receive:';
    const estVal = document.createElement('span');
    estVal.id = 'trade-est';
    estVal.style.cssText = 'font-weight:700;color:var(--color-text-primary);font-family:var(--font-mono);font-size:15px;';
    estVal.textContent = '0.00';
    estBox.appendChild(estLabel); estBox.appendChild(estVal);
    content.appendChild(estBox);

    const confirmBtn = document.createElement('button');
    const btnClass   = isBuy ? 'btn-success' : 'btn-danger';
    confirmBtn.className = 'btn ' + btnClass + ' btn-full';
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

    confirmBtn.addEventListener('click', async () => {
      if (confirmBtn.disabled || _isTradingLocked) return;

      const val = parseFloat(tradeAmt.value);
      if (!val || val <= 0) { if (window.App) App.showError('Invalid Amount'); return; }
      if (val > available)  { if (window.App) App.showError('Insufficient Funds'); return; }

      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>Executing...';
      _isTradingLocked = true;

      // Snapshot pre-operation state for rollback
      const preOpHoldings = window.AppState ? { ...(AppState.get('holdings') || {}) } : null;
      const preOpSpot     = window.AppState ? parseFloat((AppState.get('balances') || {}).spot || 0) : null;

      try {
        const { user: freshUser } = getUserState();
        if (!freshUser || !freshUser.id) throw new Error('User session lost');

        // ── DOUBLE-SPEND GUARD — fresh DB read ─────────────────────────────
        let freshSpot     = 0;
        let freshHoldings = {};
        if (window.supabaseClient) {
          const { data: profile, error: profileErr } = await window.supabaseClient
            .from('profiles')
            .select('spot_balance, holdings')
            .eq('id', freshUser.id)
            .single();
          if (profileErr) throw profileErr;
          freshSpot     = parseFloat(profile.spot_balance) || 0;
          freshHoldings = profile.holdings || {};
        } else {
          const st  = getUserState();
          freshSpot     = parseFloat((st.balances || {}).spot || 0);
          freshHoldings = st.holdings || {};
        }

        const freshAvailable = isBuy ? freshSpot : (freshHoldings[assetKey] || 0);
        if (val > freshAvailable) {
          throw new Error('Insufficient funds. Balance changed since modal opened.');
        }
        // ── END DOUBLE-SPEND GUARD ─────────────────────────────────────────

        // Compute final holdings from the fresh DB snapshot
        let newHoldings = { ...freshHoldings };

        if (isBuy) {
          const coinAmt = val / coin.current_price;
          newHoldings[assetKey] = (newHoldings[assetKey] || 0) + coinAmt;
        } else {
          newHoldings[assetKey] -= val;
          if (newHoldings[assetKey] < 0.00000001) delete newHoldings[assetKey];
        }

        // ── OPTIMISTIC UI UPDATE ───────────────────────────────────────────
        // Push the computed holdings into AppState BEFORE any DB write so
        // the UI (holdings list, total equity) reflects the trade immediately.
        // For buys, optimistically adjust spot too so balance doesn't lag.
        // Both are rolled back on any subsequent failure.
        if (window.AppState) {
          AppState.set('holdings', newHoldings);
          if (isBuy) {
            AppState.updateBalances({ spot: Math.max(0, freshSpot - val) });
          }
        }

        // Close modal immediately — user sees the optimistic update
        if (window.Modal) Modal.close();
        // ── END OPTIMISTIC UPDATE ──────────────────────────────────────────

        if (window.supabaseClient) {
          const txAmount = isBuy ? val : (val * coin.current_price);

          // 1. Ledger entry (fatal on failure — rolls back optimistic update)
          const { error: txErr } = await window.supabaseClient
            .from('transactions')
            .insert({
              user_id:     freshUser.id,
              type:        type,
              amount:      txAmount,
              description: type.toUpperCase() + ' ' + coin.symbol,
              status:      'completed',
              created_at:  new Date().toISOString()
            });
          if (txErr) throw txErr;

          // 2. Derive confirmed spot balance from ledger
          const newSpot = await deriveSpotBalance(freshUser.id, freshSpot);

          // 3. Write confirmed values to profiles
          const { error: profileErr } = await window.supabaseClient
            .from('profiles')
            .update({
              spot_balance: newSpot,
              holdings:     newHoldings,
              updated_at:   new Date().toISOString()
            })
            .eq('id', freshUser.id);
          if (profileErr) throw profileErr;

          // 4. Replace optimistic balance with the ledger-derived truth
          if (window.AppState) {
            AppState.updateBalances({ spot: newSpot });
            AppState.addTransaction({
              id:         'tx_' + Date.now(),
              type:       type,
              amount:     txAmount,
              status:     'completed',
              created_at: new Date().toISOString()
            });
          }
        }

        if (window.App) App.showSuccess(type.toUpperCase() + ' Successful');

      } catch (err) {
        console.error('[TRADE] Trade execution failed:', err);

        // ── OPTIMISTIC ROLLBACK ────────────────────────────────────────────
        // Restore pre-operation AppState so the UI is consistent with DB truth.
        if (window.AppState && preOpHoldings !== null) {
          AppState.set('holdings', preOpHoldings);
        }
        if (window.AppState && preOpSpot !== null) {
          AppState.updateBalances({ spot: preOpSpot });
        }
        // ── END ROLLBACK ───────────────────────────────────────────────────

        if (window.App) App.showError(err.message || 'Trade Execution Failed');

        // Re-enable button only if modal is still open
        confirmBtn.disabled = false;
        confirmBtn.textContent = type.toUpperCase() + ' NOW';

      } finally {
        _isTradingLocked = false;
      }
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
