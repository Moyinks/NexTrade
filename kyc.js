/**
 * NexTrade — KYC Module v1.0
 * ══════════════════════════════════════════════════════════════════════════════
 * Manual identity verification gating withdrawals.
 *
 * FLOW:
 *   openWithdraw() → KYC.check(userId) → if not approved → KYC.openScreen()
 *   User fills form + uploads compressed photos → submits to Supabase
 *   Admin reviews kyc_documents table + sets profiles.kyc_status = 'approved'
 *   Next withdrawal attempt passes gate automatically
 *
 * IMAGE COMPRESSION:
 *   All photos are compressed client-side via Canvas API before upload.
 *   Target: ≤400KB per image at max 1200px longest side, JPEG quality 0.82.
 *   Reduces storage cost and upload time on mobile data with zero quality loss
 *   visible to a human reviewer.
 *
 * SUPABASE:
 *   Table:   kyc_documents    (see SCHEMA.sql)
 *   Storage: kyc-docs bucket  (private, RLS: service role only)
 *   Column:  profiles.kyc_status  'none'|'pending'|'approved'|'rejected'
 *
 * ADMIN APPROVAL:
 *   Supabase Table Editor → kyc_documents → review → update profiles row:
 *   SET kyc_status = 'approved' WHERE id = '<user_id>'
 */

const KYC = (() => {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  const MAX_PX      = 1200;   // max dimension after compression
  const JPEG_Q      = 0.82;   // JPEG quality — sharp enough for ID text
  const MAX_KB      = 400;    // target max file size per image
  const BUCKET      = 'kyc-docs';

  // ── Status check ─────────────────────────────────────────────────────────
  async function check(userId) {
    if (!userId || !window.supabaseClient) return 'none';
    try {
      const { data, error } = await window.supabaseClient
        .from('profiles')
        .select('kyc_status')
        .eq('id', userId)
        .single();
      if (error) throw error;
      return data.kyc_status || 'none';
    } catch (err) {
      console.error('[KYC] Status check failed:', err.message);
      return 'none';
    }
  }

  // ── Image compression ─────────────────────────────────────────────────────
  // Takes a File, returns a Promise<Blob> compressed to target size.
  function compress(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not decode image'));
        img.onload = () => {
          // Calculate output dimensions
          let { width, height } = img;
          if (width > MAX_PX || height > MAX_PX) {
            if (width >= height) {
              height = Math.round(height * MAX_PX / width);
              width  = MAX_PX;
            } else {
              width  = Math.round(width * MAX_PX / height);
              height = MAX_PX;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width  = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Try at target quality, step down if still too large
          let quality = JPEG_Q;
          function tryCompress() {
            canvas.toBlob((blob) => {
              if (!blob) { reject(new Error('Compression failed')); return; }
              if (blob.size > MAX_KB * 1024 && quality > 0.5) {
                quality -= 0.08;
                tryCompress();
              } else {
                resolve(blob);
              }
            }, 'image/jpeg', quality);
          }
          tryCompress();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ── Upload a single compressed image to Supabase Storage ─────────────────
  async function uploadImage(userId, blob, label) {
    const ext  = 'jpg';
    const path = userId + '/' + label + '_' + Date.now() + '.' + ext;
    const { error } = await window.supabaseClient.storage
      .from(BUCKET)
      .upload(path, blob, {
        contentType:  'image/jpeg',
        cacheControl: '3600',
        upsert:       false
      });
    if (error) throw error;
    return path;
  }

  // ── File input with preview ───────────────────────────────────────────────
  function buildFileInput(id, labelText, icon) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

    const lbl = document.createElement('label');
    lbl.htmlFor    = id;
    lbl.style.cssText = 'font-size:11px;font-weight:700;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.5px;';
    lbl.textContent = labelText;
    wrap.appendChild(lbl);

    const zone = document.createElement('label');
    zone.htmlFor    = id;
    zone.style.cssText = [
      'display:flex;align-items:center;gap:12px;padding:14px 16px;',
      'background:var(--color-surface-elevated);border:1.5px dashed var(--color-border);',
      'border-radius:12px;cursor:pointer;transition:border-color 0.2s;'
    ].join('');
    zone.addEventListener('mouseenter', () => zone.style.borderColor = 'var(--color-primary)');
    zone.addEventListener('mouseleave', () => {
      const inp = document.getElementById(id);
      zone.style.borderColor = inp && inp.files && inp.files[0]
        ? '#10b981' : 'var(--color-border)';
    });

    const iconEl = document.createElement('div');
    iconEl.style.cssText = [
      'width:40px;height:40px;flex-shrink:0;border-radius:10px;',
      'background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.2);',
      'display:flex;align-items:center;justify-content:center;font-size:18px;'
    ].join('');
    iconEl.textContent = icon;
    zone.appendChild(iconEl);

    const textCol = document.createElement('div');
    textCol.style.cssText = 'flex:1;min-width:0;';
    const primary = document.createElement('div');
    primary.id          = id + '_label';
    primary.style.cssText = 'font-size:13px;font-weight:600;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    primary.textContent = 'Tap to choose file';
    const secondary = document.createElement('div');
    secondary.style.cssText = 'font-size:11px;color:var(--color-text-tertiary);margin-top:2px;';
    secondary.textContent = 'JPG, PNG — auto-compressed';
    textCol.appendChild(primary); textCol.appendChild(secondary);
    zone.appendChild(textCol);

    const badge = document.createElement('div');
    badge.id          = id + '_badge';
    badge.style.cssText = 'font-size:18px;flex-shrink:0;';
    badge.textContent = '📎';
    zone.appendChild(badge);

    const input = document.createElement('input');
    input.type   = 'file';
    input.id     = id;
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const nameEl  = document.getElementById(id + '_label');
      const badgeEl = document.getElementById(id + '_badge');
      if (nameEl)  nameEl.textContent  = file.name.length > 32 ? file.name.slice(0, 29) + '…' : file.name;
      if (badgeEl) badgeEl.textContent = '✅';
      zone.style.borderColor = '#10b981';
      zone.style.borderStyle = 'solid';
    });

    wrap.appendChild(zone);
    wrap.appendChild(input);
    return wrap;
  }

  // ── Status screen (pending / rejected) ───────────────────────────────────
  function openStatusScreen(status) {
    const isPending  = status === 'pending';
    const isRejected = status === 'rejected';

    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;padding:8px 0 16px;text-align:center;';

    const icon = document.createElement('div');
    icon.style.cssText = [
      'width:72px;height:72px;border-radius:50%;display:flex;align-items:center;',
      'justify-content:center;font-size:32px;margin-bottom:4px;',
      isPending
        ? 'background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);'
        : 'background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);'
    ].join('');
    icon.textContent = isPending ? '⏳' : '❌';
    content.appendChild(icon);

    const title = document.createElement('div');
    title.style.cssText = 'font-size:20px;font-weight:800;color:var(--color-text-primary);';
    title.textContent   = isPending ? 'Verification Under Review' : 'Verification Rejected';
    content.appendChild(title);

    const body = document.createElement('div');
    body.style.cssText = 'font-size:14px;color:var(--color-text-secondary);line-height:1.6;max-width:320px;';
    body.textContent   = isPending
      ? 'Your documents are being reviewed. This usually takes 1–24 hours. You\'ll be notified when approved. Your investment keeps growing in the meantime.'
      : 'Your verification was not approved. Please resubmit with a clearer photo of your ID and selfie. Contact support if you need help.';
    content.appendChild(body);

    if (isRejected) {
      const resubmitBtn = document.createElement('button');
      resubmitBtn.className   = 'btn btn-primary btn-full';
      resubmitBtn.textContent = 'Resubmit Documents';
      resubmitBtn.addEventListener('click', () => {
        if (window.Modal) Modal.close();
        setTimeout(() => openScreen(), 200);
      });
      content.appendChild(resubmitBtn);
    }

    if (window.Modal) Modal.open({ title: '', content, showCloseButton: true });
  }

  // ── Main KYC screen ───────────────────────────────────────────────────────
  function openScreen() {
    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;gap:20px;';

    // ── Hero block ─────────────────────────────────────────────────────────
    const hero = document.createElement('div');
    hero.style.cssText = [
      'display:flex;align-items:flex-start;gap:14px;padding:16px;',
      'background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:14px;'
    ].join('');
    const heroIcon = document.createElement('div');
    heroIcon.style.cssText = [
      'width:44px;height:44px;flex-shrink:0;border-radius:12px;font-size:20px;',
      'background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.25);',
      'display:flex;align-items:center;justify-content:center;'
    ].join('');
    heroIcon.textContent = '🛡️';
    const heroText = document.createElement('div');
    const heroTitle = document.createElement('div');
    heroTitle.style.cssText = 'font-size:14px;font-weight:700;color:var(--color-text-primary);margin-bottom:4px;';
    heroTitle.textContent   = 'One-time identity check';
    const heroBody = document.createElement('div');
    heroBody.style.cssText = 'font-size:12px;color:var(--color-text-secondary);line-height:1.5;';
    heroBody.textContent   = 'Required by financial regulations before your first withdrawal. Takes about 3 minutes. Your funds keep growing while we review.';
    heroText.appendChild(heroTitle); heroText.appendChild(heroBody);
    hero.appendChild(heroIcon); hero.appendChild(heroText);
    content.appendChild(hero);

    // ── Divider ────────────────────────────────────────────────────────────
    const div1 = document.createElement('div');
    div1.style.cssText = 'height:1px;background:var(--color-border);';
    content.appendChild(div1);

    // ── Personal info ──────────────────────────────────────────────────────
    const sectionLabel = (text) => {
      const el = document.createElement('div');
      el.style.cssText = 'font-size:11px;font-weight:700;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:2px;';
      el.textContent = text;
      return el;
    };

    const infoSection = document.createElement('div');
    infoSection.style.cssText = 'display:flex;flex-direction:column;gap:14px;';
    infoSection.appendChild(sectionLabel('Personal Information'));

    function buildInput(id, label, type, placeholder) {
      const grp = document.createElement('div');
      grp.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
      const lbl = document.createElement('label');
      lbl.htmlFor    = id;
      lbl.style.cssText = 'font-size:12px;color:var(--color-text-secondary);font-weight:500;';
      lbl.textContent   = label;
      const inp = document.createElement('input');
      inp.type        = type || 'text';
      inp.id          = id;
      inp.placeholder = placeholder || '';
      inp.className   = 'input-field';
      inp.style.cssText = 'height:46px;font-size:14px;';
      grp.appendChild(lbl); grp.appendChild(inp);
      return grp;
    }

    function buildSelect(id, label, options) {
      const grp = document.createElement('div');
      grp.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
      const lbl = document.createElement('label');
      lbl.htmlFor    = id;
      lbl.style.cssText = 'font-size:12px;color:var(--color-text-secondary);font-weight:500;';
      lbl.textContent   = label;
      const sel = document.createElement('select');
      sel.id        = id;
      sel.className = 'input-field';
      sel.style.cssText = 'height:46px;font-size:14px;';
      options.forEach(([val, text]) => {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = text;
        sel.appendChild(opt);
      });
      grp.appendChild(lbl); grp.appendChild(sel);
      return grp;
    }

    infoSection.appendChild(buildInput('kyc_fullname',  'Full Legal Name',       'text', 'As it appears on your ID'));
    infoSection.appendChild(buildInput('kyc_dob',       'Date of Birth',         'date', ''));
    infoSection.appendChild(buildSelect('kyc_country',  'Country of Residence', [
      ['', '— Select country —'],
      ['NG', 'Nigeria'], ['GH', 'Ghana'], ['KE', 'Kenya'], ['ZA', 'South Africa'],
      ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'],
      ['AU', 'Australia'], ['DE', 'Germany'], ['FR', 'France'],
      ['AE', 'United Arab Emirates'], ['SG', 'Singapore'], ['OTHER', 'Other']
    ]));
    infoSection.appendChild(buildSelect('kyc_doc_type', 'ID Document Type', [
      ['', '— Select type —'],
      ['passport',      'International Passport'],
      ['nin',           'NIN Slip / National ID Card'],
      ['drivers_license','Driver\'s Licence'],
      ['voters_card',   'Voter\'s Card'],
      ['residence_permit','Residence Permit']
    ]));
    content.appendChild(infoSection);

    // ── Divider ────────────────────────────────────────────────────────────
    const div2 = document.createElement('div');
    div2.style.cssText = 'height:1px;background:var(--color-border);';
    content.appendChild(div2);

    // ── Document uploads ───────────────────────────────────────────────────
    const docsSection = document.createElement('div');
    docsSection.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
    docsSection.appendChild(sectionLabel('Identity Documents'));

    const uploadNote = document.createElement('div');
    uploadNote.style.cssText = 'font-size:12px;color:var(--color-text-tertiary);line-height:1.5;';
    uploadNote.innerHTML = 'Photos are <strong style="color:var(--color-text-secondary);">automatically compressed</strong> before sending. Ensure ID text is clearly legible.';
    docsSection.appendChild(uploadNote);

    docsSection.appendChild(buildFileInput('kyc_id_front',  'ID — Front Side',              '🪪'));
    docsSection.appendChild(buildFileInput('kyc_id_back',   'ID — Back Side (if applicable)','🪪'));
    docsSection.appendChild(buildFileInput('kyc_selfie',    'Selfie Holding Your ID',        '🤳'));
    content.appendChild(docsSection);

    // ── Tips ───────────────────────────────────────────────────────────────
    const tips = document.createElement('div');
    tips.style.cssText = [
      'padding:12px 14px;border-radius:10px;',
      'background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.15);',
      'font-size:11px;color:var(--color-text-secondary);line-height:1.7;'
    ].join('');
    tips.innerHTML = [
      '<strong style="color:#10b981;display:block;margin-bottom:4px;">📷 Photo tips</strong>',
      '• Place ID on a flat surface in good lighting<br>',
      '• All four corners must be visible<br>',
      '• No glare or blurring on text<br>',
      '• Selfie: hold ID next to your face, both clearly visible'
    ].join('');
    content.appendChild(tips);

    // ── Submit button ──────────────────────────────────────────────────────
    const submitBtn = document.createElement('button');
    submitBtn.className   = 'btn btn-primary btn-full';
    submitBtn.style.height = '52px';
    submitBtn.style.fontSize = '15px';
    submitBtn.textContent = 'Submit for Verification';

    const progressBar = document.createElement('div');
    progressBar.style.cssText = 'display:none;height:4px;border-radius:2px;background:var(--color-border);overflow:hidden;';
    const progressFill = document.createElement('div');
    progressFill.style.cssText = 'height:100%;background:var(--color-primary);border-radius:2px;width:0%;transition:width 0.4s ease;';
    progressBar.appendChild(progressFill);

    const statusMsg = document.createElement('div');
    statusMsg.style.cssText = 'text-align:center;font-size:12px;color:var(--color-text-secondary);display:none;';

    content.appendChild(progressBar);
    content.appendChild(statusMsg);
    content.appendChild(submitBtn);

    // ── Submit handler ─────────────────────────────────────────────────────
    submitBtn.addEventListener('click', async () => {
      if (submitBtn.disabled) return;

      // Validate personal info
      const fullName = document.getElementById('kyc_fullname').value.trim();
      const dob      = document.getElementById('kyc_dob').value;
      const country  = document.getElementById('kyc_country').value;
      const docType  = document.getElementById('kyc_doc_type').value;

      if (!fullName)  { App.showError('Enter your full legal name');        return; }
      if (!dob)       { App.showError('Enter your date of birth');           return; }
      if (!country)   { App.showError('Select your country of residence');   return; }
      if (!docType)   { App.showError('Select your ID document type');       return; }

      const frontFile  = (document.getElementById('kyc_id_front')  || {}).files;
      const backFile   = (document.getElementById('kyc_id_back')   || {}).files;
      const selfieFile = (document.getElementById('kyc_selfie')    || {}).files;

      if (!frontFile  || !frontFile[0])  { App.showError('Upload front of your ID');    return; }
      if (!selfieFile || !selfieFile[0]) { App.showError('Upload a selfie with your ID'); return; }

      const { user } = window.AppState
        ? { user: AppState.get('user') }
        : { user: null };

      if (!user || !user.id) {
        if (window.App) App.showError('Session not found. Please refresh.');
        return;
      }

      // ── Lock UI ─────────────────────────────────────────────────────────
      submitBtn.disabled  = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>Preparing documents…';
      progressBar.style.display = 'block';
      statusMsg.style.display   = 'block';

      const setProgress = (pct, msg) => {
        progressFill.style.width = pct + '%';
        statusMsg.textContent    = msg;
      };

      try {
        setProgress(10, 'Compressing ID front…');
        const frontBlob  = await compress(frontFile[0]);

        setProgress(30, 'Compressing selfie…');
        const selfieBlob = await compress(selfieFile[0]);

        let backPath = null;
        if (backFile && backFile[0]) {
          setProgress(45, 'Compressing ID back…');
          const backBlob = await compress(backFile[0]);
          setProgress(55, 'Uploading ID back…');
          backPath = await uploadImage(user.id, backBlob, 'id_back');
        }

        setProgress(60, 'Uploading ID front…');
        const frontPath  = await uploadImage(user.id, frontBlob,  'id_front');

        setProgress(78, 'Uploading selfie…');
        const selfiePath = await uploadImage(user.id, selfieBlob, 'selfie');

        setProgress(90, 'Saving submission…');

        // Submit through the server-controlled RPC so the browser never writes
        // directly to kyc_documents or profiles.
        const { data: submitResult, error: submitErr } = await window.supabaseClient
          .rpc('submit_kyc', {
            p_full_name:    fullName,
            p_dob:          dob,
            p_country:      country,
            p_doc_type:     docType,
            p_id_front_path: frontPath,
            p_id_back_path:  backPath,
            p_selfie_path:   selfiePath
          });
        if (submitErr) throw submitErr;

        // Update local AppState using the authoritative server response.
        if (window.AppState) {
          const profile = AppState.get('profile') || {};
          AppState.set('profile', { ...profile, kyc_status: (submitResult && submitResult[0] && submitResult[0].kyc_status) || 'pending' });
        }

        setProgress(100, 'Submitted successfully');

        if (window.Modal) Modal.close();
        setTimeout(() => {
          if (window.App) App.showSuccess('Documents submitted. Review takes 1–24 hours.');
        }, 300);

      } catch (err) {
        console.error('[KYC] Submission failed:', err);
        progressBar.style.display = 'none';
        statusMsg.style.display   = 'none';
        submitBtn.disabled  = false;
        submitBtn.textContent = 'Submit for Verification';
        if (window.App) App.showError(err.message || 'Submission failed. Please try again.');
      }
    });

    if (window.Modal) Modal.open({
      title:           'Identity Verification',
      content,
      maxWidth:        '480px',
      showCloseButton: true
    });
  }

  // ── Public gate function — called by trade.js before openWithdraw ─────────
  // Returns true if withdrawal should proceed, false if KYC screen was shown.
  async function gate(userId) {
    const status = await check(userId);
    if (status === 'approved') return true;

    if (status === 'pending' || status === 'rejected') {
      openStatusScreen(status);
      return false;
    }

    // status === 'none' — show the full submission screen
    openScreen();
    return false;
  }

  return { gate, check, openScreen };

})();

if (typeof window !== 'undefined') window.KYC = KYC;
