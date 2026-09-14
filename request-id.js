// request-id.js
// Reuses an idempotency key for the same in-flight user intent so a timeout,
// reconnect, or manual retry cannot accidentally duplicate a money mutation.
(function () {
  'use strict';

  const PREFIX = 'nextrade_pending_action:';
  const TTL_MS = 30 * 60 * 1000;
  const VALID_KIND = /^(deposit|withdraw|transfer|investment|claim|trade)$/;

  function assertCrypto() {
    if (!window.crypto || typeof window.crypto.randomUUID !== 'function') {
      throw new Error('Secure request identifiers are unavailable in this browser');
    }
  }

  function normalizeFingerprint(value) {
    if (typeof value === 'string') return value.slice(0, 1000);
    return JSON.stringify(value ?? null).slice(0, 1000);
  }

  function userScope() {
    try {
      const user = window.AppState && AppState.get('user');
      const id = user && typeof user.id === 'string' ? user.id : '';
      return /^[0-9a-f-]{36}$/i.test(id) ? id : 'session';
    } catch (_) {
      return 'session';
    }
  }

  function storageKey(kind) {
    return PREFIX + userScope() + ':' + kind;
  }

  function parse(kind) {
    try {
      const raw = localStorage.getItem(storageKey(kind));
      if (!raw) return null;
      const record = JSON.parse(raw);
      if (!record || typeof record !== 'object') return null;
      if (typeof record.key !== 'string' || typeof record.fingerprint !== 'string') return null;
      if (!Number.isFinite(Number(record.createdAt))) return null;
      if (Date.now() - Number(record.createdAt) > TTL_MS) {
        localStorage.removeItem(storageKey(kind));
        return null;
      }
      return record;
    } catch (_) {
      return null;
    }
  }

  function get(kind, fingerprint) {
    if (!VALID_KIND.test(kind)) throw new Error('Unknown request type');
    assertCrypto();
    const normalized = normalizeFingerprint(fingerprint);
    const existing = parse(kind);
    if (existing && existing.fingerprint === normalized) return existing.key;

    const key = `${kind}:${window.crypto.randomUUID()}`;
    localStorage.setItem(storageKey(kind), JSON.stringify({
      key,
      fingerprint: normalized,
      createdAt: Date.now()
    }));
    return key;
  }

  function clear(kind, key) {
    if (!VALID_KIND.test(kind)) return;
    const existing = parse(kind);
    if (!existing || (key && existing.key !== key)) return;
    try { localStorage.removeItem(storageKey(kind)); } catch (_) {}
  }

  window.RequestId = Object.freeze({ get, clear });
})();
