const Deposit = (() => {
  'use strict';
  const RAILS = Object.freeze([
    { id: 'ETH_ERC20', title: 'ERC-20', subtitle: 'Ethereum simulation rail', icon: 'fa-ethereum' },
    { id: 'USDT_TRC20', title: 'TRC-20', subtitle: 'Tron simulation rail', icon: 'fa-coins' },
    { id: 'BTC', title: 'Bitcoin', subtitle: 'Bitcoin simulation rail', icon: 'fa-bitcoin' }
  ]);
  let container = null;
  const flow = { stage: 'configure', rail: 'ETH_ERC20', amount: '', reference: '', submitting: false };
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  const user = () => window.AppState ? AppState.get('user') : null;
  const transactions = () => window.AppState ? (AppState.get('transactions') || []) : [];
  function latestPending() {
    return transactions().find(tx => {
      const metadata = tx && tx.metadata;
      return Boolean(tx && tx.type === 'deposit' && tx.status === 'pending' && metadata && (metadata.demo_deposit === true || metadata.manual_deposit_test === true));
    }) || null;
  }
  function money(value) { return window.Format && Format.currency ? Format.currency(Number(value || 0)) : '$' + Number(value || 0).toFixed(2); }
  function rail(id) { return RAILS.find(item => item.id === id) || RAILS[0]; }
  function reference() {
    const currentUser = user();
    const prefix = currentUser && currentUser.id ? currentUser.id.slice(0, 8).toUpperCase() : 'ANON0000';
    return 'NXT-' + prefix + '-' + Date.now().toString(36).toUpperCase();
  }
  function goWallet() { if (window.App) App.navigate('wallet'); }
  function openTransaction(tx, source = 'deposit') {
    if (tx && tx.id && window.Transactiondetail) Transactiondetail.open(tx.id, source);
  }
  function shell() {
    const page = node('section', 'demo-deposit-page');
    const topbar = node('header', 'demo-deposit-topbar');
    const back = node('button', 'demo-deposit-back'); back.type = 'button'; back.setAttribute('aria-label', 'Back to Wallet');
    const backIcon = node('i'); backIcon.className = 'fas fa-arrow-left'; back.appendChild(backIcon); back.addEventListener('click', goWallet);
    const brand = node('div', 'demo-deposit-brand'); brand.append(node('div', 'demo-deposit-brand__name', 'NexTrade'), node('div', 'demo-deposit-brand__sub', 'Demo settlement'));
    const badge = node('div', 'demo-sim-badge'); const flask = node('i'); flask.className = 'fas fa-flask'; badge.append(flask, node('span', '', 'Simulation'));
    topbar.append(back, brand, badge);
    const main = node('main', 'demo-deposit-main');
    const hero = node('section', 'demo-deposit-hero');
    hero.append(node('div', 'demo-deposit-eyebrow', 'Human-reviewed settlement'));
    hero.append(node('h1', 'demo-deposit-title', 'Test the ledger, not your money.'));
    const copy = node('p', 'demo-deposit-copy');
    copy.append(document.createTextNode('Create a simulated transfer request and let NexTrade move it through '), node('strong', '', 'pending → reviewed → settled'), document.createTextNode('. No real assets are accepted.'));
    hero.appendChild(copy);
    const stepper = node('div', 'demo-stepper');
    [['01','Configure'],['02','Review'],['03','Submit']].forEach(([number,label], index) => {
      const step = node('div', 'demo-step'); step.dataset.step = String(index + 1); step.append(node('div', 'demo-step__num', number), node('div', 'demo-step__label', label)); stepper.appendChild(step);
    });
    const host = node('div', 'demo-panel-host');
    main.append(hero, stepper, host); page.append(topbar, main); return page;
  }
  const host = () => container ? container.querySelector('.demo-panel-host') : null;
  function updateStepper() {
    if (!container) return;
    const active = flow.stage === 'review' ? 2 : 1;
    container.querySelectorAll('.demo-step').forEach(step => {
      const number = Number(step.dataset.step);
      step.dataset.state = number < active ? 'done' : number === active ? 'active' : 'idle';
    });
  }
  function pendingCard(tx) {
    const card = node('button', 'demo-pending-context'); card.type = 'button';
    const marker = node('span', 'demo-pending-context__marker'); const markerIcon = node('i'); markerIcon.className = 'fas fa-clock'; marker.appendChild(markerIcon);
    const body = node('span', 'demo-pending-context__body'); body.append(node('span', 'demo-pending-context__title', 'One deposit is awaiting review'), node('span', 'demo-pending-context__copy', `${money(tx.amount)} · ${rail(tx.metadata && tx.metadata.rail).title}`));
    const action = node('span', 'demo-pending-context__action', 'View'); const arrow = node('i'); arrow.className = 'fas fa-arrow-right'; action.appendChild(arrow);
    card.append(marker, body, action); card.addEventListener('click', () => openTransaction(tx, 'deposit')); return card;
  }
  function railGrid() {
    const grid = node('div', 'demo-rail-grid');
    RAILS.forEach(item => {
      const button = node('button', 'demo-rail'); button.type = 'button'; button.dataset.rail = item.id; button.setAttribute('aria-pressed', String(flow.rail === item.id));
      const icon = node('span', 'demo-rail__icon'); const glyph = node('i'); glyph.className = 'fas ' + item.icon; icon.appendChild(glyph);
      const body = node('span'); body.append(node('span', 'demo-rail__title', item.title), node('span', 'demo-rail__sub', item.subtitle));
      const check = node('span', 'demo-rail__check'); const checkIcon = node('i'); checkIcon.className = 'fas fa-check'; check.appendChild(checkIcon);
      button.append(icon, body, check);
      button.addEventListener('click', () => { flow.rail = item.id; grid.querySelectorAll('.demo-rail').forEach(candidate => candidate.setAttribute('aria-pressed', String(candidate.dataset.rail === flow.rail))); });
      grid.appendChild(button);
    });
    return grid;
  }
  function assurance(title, copy, iconName) {
    const card = node('div', 'demo-assurance'); const icon = node('div', 'demo-assurance__icon'); const glyph = node('i'); glyph.className = 'fas ' + iconName; icon.appendChild(glyph);
    const body = node('div'); body.append(node('div', 'demo-assurance__title', title), node('div', 'demo-assurance__copy', copy)); card.append(icon, body); return card;
  }
  function renderConfigure() {
    const target = host(); if (!target) return; target.innerHTML = '';
    const pending = latestPending(); if (pending) target.appendChild(pendingCard(pending));
    const panel = node('section', 'demo-panel'); panel.append(node('div', 'demo-section-label', 'Demo amount'));
    const amountShell = node('label', 'demo-amount-shell'); amountShell.append(node('span', 'demo-amount-currency', '$'));
    const input = node('input', 'demo-amount-input'); input.type = 'number'; input.inputMode = 'decimal'; input.min = '10'; input.max = '100000'; input.step = '0.01'; input.placeholder = '0.00'; input.value = flow.amount; input.setAttribute('aria-label', 'Demo deposit amount'); input.addEventListener('input', () => { flow.amount = input.value; });
    amountShell.appendChild(input); panel.append(amountShell, node('div', 'demo-field-note', 'Simulation range: $10–$100,000. Nothing leaves your device or wallet.'), node('div', 'demo-section-label', 'Payment rail'), railGrid());
    panel.appendChild(assurance('Portfolio simulation only', 'The next screen uses a non-routable destination. NexTrade creates a pending demo-ledger request for human review.', 'fa-shield-halved'));
    const actions = node('div', 'demo-panel-actions'); const continueButton = node('button', 'btn btn-primary btn-emphasis', 'Review demo transfer'); continueButton.type = 'button';
    continueButton.addEventListener('click', () => {
      const amount = Number(flow.amount);
      if (!Number.isFinite(amount) || amount < 10 || amount > 100000) { if (window.App) App.showError('Enter a demo amount between $10 and $100,000.'); input.focus(); return; }
      flow.amount = String(Number(amount.toFixed(8))); flow.reference = reference(); flow.stage = 'review'; renderStage();
    });
    actions.appendChild(continueButton); panel.appendChild(actions); target.appendChild(panel); requestAnimationFrame(() => input.focus());
  }
  function destination() {
    const configured = window.APP_CONFIG && APP_CONFIG.depositAddresses && APP_CONFIG.depositAddresses[flow.rail];
    return (configured && configured.address) || 'TEST_ONLY_DO_NOT_SEND_REAL_FUNDS';
  }
  function detailRow(key, value) { const row = node('div', 'demo-detail-row'); row.append(node('div', 'demo-detail-key', key), node('div', 'demo-detail-value', value), node('span')); return row; }
  function renderReview() {
    const target = host(); if (!target) return; target.innerHTML = '';
    const panel = node('section', 'demo-panel'); const hero = node('div', 'demo-review-hero'); const left = node('div');
    left.append(node('div', 'demo-section-label', 'Declared amount'), node('div', 'demo-review-amount', money(flow.amount))); hero.append(left, node('div', 'demo-review-chip', rail(flow.rail).title)); panel.appendChild(hero);
    const details = node('div', 'demo-detail-list'); details.append(detailRow('Reference', flow.reference), detailRow('Demo destination', destination()), detailRow('Settlement', 'Human review')); panel.appendChild(details);
    panel.appendChild(assurance('Human-reviewed demo settlement', 'Submitting creates a pending ledger event. Your Spot balance changes only after approval.', 'fa-user-check'));
    panel.appendChild(assurance('Do not send real crypto', 'The destination above cannot receive funds. The action below simulates the declaration step only.', 'fa-triangle-exclamation'));
    const actions = node('div', 'demo-panel-actions'); const back = node('button', 'btn btn-secondary btn-emphasis', 'Back'); back.type = 'button'; back.addEventListener('click', () => { flow.stage = 'configure'; renderStage(); });
    const submit = node('button', 'btn btn-primary btn-emphasis', 'I completed the demo transfer'); submit.type = 'button'; submit.addEventListener('click', () => submitDemo(submit)); actions.append(back, submit); panel.appendChild(actions); target.appendChild(panel);
  }
  async function token() {
    if (!window.supabaseClient) throw new Error('Secure session unavailable');
    const { data, error } = await supabaseClient.auth.getSession(); if (error) throw error;
    if (!data || !data.session || !data.session.access_token) throw new Error('Session expired. Sign in again.');
    return data.session.access_token;
  }
  async function submitDemo(button) {
    if (flow.submitting) return;
    const currentUser = user(); if (!currentUser || !currentUser.id) { if (window.App) App.showError('Session not found. Refresh the app.'); return; }
    const amount = Number(flow.amount); if (!Number.isFinite(amount) || amount < 10 || amount > 100000) { if (window.App) App.showError('Invalid demo amount'); return; }
    flow.submitting = true; button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Submitting for review…';
    try {
      const accessToken = await token(); if (!window.RequestId) throw new Error('Secure request identifier unavailable');
      const fingerprint = [flow.rail, amount.toFixed(8), flow.reference].join('|'); const key = RequestId.get('deposit', fingerprint);
      const api = (window.APP_CONFIG && APP_CONFIG.apis && APP_CONFIG.apis.demoDeposit) || '/api/demo-deposit';
      const response = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accessToken }, body: JSON.stringify({ amount, idempotencyKey: key, depositReference: flow.reference, rail: flow.rail }) });
      const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Could not submit demo deposit'); if (!payload.tx_id) throw new Error('Demo settlement service returned an invalid response');
      RequestId.clear('deposit', key);
      const transaction = { id: payload.tx_id, user_id: currentUser.id, type: 'deposit', amount, status: payload.status || 'pending', description: 'Demo deposit (' + rail(flow.rail).title + ') — Ref: ' + flow.reference, metadata: { manual_deposit_test: true, test_only: true, demo_deposit: true, deposit_reference: flow.reference, rail: flow.rail }, created_at: payload.created_at || new Date().toISOString() };
      if (window.AppState) AppState.addTransaction(transaction);
      if (window.App) App.showSuccess('Demo settlement submitted for review');
      openTransaction(transaction, 'wallet');
    } catch (error) {
      const pending = latestPending();
      if (pending && /already awaiting review/i.test(String(error.message || ''))) {
        if (window.App && App.showWarning) App.showWarning('You already have a deposit awaiting review.');
        openTransaction(pending, 'deposit'); return;
      }
      flow.submitting = false; button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = 'I completed the demo transfer'; if (window.App) App.showError(error.message || 'Submission failed');
    }
  }
  function renderStage() { updateStepper(); if (flow.stage === 'review') renderReview(); else renderConfigure(); }
  function render(target) {
    container = target; if (!container) return;
    flow.stage = 'configure'; flow.amount = ''; flow.reference = ''; flow.rail = 'ETH_ERC20'; flow.submitting = false;
    container.innerHTML = ''; container.appendChild(shell()); renderStage();
  }
  function cleanup() { container = null; }
  return Object.freeze({ render, cleanup });
})();
if (typeof window !== 'undefined') window.Deposit = Deposit;
