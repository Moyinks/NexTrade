/**
 * NexTrade — Wallet Module (Institutional Interface)
 * * VISUALS: Deep Blue Mesh Gradients (Spot Wallet Theme).
 * * LOGIC:
 * 1. ACTION BAR: Wires 'Deposit' & 'Withdraw' directly to Trade.js engine.
 * 2. ASSETS: Renders 'Holdings' from AppState with live valuation.
 * 3. HISTORY: Displays 'Pending' vs 'Completed' statuses clearly.
 */

const Wallet = (() => {
  'use strict';

  // ============================================
  // STATE
  // ============================================
  let container = null;
  
  const state = {
    user: null,
    balances: { spot: 0, vault: 0 },
    holdings: {},
    transactions: [],
    marketData: [], // For asset valuation
    hideBalance: localStorage.getItem('nex_hide_balance') === 'true'
  };

  // ============================================
  // HELPERS
  // ============================================
  function formatMoney(amount) {
    if (state.hideBalance) return '••••••••';
    return (window.Format && Format.currency) 
      ? Format.currency(amount) 
      : '$' + (amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
  }

  function togglePrivacy() {
    state.hideBalance = !state.hideBalance;
    localStorage.setItem('nex_hide_balance', state.hideBalance);
    render(container); // Re-render instantly
  }

  function copyAddress() {
    const addr = "0x71C7656EC7ab88b098defB751B7401B5f6d89A23";
    if (navigator.clipboard) {
      navigator.clipboard.writeText(addr);
      if (window.App && App.showSuccess) App.showSuccess('Address Copied');
    } else {
      alert('Address: ' + addr);
    }
  }

  // ============================================
  // CORE RENDER
  // ============================================
  function render(element) {
    if (!element) return;
    container = element;
    container.className = 'wallet-page';
    container.style.paddingBottom = '100px';

    // 1. Sync State
    if (window.AppState) {
      state.user = AppState.get('user');
      const bals = AppState.get('balances');
      state.balances = bals || { spot: 0, vault: 0 };
      state.holdings = AppState.get('holdings') || {};
      state.transactions = AppState.get('transactions') || [];
      state.marketData = AppState.get('marketData') || [];
    }

    // 2. Build UI
    container.innerHTML = '';
    
    container.appendChild(createHeader());
    container.appendChild(createHeroCard());
    container.appendChild(createActionBar());
    container.appendChild(createAssetsSection());
    container.appendChild(createHistorySection());

    // 3. Post-Render
    if (window.Navbar) Navbar.setActive('wallet');
  }

  // ============================================
  // COMPONENTS
  // ============================================

  function createHeader() {
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom:24px; padding-top:12px; display:flex; justify-content:space-between; align-items:center;';
    
    header.innerHTML = `
      <div>
        <h2 style="font-size:24px; font-weight:700; color:var(--color-text-primary); letter-spacing:-0.02em; margin:0;">Spot Wallet</h2>
        <div style="font-size:13px; color:var(--color-text-secondary); margin-top:4px;">Manage your crypto assets</div>
      </div>
      <div style="width:40px; height:40px; border-radius:50%; background:var(--color-surface); border:1px solid var(--color-border); display:flex; align-items:center; justify-content:center; color:var(--color-text-secondary);">
        <i class="fas fa-qrcode"></i>
      </div>
    `;
    return header;
  }

  function createHeroCard() {
    const card = document.createElement('div');
    card.className = 'hero-card';
    
    // Blue Mesh Gradient (Spot Theme)
    card.style.cssText = `
      position: relative; overflow: hidden;
      border-radius: var(--radius-xl);
      padding: 24px; margin-bottom: 24px; height: 200px;
      display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 20px 40px -10px rgba(0,0,0,0.5);
      background: radial-gradient(circle at 10% 10%, rgba(59, 130, 246, 0.4) 0%, transparent 60%),
                  linear-gradient(135deg, #172554 0%, #020617 100%);
    `;

    const iconClass = state.hideBalance ? 'fa-eye-slash' : 'fa-eye';

    card.innerHTML = `
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:rgba(255,255,255,0.6); margin-bottom:12px;">
        Available Balance
      </div>
      
      <div style="font-family:var(--font-mono); font-size:42px; font-weight:700; color:white; letter-spacing:-1.5px; margin-bottom:16px; text-shadow: 0 2px 10px rgba(0,0,0,0.3);">
        ${formatMoney(state.balances.spot)}
      </div>

      <button id="copy-addr-btn" style="
        background: rgba(255,255,255,0.1); 
        border: 1px solid rgba(255,255,255,0.2); 
        padding: 8px 16px; 
        border-radius: 20px; 
        color: rgba(255,255,255,0.9);
        font-family: var(--font-mono); font-size: 12px;
        cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
        backdrop-filter: blur(4px); transition: background 0.2s;
      ">
        <span>0x71C...9A23</span>
        <i class="fas fa-copy" style="font-size:10px;"></i>
      </button>

      <button id="wallet-privacy-btn" style="
        position: absolute; top: 20px; right: 20px;
        background: rgba(255,255,255,0.1); border: none; 
        color: white; width: 32px; height: 32px; border-radius: 50%; 
        display: flex; align-items: center; justify-content: center; cursor: pointer;
      ">
        <i class="fas ${iconClass}" style="font-size:12px;"></i>
      </button>
    `;

    card.querySelector('#wallet-privacy-btn').onclick = (e) => { e.stopPropagation(); togglePrivacy(); };
    card.querySelector('#copy-addr-btn').onclick = copyAddress;

    return card;
  }

  function createActionBar() {
    const bar = document.createElement('div');
    bar.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:32px;';

    // 1. Deposit (Primary Action)
    const depositBtn = document.createElement('button');
    depositBtn.className = 'btn btn-primary';
    depositBtn.style.cssText = 'height:56px; border-radius:16px; font-size:15px; width:100%;';
    depositBtn.innerHTML = `<i class="fas fa-arrow-down" style="margin-right:8px;"></i> Deposit`;
    
    depositBtn.onclick = () => {
      if (window.Trade) Trade.openDeposit();
      else alert('Trade Engine Loading...');
    };

    // 2. Withdraw (Secondary Action)
    const withdrawBtn = document.createElement('button');
    withdrawBtn.className = 'btn btn-secondary';
    withdrawBtn.style.cssText = 'height:56px; border-radius:16px; font-size:15px; width:100%; border-color:var(--color-border); color:var(--color-text-primary);';
    withdrawBtn.innerHTML = `<i class="fas fa-arrow-up" style="margin-right:8px;"></i> Withdraw`;
    
    withdrawBtn.onclick = () => {
      if (window.Trade) Trade.openWithdraw();
      else alert('Trade Engine Loading...');
    };

    bar.appendChild(depositBtn);
    bar.appendChild(withdrawBtn);
    return bar;
  }

  function createAssetsSection() {
    const section = document.createElement('div');
    section.style.marginBottom = '32px';

    section.innerHTML = `
      <h3 style="font-size:16px; font-weight:700; color:var(--color-text-primary); margin-bottom:16px;">Your Assets</h3>
    `;

    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:1px;';

    // Filter Holdings > 0 (Small dust cleanup visual)
    const assetKeys = Object.keys(state.holdings).filter(k => state.holdings[k] > 0.000001);

    if (assetKeys.length === 0) {
      list.innerHTML = `
        <div class="empty-state" style="padding:32px; text-align:center; border:1px dashed var(--color-border); border-radius:var(--radius-lg); opacity:0.6;">
          <div style="font-size:24px; color:var(--color-text-tertiary); margin-bottom:8px;"><i class="fas fa-wallet"></i></div>
          <div style="font-size:13px; color:var(--color-text-secondary);">No assets held yet.</div>
          <button onclick="App.navigate('market')" style="margin-top:12px; font-size:12px; color:var(--color-primary); background:none; border:none; font-weight:600; cursor:pointer;">Buy Crypto</button>
        </div>
      `;
    } else {
      assetKeys.forEach(symbol => {
        const amount = state.holdings[symbol];
        
        // Find price info
        // We use state.marketData if available, otherwise defaults
        const coin = state.marketData.find(c => c.symbol.toLowerCase() === symbol.toLowerCase()) || { 
          name: symbol.toUpperCase(), 
          symbol: symbol.toUpperCase(), 
          current_price: 0, 
          image: null,
          price_change_percentage_24h: 0 
        };
        
        // Safe valuation
        const value = amount * (coin.current_price || 0);
        const isUp = (coin.price_change_percentage_24h || 0) >= 0;

        const item = document.createElement('div');
        item.className = 'list-item'; // Uses core.css styling
        item.style.cssText = `
          display:flex; align-items:center; justify-content:space-between;
          padding:16px; background:var(--color-surface);
          border-bottom:1px solid var(--color-border);
          cursor:pointer;
        `;
        
        // Tap asset to go to market page for it
        item.onclick = () => {
            if (window.Market) {
                App.navigate('market');
                // Optional: Scroll to coin or open detail not implemented yet, 
                // but this links the flow.
            }
        };
        
        item.innerHTML = `
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:40px; height:40px; border-radius:50%; background:var(--color-surface-elevated); display:flex; align-items:center; justify-content:center; overflow:hidden;">
              ${coin.image ? `<img src="${coin.image}" style="width:100%; height:100%;">` : `<span style="font-size:12px; font-weight:700;">${coin.symbol[0]}</span>`}
            </div>
            
            <div>
              <div style="font-size:15px; font-weight:600; color:var(--color-text-primary);">${coin.name}</div>
              <div style="font-size:12px; color:var(--color-text-secondary);">${amount.toFixed(4)} ${coin.symbol.toUpperCase()}</div>
            </div>
          </div>

          <div style="text-align:right;">
            <div style="font-family:var(--font-mono); font-size:15px; font-weight:600; color:var(--color-text-primary);">
              ${formatMoney(value)}
            </div>
            <div style="font-size:12px; font-weight:500; color:${isUp ? 'var(--color-success)' : 'var(--color-danger)'};">
              ${coin.current_price > 0 ? '$' + coin.current_price.toLocaleString() : '---'}
            </div>
          </div>
        `;
        list.appendChild(item);
      });
    }

    section.appendChild(list);
    return section;
  }

  function createHistorySection() {
    const section = document.createElement('div');
    
    section.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h3 style="font-size:16px; font-weight:700; color:var(--color-text-primary);">Recent Activity</h3>
      </div>
    `;

    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:8px;';

    if (state.transactions.length === 0) {
       list.innerHTML = `<div class="empty-state" style="text-align:center; padding:20px; font-size:13px; opacity:0.5;">No transactions found</div>`;
    } else {
      // Sort by date desc
      const sortedTxs = [...state.transactions].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

      sortedTxs.slice(0, 20).forEach(tx => {
        const isDeposit = tx.type === 'deposit' || tx.type === 'in';
        const isPending = tx.status === 'pending';
        
        let color = isDeposit ? 'var(--color-success)' : 'var(--color-text-primary)';
        if (isPending) color = 'var(--color-warning)'; // Yellow for Pending
        
        const icon = isDeposit ? 'fa-arrow-down' : 'fa-arrow-up';
        const date = new Date(tx.created_at).toLocaleDateString(undefined, { month:'short', day:'numeric' });

        const item = document.createElement('div');
        item.style.cssText = `
          display:flex; align-items:center; justify-content:space-between;
          padding:12px 16px; background:var(--color-surface); border:1px solid var(--color-border);
          border-radius:var(--radius-lg);
        `;
        
        item.innerHTML = `
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:36px; height:36px; border-radius:50%; background:var(--color-surface-elevated); display:flex; align-items:center; justify-content:center; color:${isPending ? '#f59e0b' : (isDeposit ? '#10b981' : '#fff')}; border:1px solid var(--color-border);">
              <i class="fas ${icon}" style="font-size:12px;"></i>
            </div>
            <div>
              <div style="font-size:14px; font-weight:600; color:var(--color-text-primary); text-transform:capitalize;">${tx.type}</div>
              <div style="font-size:11px; color:var(--color-text-secondary);">
                ${date} • <span style="text-transform:uppercase; font-size:10px; font-weight:700; color:${isPending ? '#f59e0b' : '#94a3b8'}">${tx.status}</span>
              </div>
            </div>
          </div>

          <div style="font-family:var(--font-mono); font-size:14px; font-weight:600; color:${color};">
            ${isDeposit ? '+' : '-'}${formatMoney(tx.amount)}
          </div>
        `;
        list.appendChild(item);
      });
    }

    section.appendChild(list);
    return section;
  }

  return { render };
})();

if (typeof window !== 'undefined') window.Wallet = Wallet;
