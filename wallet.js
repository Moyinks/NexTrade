/**
 * NexTrade — Wallet Module (Institutional Grade)
 * * REAL-LIFE IMPLEMENTATION:
 * 1. DEPOSIT: Creates 'pending' requests. Admin must approve in Supabase to credit funds.
 * 2. WITHDRAW: Deducts balance immediately and creates 'pending' request for Admin review.
 * 3. SCHEMA ALIGNMENT: Stores details in the existing 'description' column.
 */

const Wallet = (() => {
  'use strict';

  // ============================================
  // STATE & CONFIG
  // ============================================
  let container = null;
  let unsubscribe = null;

  // ============================================
  // RENDER ENTRY POINT
  // ============================================

  function render(element) {
    if (!element || !(element instanceof HTMLElement)) {
      console.error('[Wallet] Invalid container');
      return;
    }

    container = element;
    container.className = 'wallet-page';
    container.innerHTML = '';

    const frag = document.createDocumentFragment();

    // 1. Header
    frag.appendChild(createHeader());

    // 2. Balance Card (Spot)
    frag.appendChild(createBalanceCard());

    // 3. Action Buttons (Deposit/Withdraw)
    frag.appendChild(createActionButtons());

    // 4. Asset Holdings List
    frag.appendChild(createHoldingsSection());

    // 5. Transaction History
    frag.appendChild(createTransactionHistory());

    container.appendChild(frag);

    // Start listening for state changes
    subscribeToUpdates();
  }

  // ============================================
  // COMPONENT FACTORIES
  // ============================================

  function createHeader() {
    const div = document.createElement('header');
    div.className = 'wallet-header';
    div.innerHTML = '<h1 class="wallet-title">Wallet</h1>';
    return div;
  }

  function createBalanceCard() {
    const balances = (window.AppState ? AppState.get('balances') : null) || { spot: 0 };
    
    const div = document.createElement('div');
    div.className = 'hero-card';
    div.id = 'wallet-main-balance';
    
    div.innerHTML = `
      <div class="hero-label">Available Balance</div>
      <div class="hero-value financial-data">${window.Format ? Format.currency(balances.spot) : balances.spot}</div>
      <div style="font-size:var(--text-sm); color:rgba(255,255,255,0.7); margin-top:var(--space-2);">
        Funds available for trading and investment
      </div>
    `;
    return div;
  }

  function createActionButtons() {
    const div = document.createElement('div');
    div.className = 'wallet-actions';
    
    div.innerHTML = `
      <button class="wallet-action-btn" id="btn-deposit">
        <div class="wallet-action-icon">⬇️</div>
        <div class="wallet-action-label">Deposit</div>
      </button>
      <button class="wallet-action-btn" id="btn-withdraw">
        <div class="wallet-action-icon" style="background:var(--color-danger)">⬆️</div>
        <div class="wallet-action-label">Withdraw</div>
      </button>
    `;

    // Attach Handlers
    div.querySelector('#btn-deposit').addEventListener('click', () => showDepositModal());
    div.querySelector('#btn-withdraw').addEventListener('click', () => showWithdrawModal());

    return div;
  }

  function createHoldingsSection() {
    const section = document.createElement('section');
    section.className = 'wallet-holdings';
    section.innerHTML = `
      <h2 style="font-size:var(--text-xl); font-weight:600; color:var(--color-text-primary); margin:var(--space-8) 0 var(--space-4);">
        Your Assets
      </h2>
      <div id="holdings-list-container" style="display:flex; flex-direction:column; gap:var(--space-3);"></div>
    `;
    
    // Initial render
    renderHoldings(section.querySelector('#holdings-list-container'));
    
    return section;
  }

  function renderHoldings(target) {
    const list = target || document.getElementById('holdings-list-container');
    if (!list) return;

    list.innerHTML = '';

    // Safely get data
    const holdings = (window.AppState ? AppState.get('holdings') : {}) || {};
    const marketData = (window.AppState ? AppState.get('marketData') : []) || [];

    // Filter out near-zero dust
    const entries = Object.entries(holdings).filter(([_, qty]) => parseFloat(qty) > 0.000001);

    if (entries.length === 0) {
      list.innerHTML = `
        <div style="padding:var(--space-6); background:var(--color-surface-elevated); border-radius:var(--radius-base); color:var(--color-text-secondary); font-size:var(--text-sm); text-align:center; border:1px dashed var(--color-border);">
          No crypto assets held.
        </div>`;
      return;
    }

    entries.forEach(([symbol, quantity]) => {
      // Find current price for valuation
      const coin = marketData.find(c => c.symbol?.toUpperCase() === symbol.toUpperCase());
      const price = coin ? coin.current_price : 0;
      const usdValue = quantity * price;

      const item = document.createElement('div');
      item.style.cssText = `
        display: flex; 
        justify-content: space-between; 
        align-items: center; 
        padding: var(--space-4); 
        background: var(--color-surface-elevated); 
        border-radius: var(--radius-base); 
        border: 1px solid var(--color-border);
      `;

      item.innerHTML = `
        <div style="display:flex; align-items:center; gap:var(--space-3);">
          <div style="width:40px; height:40px; background:var(--color-surface); border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:var(--text-xs); border:1px solid var(--color-border);">
            ${symbol.substring(0, 3)}
          </div>
          <div>
            <div style="font-weight:600; color:var(--color-text-primary); font-size:var(--text-base);">
              ${symbol.toUpperCase()}
            </div>
            <div style="font-size:var(--text-xs); color:var(--color-text-secondary);">
              ${parseFloat(quantity).toFixed(6)}
            </div>
          </div>
        </div>
        <div style="text-align:right;">
          <div class="financial-data" style="font-weight:700; color:var(--color-text-primary); font-size:var(--text-lg);">
            ${window.Format ? Format.currency(usdValue) : usdValue.toFixed(2)}
          </div>
          <div style="font-size:var(--text-xs); color:var(--color-text-secondary);">
            @ ${window.Format ? Format.currency(price) : price}
          </div>
        </div>
      `;
      list.appendChild(item);
    });
  }

  function createTransactionHistory() {
    const section = document.createElement('section');
    section.className = 'transaction-history';
    section.innerHTML = `
      <h2 style="font-size:var(--text-xl); font-weight:600; color:var(--color-text-primary); margin:var(--space-8) 0 var(--space-4);">
        Transaction History
      </h2>
      <div id="tx-history-container" style="display:flex; flex-direction:column; gap:var(--space-2);"></div>
    `;
    
    renderTransactions(section.querySelector('#tx-history-container'));
    return section;
  }

  function renderTransactions(target) {
    const list = target || document.getElementById('tx-history-container');
    if (!list) return;

    list.innerHTML = '';
    const txs = (window.AppState ? AppState.get('transactions') : []) || [];

    if (txs.length === 0) {
      list.innerHTML = `
        <div class="empty-state" style="text-align:center; padding:var(--space-8); opacity:0.6;">
          <div style="font-size:48px; margin-bottom:var(--space-2);">📜</div>
          <div>No transactions found.</div>
        </div>`;
      return;
    }

    txs.forEach(tx => {
      const isDeposit = tx.type === 'deposit';
      const isPositive = isDeposit || tx.type === 'sell';
      const isPending = tx.status === 'pending';
      
      let icon = '💸'; 
      if (isDeposit) icon = '⬇️';
      if (tx.type === 'buy' || tx.type === 'sell') icon = '🪙';

      // Status Badge Style
      let statusColor = 'var(--color-text-secondary)';
      if (tx.status === 'completed') statusColor = 'var(--color-success)';
      if (tx.status === 'pending') statusColor = '#f59e0b'; // Amber/Yellow
      if (tx.status === 'failed') statusColor = 'var(--color-danger)';

      const item = document.createElement('div');
      item.className = 'transaction-item';
      item.style.cssText = `
        display: flex; 
        align-items: center; 
        gap: var(--space-4); 
        padding: var(--space-4); 
        background: var(--color-surface-elevated); 
        border-radius: var(--radius-base); 
        border: 1px solid var(--color-border);
      `;

      item.innerHTML = `
        <div class="transaction-icon" style="width:40px; height:40px; background:var(--color-surface); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.2rem;">
          ${icon}
        </div>
        <div style="flex:1;">
          <div style="font-weight:600; text-transform:capitalize; color:var(--color-text-primary);">
            ${tx.type}
            ${isPending ? '<span style="font-size:10px; background:#f59e0b20; color:#f59e0b; padding:2px 6px; border-radius:4px; margin-left:6px; vertical-align:middle;">PENDING</span>' : ''}
          </div>
          <div style="font-size:var(--text-xs); color:var(--color-text-secondary);">
            ${window.Format ? Format.shortDate(tx.created_at) : tx.created_at.split('T')[0]}
          </div>
        </div>
        <div style="text-align:right;">
          <div class="financial-data" style="font-weight:700; color:${isPositive ? 'var(--color-success)' : 'var(--color-text-primary)'};">
            ${isPositive ? '+' : '-'}${window.Format ? Format.currency(tx.amount) : tx.amount}
          </div>
          <div style="font-size:var(--text-xs); text-transform:uppercase; color:${statusColor};">
            ${tx.status}
          </div>
        </div>
      `;
      list.appendChild(item);
    });
  }

  // ============================================
  // MODAL ACTIONS (REAL DATABASE)
  // ============================================

  async function showDepositModal() {
    const content = document.createElement('div');
    content.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-4);';
    
    content.innerHTML = `
      <div style="padding:var(--space-3); background:var(--color-surface-elevated); border-radius:var(--radius-base); font-size:var(--text-sm); line-height:1.4;">
        <strong>Instructions:</strong><br>
        1. Select a payment method.<br>
        2. Send funds to the provided address.<br>
        3. Enter the transaction ID/Reference below for verification.
      </div>

      <div class="input-group">
        <label class="input-label">Payment Method</label>
        <select id="dep-method" class="input-field" style="background:var(--color-surface);">
          <option value="USDT (TRC20)">USDT (TRC20)</option>
          <option value="USDT (ERC20)">USDT (ERC20)</option>
          <option value="Bitcoin (BTC)">Bitcoin (BTC)</option>
          <option value="Bank Wire">Bank Wire (SWIFT)</option>
        </select>
      </div>

      <div class="input-group">
        <label class="input-label">Admin Address / IBAN</label>
        <div style="display:flex; gap:8px;">
           <input type="text" id="admin-wallet" class="input-field" value="T9y... (Select method)" readonly style="font-family:monospace; font-size:var(--text-xs);">
           <button class="btn" style="padding:0 12px;" onclick="navigator.clipboard.writeText(document.getElementById('admin-wallet').value)">📋</button>
        </div>
      </div>

      <div class="input-group">
        <label class="input-label">Amount Sent (USD)</label>
        <input type="number" id="dep-amount" class="input-field financial-data" placeholder="0.00" min="50" step="0.01">
      </div>

      <div class="input-group">
        <label class="input-label">Transaction Hash / Reference ID</label>
        <input type="text" id="dep-ref" class="input-field" placeholder="e.g. 7f3a1... or Wire Ref #">
      </div>

      <button class="btn btn-success btn-full" id="submit-deposit" style="padding:var(--space-4);">
        I Have Sent The Funds
      </button>
    `;

    // Dynamic Address Logic
    const methodSelect = content.querySelector('#dep-method');
    const addressInput = content.querySelector('#admin-wallet');
    const updateAddress = () => {
      const m = methodSelect.value;
      if(m.includes('TRC20')) addressInput.value = 'TXj7...YourRealAdminWalletHere'; 
      else if(m.includes('ERC20')) addressInput.value = '0x71C...YourRealAdminWalletHere';
      else if(m.includes('BTC')) addressInput.value = 'bc1q...YourRealAdminWalletHere';
      else addressInput.value = 'Ask Support for IBAN';
    };
    methodSelect.addEventListener('change', updateAddress);
    updateAddress(); // Init

    // Handle Submit
    const btn = content.querySelector('#submit-deposit');
    btn.onclick = async () => {
      const amount = parseFloat(content.querySelector('#dep-amount').value);
      const ref = content.querySelector('#dep-ref').value.trim();
      const method = methodSelect.value;

      if (!amount || amount < 50) {
        if (window.App) App.showError('Minimum deposit is $50.00');
        return;
      }
      if (!ref || ref.length < 5) {
        if (window.App) App.showError('Please enter a valid Transaction Hash/Reference.');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Submitting Request...';

      try {
        const tx = {
          type: 'deposit',
          amount: amount,
          status: 'pending', // Waiting for Admin
          created_at: new Date().toISOString(),
          description: `Method: ${method} | Ref: ${ref}` // Using existing DB column
        };

        // 1. Save to Real DB
        if (window.supabaseClient) {
          const { error } = await supabaseClient.createTransaction(tx);
          if (error) throw new Error(error.message);
        }

        // 2. Update Local State (Only History, NO Balance update)
        // We do NOT add to balances.spot yet.
        AppState.addTransaction(tx);

        if (window.Modal) await Modal.close();
        if (window.App) App.showSuccess('Deposit request submitted. Waiting for confirmation.');

      } catch (err) {
        console.error('Deposit error:', err);
        if (window.App) App.showError('Request failed. Check connection.');
        btn.disabled = false;
        btn.textContent = 'I Have Sent The Funds';
      }
    };

    if (window.Modal) {
      Modal.open({ title: 'Deposit Funds', content, maxWidth: '400px', showCloseButton: true });
    }
  }

  async function showWithdrawModal() {
    const balances = AppState.get('balances');
    
    const content = document.createElement('div');
    content.style.cssText = 'display:flex; flex-direction:column; gap:var(--space-4);';
    
    content.innerHTML = `
      <div style="padding:var(--space-3); background:var(--color-surface-elevated); border-radius:var(--radius-base); text-align:right;">
        <span style="font-size:var(--text-xs); color:var(--color-text-secondary);">Available:</span>
        <span class="financial-data" style="font-weight:700;">${window.Format ? Format.currency(balances.spot) : balances.spot}</span>
      </div>

      <div class="input-group">
        <label class="input-label">Withdraw Amount</label>
        <input type="number" id="wd-amount" class="input-field financial-data" placeholder="0.00" min="10" max="${balances.spot}">
      </div>

      <div class="input-group">
        <label class="input-label">Destination Wallet / Account</label>
        <input type="text" id="wd-address" class="input-field" placeholder="Paste address here">
      </div>

      <button class="btn btn-danger btn-full" id="submit-withdraw" style="padding:var(--space-4);">
        Request Withdrawal
      </button>
    `;

    const btn = content.querySelector('#submit-withdraw');
    btn.onclick = async () => {
      const amount = parseFloat(content.querySelector('#wd-amount').value);
      const address = content.querySelector('#wd-address').value.trim();

      if (!amount || amount < 10) { return App.showError('Min withdrawal $10'); }
      if (amount > balances.spot) { return App.showError('Insufficient balance'); }
      if (address.length < 10) { return App.showError('Invalid address'); }

      btn.disabled = true;
      btn.textContent = 'Processing...';

      try {
        const tx = {
          type: 'withdraw',
          amount: amount,
          status: 'pending',
          created_at: new Date().toISOString(),
          description: `To: ${address}`
        };

        // 1. DB Insert
        if (window.supabaseClient) {
          const { error } = await supabaseClient.createTransaction(tx);
          if (error) throw new Error(error.message);
          
          // 2. DB Balance Update (Reserve funds)
          const newSpot = balances.spot - amount;
          const { error: balErr } = await supabaseClient.updateBalances(AppState.get('user').id, { spot: newSpot });
          if (balErr) throw new Error(balErr.message);
        }

        // 3. Local Update
        AppState.updateBalances({ spot: balances.spot - amount });
        AppState.addTransaction(tx);

        if (window.Modal) await Modal.close();
        if (window.App) App.showSuccess('Withdrawal requested.');

      } catch (err) {
        console.error('Withdraw error:', err);
        App.showError('Failed to process withdrawal.');
        btn.disabled = false;
        btn.textContent = 'Request Withdrawal';
      }
    };

    if (window.Modal) {
      Modal.open({ title: 'Withdraw Funds', content, maxWidth: '400px', showCloseButton: true });
    }
  }

  // ============================================
  // SUBSCRIPTIONS & CLEANUP
  // ============================================

  function subscribeToUpdates() {
    if (unsubscribe) unsubscribe();

    if (window.AppState) {
      unsubscribe = AppState.subscribe((state) => {
        // 1. Update Balance Header
        const balEl = document.querySelector('#wallet-main-balance .hero-value');
        if (balEl) {
          balEl.textContent = window.Format ? Format.currency(state.balances.spot) : state.balances.spot;
        }

        // 2. Re-render Lists
        renderHoldings();
        renderTransactions();
      });
    }
  }

  function cleanup() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    container = null;
  }

  // ============================================
  // EXPORT
  // ============================================
  return { 
    render, 
    cleanup 
  };

})();

if (typeof window !== 'undefined') window.Wallet = Wallet;
