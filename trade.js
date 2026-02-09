/**
 * NexTrade — Trade & Transaction Engine (FIXED - Handles Both Coin Objects and IDs)
 * ══════════════════════════════════════════════════════════════════════
 * CRITICAL FIXES:
 * 1. openBuy/openSell now accept BOTH coin objects AND coin IDs
 * 2. Proper validation and error handling
 * 3. Graceful fallbacks when coin data is missing
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
  // 1. DEPOSIT FLOW (The "Admin Gate")
  // ============================================
  
  function openDeposit() {
    const content = document.createElement('div');
    content.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <button id="dep-crypto" class="btn btn-secondary" style="border-color:var(--color-primary); color:var(--color-primary);">
            <i class="fas fa-qrcode"></i> Crypto
          </button>
          <button id="dep-fiat" class="btn btn-secondary">
            <i class="fas fa-credit-card"></i> Bank/Card
          </button>
        </div>

        <div id="dep-view-crypto" style="text-align:center; padding:16px; background:var(--color-surface); border-radius:12px; border:1px solid var(--color-border);">
          <div style="width:140px; height:140px; background:white; margin:0 auto 12px auto; padding:8px; border-radius:8px;">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=0x71C7656EC7ab88b098defB751B7401B5f6d89A23" style="width:100%; height:100%;">
          </div>
          <div style="font-size:12px; color:var(--color-text-secondary); margin-bottom:4px;">USDT (ERC20) Deposit Address</div>
          <div style="font-family:var(--font-mono); font-size:13px; color:var(--color-text-primary); background:var(--color-surface-elevated); padding:10px; border-radius:8px; display:flex; align-items:center; justify-content:center; gap:8px; border:1px solid var(--color-border);">
            <span style="overflow:hidden; text-overflow:ellipsis;">0x71C...9A23</span>
            <i class="fas fa-copy" style="cursor:pointer; color:var(--color-primary);" onclick="navigator.clipboard.writeText('0x71C7656EC7ab88b098defB751B7401B5f6d89A23'); alert('Address Copied')"></i>
          </div>
        </div>

        <div class="input-group" style="margin-top:8px;">
          <label class="input-label">Amount Sent (USD)</label>
          <input type="number" id="dep-amount" class="input-field financial-data" placeholder="0.00">
          <div style="font-size:11px; color:var(--color-text-secondary); margin-top:6px; line-height:1.4;">
            <i class="fas fa-info-circle"></i> Your balance will update after admin confirmation (approx. 10-30 mins).
          </div>
        </div>

        <button id="confirm-dep-btn" class="btn btn-primary btn-full">I Have Made The Transfer</button>
      </div>
    `;

    const btn = content.querySelector('#confirm-dep-btn');
    const input = content.querySelector('#dep-amount');

    btn.onclick = async () => {
      const { valid, num, msg } = validateAmount(input.value);
      if (!valid) return App.showError(msg);

      btn.disabled = true;
      btn.innerHTML = '<div class="spinner" style="width:20px; height:20px;"></div> Verifying...';

      // Simulate Network Delay
      setTimeout(async () => {
        try {
          const { user } = getUserState();
          
          // 1. DATABASE INSERT (Status: PENDING)
          if (window.supabaseClient) {
            await supabaseClient.from('transactions').insert({
              user_id: user.id,
              type: 'deposit',
              amount: num,
              status: 'pending',
              description: 'Deposit (USDT)',
              created_at: new Date().toISOString()
            });
          }

          // 2. LOCAL STATE UPDATE (History Only)
          const newTx = {
            id: 'temp_' + Date.now(),
            type: 'deposit',
            amount: num,
            status: 'pending',
            created_at: new Date().toISOString()
          };
          AppState.addTransaction(newTx);

          // 3. UI REFRESH & FEEDBACK
          await Modal.close();
          if (window.Wallet) Wallet.render(document.querySelector('.wallet-page'));
          
          App.showSuccess('Deposit Submitted. Waiting for Approval.');

        } catch (err) {
          console.error(err);
          App.showError('Request Failed');
          btn.disabled = false;
          btn.textContent = 'Try Again';
        }
      }, 1500);
    };

    Modal.open({ title: 'Deposit Funds', content });
  }

  // ============================================
  // 2. WITHDRAW FLOW (The "Lock" Logic)
  // ============================================

  function openWithdraw() {
    const { balances } = getUserState();
    
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
      if (addr.length < 10) return App.showError('Invalid Address');

      btn.disabled = true;
      btn.innerHTML = '<div class="spinner" style="width:20px; height:20px;"></div> Processing...';

      setTimeout(async () => {
        try {
          const { user, balances: currBal } = getUserState();
          
          const newSpot = currBal.spot - num;

          if (window.supabaseClient) {
            await supabaseClient.from('profiles').update({ spot_balance: newSpot }).eq('id', user.id);
            
            await supabaseClient.from('transactions').insert({
              user_id: user.id,
              type: 'withdraw',
              amount: num,
              status: 'pending',
              description: `Withdraw to ${addr.substring(0,6)}...`,
              created_at: new Date().toISOString()
            });
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
          console.error(err);
          App.showError('Error processing withdrawal');
          btn.disabled = false;
          btn.textContent = 'Try Again';
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
    // ========================================
    let coin = coinInput;
    
    if (typeof coinInput === 'string') {
      // It's a coin ID, fetch from market data
      const marketData = window.AppState ? AppState.get('marketData') : [];
      coin = marketData.find(c => c.id === coinInput);
      
      if (!coin) {
        console.error('[TRADE] Coin not found:', coinInput);
        if (window.App && App.showError) App.showError('Coin data not available');
        return;
      }
    }
    
    // Validate coin object has required properties
    if (!coin || !coin.id || !coin.symbol || typeof coin.current_price !== 'number') {
      console.error('[TRADE] Invalid coin object:', coin);
      if (window.App && App.showError) App.showError('Invalid coin data');
      return;
    }
    
    console.log('[TRADE] Opening trade modal for:', coin.id, type);
    
    const { balances, holdings } = getUserState();
    
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
          await supabaseClient.from('profiles').update({ 
            spot_balance: newSpot, 
            holdings: newHoldings 
          }).eq('id', user.id);

          await supabaseClient.from('transactions').insert({
            user_id: user.id,
            type: type,
            amount: isBuy ? val : (val * coin.current_price),
            description: `${type.toUpperCase()} ${coin.symbol}`,
            status: 'completed', 
            created_at: new Date().toISOString()
          });
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
        console.error(err);
        App.showError('Trade Execution Failed');
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Try Again';
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
