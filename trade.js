/**
 * NexTrade — Trade & Transaction Engine (FIXED - User Validation)
 * ══════════════════════════════════════════════════════════════════════
 * CRITICAL FIXES:
 * 1. openBuy/openSell now accept BOTH coin objects AND coin IDs
 * 2. Proper validation and error handling
 * 3. Graceful fallbacks when coin data is missing
 * 4. FIXED: Proper null checks before accessing coin.id (line 96 error)
 * 5. FIXED: User validation in deposit/withdraw flows
 * ══════════════════════════════════════════════════════════════════════
 * CORE LOGIC:
 * 1. DEPOSIT: Creates a "Pending" transaction. DOES NOT update balance (requires Admin).
 * 2. WITHDRAW: Immediately deducts balance (locks funds) & creates "Pending" transaction.
 * 3. SPOT TRADE: Instant execution. Updates Balance & Holdings immediately.
 */

const Trade = (() => {
  'use strict';

  // ============================================
  // HELPERS
  // ============================================
  
  function getUserState() {
    if (!window.AppState) return { user: null, balances: { spot: 0 }, holdings: {} };
    return {
      user: AppState.get('user'),
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

  // ============================================
  // 1. DEPOSIT FLOW (The "Admin Gate") - FIXED
  // ============================================
  
  function openDeposit() {
  // YOUR REAL WALLET ADDRESSES — replace with your actual addresses
  const DEPOSIT_ADDRESSES = {
    USDT_ERC20: {
      address: '0x71C7656EC7ab88b098defB751B7401B5f6d89A23', // YOUR ETH/USDT address
      label: 'USDT (ERC-20 / Ethereum)',
      network: 'Ethereum Network',
      icon: 'fa-ethereum',
      color: '#627eea'
    },
    BTC: {
      address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', // YOUR Bitcoin address
      label: 'Bitcoin (BTC)',
      network: 'Bitcoin Network',
      icon: 'fa-bitcoin',
      color: '#f7931a'
    },
    USDT_TRC20: {
      address: 'TYour TRC20 AddressHere', // YOUR TRON/USDT address
      label: 'USDT (TRC-20 / Tron)',
      network: 'Tron Network',
      icon: 'fa-coins',
      color: '#ef0027'
    }
  };

  let selectedCoin = 'USDT_ERC20';

  function buildCryptoView(coinKey) {
    const coin = DEPOSIT_ADDRESSES[coinKey];
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(coin.address)}`;
    return `
      <div style="text-align:center; padding:16px; background:var(--color-surface); border-radius:12px; border:1px solid var(--color-border);">
        <div style="width:160px; height:160px; background:white; margin:0 auto 12px; padding:8px; border-radius:8px;">
          <img src="${qrUrl}" style="width:100%; height:100%;" alt="QR Code">
        </div>
        <div style="display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:${coin.color}; margin-bottom:8px;">
          <i class="fas ${coin.icon}"></i>${coin.label}
        </div>
        <div style="font-size:11px; color:var(--color-text-tertiary); margin-bottom:10px;">${coin.network}</div>
        <div style="font-family:var(--font-mono); font-size:12px; color:var(--color-text-primary); background:var(--color-surface-elevated); padding:10px 12px; border-radius:8px; display:flex; align-items:center; justify-content:space-between; gap:8px; border:1px solid var(--color-border); word-break:break-all; text-align:left;">
          <span id="dep-addr-text">${coin.address}</span>
          <button id="copy-addr-btn" style="flex-shrink:0; background:none; border:none; color:var(--color-primary); cursor:pointer; padding:4px;">
            <i class="fas fa-copy"></i>
          </button>
        </div>
        <div style="margin-top:10px; font-size:11px; color:#f59e0b; display:flex; align-items:center; gap:6px;">
          <i class="fas fa-exclamation-triangle"></i>
          Only send ${coin.label.split('(')[0].trim()} to this address
        </div>
      </div>
    `;
  }

  const content = document.createElement('div');
  content.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:16px;">
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <button id="tab-crypto" class="btn btn-primary" style="font-size:13px;">
          <i class="fas fa-qrcode"></i> Crypto
        </button>
        <button id="tab-bank" class="btn btn-secondary" style="font-size:13px;">
          <i class="fas fa-credit-card"></i> Card / Bank
        </button>
      </div>

      <!-- CRYPTO PANEL -->
      <div id="panel-crypto">
        <select id="coin-select" class="input-field" style="margin-bottom:12px; padding:10px;">
          <option value="USDT_ERC20">USDT — ERC-20 (Ethereum)</option>
          <option value="BTC">Bitcoin — BTC</option>
          <option value="USDT_TRC20">USDT — TRC-20 (Tron)</option>
        </select>

        <div id="crypto-view">${buildCryptoView('USDT_ERC20')}</div>

        <div class="input-group" style="margin-top:12px;">
          <label class="input-label">Amount Sent (USD equivalent)</label>
          <input type="number" id="dep-amount" class="input-field financial-data" placeholder="0.00" min="10">
          <div style="font-size:11px; color:var(--color-text-secondary); margin-top:6px;">
            <i class="fas fa-info-circle"></i> Balance updates after 1 confirmation (10–30 mins).
          </div>
        </div>
        <button id="confirm-dep-btn" class="btn btn-primary btn-full">I Have Made The Transfer</button>
      </div>

      <!-- BANK / CARD PANEL -->
      <div id="panel-bank" style="display:none;">
        <div style="text-align:center; padding:24px; background:var(--color-surface-elevated); border-radius:12px; border:1px solid var(--color-border);">
          <i class="fas fa-credit-card" style="font-size:40px; color:var(--color-primary); margin-bottom:16px; display:block;"></i>
          <div style="font-size:16px; font-weight:700; color:var(--color-text-primary); margin-bottom:8px;">Card & Bank Deposit</div>
          <div style="font-size:13px; color:var(--color-text-secondary); margin-bottom:20px; line-height:1.5;">
            Deposit via credit card, debit card, or bank transfer. Powered by Stripe.
          </div>
          <div class="input-group" style="text-align:left; margin-bottom:16px;">
            <label class="input-label">Deposit Amount (USD)</label>
            <input type="number" id="stripe-amount" class="input-field financial-data" placeholder="100.00" min="10">
          </div>
          <button id="stripe-pay-btn" class="btn btn-primary btn-full" style="background:linear-gradient(135deg, #635bff, #4f46e5);">
            <i class="fas fa-lock" style="margin-right:6px;"></i>Pay Securely with Stripe
          </button>
          <div style="margin-top:12px; font-size:11px; color:var(--color-text-tertiary);">
            <i class="fas fa-shield-alt" style="color:#10b981; margin-right:4px;"></i>256-bit SSL encryption · No card data stored
          </div>
        </div>
      </div>

    </div>
  `;

  // Tab switching
  content.querySelector('#tab-crypto').onclick = () => {
    content.querySelector('#panel-crypto').style.display = 'block';
    content.querySelector('#panel-bank').style.display = 'none';
    content.querySelector('#tab-crypto').className = 'btn btn-primary';
    content.querySelector('#tab-bank').className = 'btn btn-secondary';
  };

  content.querySelector('#tab-bank').onclick = () => {
    content.querySelector('#panel-crypto').style.display = 'none';
    content.querySelector('#panel-bank').style.display = 'block';
    content.querySelector('#tab-bank').className = 'btn btn-primary';
    content.querySelector('#tab-crypto').className = 'btn btn-secondary';
  };

  // Coin selector — swap address and QR dynamically
  content.querySelector('#coin-select').onchange = (e) => {
    selectedCoin = e.target.value;
    content.querySelector('#crypto-view').innerHTML = buildCryptoView(selectedCoin);
    // Re-bind copy button after innerHTML swap
    bindCopyBtn();
  };

  function bindCopyBtn() {
    const copyBtn = content.querySelector('#copy-addr-btn');
    if (!copyBtn) return;
    copyBtn.onclick = () => {
      const addr = DEPOSIT_ADDRESSES[selectedCoin].address;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(addr).then(() => App.showSuccess('Address Copied'));
      }
    };
  }
  bindCopyBtn();

  // Stripe button
  content.querySelector('#stripe-pay-btn').onclick = () => {
    const amount = parseFloat(content.querySelector('#stripe-amount').value);
    if (!amount || amount < 10) return App.showError('Minimum deposit is $10');
    initiateStripeCheckout(amount);
  };

  // Crypto confirm button
  const confirmBtn = content.querySelector('#confirm-dep-btn');
  confirmBtn.onclick = async () => {
    const { valid, num, msg } = validateAmount(content.querySelector('#dep-amount').value);
    if (!valid) return App.showError(msg);

    const { user } = getUserState();
    if (!user || !user.id) return App.showError('Session not found. Please refresh.');

    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

    try {
      if (window.supabaseClient) {
        const { error } = await window.supabaseClient.from('transactions').insert({
          user_id: user.id,
          type: 'deposit',
          amount: num,
          status: 'pending',
          description: `Deposit (${DEPOSIT_ADDRESSES[selectedCoin].label})`,
          created_at: new Date().toISOString()
        });
        if (error) throw error;
      }

      if (window.AppState) {
        AppState.addTransaction({
          id: 'temp_' + Date.now(),
          type: 'deposit',
          amount: num,
          status: 'pending',
          created_at: new Date().toISOString()
        });
      }
// Force wallet UI refresh if currently mounted
    if (window.Wallet) {
  const walletPage = document.querySelector('.wallet-page');
  if (walletPage) Wallet.render(walletPage);
}
      await Modal.close();
      App.showSuccess('Deposit submitted. Awaiting confirmation.');

    } catch (err) {
      App.showError(err.message || 'Submission failed');
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = 'I Have Made The Transfer';
    }
  };

  Modal.open({ title: 'Deposit Funds', content, maxWidth: '480px' });
}

  // ============================================
  // 2. WITHDRAW FLOW (The "Lock" Logic) - FIXED
  // ============================================

  function openWithdraw() {
    const { balances, user } = getUserState();
    
    // Validate user exists
    if (!user || !user.id) {
      console.error('[TRADE] No user found in state');
      if (window.App && App.showError) {
        App.showError('User session not found. Please refresh the page.');
      }
      return;
    }
    
    const content = document.createElement('div');
    content.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div style="background:var(--color-surface-elevated); padding:16px; border-radius:12px; border:1px solid var(--color-border); display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:13px; color:var(--color-text-secondary);">Available Balance</span>
          <span style="font-size:18px; font-weight:700; color:var(--color-text-primary); font-family:var(--font-mono);">
            ${Format.currency(balances.spot)}
          </span>
        </div>

        <div class="input-group">
          <label class="input-label">Destination Address (USDT/ERC20)</label>
          <input type="text" id="wd-addr" class="input-field" placeholder="Paste wallet address">
        </div>

        <div class="input-group">
          <label class="input-label">Amount to Withdraw (USD)</label>
          <input type="number" id="wd-amount" class="input-field financial-data" placeholder="0.00">
        </div>

        <button id="confirm-wd-btn" class="btn btn-secondary btn-full" style="border-color:var(--color-border);">Request Withdrawal</button>
      </div>
    `;

    const btn = content.querySelector('#confirm-wd-btn');
    const inputAmt = content.querySelector('#wd-amount');
    const inputAddr = content.querySelector('#wd-addr');

    btn.onclick = async () => {
      const { valid, num, msg } = validateAmount(inputAmt.value, balances.spot);
      if (!valid) return App.showError(msg);
      
      const addr = inputAddr.value.trim();
const addrValidation = Validation.walletAddress(addr, 'ETH');
if (!addrValidation.isValid) return App.showError(addrValidation.error);

      btn.disabled = true;
      btn.innerHTML = '<div class="spinner" style="width:20px; height:20px;"></div> Processing...';

      setTimeout(async () => {
        try {
          const { user, balances: currBal } = getUserState();
          
          // Re-validate user (in case state changed)
          if (!user || !user.id) {
            throw new Error('User session lost');
          }
          
          const newSpot = currBal.spot - num;

          if (window.supabaseClient) {
  const { error: txError } = await supabaseClient.from('transactions').insert({
    user_id: user.id,
    type: 'withdraw',
    amount: num,
    status: 'pending',
    description: `Withdraw to ${addr.substring(0, 6)}...`,
    created_at: new Date().toISOString()
  });
  if (txError) throw txError;

  const { error: balError } = await supabaseClient
    .from('profiles')
    .update({ spot_balance: newSpot })
    .eq('id', user.id);
  if (balError) throw balError;
}

AppState.updateBalances({ spot: newSpot });
          
          const newTx = {
            id: 'tx_' + Date.now(),
            type: 'withdraw',
            amount: num,
            status: 'pending',
            created_at: new Date().toISOString()
          };
          AppState.addTransaction(newTx);

          await Modal.close();
          if (window.Wallet) Wallet.render(document.querySelector('.wallet-page'));
          App.showSuccess('Withdrawal Request Submitted');

        } catch (err) {
          console.error('[TRADE] Withdrawal failed:', err);
          App.showError(err.message || 'Error processing withdrawal');
          btn.disabled = false;
          btn.innerHTML = 'Request Withdrawal';
        }
      }, 1500);
    };

    Modal.open({ title: 'Withdraw Funds', content });
  }

  // ============================================
  // 3. SPOT TRADE (Instant Execution) - FIXED
  // ============================================

  function openSpotTrade(coinInput, type) {
    // ========================================
    // CRITICAL FIX: Handle both coin object and coin ID string
    // FIXED: Proper null/undefined checks before accessing properties
    // ========================================
    let coin = coinInput;
    
    // Early validation - check if we have any input
    if (!coinInput) {
      console.error('[TRADE] No coin data provided');
      if (window.App && App.showError) App.showError('No coin selected');
      return;
    }
    
    if (typeof coinInput === 'string') {
      // It's a coin ID, fetch from market data
      const marketData = window.AppState ? AppState.get('marketData') : [];
      
      if (!marketData || marketData.length === 0) {
        console.error('[TRADE] Market data not available');
        if (window.App && App.showError) App.showError('Market data is loading. Please try again.');
        return;
      }
      
      coin = marketData.find(c => c && c.id === coinInput);
      
      if (!coin) {
        console.error('[TRADE] Coin not found in market data:', coinInput);
        if (window.App && App.showError) App.showError('Coin data not available. Please refresh the page.');
        return;
      }
    }
    
    // Validate coin object has required properties
    if (!coin || !coin.id || !coin.symbol || typeof coin.current_price !== 'number') {
      console.error('[TRADE] Invalid coin object:', coin);
      if (window.App && App.showError) App.showError('Invalid coin data. Please try again.');
      return;
    }
    
    console.log('[TRADE] Opening trade modal for:', coin.id, type);
    
    const { balances, holdings, user } = getUserState();
    
    // Validate user exists for trades
    if (!user || !user.id) {
      console.error('[TRADE] No user found in state');
      if (window.App && App.showError) {
        App.showError('User session not found. Please refresh the page.');
      }
      return;
    }
    
    // Config based on type
    const isBuy = type === 'buy';
    const assetKey = coin.symbol.toLowerCase();
    const available = isBuy ? balances.spot : (holdings[assetKey] || 0);
    const availLabel = isBuy ? 'USD' : coin.symbol.toUpperCase();
    const color = isBuy ? 'var(--color-success)' : 'var(--color-danger)';
    const btnColorClass = isBuy ? 'btn-success' : 'btn-danger';
    
    const content = document.createElement('div');
    content.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:20px;">
        
        <div style="display:flex; align-items:center; gap:16px; padding-bottom:16px; border-bottom:1px solid var(--color-border);">
          <img src="${coin.image || ''}" style="width:48px; height:48px; border-radius:50%; background:var(--color-surface-elevated);" onerror="this.style.display='none'">
          <div>
            <div style="font-size:18px; font-weight:700; color:var(--color-text-primary);">${type.toUpperCase()} ${coin.name}</div>
            <div style="font-size:13px; color:var(--color-text-secondary);">$${coin.current_price.toLocaleString()}</div>
          </div>
        </div>

        <div style="position:relative; margin-top:8px;">
          <label style="font-size:11px; color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">Amount in ${isBuy ? 'USD' : coin.symbol}</label>
          <div style="display:flex; align-items:center; gap:8px;">
            <input type="number" id="trade-amt" class="financial-data" 
              style="font-size:32px; font-weight:700; background:transparent; border:none; color:var(--color-text-primary); width:100%; padding:12px 0; outline:none;" 
              placeholder="0.00"
            >
            <span style="font-size:14px; font-weight:700; color:var(--color-text-secondary);">${isBuy ? 'USD' : coin.symbol}</span>
          </div>
          <div style="height:1px; background:var(--color-border); width:100%;"></div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:12px; color:var(--color-text-secondary);">
            Available: <span style="font-weight:700; color:var(--color-text-primary);">${available.toFixed(isBuy ? 2 : 6)} ${availLabel}</span>
          </div>
          <button id="trade-max" style="font-size:11px; color:${color}; background:${color}15; border:1px solid ${color}30; padding:4px 10px; border-radius:6px; font-weight:700; cursor:pointer;">MAX</button>
        </div>

        <div style="background:var(--color-surface-elevated); padding:16px; border-radius:12px; font-size:13px; color:var(--color-text-secondary); display:flex; justify-content:space-between; align-items:center;">
          <span>Estimated Receive:</span>
          <span id="trade-est" style="font-weight:700; color:var(--color-text-primary); font-family:var(--font-mono); font-size:15px;">0.00</span>
        </div>

        <button id="trade-confirm" class="btn ${btnColorClass} btn-full" style="height:56px; font-size:16px;">
          ${type.toUpperCase()} NOW
        </button>
      </div>
    `;

    const input = content.querySelector('#trade-amt');
    const estDisplay = content.querySelector('#trade-est');
    const maxBtn = content.querySelector('#trade-max');
    const confirmBtn = content.querySelector('#trade-confirm');

    // Live Calculation
    const updateEst = () => {
      const val = parseFloat(input.value) || 0;
      if (isBuy) {
        // USD -> Coin
        estDisplay.textContent = `${(val / coin.current_price).toFixed(6)} ${coin.symbol}`;
      } else {
        // Coin -> USD
        estDisplay.textContent = `$${(val * coin.current_price).toFixed(2)}`;
      }
    };
    
    input.oninput = updateEst;
    maxBtn.onclick = () => { input.value = available; updateEst(); };

    confirmBtn.onclick = async () => {
      const val = parseFloat(input.value);
      if (!val || val <= 0) return App.showError('Invalid Amount');
      if (val > available) return App.showError('Insufficient Funds');

      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<div class="spinner" style="width:20px; height:20px;"></div> Executing...';

      try {
        const { user, balances: currBal, holdings: currHold } = getUserState();
        
        // Re-validate user
        if (!user || !user.id) {
          throw new Error('User session lost');
        }
        
        let newSpot = currBal.spot;
        let newHoldings = { ...currHold };
        
        // --- THE MATH ENGINE ---
        if (isBuy) {
          const coinAmt = val / coin.current_price;
          newSpot -= val;
          newHoldings[assetKey] = (newHoldings[assetKey] || 0) + coinAmt;
        } else {
          const usdAmt = val * coin.current_price;
          newSpot += usdAmt;
          newHoldings[assetKey] -= val;
          if (newHoldings[assetKey] < 0.00000001) delete newHoldings[assetKey];
        }

        // 1. DATABASE UPDATE
        if (window.supabaseClient) {
  const { error: profileErr } = await supabaseClient
    .from('profiles')
    .update({ spot_balance: newSpot, holdings: newHoldings })
    .eq('id', user.id);
  if (profileErr) throw profileErr;

  const { error: txErr } = await supabaseClient.from('transactions').insert({
    user_id: user.id,
    type: type,
    amount: isBuy ? val : (val * coin.current_price),
    description: `${type.toUpperCase()} ${coin.symbol}`,
    status: 'completed',
    created_at: new Date().toISOString()
  });
  if (txErr) {
    console.error('[TRADE] TX record failed after balance update:', txErr);
    // Don't throw — balance already committed, log for admin
  }
}

        // 2. STATE UPDATE
        AppState.updateBalances({ spot: newSpot });
        AppState.set('holdings', newHoldings);
        
        const newTx = {
          id: 'tx_' + Date.now(),
          type: type,
          amount: isBuy ? val : (val * coin.current_price),
          status: 'completed',
          created_at: new Date().toISOString()
        };
        AppState.addTransaction(newTx);
        
        // 3. SUCCESS
        await Modal.close();
        if (window.Wallet) Wallet.render(document.querySelector('.wallet-page'));
        App.showSuccess(`${type.toUpperCase()} Successful`);

      } catch (err) {
        console.error('[TRADE] Trade execution failed:', err);
        App.showError(err.message || 'Trade Execution Failed');
        confirmBtn.disabled = false;
        confirmBtn.textContent = `${type.toUpperCase()} NOW`;
      }
    };

    Modal.open({ title: '', content, showCloseButton: true });
  }

  // ============================================
  // EXPORTS
  // ============================================
  return {
    openDeposit,
    openWithdraw,
    openBuy: (coin) => openSpotTrade(coin, 'buy'),
    openSell: (coin) => openSpotTrade(coin, 'sell')
  };

})();

if (typeof window !== 'undefined') window.Trade = Trade;
