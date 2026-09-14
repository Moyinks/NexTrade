/**
 * NexTrade — deterministic display math
 *
 * Mutation authority lives in Postgres. This module mirrors the same formulae
 * for previews only, so UI estimates do not invent a second financial model.
 */
(function () {
  'use strict';
  if (window.FinanceMath) return;

  const DAY_MS = 86400000;

  function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function percentToRate(value) {
    const n = finite(value, 0);
    return n > 1 ? n / 100 : n;
  }

  function durationDays(inv) {
    const explicit = finite(inv && (inv.duration_days ?? inv.durationDays ?? inv.duration), 0);
    if (explicit > 0) return explicit;
    const start = Date.parse(inv && inv.created_at);
    const end = Date.parse(inv && inv.matures_at);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return (end - start) / DAY_MS;
    }
    return 30;
  }

  function progress(inv, now = Date.now()) {
    const start = Date.parse(inv && inv.created_at);
    if (!Number.isFinite(start)) return 0;

    // Postgres computes progress from the immutable [created_at, matures_at]
    // span. Prefer that exact span here so migrated positions cannot drift from
    // server claim math if a legacy duration_days snapshot is inconsistent.
    const maturity = Date.parse(inv && inv.matures_at);
    if (Number.isFinite(maturity) && maturity > start) {
      return clamp((now - start) / (maturity - start), 0, 1);
    }

    const days = durationDays(inv);
    if (!(days > 0)) return 0;
    return clamp((now - start) / (days * DAY_MS), 0, 1);
  }

  function investmentEstimate(inv, now = Date.now()) {
    const principal = Math.max(0, finite(inv && inv.amount, 0));
    const p = progress(inv, now);
    const targetRate = Math.max(0, percentToRate(inv && inv.apy));
    const perfFeeRate = clamp(percentToRate(inv && inv.perf_fee), 0, 1);
    const grossProfit = principal * targetRate * p;
    const performanceFee = Math.max(0, grossProfit) * perfFeeRate;
    const netProfit = grossProfit - performanceFee;
    const value = Math.max(0, principal + netProfit);

    const maturityGrossProfit = principal * targetRate;
    const maturityFee = Math.max(0, maturityGrossProfit) * perfFeeRate;
    const atMaturity = Math.max(0, principal + maturityGrossProfit - maturityFee);

    return Object.freeze({
      principal,
      progress: p,
      targetRate,
      perfFeeRate,
      grossProfit,
      performanceFee,
      netProfit,
      value,
      atMaturity
    });
  }

  function earlyExit(inv, penaltyRateInput, now = Date.now()) {
    const est = investmentEstimate(inv, now);
    const penaltyRate = clamp(percentToRate(
      penaltyRateInput != null ? penaltyRateInput : inv && inv.penalty_rate
    ), 0, 1);
    const remaining = 1 - est.progress;
    const penalty = est.progress < 1 ? est.value * penaltyRate * remaining : 0;
    return Object.freeze({
      ...est,
      remaining,
      penaltyRate,
      penalty,
      received: Math.max(0, est.value - penalty),
      isEarly: est.progress < 1
    });
  }

  window.FinanceMath = Object.freeze({
    finite,
    percentToRate,
    durationDays,
    progress,
    investmentEstimate,
    earlyExit
  });
})();
