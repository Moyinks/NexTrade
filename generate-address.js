/**
 * NexTrade — HD Wallet Address Generator
 * Vercel Serverless Function: /api/generate-address
 * ══════════════════════════════════════════════════════════════════════════════
 * Derives a fresh Ethereum child address from your HD wallet's xpub key.
 * Each deposit request gets a unique address. All funds arrive in the same
 * master wallet because every child address is mathematically linked to xpub.
 *
 * Your private keys NEVER touch this server — only the public xpub is used.
 *
 * REQUIRED VERCEL ENVIRONMENT VARIABLES:
 *   HD_WALLET_XPUB          xpub key from MetaMask/Ledger
 *   SUPABASE_URL            your Supabase project URL
 *   SUPABASE_SERVICE_KEY    service role key (NOT the anon key)
 *
 * HOW TO GET YOUR XPUB:
 *   MetaMask desktop  → Settings → Advanced → Show Extended Public Key
 *   Ledger Live       → Accounts → your ETH account → ... → Advanced → xpub
 *   Trust Wallet      → Settings → Wallets → your wallet → Extended Public Key
 *
 * DERIVATION PATH: m/0/{index} (BIP44 external chain, unhardened)
 * Compatible with MetaMask, Ledger, and all BIP44 HD wallets.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { ethers }       = require('ethers');

module.exports = async function handler(req, res) {
  // ── CORS headers ─────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Allow only the app's own origin. Set ALLOWED_ORIGIN in Vercel env vars.
  // Falls back to permissive for development if not set.
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowed);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth: verify Supabase JWT ────────────────────────────────────────────
  const authHeader = req.headers['authorization'] || '';
  const token      = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const supabaseUrl        = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const xpub               = process.env.HD_WALLET_XPUB;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[generate-address] SUPABASE_URL or SUPABASE_SERVICE_KEY not set');
    return res.status(503).json({ error: 'Server not configured (Supabase)' });
  }

  if (!xpub) {
    console.error('[generate-address] HD_WALLET_XPUB not set');
    return res.status(503).json({ error: 'HD wallet not configured. Set HD_WALLET_XPUB in Vercel env vars.' });
  }

  // Use service role client to bypass RLS for server-side writes
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  // Verify the user's JWT
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  try {
    // ── Get next derivation index atomically ─────────────────────────────
    const { data: nextIndexData, error: idxErr } = await supabase.rpc('next_deposit_address_index');
    if (idxErr) throw idxErr;
    const nextIndex = parseInt(nextIndexData, 10);
    if (!Number.isFinite(nextIndex) || nextIndex < 0) {
      throw new Error('Could not allocate address index');
    }

    // ── Derive child address from xpub ────────────────────────────────────
    // ethers v5: ethers.utils.HDNode.fromExtendedKey(xpub)
    // Path 0/{n} = external (receiving) chain, unhardened.
    // This is the standard path for watch-only / deposit address generation.
    const rootNode  = ethers.utils.HDNode.fromExtendedKey(xpub);
    const childNode = rootNode.derivePath('0/' + nextIndex);
    const address   = childNode.address; // EIP-55 checksummed Ethereum address

    // ── Insert into deposit_addresses ─────────────────────────────────────
    const { error: insertErr } = await supabase
      .from('deposit_addresses')
      .insert({
        user_id:          user.id,
        address:          address,
        derivation_index: nextIndex,
        network:          'eth',
        used:             false,
        expires_at:       new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      });

    if (insertErr) throw insertErr;

    console.log('[generate-address] ✅ index=' + nextIndex + ' address=' + address.slice(0, 8) + '...' + ' user=' + user.id.slice(0, 8));

    return res.status(200).json({
      address: address,
      index:   nextIndex
    });

  } catch (err) {
    console.error('[generate-address] ❌', err.message || err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
