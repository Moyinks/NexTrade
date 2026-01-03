/**
 * NexTrade — Vault Module (Institutional Grade)
 * Automated strategy management with daily-split ROI simulation.
 * * FIXES:
 * - Internal Rendering: Strategy cards render directly to prevent "bouncing" errors.
 * - Bot Simulation: Implements 10% monthly ROI split into daily/secondly increments.
 * - Reactive UI: Real-time progress bars for lock periods.
 * - Safety: Checks for Modal availability before triggering actions.
 */

const Vault = (() => {
  'use strict';

  // ============================================
  // PRIVATE STATE & CONSTANTS
  // ============================================

  let container = null;
  let unsubscribe = null;
  let simulationInterval = null;

  // Investment Configuration
  // 10% Monthly Return / 30 Days
  const MONTHLY_ROI_TARGET = 0.10; 
  const DAYS_IN_MONTH = 30;
  // Update the UI every 5 seconds to simulate "live" trading
  const TICK_INTERVAL_MS = 5000; 

  // ============================================
  // CORE RENDER LOGIC
  // ============================================

  /**
   * Main entry point for the Vault page.
   * @param {HTMLElement} element - The container to render into.
   */
  function render(element) {
    if (!element || !(element instanceof HTMLElement)) {
      console.error('[Vault] Error: Invalid container provided.');
      return;
    }

    container = element;
    container.className = 'vault-page';
    container.innerHTML = '';

    // Create a fragment to minimize reflows
    const fragment = document.createDocumentFragment();

    // 1. Header Section
    fragment.appendChild(createHeader());

    // 2. Performance Summary (Principal vs Profit)
    fragment.appendChild(createSummaryCard());

    // 3. Strategy Selection Grid
    fragment.appendChild(createStrategyGrid());

    // 4. Active Positions List
    fragment.appendChild(createActivePositionsSection());

    container.appendChild(fragment);

    // Initialize logic
    subscribeToUpdates();
    startBotSimulation();
  }

  // ============================================
  // COMPONENT FACTORIES
  // ============================================

  function createHeader() {
    const header = document.createElement('header');
    header.className = 'vault-header';
    header.innerHTML = `
      <h1 class="vault-title">Investment Vault</h1>
      <p class="vault-subtitle">Automated high-frequency trading with daily profit delivery.</p>
    `;
    return header;
  }

  /**
   * Creates the dashboard summary showing total invested vs total profit.
   * Uses IDs (v-principal, v-profit) for fast updates via the ticker.
   */
  function createSummaryCard() {
    const summary = document.createElement('div');
    summary.className = 'vault-summary-grid';
    summary.style.cssText = `
      display: grid; 
      grid-template-columns: repeat(2, 1fr); 
      gap: var(--space-4); 
      margin-bottom: var(--space-8);
    `;

    // Calculate initial values
    const investments = (window.AppState ? AppState.get('investments') : []) || [];
    const active = investments.filter(i => i.status === 'active');
    
    const principal = active.reduce((sum, i) => sum + (i.amount || 0), 0);
    const current = active.reduce((sum, i) => sum + (i.current_value || i.amount || 0), 0);
    const profit = Math.max(0, current - principal);

    summary.innerHTML = `
      <div class="summary-card" style="background:var(--color-surface-elevated); padding:var(--space-5); border-radius:var(--radius-lg); border:1px solid var(--color-border);">
        <div style="font-size:var(--text-xs); color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:var(--space-1);">Principal Invested</div>
        <div class="financial-data" id="v-principal" style="font-size:var(--text-2xl); font-weight:700; color:var(--color-text-primary);">
          ${window.Format ? Format.currency(principal) : principal}
        </div>
      </div>
      <div class="summary-card" style="background:var(--color-surface-elevated); padding:var(--space-5); border-radius:var(--radius-lg); border:1px solid var(--color-border);">
        <div style="font-size:var(--text-xs); color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:var(--space-1);">Accrued Profit</div>
        <div class="financial-data" id="v-profit" style="font-size:var(--text-2xl); font-weight:700; color:var(--color-success);">
          +${window.Format ? Format.currency(profit) : profit}
        </div>
      </div>
    `;

    return summary;
  }

  /**
   * Renders the grid of available strategies.
   * Note: Renders internally to avoid dependency on 'Card.js'.
   */
  function createStrategyGrid() {
    const section = document.createElement('section');
    section.innerHTML = `
      <h2 style="font-size:var(--text-xl); font-weight:600; color:var(--color-text-primary); margin-bottom:var(--space-4);">Strategy Plans</h2>
      <div id="strategy-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:var(--space-4); margin-bottom:var(--space-8);"></div>
    `;

    const grid = section.querySelector('#strategy-grid');
    const strategies = (window.AppState ? AppState.get('strategies') : []) || [];

    strategies.forEach(strategy => {
      const card = document.createElement('div');
      card.className = 'strategy-card';
      card.style.cssText = `
        background: var(--color-surface-elevated); 
        border: 1px solid var(--color-border); 
        border-radius: var(--radius-lg); 
        padding: var(--space-6); 
        cursor: pointer; 
        transition: transform 0.2s ease, border-color 0.2s ease;
      `;
      
      const roiLabel = strategy.id === 'alpha-scalper' ? '10% (Monthly)' : `${strategy.apy}% (APY)`;

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:var(--space-4);">
          <div style="font-size:var(--text-3xl);">${strategy.icon}</div>
          <div style="background:var(--color-primary-bg); color:var(--color-primary); padding:2px 8px; border-radius:4px; font-size:var(--text-xs); font-weight:700;">${roiLabel}</div>
        </div>
        <div style="font-weight:600; font-size:var(--text-lg); color:var(--color-text-primary); margin-bottom:var(--space-2);">${strategy.name}</div>
        <p style="font-size:var(--text-sm); color:var(--color-text-secondary); margin-bottom:var(--space-4); line-height:1.5; min-height:3em;">${strategy.description}</p>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-4); border-top:1px solid var(--color-border); padding-top:var(--space-4);">
          <div>
            <div style="font-size:var(--text-2xs); color:var(--color-text-secondary); text-transform:uppercase;">Lock Period</div>
            <div style="font-size:var(--text-sm); font-weight:500;">${strategy.lockPeriod} Days</div>
          </div>
          <div>
            <div style="font-size:var(--text-2xs); color:var(--color-text-secondary); text-transform:uppercase;">Min. Entry</div>
            <div style="font-size:var(--text-sm); font-weight:500;">${window.Format ? Format.currency(strategy.minInvestment) : strategy.minInvestment}</div>
          </div>
        </div>
      `;

      card.addEventListener('click', () => handleStrategyClick(strategy));
      
      // Hover effect
      card.onmouseenter = () => { card.style.borderColor = 'var(--color-primary)'; card.style.transform = 'translateY(-2px)'; };
      card.onmouseleave = () => { card.style.borderColor = 'var(--color-border)'; card.style.transform = 'translateY(0)'; };

      grid.appendChild(card);
    });

    return section;
  }

  function createActivePositionsSection() {
    const section = document.createElement('section');
    section.innerHTML = `
      <h2 style="font-size:var(--text-xl); font-weight:600; color:var(--color-text-primary); margin-bottom:var(--space-4);">Active Positions</h2>
      <div id="inv-list" style="display:flex; flex-direction:column; gap:var(--space-4);"></div>
    `;
    
    // Initial Render
    renderActiveInvestments(section.querySelector('#inv-list'));
    
    return section;
  }

  function renderActiveInvestments(target) {
    const list = target || document.getElementById('inv-list');
    if (!list) return;

    list.innerHTML = '';
    const investments = (window.AppState ? AppState.get('investments') : []) || [];
    const active = investments.filter(i => i.status === 'active');

    if (active.length === 0) {
      list.innerHTML = `
        <div style="text-align:center; padding:var(--space-10); background:var(--color-surface-elevated); border-radius:var(--radius-lg); border:1px dashed var(--color-border);">
          <div style="font-size:48px; margin-bottom:var(--space-4); opacity:0.3;">🔒</div>
          <div style="font-weight:600; color:var(--color-text-primary); margin-bottom:var(--space-2);">No Active Positions</div>
          <div style="color:var(--color-text-secondary); font-size:var(--text-sm);">Select a strategy above to start earning.</div>
        </div>`;
      return;
    }

    active.forEach(inv => {
      const card = document.createElement('div');
      card.className = 'investment-card';
      card.style.cssText = `
        background: var(--color-surface-elevated); 
        border: 1px solid var(--color-border); 
        border-radius: var(--radius-lg); 
        padding: var(--space-6);
      `;

      // Progress Logic
      const start = new Date(inv.created_at).getTime();
      const end = new Date(inv.locked_until).getTime();
      const now = Date.now();
      const progress = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
      
      // Profit Logic
      const currentVal = inv.current_value || inv.amount;
      const profit = currentVal - inv.amount;

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-4);">
          <div>
            <div style="font-size:var(--text-xs); color:var(--color-text-secondary); text-transform:uppercase;">Strategy</div>
            <div style="font-weight:700; color:var(--color-text-primary); font-size:var(--text-lg);">${inv.strategy_name}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:var(--text-xs); color:var(--color-text-secondary); text-transform:uppercase;">Current Value</div>
            <div class="financial-data" style="font-weight:700; color:var(--color-primary); font-size:var(--text-xl);">
              ${window.Format ? Format.currency(currentVal) : currentVal}
            </div>
          </div>
        </div>

        <div style="margin-bottom:var(--space-5);">
          <div style="display:flex; justify-content:space-between; font-size:var(--text-2xs); color:var(--color-text-secondary); margin-bottom:var(--space-1); text-transform:uppercase;">
            <span>Lock Progression</span>
            <span>${progress.toFixed(1)}%</span>
          </div>
          <div style="height:8px; background:var(--color-border); border-radius:4px; overflow:hidden;">
            <div style="height:100%; width:${progress}%; background:var(--color-primary); transition:width 1s linear;"></div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:var(--space-2); border-top:1px solid var(--color-border); padding-top:var(--space-4);">
          <div>
            <div style="font-size:var(--text-2xs); color:var(--color-text-secondary); text-transform:uppercase;">Principal</div>
            <div style="font-size:var(--text-sm); font-weight:500;">${window.Format ? Format.currency(inv.amount) : inv.amount}</div>
          </div>
          <div>
            <div style="font-size:var(--text-2xs); color:var(--color-text-secondary); text-transform:uppercase;">Total Profit</div>
            <div style="font-size:var(--text-sm); color:var(--color-success); font-weight:700;">
              +${window.Format ? Format.currency(profit) : profit}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:var(--text-2xs); color:var(--color-text-secondary); text-transform:uppercase;">Unlocks</div>
            <div style="font-size:var(--text-sm); font-weight:500;">${window.Format ? Format.shortDate(inv.locked_until) : inv.locked_until}</div>
          </div>
        </div>
      `;

      list.appendChild(card);
    });
  }

  // ============================================
  // HANDLERS & SIMULATION
  // ============================================

  async function handleStrategyClick(strategy) {
    // 1. Update State
    if (window.AppState) AppState.selectStrategy(strategy);

    // 2. Open Modal (Defensive check)
    if (!window.Modal || typeof Modal.showInvestmentModal !== 'function') {
      console.error('[Vault] Modal.showInvestmentModal missing.');
      if (window.App) App.showError('Feature unavailable. Check Modal module.');
      return;
    }

    try {
      // 3. Await User Input
      const result = await Modal.showInvestmentModal(strategy);

      // 4. Process Investment if confirmed
      if (result) {
        await executeInvestment(result);
      }
    } catch (err) {
      console.error('[Vault] Strategy selection error:', err);
    }
  }

  async function executeInvestment(data) {
    if (window.AppState) AppState.setLoading(true);

    try {
      const balances = AppState.get('balances');
      
      // Validation: Check Spot Balance
      if (data.amount > balances.spot) {
        if (window.App) App.showError('Insufficient funds in Spot Wallet.');
        return;
      }

      // Create Record
      const investment = {
        id: 'inv_' + Date.now(),
        ...data,
        current_value: data.amount, // Start at principal
        status: 'active',
        created_at: new Date().toISOString()
      };

      // Calculate New Balances (Spot - Amount, Vault + Amount handled by State logic)
      // Note: We only decrement spot here; AppState.addInvestment should auto-increment Vault.
      const newSpotBalance = balances.spot - data.amount;

      // Update State (Persistence happens here)
      if (window.AppState) {
        AppState.addInvestment(investment);
        AppState.updateBalances({ spot: newSpotBalance });
      }

      if (window.App) await App.showSuccess(`Invested ${window.Format ? Format.currency(data.amount) : data.amount} in ${data.strategy_name}`);

      // Re-render to show new position immediately
      render(container.parentElement);

    } catch (err) {
      console.error('[Vault] Execution failed:', err);
      if (window.App) App.showError('Investment processing failed.');
    } finally {
      if (window.AppState) AppState.setLoading(false);
    }
  }

  /**
   * THE BOT: Simulates daily profit split.
   * Math: (Principal * 10%) / 30 Days / (Ticks per Day)
   */
  function startBotSimulation() {
    if (simulationInterval) clearInterval(simulationInterval);

    simulationInterval = setInterval(() => {
      const investments = (window.AppState ? AppState.get('investments') : []) || [];
      let stateChanged = false;

      const updatedInvestments = investments.map(inv => {
        // Only active bots generate profit
        if (inv.status !== 'active') return inv;

        // Calculate Tick Profit
        // 1. Monthly Profit = Principal * 0.10
        // 2. Daily Profit = Monthly / 30
        // 3. Tick Fraction = 5000ms / 86,400,000ms (ms in a day)
        
        const monthlyProfit = inv.amount * MONTHLY_ROI_TARGET;
        const dailyProfit = monthlyProfit / DAYS_IN_MONTH;
        
        const msPerDay = 24 * 60 * 60 * 1000;
        const tickFraction = TICK_INTERVAL_MS / msPerDay;
        
        const tickProfit = dailyProfit * (TICK_INTERVAL_MS / 1000 / 60 / 60 / 24) * (msPerDay / TICK_INTERVAL_MS); // Simplified: dailyProfit * tickFraction is conceptually clearer but let's use direct math:
        
        // Direct: Principal * 0.10 * (5000 / (30 * 24 * 3600 * 1000))
        const actualTickProfit = inv.amount * MONTHLY_ROI_TARGET * (TICK_INTERVAL_MS / (DAYS_IN_MONTH * 24 * 60 * 60 * 1000));

        if (actualTickProfit > 0) {
          stateChanged = true;
          // Accumulate profit
          const current = parseFloat(inv.current_value) || parseFloat(inv.amount);
          return { ...inv, current_value: current + actualTickProfit };
        }
        return inv;
      });

      // Batch update state if changes occurred
      if (stateChanged && window.AppState) {
        AppState.set('investments', updatedInvestments);
      }
    }, TICK_INTERVAL_MS);
  }

  // ============================================
  // SUBSCRIPTION & CLEANUP
  // ============================================

  function subscribeToUpdates() {
    if (unsubscribe) unsubscribe();

    if (window.AppState) {
      unsubscribe = AppState.subscribe((state) => {
        // 1. Re-render active list
        renderActiveInvestments();
        
        // 2. Update Header Summaries efficiently
        const active = state.investments.filter(i => i.status === 'active');
        const principal = active.reduce((s, i) => s + i.amount, 0);
        const current = active.reduce((s, i) => s + (i.current_value || i.amount), 0);
        
        const pEl = document.getElementById('v-principal');
        const fEl = document.getElementById('v-profit');
        
        if (pEl) pEl.textContent = window.Format ? Format.currency(principal) : principal;
        if (fEl) fEl.textContent = '+' + (window.Format ? Format.currency(current - principal) : (current - principal));
      });
    }
  }

  function cleanup() {
    if (unsubscribe) unsubscribe();
    if (simulationInterval) clearInterval(simulationInterval);
    unsubscribe = null;
    simulationInterval = null;
    container = null;
  }

  // ============================================
  // EXPORT
  // ============================================
  return { 
    render, 
    refresh: () => render(container.parentElement), 
    cleanup 
  };

})();

if (typeof window !== 'undefined') window.Vault = Vault;
