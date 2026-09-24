/**
 * NexTrade — optional HD deposit address generator.
 * Public portfolio mode is disabled by default. This endpoint also fails closed
 * unless ENABLE_REAL_DEPOSITS=true and every privileged environment value exists.
 */
'use strict';

const { createClient } = require('@supabase/supabase-js');
const { HDNodeWallet, isAddress } = require('ethers');
const { requireSameOrigin } = require('../server/supabase-server');

function securityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}


module.exports = async function handler(req, res) {
  securityHeaders(res);
  if (req.method !== 'POST' && req.method !== 'OPTIONS') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    requireSameOrigin(req);
  } catch (_) {
    return res.status(403).json({ error: 'Origin rejected' });
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (contentType && !contentType.startsWith('application/json')) return res.status(415).json({ error: 'JSON request required' });
  const contentLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > 1024) return res.status(413).json({ error: 'Request body too large' });
  if (process.env.ENABLE_REAL_DEPOSITS !== 'true') {
    return res.status(403).json({ error: 'Real deposits are disabled for this deployment' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const xpub = process.env.HD_WALLET_XPUB;
  if (!supabaseUrl || !serviceKey || !xpub) {
    return res.status(503).json({ error: 'Deposit infrastructure is not configured' });
  }

  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Missing authorization' });

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const user = authData && authData.user;
  if (authError || !user) return res.status(401).json({ error: 'Invalid or expired session' });

  try {
    const { data: nextIndexData, error: indexError } = await supabase.rpc('next_deposit_address_index');
    if (indexError) throw indexError;
    const nextIndex = Number(nextIndexData);
    if (!Number.isSafeInteger(nextIndex) || nextIndex < 0) throw new Error('Invalid derivation index');

    // ethers v6 returns an HDNodeVoidWallet for xpub keys. Derive only
    // non-hardened children so the server never needs a private key.
    const root = HDNodeWallet.fromExtendedKey(xpub);
    const address = root.deriveChild(0).deriveChild(nextIndex).address;
    if (!isAddress(address)) throw new Error('Derived invalid address');

    const { error: insertError } = await supabase.from('deposit_addresses').insert({
      user_id: user.id,
      address,
      derivation_index: nextIndex,
      network: 'eth',
      used: false,
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    });
    if (insertError) throw insertError;

    return res.status(200).json({ address, index: nextIndex });
  } catch (error) {
    console.error('[generate-address]', error && error.message ? error.message : error);
    return res.status(500).json({ error: 'Could not allocate deposit address' });
  }
};
