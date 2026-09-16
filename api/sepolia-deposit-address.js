/**
 * NexTrade — Sepolia test deposit address endpoint.
 * Testnet only. Returns a configured public Sepolia receiving address after
 * authenticating the current user. No private key or xpub is used here.
 */
'use strict';

const { createClient } = require('@supabase/supabase-js');
const { getAddress, isAddress } = require('ethers');

function securityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function enforceOrigin(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN;
  if (!allowed) {
    res.status(503).json({ error: 'Server origin policy is not configured' });
    return false;
  }
  if ((req.headers.origin || '') !== allowed) {
    res.status(403).json({ error: 'Origin not allowed' });
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
  return true;
}

async function authenticate(req) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('AUTH_CONFIG_MISSING');

  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

module.exports = async function handler(req, res) {
  securityHeaders(res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');

  if (!enforceOrigin(req, res)) return;
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.ENABLE_SEPOLIA_TEST_DEPOSITS !== 'true') {
    return res.status(403).json({ error: 'Sepolia test deposits are disabled' });
  }

  try {
    const user = await authenticate(req);
    if (!user) return res.status(401).json({ error: 'Invalid or expired session' });

    const configured = String(process.env.SEPOLIA_DEPOSIT_ADDRESS || '').trim();
    if (!isAddress(configured)) {
      return res.status(503).json({ error: 'Sepolia deposit address is not configured' });
    }

    return res.status(200).json({
      address: getAddress(configured),
      network: 'Sepolia',
      chainId: 11155111,
      testnet: true
    });
  } catch (error) {
    if (error && error.message === 'AUTH_CONFIG_MISSING') {
      return res.status(503).json({ error: 'Authentication infrastructure is not configured' });
    }
    console.error('[sepolia-deposit-address]', error && error.message ? error.message : error);
    return res.status(500).json({ error: 'Could not load Sepolia deposit address' });
  }
};
