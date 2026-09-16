/**
 * NexTrade — Sepolia test deposit verifier.
 * Testnet only. Verifies an on-chain Sepolia ETH transfer and then asks the
 * database service-role RPC to approve exactly one pending NexTrade deposit.
 * No private key or xpub is required by this endpoint.
 */
'use strict';

const { createClient } = require('@supabase/supabase-js');
const { getAddress, isAddress } = require('ethers');

const SEPOLIA_CHAIN_ID = 11155111n;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const RPC_TIMEOUT_MS = 8000;

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

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body.length <= 2048) {
    try { return JSON.parse(req.body); } catch (_) { return null; }
  }
  return null;
}

function parseMinConfirmations() {
  const parsed = Number(process.env.SEPOLIA_MIN_CONFIRMATIONS || 2);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 12) return 2;
  return parsed;
}

async function rpcCall(rpcUrl, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`RPC_HTTP_${response.status}`);
    const payload = await response.json();
    if (payload && payload.error) throw new Error('RPC_ERROR');
    return payload ? payload.result : null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  securityHeaders(res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (!enforceOrigin(req, res)) return;
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return res.status(415).json({ error: 'JSON request required' });
  }
  const contentLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > 2048) {
    return res.status(413).json({ error: 'Request body too large' });
  }

  if (process.env.ENABLE_SEPOLIA_TEST_DEPOSITS !== 'true') {
    return res.status(403).json({ error: 'Sepolia test deposits are disabled' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const rpcUrl = String(process.env.SEPOLIA_RPC_URL || '').trim();
  const configuredRecipient = String(process.env.SEPOLIA_DEPOSIT_ADDRESS || '').trim();
  if (!supabaseUrl || !serviceKey || !rpcUrl || !isAddress(configuredRecipient)) {
    return res.status(503).json({ error: 'Sepolia test infrastructure is not configured' });
  }

  const body = readJsonBody(req);
  const depositTxId = body && String(body.depositTxId || '').trim();
  const txHash = body && String(body.txHash || '').trim();
  if (!UUID_RE.test(depositTxId || '') || !TX_HASH_RE.test(txHash || '')) {
    return res.status(400).json({ error: 'Invalid deposit transaction ID or Sepolia transaction hash' });
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
    const [chainHex, tx, receipt, latestBlockHex] = await Promise.all([
      rpcCall(rpcUrl, 'eth_chainId', []),
      rpcCall(rpcUrl, 'eth_getTransactionByHash', [txHash]),
      rpcCall(rpcUrl, 'eth_getTransactionReceipt', [txHash]),
      rpcCall(rpcUrl, 'eth_blockNumber', [])
    ]);

    if (!chainHex || BigInt(chainHex) !== SEPOLIA_CHAIN_ID) {
      return res.status(502).json({ error: 'Configured RPC is not Sepolia' });
    }
    if (!tx) return res.status(404).json({ error: 'Sepolia transaction not found' });
    if (!receipt || !receipt.blockNumber) {
      return res.status(409).json({ error: 'Transaction is still pending on Sepolia' });
    }
    if (String(receipt.status).toLowerCase() !== '0x1') {
      return res.status(422).json({ error: 'Sepolia transaction failed' });
    }
    if (!tx.to || !isAddress(tx.to)) {
      return res.status(422).json({ error: 'Transaction has no valid recipient' });
    }

    const expected = getAddress(configuredRecipient);
    const actual = getAddress(tx.to);
    if (actual !== expected) {
      return res.status(422).json({ error: 'Transaction was not sent to the NexTrade Sepolia test address' });
    }

    const valueWei = BigInt(tx.value || '0x0');
    if (valueWei <= 0n) {
      return res.status(422).json({ error: 'Sepolia transaction transferred no ETH' });
    }

    const blockNumber = BigInt(receipt.blockNumber);
    const latestBlock = BigInt(latestBlockHex || '0x0');
    if (latestBlock < blockNumber) throw new Error('RPC_BLOCK_REGRESSION');

    const confirmations = Number(latestBlock - blockNumber + 1n);
    const requiredConfirmations = parseMinConfirmations();
    if (confirmations < requiredConfirmations) {
      return res.status(409).json({
        error: `Waiting for Sepolia confirmations (${confirmations}/${requiredConfirmations})`,
        confirmations,
        requiredConfirmations
      });
    }

    const sender = tx.from && isAddress(tx.from) ? getAddress(tx.from) : null;
    if (!sender) return res.status(422).json({ error: 'Transaction sender is invalid' });

    const { data, error } = await supabase.rpc('confirm_sepolia_test_deposit', {
      p_user_id: user.id,
      p_transaction_id: depositTxId,
      p_tx_hash: txHash.toLowerCase(),
      p_sender: sender,
      p_recipient: actual,
      p_value_wei: valueWei.toString(),
      p_block_number: Number(blockNumber)
    });
    if (error) throw error;
    if (!data || !data[0] || !data[0].tx_id) throw new Error('Invalid deposit confirmation response');

    return res.status(200).json({
      ok: true,
      testnet: true,
      chainId: Number(SEPOLIA_CHAIN_ID),
      confirmations,
      txId: data[0].tx_id,
      spotBalance: Number(data[0].spot_balance),
      approvedAt: data[0].approved_at
    });
  } catch (error) {
    console.error('[verify-sepolia-deposit]', error && error.message ? error.message : error);
    return res.status(500).json({ error: 'Could not verify Sepolia deposit' });
  }
};
