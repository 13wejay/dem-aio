// Vercel Edge Function — CORS proxy for DEM tile downloads
export const config = { runtime: 'edge' };

const ALLOWED_DOMAINS = [
  'copernicus-dem-30m.s3',
  'portal.opentopography.org',
  'data.hydrosheds.org',
  'opentopography.s3.sdsc.edu'
];

export default async function handler(request) {
  const url = new URL(request.url);

  // Handle CORS preflight
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

  // Security: only allow whitelisted domains
  const isAllowed = ALLOWED_DOMAINS.some(domain => targetUrl.includes(domain));
  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    // Forward range headers for COG partial reads
    const headers = {};
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
      headers['Range'] = rangeHeader;
    }

    const response = await fetch(targetUrl, { headers });

    // Build response headers
    const responseHeaders = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Cache-Control': 'public, max-age=86400'
    });

    // Forward relevant headers
    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of forwardHeaders) {
      const val = response.headers.get(h);
      if (val) responseHeaders.set(h, val);
    }

    // Stream the response body
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy fetch failed: ' + error.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
