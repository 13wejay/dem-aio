// Vercel Edge Function — Authenticated proxy for NASA Earthdata
// Key design: Bearer/Basic auth only goes to Earthdata domains.
// When Earthdata redirects to S3 presigned URLs, we strip the Authorization
// header so S3's own query-string signature can work correctly.
export const config = { runtime: 'edge' };

const EARTHDATA_DOMAINS = [
  'earthdata.nasa.gov',
  'ornldaac.earthdata.nasa.gov',
  'data.ornldaac.earthdata.nasa.gov',
  'urs.earthdata.nasa.gov',
  'gpm1.gesdisc.eosdis.nasa.gov',
  'disc.gsfc.nasa.gov',
];

function isEarthdataDomain(url) {
  try {
    const host = new URL(url).hostname;
    return EARTHDATA_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch { return false; }
}

const ALLOWED_TARGET_DOMAINS = [
  'data.ornldaac.earthdata.nasa.gov',
  'opendap.earthdata.nasa.gov',
  'gpm1.gesdisc.eosdis.nasa.gov',
];

async function fetchFollowRedirects(initialUrl, earhdataAuthHeaders, rangeHeader, maxRedirects = 10) {
  let currentUrl = initialUrl;
  let cookies = {};

  for (let i = 0; i <= maxRedirects; i++) {
    const isED = isEarthdataDomain(currentUrl);

    // Only send auth headers to Earthdata. Strip them for S3 / other hosts.
    const reqHeaders = {
      'User-Agent': 'DEM-Explorer/1.0'
    };

    if (isED) {
      Object.assign(reqHeaders, earhdataAuthHeaders);
      const cookieStr = buildCookieHeader(cookies);
      if (cookieStr) reqHeaders['Cookie'] = cookieStr;
    }

    // Forward Range header so COG reads work, but NOT during Earthdata login/oauth flows
    const isLoginFlow = currentUrl.includes('urs.earthdata.nasa.gov') || currentUrl.includes('/oauth');
    if (rangeHeader && !isLoginFlow) {
      reqHeaders['Range'] = rangeHeader;
    }

    const response = await fetch(currentUrl, {
      method: 'GET',
      headers: reqHeaders,
      redirect: 'manual'
    });

    // Collect cookies from Earthdata responses
    if (isED) {
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) parseCookies(setCookie, cookies);
    }

    if (response.status === 200 || response.status === 206) {
      return response;
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) break;
      currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
      continue;
    }

    // Return error response as-is so we can report status
    return response;
  }

  throw new Error('Too many redirects');
}

function buildCookieHeader(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function parseCookies(setCookieHeader, target) {
  const parts = setCookieHeader.split(/,(?=\s*\w+=)/);
  for (const part of parts) {
    const main = part.split(';')[0].trim();
    const eq = main.indexOf('=');
    if (eq > 0) {
      target[main.slice(0, eq).trim()] = main.slice(eq + 1).trim();
    }
  }
}

export default async function handler(request) {
  const reqUrl = new URL(request.url);

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

  const targetUrl = reqUrl.searchParams.get('url');
  if (!targetUrl) {
    return errorResponse(400, 'Missing url parameter');
  }

  // Security: only allow known Earthdata data domains as the initial target
  const isAllowed = ALLOWED_TARGET_DOMAINS.some(d => targetUrl.includes(d));
  if (!isAllowed) {
    return errorResponse(403, `Domain not allowed: ${new URL(targetUrl).hostname}`);
  }

  const token    = process.env.EARTHDATA_TOKEN;
  const username = process.env.EARTHDATA_USERNAME;
  const password = process.env.EARTHDATA_PASSWORD;

  if (!token && !username) {
    return errorResponse(500, 'No Earthdata credentials configured on server. Set EARTHDATA_TOKEN in Vercel env vars.');
  }

  // Auth header, applied only to Earthdata domains
  const authHeaders = {};
  if (token) {
    authHeaders['Authorization'] = `Bearer ${token}`;
  } else {
    authHeaders['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`;
  }

  // Forward Range header for COG partial reads
  const rangeHeader = request.headers.get('Range') || request.headers.get('range') || null;

  try {
    const upstream = await fetchFollowRedirects(targetUrl, authHeaders, rangeHeader);

    const responseHeaders = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Vary': 'Range'
    });

    // Forward important response headers
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const val = upstream.headers.get(h);
      if (val) responseHeaders.set(h, val);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders
    });

  } catch (err) {
    return errorResponse(502, 'Proxy error: ' + err.message);
  }
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
