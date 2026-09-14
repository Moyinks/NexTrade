/**
 * NexTrade — Withdrawal Passphrase Module v1.1
 * ══════════════════════════════════════════════════════════════════════════════
 * Final confirmation step before a withdrawal request is submitted, on top
 * of (and after) KYC.
 *
 * IMPORTANT — this is NOT a crypto wallet seed phrase / BIP39 mnemonic.
 * NexTrade is custodial: deposit addresses are derived server-side from
 * NexTrade's own HD wallet xpub (see generate-address.js), so there is no
 * per-user wallet or recovery phrase to check against. This is a 5-word
 * secret phrase the user makes up and sets themselves inside NexTrade, hashed
 * server-side via set_withdrawal_passphrase / verify_withdrawal_passphrase
 * (as a single space-joined string), and is never compared or stored in
 * plaintext. See SCHEMA.sql for the canonical columns, RPCs, lockout, and replay controls.
 *
 * FLOW:
 *   trade.js openWithdraw() → (after KYC gate, after amount/address entered)
 *   → WithdrawalAuth.confirm(userId) → resolves true/false
 *     - No phrase set yet → "Create Your 5 Words" → "Confirm Your 5 Words"
 *       (two screens, so a typo isn't silently locked in). Confirming also
 *       authorizes this withdrawal (first-time setup).
 *     - Phrase already set → "Enter Your 5 Words" screen.
 *   Only on resolve(true) does trade.js proceed to call request_withdrawal.
 */

const WithdrawalAuth = (() => {
  'use strict';

  const WORD_COUNT = 5;

  // ── Status check — always fresh, never cached, mirrors KYC.check() ───────
  async function _getStatus() {
    if (!window.supabaseClient) return false;
    try {
      const { data, error } = await window.supabaseClient
        .rpc('get_withdrawal_passphrase_status');
      if (error) throw error;
      // RPC returns a single boolean (not wrapped in an array like table-returning RPCs)
      return data === true;
    } catch (err) {
      console.error('[WithdrawalAuth] Status check failed:', err.message);
      return false;
    }
  }

  function _errorBox() {
    const box = document.createElement('div');
    box.style.cssText = 'font-size:12px;color:#ef4444;display:none;';
    return box;
  }

  // ── 5-word input grid ──────────────────────────────────────────────────
  function _buildWordGrid(idPrefix) {
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';
    for (let i = 1; i <= WORD_COUNT; i++) {
      const cell = document.createElement('div');
      cell.style.cssText = 'display:flex;flex-direction:column;gap:4px;' + (i === WORD_COUNT ? 'grid-column:1;' : '');
      const lbl = document.createElement('label');
      lbl.style.cssText = 'font-size:11px;color:var(--color-text-tertiary);';
      lbl.textContent = 'Word ' + i;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.id = idPrefix + '-w' + i;
      inp.autocomplete = 'off';
      inp.autocapitalize = 'off';
      inp.spellcheck = false;
      inp.className = 'input-field';
      inp.style.cssText = 'height:42px;font-size:14px;';
      cell.appendChild(lbl);
      cell.appendChild(inp);
      grid.appendChild(cell);
    }
    return grid;
  }

  function _readWords(idPrefix) {
    const words = [];
    for (let i = 1; i <= WORD_COUNT; i++) {
      const el = document.getElementById(idPrefix + '-w' + i);
      words.push(el ? el.value.trim() : '');
    }
    return words;
  }

  function _wordsIncomplete(words) {
    return words.some(w => w.length < 2);
  }

  function _wordsMatch(a, b) {
    return a.length === b.length && a.every((w, i) => w === b[i]);
  }

  function _phraseFromWords(words) {
    return words.join(' ');
  }

  // ── Screen: create the 5 words (step 1 of 2) ─────────────────────────────
  function _openCreateScreen(resolve) {
    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;gap:14px;';

    const intro = document.createElement('p');
    intro.style.cssText = 'font-size:13px;color:var(--color-text-secondary);line-height:1.5;margin:0;';
    intro.textContent = "Make up 5 words to confirm this and future withdrawal requests. This is separate from your account password — exact spelling, case, and order all matter, so pick something you'll remember precisely.";
    content.appendChild(intro);

    content.appendChild(_buildWordGrid('wpa-new'));

    const err = _errorBox();
    content.appendChild(err);

    const btn = document.createElement('button');
    btn.className = 'btn btn-primary btn-full';
    btn.textContent = 'Continue';
    content.appendChild(btn);

    let resolved = false;

    btn.addEventListener('click', () => {
      const words = _readWords('wpa-new');
      err.style.display = 'none';
      if (_wordsIncomplete(words)) {
        err.textContent = 'Enter all 5 words (at least 2 characters each).';
        err.style.display = 'block';
        return;
      }
      resolved = true; // handing off to step 2, not a cancel
      _openConfirmScreen(resolve, words);
    });

    if (window.Modal) {
      Modal.open({ title: 'Secure Your Withdrawal', content, maxWidth: '420px', dismissible: true });
      _onModalClosedWithoutSuccess(() => resolved, resolve);
    }
  }

  // ── Screen: confirm the 5 words (step 2 of 2) ────────────────────────────
  function _openConfirmScreen(resolve, originalWords) {
    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;gap:14px;';

    const intro = document.createElement('p');
    intro.style.cssText = 'font-size:13px;color:var(--color-text-secondary);line-height:1.5;margin:0;';
    intro.textContent = 'Re-enter the same 5 words to confirm.';
    content.appendChild(intro);

    content.appendChild(_buildWordGrid('wpa-confirm'));

    const err = _errorBox();
    content.appendChild(err);

    const btn = document.createElement('button');
    btn.className = 'btn btn-primary btn-full';
    btn.textContent = 'Confirm & Save';
    content.appendChild(btn);

    const back = document.createElement('button');
    back.type = 'button';
    back.style.cssText = 'background:none;border:none;color:var(--color-text-secondary);font-size:12px;cursor:pointer;padding:4px 0;text-align:center;';
    back.textContent = '‹ Start over';
    content.appendChild(back);

    let resolved = false;

    back.addEventListener('click', () => {
      resolved = true; // not a cancel — moving back to step 1
      _openCreateScreen(resolve);
    });

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const words = _readWords('wpa-confirm');
      err.style.display = 'none';

      if (_wordsIncomplete(words)) {
        err.textContent = 'Enter all 5 words.';
        err.style.display = 'block';
        return;
      }
      if (!_wordsMatch(words, originalWords)) {
        err.textContent = "Those don't match what you entered. Try again, or start over.";
        err.style.display = 'block';
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>Saving…';

      try {
        if (!window.supabaseClient) throw new Error('Secure service unavailable');
        const { error } = await window.supabaseClient
          .rpc('set_withdrawal_passphrase', { p_passphrase: _phraseFromWords(originalWords) });
        if (error) throw error;

        resolved = true;
        if (window.Modal) Modal.close();
        resolve(true);
      } catch (e) {
        console.error('[WithdrawalAuth] Set failed:', e.message);
        err.textContent = e.message || 'Could not save your words. Please try again.';
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Confirm & Save';
      }
    });

    if (window.Modal) {
      Modal.open({ title: 'Confirm Your 5 Words', content, maxWidth: '420px', dismissible: true });
      _onModalClosedWithoutSuccess(() => resolved, resolve);
    }
  }

  // ── Screen: enter an existing 5-word phrase ──────────────────────────────
  function _openVerifyScreen(resolve) {
    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;gap:14px;';

    const intro = document.createElement('p');
    intro.style.cssText = 'font-size:13px;color:var(--color-text-secondary);line-height:1.5;margin:0;';
    intro.textContent = 'Enter your 5 words to complete this withdrawal.';
    content.appendChild(intro);

    content.appendChild(_buildWordGrid('wpa-verify'));

    const err = _errorBox();
    content.appendChild(err);

    const btn = document.createElement('button');
    btn.className = 'btn btn-primary btn-full';
    btn.textContent = 'Confirm Withdrawal';
    content.appendChild(btn);

    let resolved = false;

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const words = _readWords('wpa-verify');
      err.style.display = 'none';

      if (words.some(w => !w)) {
        err.textContent = 'Enter all 5 words.';
        err.style.display = 'block';
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>Verifying…';

      try {
        if (!window.supabaseClient) throw new Error('Secure service unavailable');
        const { data, error } = await window.supabaseClient
          .rpc('verify_withdrawal_passphrase', { p_passphrase: _phraseFromWords(words) });
        if (error) throw error;

        if (data === true) {
          resolved = true;
          if (window.Modal) Modal.close();
          resolve(true);
        } else {
          err.textContent = 'Those words are incorrect. Please try again.';
          err.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Confirm Withdrawal';
        }
      } catch (e) {
        console.error('[WithdrawalAuth] Verify failed:', e.message);
        err.textContent = e.message || 'Could not verify. Please try again.';
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Confirm Withdrawal';
      }
    });

    if (window.Modal) {
      Modal.open({ title: 'Confirm Withdrawal', content, maxWidth: '420px', dismissible: true });
      _onModalClosedWithoutSuccess(() => resolved, resolve);
    }
  }

  // ── Detect the user dismissing the modal (X / backdrop) without success ──
  // Modal module doesn't expose an onClose callback, so poll for the modal
  // element leaving the DOM. Cheap and self-cancelling.
  function _onModalClosedWithoutSuccess(wasResolvedFn, resolve) {
    const check = setInterval(() => {
      const stillOpen = document.querySelector('.ntm-card');
      if (!stillOpen) {
        clearInterval(check);
        if (!wasResolvedFn()) resolve(false);
      }
    }, 250);
  }

  // ── Public entry point ────────────────────────────────────────────────────
  // Returns a Promise<boolean> — true once the user has successfully set or
  // verified their 5 words, false if they cancelled.
  function confirm(userId) {
    return new Promise(async (resolve) => {
      if (!userId) { resolve(false); return; }
      const alreadySet = await _getStatus();
      if (alreadySet) {
        _openVerifyScreen(resolve);
      } else {
        _openCreateScreen(resolve);
      }
    });
  }

  return { confirm };

})();

if (typeof window !== 'undefined') window.WithdrawalAuth = WithdrawalAuth;
