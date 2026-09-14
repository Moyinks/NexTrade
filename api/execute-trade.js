/**
 * NexTrade — server-authoritative trade execution
 *
 * The browser chooses direction/asset/amount, but never the execution price.
 * This endpoint authenticates the caller, resolves an allowlisted market price,
 * then calls a service-role-only Postgres RPC that serializes the user's ledger.
 */
'use strict';

const { createClient } = require('@supabase/supabase-js');

const COINS = Object.freeze({
  bitcoin: 'btc',
  ethereum: 'eth',
  solana: 'sol',
  binancecoin: 'bnb',
  ripple: 'xrp',
  cardano: 'ada',
  'avalanche-2': 'avax',
  polkadot: 'dot',
  'matic-network': 'matic',
  dogecoin: 'doge',
  'shiba-inu': 'shib',
  tron: 'trx',
  litecoin: 'ltc',
  chainlink: 'link',
  uniswap: 'uni',
  toncoin: 'ton',
  near: 'near',
  stellar: 'xlm',
  sui: 'sui'
});

const MAX_AMOUNT = 1_000_000_000;
const PRICE_TIMEOUT_MS = 7000;
const MAX_PRICE_AGE_SECONDS = 180;
const MAX_BODY_BYTES = 4096;

function setSecurityHeaders(res) {
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
  const origin = req.headers.origin || '';
  if (origin !== allowed) {
    res.status(403).json({ error: 'Origin not allowed' });
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
  return true;
}

function validAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= MAX_AMOUNT ? n : null;
}

function validIdempotencyKey(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return /^trade:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key) ? key : null;
}

async function fetchUsdPrice(coinId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRICE_TIMEOUT_MS);
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' +
      encodeURIComponent(coinId) + '&vs_currencies=usd&include_last_updated_at=true';
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error('Market price service unavailable');
    const body = await response.json();
    const quote = body && body[coinId];
    const price = Number(quote && quote.usd);
    const updatedAt = Number(quote && quote.last_updated_at);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid market price');
    if (!Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > nowSeconds + 30 || nowSeconds - updatedAt > MAX_PRICE_AGE_SECONDS) {
      throw new Error('Market price is stale');
    }
    return price;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (!enforceOrigin(req, res)) return;
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) return res.status(415).json({ error: 'JSON body required' });
  const contentLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return res.status(413).json({ error: 'Request body too large' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({ error: 'Server financial authority is not configured' });
  }

  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Missing authorization' });

  const side = String(req.body && req.body.side || '').toLowerCase();
  const coinId = String(req.body && req.body.coinId || '').toLowerCase();
  const requestedAsset = String(req.body && req.body.asset || '').toLowerCase();
  const amount = validAmount(req.body && req.body.amount);
  const idempotencyKey = validIdempotencyKey(req.body && req.body.idempotencyKey);
  const serverAsset = COINS[coinId];

  if (!['buy', 'sell'].includes(side)) return res.status(400).json({ error: 'Invalid trade side' });
  if (!serverAsset || requestedAsset !== serverAsset) return res.status(400).json({ error: 'Asset mapping rejected' });
  if (amount == null) return res.status(400).json({ error: 'Invalid trade amount' });
  if (!idempotencyKey) return res.status(400).json({ error: 'Invalid idempotency key' });

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const user = authData && authData.user;
  if (authError || !user) return res.status(401).json({ error: 'Invalid or expired session' });

  try {
    const price = await fetchUsdPrice(coinId);
    const { data, error } = await supabase.rpc('execute_trade', {
      p_user_id: user.id,
      p_side: side,
      p_asset: serverAsset,
      p_amount: amount,
      p_price: price,
      p_idempotency_key: idempotencyKey
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.tx_id) throw new Error('Trade authority returned an invalid response');

    return res.status(200).json({
      tx_id: row.tx_id,
      spot_balance: Number(row.spot_balance),
      holdings: row.holdings || {},
      executed_price: Number(row.executed_price),
      executed_usd_amount: Number(row.executed_usd_amount),
      asset_quantity: Number(row.asset_quantity)
    });
  } catch (error) {
    console.error('[execute-trade]', error && error.message ? error.message : error);
    const message = String(error && error.message || 'Trade execution failed');
    const domainError = /insufficient|idempot|invalid|unsupported|holding/i.test(message);
    if (domainError) return res.status(400).json({ error: message });
    if (/market price|price service|abort/i.test(message)) return res.status(502).json({ error: 'Market price service unavailable' });
    return res.status(500).json({ error: 'Trade execution failed' });
  }
};
