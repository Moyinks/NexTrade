const Deposit = (() => {
  'use strict';

  const RAILS = Object.freeze([
    { id: 'ETH_ERC20', title: 'ERC-20', subtitle: 'Ethereum simulation', icon: 'fa-ethereum' },
    { id: 'USDT_TRC20', title: 'TRC-20', subtitle: 'Tron simulation', icon: 'fa-coins' },
    { id: 'BTC', title: 'Bitcoin', subtitle: 'Bitcoin simulation', icon: 'fa-bitcoin' }
  ]);

  let container = null;
  let sheet = null;

  const flow = {
    stage: 'configure',
    rail: 'ETH_ERC20',
    amount: '',
    reference: '',
    submitting: false
  };

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function user() {
    return window.AppState ? AppState.get('user') : null;
  }

  function transactions() {
    return window.AppState ? (AppState.get('transactions') || []) : [];
  }

  function rail(id) {
    return RAILS.find(item => item.id === id) || RAILS[0];
  }

  function money(value) {
    return window.Format && Format.currency
      ? Format.currency(Number(value || 0))
      : '$' + Number(value || 0).toFixed(2);
  }

  function latestPending() {
    return transactions().find(tx => {
      const metadata = tx && tx.metadata;
      return Boolean(
        tx &&
        tx.type === 'deposit' &&
        tx.status === 'pending' &&
        metadata &&
        (metadata.demo_deposit === true || metadata.manual_deposit_test === true)
      );
    }) || null;
  }

  function makeReference() {
    const currentUser = user();
    const prefix = currentUser && currentUser.id
      ? currentUser.id.slice(0, 8).toUpperCase()
      : 'ANON0000';

    return 'NXT-' + prefix + '-' + Date.now().toString(36).toUpperCase();
  }

  function goBack() {
    if (window.App && typeof App.back === 'function') {
      App.back('wallet');
      return;
    }
    if (window.App && App.navigate) App.navigate('wallet');
  }

  function openTransaction(tx, source = 'deposit') {
    if (tx && tx.id && window.Transactiondetail) {
      Transactiondetail.open(tx.id, source);
    }
  }

  function destination() {
    const configured =
      window.APP_CONFIG &&
      APP_CONFIG.depositAddresses &&
      APP_CONFIG.depositAddresses[flow.rail];

    return (configured && configured.address) || 'TEST_ONLY_DO_NOT_SEND_REAL_FUNDS';
  }

  function closeRailSheet() {
    if (!sheet) return;
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');

    window.setTimeout(() => {
      if (!sheet) return;
      sheet.remove();
      sheet = null;
    }, 220);
  }

  function openRailSheet() {
    if (sheet || !container) return;

    sheet = node('div', 'demo-sheet-layer');
    sheet.setAttribute('aria-hidden', 'false');

    const scrim = node('button', 'demo-sheet-scrim');
    scrim.type = 'button';
    scrim.setAttribute('aria-label', 'Close payment method selector');
    scrim.addEventListener('click', closeRailSheet);

    const panel = node('section', 'demo-sheet');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Choose payment method');

    panel.appendChild(node('div', 'demo-sheet__handle'));

    const head = node('div', 'demo-sheet__head');
    head.append(
      node('div', 'demo-sheet__title', 'Choose payment method'),
      node('div', 'demo-sheet__copy', 'Pick one rail. Only the selected method stays on the form.')
    );
    panel.appendChild(head);

    const list = node('div', 'demo-sheet__list');

    RAILS.forEach(item => {
      const option = node('button', 'demo-sheet-option');
      option.type = 'button';
      option.setAttribute('aria-pressed', String(item.id === flow.rail));

      const icon = node('span', 'demo-sheet-option__icon');
      const glyph = node('i');
      glyph.className = 'fas ' + item.icon;
      icon.appendChild(glyph);

      const body = node('span', 'demo-sheet-option__body');
      body.append(
        node('span', 'demo-sheet-option__title', item.title),
        node('span', 'demo-sheet-option__sub', item.subtitle)
      );

      const indicator = node('span', 'demo-sheet-option__indicator');
      const check = node('i');
      check.className = 'fas fa-check';
      indicator.appendChild(check);

      option.append(icon, body, indicator);
      option.addEventListener('click', () => {
        flow.rail = item.id;
        closeRailSheet();
        window.setTimeout(renderStage, 160);
      });

      list.appendChild(option);
    });

    panel.appendChild(list);
    sheet.append(scrim, panel);
    container.appendChild(sheet);

    requestAnimationFrame(() => {
      if (sheet) sheet.classList.add('is-open');
    });
  }

  function currentRailRow() {
    const selected = rail(flow.rail);
    const button = node('button', 'demo-method-trigger');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'dialog');

    const icon = node('span', 'demo-method-trigger__icon');
    const glyph = node('i');
    glyph.className = 'fas ' + selected.icon;
    icon.appendChild(glyph);

    const body = node('span', 'demo-method-trigger__body');
    body.append(
      node('span', 'demo-method-trigger__title', selected.title),
      node('span', 'demo-method-trigger__sub', selected.subtitle)
    );

    const action = node('span', 'demo-method-trigger__action', 'Change');
    const chevron = node('i');
    chevron.className = 'fas fa-chevron-right';
    action.appendChild(chevron);

    button.append(icon, body, action);
    button.addEventListener('click', openRailSheet);
    return button;
  }

  function pendingCard(tx) {
    const card = node('button', 'demo-pending-context');
    card.type = 'button';

    const marker = node('span', 'demo-pending-context__marker');
    const glyph = node('i');
    glyph.className = 'fas fa-clock';
    marker.appendChild(glyph);

    const body = node('span', 'demo-pending-context__body');
    body.append(
      node('span', 'demo-pending-context__title', 'Deposit awaiting review'),
      node('span', 'demo-pending-context__copy', money(tx.amount) + ' · ' + rail(tx.metadata && tx.metadata.rail).title)
    );

    const action = node('span', 'demo-pending-context__action', 'View');
    const arrow = node('i');
    arrow.className = 'fas fa-arrow-right';
    action.appendChild(arrow);

    card.append(marker, body, action);
    card.addEventListener('click', () => openTransaction(tx));
    return card;
  }

  function shell() {
    const page = node('section', 'demo-deposit-page');
    const topbar = node('header', 'demo-deposit-topbar');

    const back = node('button', 'demo-deposit-back');
    back.type = 'button';
    back.setAttribute('aria-label', 'Back');
    const backIcon = node('i');
    backIcon.className = 'fas fa-arrow-left';
    back.appendChild(backIcon);
    back.addEventListener('click', goBack);

    const titleGroup = node('div', 'demo-deposit-topbar__title');
    titleGroup.append(
      node('strong', '', 'Deposit'),
      node('span', '', 'Demo settlement')
    );

    const badge = node('div', 'demo-sim-badge');
    const flask = node('i');
    flask.className = 'fas fa-flask';
    badge.append(flask, node('span', '', 'Simulation'));

    topbar.append(back, titleGroup, badge);

    const main = node('main', 'demo-deposit-main');
    const intro = node('section', 'demo-flow-head');
    intro.append(
      node('div', 'demo-flow-head__eyebrow', 'Demo deposit'),
      node('h1', 'demo-flow-head__title', 'Add funds to your demo balance'),
      node('p', 'demo-flow-head__copy', 'Simulate a reviewed settlement. No real assets are transferred.')
    );

    const progress = node('div', 'demo-flow-progress');
    progress.innerHTML =
      '<span>Step <strong id="demo-step-current">1</strong> of 2</span>' +
      '<span class="demo-flow-progress__track"><span id="demo-progress-fill"></span></span>';

    const host = node('div', 'demo-panel-host');

    main.append(intro, progress, host);
    page.append(topbar, main);
    return page;
  }

  function host() {
    return container ? container.querySelector('.demo-panel-host') : null;
  }

  function updateProgress() {
    if (!container) return;
    const step = flow.stage === 'review' ? 2 : 1;
    const current = container.querySelector('#demo-step-current');
    const fill = container.querySelector('#demo-progress-fill');
    if (current) current.textContent = String(step);
    if (fill) fill.dataset.step = String(step);
  }

  function renderConfigure() {
    const target = host();
    if (!target) return;
    target.replaceChildren();

    const pending = latestPending();
    if (pending) target.appendChild(pendingCard(pending));

    const panel = node('section', 'demo-panel demo-panel--compact');

    const amountLabel = node('label', 'demo-field');
    amountLabel.appendChild(node('span', 'demo-field__label', 'Amount'));

    const amountShell = node('span', 'demo-amount-shell');
    amountShell.appendChild(node('span', 'demo-amount-currency', '$'));

    const input = node('input', 'demo-amount-input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '10';
    input.max = '100000';
    input.step = '0.01';
    input.placeholder = '0.00';
    input.value = flow.amount;
    input.setAttribute('aria-label', 'Demo deposit amount');
    input.addEventListener('input', () => {
      flow.amount = input.value;
    });

    amountShell.appendChild(input);
    amountLabel.append(amountShell, node('span', 'demo-field__hint', '$10–$100,000'));

    const method = node('div', 'demo-field');
    method.append(
      node('span', 'demo-field__label', 'Payment method'),
      currentRailRow()
    );

    const disclosure = node('details', 'demo-disclosure');
    disclosure.append(
      node('summary', '', 'How demo deposits work'),
      node('p', '', 'NexTrade creates a pending demo-ledger request for human review. The displayed destination is deliberately non-routable, and no real funds should be sent.')
    );

    const actions = node('div', 'demo-panel-actions');
    const continueButton = node('button', 'btn btn-primary btn-emphasis demo-primary-action', 'Continue');
    continueButton.type = 'button';
    continueButton.addEventListener('click', () => {
      const amount = Number(flow.amount);

      if (!Number.isFinite(amount) || amount < 10 || amount > 100000) {
        if (window.App) App.showError('Enter an amount between $10 and $100,000.');
        input.focus();
        return;
      }

      flow.amount = String(Number(amount.toFixed(8)));
      flow.reference = makeReference();
      flow.stage = 'review';
      renderStage();
    });

    actions.appendChild(continueButton);
    panel.append(amountLabel, method, disclosure, actions);
    target.appendChild(panel);
  }

  function detailRow(key, value, mono = false) {
    const row = node('div', 'demo-review-row');
    row.appendChild(node('span', 'demo-review-row__key', key));
    const valueNode = node('span', 'demo-review-row__value', value);
    if (mono) valueNode.classList.add('is-mono');
    row.appendChild(valueNode);
    return row;
  }

  function renderReview() {
    const target = host();
    if (!target) return;
    target.replaceChildren();

    const panel = node('section', 'demo-panel demo-panel--review');

    const summary = node('div', 'demo-review-summary');
    summary.append(
      node('div', 'demo-review-summary__label', 'Demo deposit'),
      node('div', 'demo-review-summary__amount', money(flow.amount)),
      node('div', 'demo-review-summary__method', rail(flow.rail).title)
    );

    const details = node('div', 'demo-review-list');
    details.append(
      detailRow('Payment method', rail(flow.rail).title),
      detailRow('Reference', flow.reference, true),
      detailRow('Settlement', 'Human review')
    );

    const destinationBlock = node('div', 'demo-destination');
    destinationBlock.append(
      node('span', 'demo-destination__label', 'Demo destination'),
      node('code', 'demo-destination__value', destination())
    );

    const warning = node('div', 'demo-review-warning');
    const warningIcon = node('i');
    warningIcon.className = 'fas fa-triangle-exclamation';
    warning.append(
      warningIcon,
      node('span', '', 'Simulation only. Do not send real crypto.')
    );

    const actions = node('div', 'demo-review-actions');

    const back = node('button', 'btn btn-secondary btn-emphasis', 'Back');
    back.type = 'button';
    back.addEventListener('click', () => {
      flow.stage = 'configure';
      renderStage();
    });

    const submit = node('button', 'btn btn-primary btn-emphasis', 'Submit for review');
    submit.type = 'button';
    submit.addEventListener('click', () => submitDemo(submit));

    actions.append(back, submit);
    panel.append(summary, details, destinationBlock, warning, actions);
    target.appendChild(panel);
  }

  async function token() {
    if (!window.supabaseClient) throw new Error('Secure session unavailable');

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;

    if (!data || !data.session || !data.session.access_token) {
      throw new Error('Session expired. Sign in again.');
    }

    return data.session.access_token;
  }

  async function submitDemo(button) {
    if (flow.submitting) return;

    const currentUser = user();
    if (!currentUser || !currentUser.id) {
      if (window.App) App.showError('Session not found. Refresh the app.');
      return;
    }

    const amount = Number(flow.amount);
    if (!Number.isFinite(amount) || amount < 10 || amount > 100000) {
      if (window.App) App.showError('Invalid demo amount');
      return;
    }

    flow.submitting = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Submitting…';

    try {
      const accessToken = await token();
      if (!window.RequestId) throw new Error('Secure request identifier unavailable');

      const fingerprint = [flow.rail, amount.toFixed(8), flow.reference].join('|');
      const key = RequestId.get('deposit', fingerprint);
      const api =
        (window.APP_CONFIG && APP_CONFIG.apis && APP_CONFIG.apis.demoDeposit) ||
        '/api/demo-deposit';

      const response = await fetch(api, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + accessToken
        },
        body: JSON.stringify({
          amount,
          idempotencyKey: key,
          depositReference: flow.reference,
          rail: flow.rail
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not submit demo deposit');
      if (!payload.tx_id) throw new Error('Demo settlement service returned an invalid response');

      RequestId.clear('deposit', key);

      const transaction = {
        id: payload.tx_id,
        user_id: currentUser.id,
        type: 'deposit',
        amount,
        status: payload.status || 'pending',
        description: 'Demo deposit (' + rail(flow.rail).title + ') — Ref: ' + flow.reference,
        metadata: {
          manual_deposit_test: true,
          test_only: true,
          demo_deposit: true,
          deposit_reference: flow.reference,
          rail: flow.rail
        },
        created_at: payload.created_at || new Date().toISOString()
      };

      if (window.AppState) AppState.addTransaction(transaction);
      if (window.App) App.showSuccess('Submitted for review');
      openTransaction(transaction);
    } catch (error) {
      const pending = latestPending();

      if (pending && /already awaiting review/i.test(String(error.message || ''))) {
        if (window.App && App.showWarning) {
          App.showWarning('You already have a deposit awaiting review.');
        }
        openTransaction(pending);
        return;
      }

      flow.submitting = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = 'Submit for review';

      if (window.App) App.showError(error.message || 'Submission failed');
    }
  }

  function renderStage() {
    updateProgress();
    if (flow.stage === 'review') {
      renderReview();
      return;
    }
    renderConfigure();
  }

  function render(target) {
    container = target;
    if (!container) return;

    flow.stage = 'configure';
    flow.amount = '';
    flow.reference = '';
    flow.rail = 'ETH_ERC20';
    flow.submitting = false;

    container.replaceChildren(shell());
    renderStage();
  }

  function cleanup() {
    closeRailSheet();
    container = null;
  }

  return Object.freeze({ render, cleanup });
})();

if (typeof window !== 'undefined') window.Deposit = Deposit;
