'use strict';

const { createClient } = require('@supabase/supabase-js');

const MAX_BODY_BYTES = 4096;

const IDEMPOTENCY_RE =
  /^deposit:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$/;

const REFERENCE_RE =
  /^NXT-[A-F0-9]{8}-[A-Z0-9]{4,20}$/;

const RAIL_LABELS = Object.freeze({
  ETH_ERC20: 'ETH / USDT (ERC-20)',
  USDT_TRC20: 'USDT (TRC-20)',
  BTC: 'Bitcoin (BTC)'
});

function send(res, status, body) {
  return res.status(status).json(body);
}

function setSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function isSameOrigin(req) {
  const origin = String(req.headers.origin || '');
  const host = String(req.headers.host || '');

  if (!origin || !host) return false;

  try {
    const parsed = new URL(origin);

    return (
      parsed.protocol === 'https:' &&
      parsed.host === host
    );
  } catch (_) {
    return false;
  }
}

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== 'POST') {
    return send(res, 405, {
      error: 'Method not allowed'
    });
  }

  /*
   * Hard stop:
   * this route is usable only inside a Vercel Preview deployment.
   * If this code were ever accidentally merged into Production,
   * the route returns 404 before touching the database.
   */
  if (process.env.VERCEL_ENV !== 'preview') {
    return send(res, 404, {
      error: 'Not found'
    });
  }

  if (!isSameOrigin(req)) {
    return send(res, 403, {
      error: 'Origin rejected'
    });
  }

  const contentType =
    String(req.headers['content-type'] || '').toLowerCase();

  if (!contentType.startsWith('application/json')) {
    return send(res, 415, {
      error: 'JSON required'
    });
  }

  const contentLength =
    Number(req.headers['content-length'] || 0);

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_BODY_BYTES
  ) {
    return send(res, 413, {
      error: 'Request body too large'
    });
  }

  const supabaseUrl =
    process.env.SUPABASE_URL;

  const serviceKey =
    process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return send(res, 503, {
      error: 'Deposit test service unavailable'
    });
  }

  const authorization =
    String(req.headers.authorization || '');

  if (!authorization.startsWith('Bearer ')) {
    return send(res, 401, {
      error: 'Authentication required'
    });
  }

  const token =
    authorization.slice(7).trim();

  if (!token) {
    return send(res, 401, {
      error: 'Authentication required'
    });
  }

  const body =
    req.body && typeof req.body === 'object'
      ? req.body
      : {};

  const amount =
    Number(body.amount);

  const idempotencyKey =
    String(body.idempotencyKey || '').trim();

  const depositReference =
    String(body.depositReference || '').trim();

  const rail =
    String(body.rail || '').trim();

  const railLabel =
    RAIL_LABELS[rail];

  if (
    !Number.isFinite(amount) ||
    amount < 10 ||
    amount > 100000
  ) {
    return send(res, 400, {
      error: 'Test amount must be between 10 and 100000'
    });
  }

  const normalizedAmount =
    Number(amount.toFixed(8));

  if (
    Math.abs(normalizedAmount - amount) > 1e-10
  ) {
    return send(res, 400, {
      error: 'Amount supports at most 8 decimal places'
    });
  }

  if (!IDEMPOTENCY_RE.test(idempotencyKey)) {
    return send(res, 400, {
      error: 'Invalid idempotency key'
    });
  }

  if (!REFERENCE_RE.test(depositReference)) {
    return send(res, 400, {
      error: 'Invalid deposit reference'
    });
  }

  if (!railLabel) {
    return send(res, 400, {
      error: 'Invalid test rail'
    });
  }

  const description =
    `Deposit (${railLabel}) — Ref: ${depositReference}`;

  /*
   * Keep user-token verification completely separate from the
   * privileged database client.
   *
   * A service/secret client must never inherit a user's JWT for
   * privileged writes or RLS will apply as that user.
   */
  const authClient = createClient(
    supabaseUrl,
    serviceKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );

  const {
    data: userData,
    error: userError
  } = await authClient.auth.getUser(token);

  /*
   * Fresh privileged client.
   *
   * Explicitly pin Authorization to the server credential so no browser
   * session JWT can ever replace the service-role identity used by PostgREST.
   */
  const adminClient = createClient(
    supabaseUrl,
    serviceKey,
    {
      global: {
        headers: {
          Authorization: `Bearer ${serviceKey}`
        }
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );

  /*
   * Fail closed before any privileged table access.
   * This checks the role Postgres actually sees.
   */
  const {
    data: isServiceRole,
    error: roleCheckError
  } = await adminClient.rpc('is_service_role');

  if (
    roleCheckError ||
    isServiceRole !== true
  ) {
    console.error(
      '[test-manual-deposit] privileged role check failed',
      {
        code: roleCheckError && roleCheckError.code,
        message: roleCheckError && roleCheckError.message
      }
    );

    return send(res, 503, {
      error: 'Privileged database access unavailable'
    });
  }

  const user =
    userData && userData.user;

  if (
    userError ||
    !user ||
    !user.id
  ) {
    return send(res, 401, {
      error: 'Invalid session'
    });
  }

  /*
   * A valid Auth user may pre-date a database/profile rebuild.
   * Repair the read-cache profile server-side instead of rejecting
   * an otherwise valid authenticated test user.
   */
  const rawName =
    user.user_metadata &&
    typeof user.user_metadata.full_name === 'string'
      ? user.user_metadata.full_name
      : '';

  const fullName =
    rawName.trim().slice(0, 120);

  const {
    error: profileError
  } = await adminClient
    .from('profiles')
    .upsert(
      {
        id: user.id,
        email: user.email || null,
        full_name: fullName
      },
      {
        onConflict: 'id',
        ignoreDuplicates: true
      }
    );

  if (profileError) {
    console.error(
      '[test-manual-deposit] profile bootstrap failed',
      {
        code: profileError.code,
        message: profileError.message
      }
    );

    return send(res, 500, {
      error: 'Profile bootstrap failed'
    });
  }

  const selectExisting = () =>
    adminClient
      .from('transactions')
      .select(
        'id,type,amount,status,description,metadata,created_at'
      )
      .eq('user_id', user.id)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

  const validateExisting = row =>
    row &&
    row.type === 'deposit' &&
    Number(row.amount) === normalizedAmount &&
    row.description === description &&
    row.metadata &&
    row.metadata.manual_deposit_test === true;

  /*
   * Retry safety:
   * the same browser request cannot create duplicate deposits.
   */
  const {
    data: existing,
    error: existingError
  } = await selectExisting();

  if (existingError) {
    return send(res, 500, {
      error: 'Could not check existing deposit'
    });
  }

  if (existing) {
    if (!validateExisting(existing)) {
      return send(res, 409, {
        error: 'Idempotency key conflict'
      });
    }

    return send(res, 200, {
      tx_id: existing.id,
      status: existing.status,
      created_at: existing.created_at,
      test_only: true
    });
  }

  /*
   * IMPORTANT:
   * only a PENDING ledger row is created.
   * This does not add money to Spot.
   */
  const {
    data: inserted,
    error: insertError
  } = await adminClient
    .from('transactions')
    .insert({
      user_id: user.id,
      type: 'deposit',
      amount: normalizedAmount,
      status: 'pending',
      description,
      idempotency_key: idempotencyKey,
      metadata: {
        manual_deposit_test: true,
        test_only: true,
        deposit_reference: depositReference,
        rail
      }
    })
    .select('id,status,created_at')
    .single();

  /*
   * Protect against a concurrent retry racing the first request.
   */
  if (insertError) {
    if (insertError.code === '23505') {
      const {
        data: raced,
        error: raceError
      } = await selectExisting();

      if (
        !raceError &&
        validateExisting(raced)
      ) {
        return send(res, 200, {
          tx_id: raced.id,
          status: raced.status,
          created_at: raced.created_at,
          test_only: true
        });
      }
    }

    return send(res, 500, {
      error: 'Could not create pending test deposit'
    });
  }

  return send(res, 201, {
    tx_id: inserted.id,
    status: inserted.status,
    created_at: inserted.created_at,
    test_only: true
  });
};
