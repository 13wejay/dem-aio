// Vercel Edge Function — Authenticated proxy for NASA Earthdata
export const config = { runtime: 'edge' };

const ALLOWED_EARTHDATA_DOMAINS = [
  'data.ornldaac.earthdata.nasa.gov',
  'urs.earthdata.nasa.gov',
  'opendap.earthdata.nasa.gov',
  'opendap.cr.usgs.gov'
];

async function fetchFollowRedirects(url, headers, maxRedirects = 8) {
  let currentUrl = url;
  let cookies = {};

  for (let i = 0; i < maxRedirects; i++) {
    const response = await fetch(currentUrl, {
      method: 'GET',
      headers: { ...headers, Cookie: buildCookieHeader(cookies) },
      redirect: 'manual'  // Handle redirects manually
    });

    // Collect any Set-Cookie headers from this response
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      parseCookies(setCookie, cookies);
    }

    if (response.status === 200 || response.status === 206) {
      return response; // Success
    }

    if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
      const location = response.headers.get('location');
      if (!location) break;
      currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
      continue;
    }

    // Non-redirect, non-success
    return response;
  }

  throw new Error('Too many redirects or failed to fetch');
}

function buildCookieHeader(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function parseCookies(setCookieHeader, target) {
  // setCookieHeader may be one or multiple cookies comma-separated
  const parts = setCookieHeader.split(/,(?=[^ ])/);
  for (const part of parts) {
    const main = part.split(';')[0].trim();
    const eqIdx = main.indexOf('=');
    if (eqIdx > 0) {
      target[main.slice(0, eqIdx).trim()] = main.slice(eqIdx + 1).trim();
    }
  }
}

export default async function handler(request) {
  const url = new URL(request.url);

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Security: only allow Earthdata domains
  const isAllowed = ALLOWED_EARTHDATA_DOMAINS.some(domain => targetUrl.includes(domain));
  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Domain not allowed. Must be an Earthdata domain.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const token = process.env.EARTHDATA_TOKEN;
  const username = process.env.EARTHDATA_USERNAME;
  const password = process.env.EARTHDATA_PASSWORD;

  if (!token && !username) {
    return new Response(JSON.stringify({ error: 'No Earthdata credentials configured on server.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Build auth headers — prefer token, fall back to Basic Auth
  const authHeaders = {};
  if (token) {
    authHeaders['Authorization'] = `Bearer ${token}`;
  } else {
    const encoded = btoa(`${username}:${password}`);
    authHeaders['Authorization'] = `Basic ${encoded}`;
  }

  // Forward Range header for COG partial reads
  const rangeHeader = request.headers.get('Range');
  if (rangeHeader) authHeaders['Range'] = rangeHeader;
  authHeaders['User-Agent'] = 'DEM-Explorer/1.0';

  try {
    const response = await fetchFollowRedirects(targetUrl, authHeaders);

    const responseHeaders = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Cache-Control': 'public, max-age=3600'
    });

    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of forwardHeaders) {
      const val = response.headers.get(h);
      if (val) responseHeaders.set(h, val);
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Earthdata proxy failed: ' + error.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
