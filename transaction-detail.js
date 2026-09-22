const Transactiondetail = (() => {
  'use strict';
  let container = null;
  let transactionId = null;
  let returnRoute = 'wallet';
  let unsubscribe = null;
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  const transactions = () => window.AppState ? (AppState.get('transactions') || []) : [];
  const current = () => transactionId ? (transactions().find(tx => tx && tx.id === transactionId) || null) : null;
  function presentation(tx) {
    return window.TransactionUI && TransactionUI.present
      ? TransactionUI.present(tx)
      : { label: 'Transaction', status: String(tx.status || 'unknown'), statusLabel: String(tx.status || 'Unknown'), tone: 'neutral', amountPrefix: '', context: String(tx.description || '') };
  }
  function money(value) {
    return window.Format && Format.currency ? Format.currency(Number(value || 0)) : '$' + Number(value || 0).toFixed(2);
  }
  function dateTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function railLabel(value) {
    return { ETH_ERC20: 'ERC-20 Simulation', USDT_TRC20: 'TRC-20 Simulation', BTC: 'Bitcoin Simulation' }[value] || value || null;
  }
  function open(id) {
    transactionId = id;
    if (window.App && App.navigate) App.navigate('transactiondetail');
  }

  function back() {
    if (window.App && typeof App.back === 'function') {
      App.back('wallet');
      return;
    }
    if (window.App && App.navigate) App.navigate(returnRoute || 'wallet');
  }
  function recordRow(key, value, mono = false) {
    const row = node('div', 'transaction-record-row');
    row.append(node('div', 'transaction-record-row__key', key));
    const valueElement = node('div', 'transaction-record-row__value', value == null || value === '' ? '—' : String(value));
    if (mono) valueElement.classList.add('is-mono');
    row.appendChild(valueElement);
    return row;
  }
  function statusEventModel(tx, view) {
    const metadata = tx.metadata || {};
    const reviewedAt = metadata.reviewed_at || null;
    const result = [{ title: 'Request submitted', meta: dateTime(tx.created_at), state: 'done' }];
    if (view.status === 'pending') {
      result.push({ title: 'Review in progress', meta: 'Awaiting human verification', state: 'active' });
      result.push({ title: 'Decision', meta: 'Not decided yet', state: 'idle' });
      return result;
    }
    result.push({ title: 'Reviewed', meta: dateTime(reviewedAt || tx.updated_at), state: 'done' });
    if (view.status === 'approved' || view.status === 'completed') {
      result.push({ title: 'Credited', meta: dateTime(reviewedAt || tx.updated_at), state: 'done' });
    } else if (view.status === 'rejected' || view.status === 'failed' || view.status === 'cancelled') {
      result.push({ title: view.status === 'rejected' ? 'Declined' : view.statusLabel, meta: metadata.decline_reason || view.context, state: 'danger' });
    }
    return result;
  }
  function receiptText(tx, view) {
    const metadata = tx.metadata || {};
    const parts = [
      'NexTrade Transaction Receipt', '',
      `${view.label}: ${view.amountPrefix}${money(tx.amount)}`,
      `Status: ${view.statusLabel}`,
      `Submitted: ${dateTime(tx.created_at)}`
    ];
    if (metadata.rail) parts.push(`Network: ${railLabel(metadata.rail)}`);
    if (metadata.deposit_reference) parts.push(`Reference: ${metadata.deposit_reference}`);
    parts.push(`Transaction ID: ${tx.id}`);
    if (metadata.demo_deposit === true || metadata.test_only === true) {
      parts.push('', 'Portfolio simulation — no real funds transferred.');
    }
    return parts.join('\n');
  }
  async function share(tx, view) {
    const text = receiptText(tx, view);
    if (navigator.share) {
      try { await navigator.share({ title: 'NexTrade Transaction Receipt', text }); return; }
      catch (error) { if (error && error.name === 'AbortError') return; }
    }
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      if (window.App) App.showSuccess('Receipt copied');
    }
  }
  function printReceipt() { window.print(); }
  function buildReceipt(tx, view) {
    const metadata = tx.metadata || {};
    const receipt = node('section', 'transaction-receipt');
    const head = node('div', 'transaction-receipt__head');
    head.append(node('div', 'transaction-receipt__brand', 'NexTrade'));
    head.append(node('div', 'transaction-receipt__caption', 'Transaction receipt'));
    receipt.appendChild(head);
    const rows = node('div', 'transaction-receipt__rows');
    rows.append(recordRow('Amount', view.amountPrefix + money(tx.amount), true));
    rows.append(recordRow('Status', view.statusLabel));
    rows.append(recordRow('Transaction', view.label));
    rows.append(recordRow('Submitted', dateTime(tx.created_at)));
    if (metadata.rail) rows.append(recordRow('Network', railLabel(metadata.rail)));
    if (metadata.deposit_reference) rows.append(recordRow('Reference', metadata.deposit_reference, true));
    if (metadata.reviewed_at || tx.status === 'approved' || tx.status === 'rejected') rows.append(recordRow('Reviewed', dateTime(metadata.reviewed_at || tx.updated_at)));
    if (metadata.demo_deposit === true || metadata.test_only === true) rows.append(recordRow('Settlement', 'Human-reviewed demo'));
    receipt.appendChild(rows);
    if (metadata.demo_deposit === true || metadata.test_only === true) {
      receipt.appendChild(node('div','transaction-receipt__notice','Portfolio simulation — no real funds transferred.'));
    }
    return receipt;
  }
  function renderRecord(tx) {
    const view = presentation(tx);
    const metadata = tx.metadata || {};
    const page = node('section', 'transaction-detail-page');
    const topbar = node('header', 'transaction-detail-topbar');
    const backButton = node('button', 'transaction-detail-topbar__back');
    backButton.type = 'button'; backButton.setAttribute('aria-label', 'Back');
    const backIcon = node('i'); backIcon.className = 'fas fa-arrow-left'; backButton.appendChild(backIcon); backButton.addEventListener('click', back);
    topbar.append(backButton, node('div', 'transaction-detail-topbar__title', 'Transaction'));
    const shareButton = node('button', 'transaction-detail-topbar__share');
    shareButton.type = 'button'; shareButton.setAttribute('aria-label', 'Share receipt');
    const shareIcon = node('i'); shareIcon.className = 'fas fa-share-nodes'; shareButton.appendChild(shareIcon); shareButton.addEventListener('click', () => share(tx, view)); topbar.appendChild(shareButton);
    const main = node('main', 'transaction-detail-main');
    const summary = node('section', 'transaction-summary');
    const status = node('div', 'transaction-summary__status', view.statusLabel); status.dataset.tone = view.tone;
    summary.append(status, node('div', 'transaction-summary__amount', view.amountPrefix + money(tx.amount)), node('div', 'transaction-summary__label', view.label), node('div', 'transaction-summary__context', view.context));
    main.append(summary, buildReceipt(tx, view));
    const timeline = node('section', 'transaction-timeline'); timeline.append(node('div', 'transaction-timeline__title', 'Activity'));
    const eventList = node('div', 'transaction-timeline__list');
    statusEventModel(tx, view).forEach(event => {
      const item = node('div', 'transaction-event'); item.dataset.state = event.state;
      item.append(node('div', 'transaction-event__title', event.title), node('div', 'transaction-event__meta', event.meta)); eventList.appendChild(item);
    });
    timeline.appendChild(eventList); main.appendChild(timeline);
    const actions = node('div', 'transaction-detail-actions');
    const shareAction = node('button', 'btn btn-secondary btn-emphasis', 'Share'); shareAction.type = 'button';
    const saIcon = node('i'); saIcon.className = 'fas fa-share-nodes'; shareAction.prepend(saIcon); shareAction.addEventListener('click', () => share(tx, view));
    const receiptAction = node('button', 'btn btn-primary btn-emphasis', 'Receipt'); receiptAction.type = 'button';
    const rIcon = node('i'); rIcon.className = 'fas fa-file-arrow-down'; receiptAction.prepend(rIcon); receiptAction.addEventListener('click', printReceipt);
    actions.append(shareAction, receiptAction); main.appendChild(actions);
    const tech = node('details', 'transaction-tech'); tech.append(node('summary', '', 'Technical details'));
    const techBody = node('div', 'transaction-tech__body'); const techRows = node('div', 'transaction-receipt__rows');
    techRows.append(recordRow('Transaction ID', tx.id, true));
    if (tx.updated_at) techRows.append(recordRow('Last updated', dateTime(tx.updated_at)));
    if (metadata.review_status) techRows.append(recordRow('Review state', metadata.review_status));
    techBody.appendChild(techRows); tech.appendChild(techBody); main.appendChild(tech);
    page.append(topbar, main); return page;
  }
  function renderEmpty() {
    const page = node('section', 'transaction-detail-page'); const empty = node('div', 'transaction-empty-record');
    const icon = node('i'); icon.className = 'fas fa-receipt'; empty.append(icon, document.createTextNode('Transaction record unavailable.'));
    const button = node('button', 'btn btn-secondary btn-emphasis', 'Back to Wallet'); button.type = 'button'; button.addEventListener('click', () => window.App && App.navigate('wallet')); empty.appendChild(button); page.appendChild(empty); return page;
  }
  function rerender() { if (!container) return; const tx = current(); container.innerHTML = ''; container.appendChild(tx ? renderRecord(tx) : renderEmpty()); }
  function render(target) {
    container = target; if (!container) return; rerender();
    if (window.AppState && !unsubscribe) unsubscribe = AppState.subscribe('transactions', rerender);
  }
  function cleanup() { if (typeof unsubscribe === 'function') unsubscribe(); unsubscribe = null; container = null; }
  return Object.freeze({ open, back, render, cleanup });
})();
if (typeof window !== 'undefined') window.Transactiondetail = Transactiondetail;
