'use strict';

const ALLOWED_HOSTS = new Set([
  'assets.coingecko.com',
  'coin-images.coingecko.com'
]);
const ALLOWED_PATH_PREFIX = '/coins/images/';
const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif'
]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 2;

function applyHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function parseApprovedImageUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048) return null;

  let url;
  try {
    url = new URL(value);
  } catch (_) {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (url.username || url.password || url.port) return null;
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (!url.pathname.startsWith(ALLOWED_PATH_PREFIX)) return null;

  return url;
}

async function fetchApprovedImage(initialUrl, signal) {
  let current = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const upstream = await fetch(current.href, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.1',
        'User-Agent': 'NexTrade/2.1 coin-image-proxy'
      }
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      if (hop === MAX_REDIRECTS) throw new Error('Too many image redirects');
      const location = upstream.headers.get('location');
      if (!location) throw new Error('Image redirect missing location');
      const redirected = parseApprovedImageUrl(new URL(location, current).href);
      if (!redirected) throw new Error('Image redirect left allowlist');
      current = redirected;
      continue;
    }

    return upstream;
  }

  throw new Error('Image redirect limit exceeded');
}

async function readBodyWithLimit(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0 || body.length > maxBytes) throw new Error('Invalid image payload size');
    return body;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('Image payload too large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }

  if (total === 0) throw new Error('Empty image payload');
  return Buffer.concat(chunks, total);
}

module.exports = async function handler(req, res) {
  applyHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const raw = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  const upstreamUrl = parseApprovedImageUrl(raw);
  if (!upstreamUrl) {
    return res.status(400).json({ error: 'Invalid image URL' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetchApprovedImage(upstreamUrl, controller.signal);

    if (!upstream.ok) {
      return res.status(502).json({ error: 'Image upstream unavailable' });
    }

    const contentType = String(upstream.headers.get('content-type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();

    // Keep same-origin proxy responses passive. SVG is intentionally excluded.
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return res.status(415).json({ error: 'Unsupported image type' });
    }

    const declaredLength = Number(upstream.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: 'Image too large' });
    }

    let body;
    try {
      body = await readBodyWithLimit(upstream, MAX_IMAGE_BYTES);
    } catch (error) {
      if (/too large|payload size/i.test(String(error?.message || ''))) {
        return res.status(413).json({ error: 'Image too large' });
      }
      throw error;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800');

    const etag = upstream.headers.get('etag');
    if (etag) res.setHeader('ETag', etag);

    return res.status(200).send(body);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return res.status(504).json({ error: 'Image upstream timeout' });
    }
    console.error('[COIN_IMAGE] Proxy failed:', error && error.message ? error.message : error);
    return res.status(502).json({ error: 'Image proxy failed' });
  } finally {
    clearTimeout(timeout);
  }
};

module.exports._test = {
  parseApprovedImageUrl,
  fetchApprovedImage,
  readBodyWithLimit,
  ALLOWED_HOSTS,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_PATH_PREFIX,
  MAX_IMAGE_BYTES,
  MAX_REDIRECTS
};
