/**
 * NexTrade — Transaction Presentation Authority
 *
 * Financial meaning is decided once here.
 * Home, Wallet and Feed consume the result.
 *
 * State outranks direction:
 *   pending   -> warning; not yet settled
 *   approved/completed -> direction may become +/- money movement
 *   rejected/failed -> danger; never presented as successful credit
 *   cancelled -> neutral
 */

(function () {
  'use strict';

  const TYPES = Object.freeze({
    deposit: {
      label: 'Deposit',
      icon: 'fa-arrow-down',
      direction: 'credit'
    },
    withdraw: {
      label: 'Withdrawal',
      icon: 'fa-arrow-up',
      direction: 'debit'
    },
    buy: {
      label: 'Buy Order',
      icon: 'fa-arrow-trend-up',
      direction: 'debit'
    },
    sell: {
      label: 'Sell Order',
      icon: 'fa-arrow-trend-down',
      direction: 'credit'
    },
    investment: {
      label: 'Strategy Entry',
      icon: 'fa-layer-group',
      direction: 'debit'
    },
    claim: {
      label: 'Cycle Return',
      icon: 'fa-coins',
      direction: 'credit'
    },
    transfer_in: {
      label: 'Transfer In',
      icon: 'fa-arrows-left-right',
      direction: 'credit'
    },
    transfer_out: {
      label: 'Transfer Out',
      icon: 'fa-arrows-left-right',
      direction: 'debit'
    }
  });

  const STATUS_LABEL = Object.freeze({
    pending: 'Pending',
    approved: 'Approved',
    completed: 'Completed',
    rejected: 'Declined',
    failed: 'Failed',
    cancelled: 'Cancelled'
  });

  const CONTEXT = Object.freeze({
    deposit: {
      pending: 'Awaiting manual review',
      approved: 'Credited to Spot Wallet',
      completed: 'Credited to Spot Wallet',
      rejected: 'Deposit declined',
      failed: 'Deposit failed',
      cancelled: 'Deposit cancelled'
    },
    withdraw: {
      pending: 'Processing request',
      approved: 'Withdrawal approved',
      completed: 'Sent from Spot Wallet',
      rejected: 'Withdrawal declined',
      failed: 'Withdrawal failed',
      cancelled: 'Withdrawal cancelled'
    },
    buy: {
      pending: 'Order pending',
      approved: 'Purchase approved',
      completed: 'Crypto bought via Spot',
      rejected: 'Order declined',
      failed: 'Order failed',
      cancelled: 'Order cancelled'
    },
    sell: {
      pending: 'Order pending',
      approved: 'Sale approved',
      completed: 'Proceeds credited to Spot',
      rejected: 'Order declined',
      failed: 'Sale failed',
      cancelled: 'Order cancelled'
    },
    investment: {
      pending: 'Strategy entry pending',
      approved: 'Strategy entry approved',
      completed: 'Capital deployed in Vault',
      rejected: 'Strategy entry declined',
      failed: 'Strategy entry failed',
      cancelled: 'Strategy entry cancelled'
    },
    claim: {
      pending: 'Cycle return processing',
      approved: 'Cycle return approved',
      completed: 'Return credited to Spot Wallet',
      rejected: 'Claim declined',
      failed: 'Claim failed',
      cancelled: 'Claim cancelled'
    },
    transfer_in: {
      pending: 'Transfer pending',
      approved: 'Transfer approved',
      completed: 'Vault → Spot Wallet',
      rejected: 'Transfer declined',
      failed: 'Transfer failed',
      cancelled: 'Transfer cancelled'
    },
    transfer_out: {
      pending: 'Transfer pending',
      approved: 'Transfer approved',
      completed: 'Spot Wallet → Vault',
      rejected: 'Transfer declined',
      failed: 'Transfer failed',
      cancelled: 'Transfer cancelled'
    }
  });

  function normaliseType(value) {
    return String(value || '')
      .trim()
      .toLowerCase();
  }

  function normaliseStatus(value) {
    const status = String(value || '')
      .trim()
      .toLowerCase();

    return status || 'completed';
  }

  function titleCase(value) {
    return String(value || 'Transaction')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function explicitDescription(tx, type) {
    const description =
      typeof tx.description === 'string'
        ? tx.description.trim()
        : '';

    if (!description) return '';
    if (description.toLowerCase() === type) return '';

    return description;
  }

  function present(tx = {}) {
    const type = normaliseType(tx.type);
    const status = normaliseStatus(tx.status);

    const meta = TYPES[type] || {
      label: titleCase(type || 'Transaction'),
      icon: 'fa-circle-dot',
      direction: 'neutral'
    };

    let tone = 'neutral';
    let amountPrefix = '';

    if (status === 'pending') {
      tone = 'warning';
    } else if (
      status === 'rejected' ||
      status === 'failed'
    ) {
      tone = 'danger';
    } else if (status === 'cancelled') {
      tone = 'neutral';
    } else if (
      status === 'approved' ||
      status === 'completed'
    ) {
      if (meta.direction === 'credit') {
        tone = 'success';
        amountPrefix = '+';
      } else if (meta.direction === 'debit') {
        tone = 'danger';
        amountPrefix = '-';
      }
    }

    const contextual =
      CONTEXT[type] &&
      CONTEXT[type][status]
        ? CONTEXT[type][status]
        : STATUS_LABEL[status] || titleCase(status);

    return Object.freeze({
      type,
      status,
      label: meta.label,
      icon: meta.icon,
      direction: meta.direction,
      tone,
      amountPrefix,
      statusLabel:
        STATUS_LABEL[status] ||
        titleCase(status),
      context:
        explicitDescription(tx, type) ||
        contextual
    });
  }

  window.TransactionUI = Object.freeze({
    present
  });
})();
