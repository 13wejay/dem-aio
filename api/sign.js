// Vercel Serverless Function — Planetary Computer SAS URL Signer
// Proxies signing requests so browser CORS is not an issue
export const config = { runtime: 'edge' };

const PC_SIGN_API  = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=';
const PC_TOKEN_API = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/';

// Some storage accounts (e.g. Sentinel-1 RTC) do NOT support per-blob signing via
// the /sign?href= endpoint — it times out. For these, we use the collection-level
// /token/<collection> endpoint and stitch the token onto the blob URL ourselves.
const TOKEN_ROUTE_HOSTS = {
  'sentinel1euwestrtc.blob.core.windows.net': 'sentinel-1-rtc',
};

export default async function handler(request) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const href       = url.searchParams.get('href');
  const collection = url.searchParams.get('collection');

  try {
    // ── Token endpoint (explicit collection) ──────────────────────────────
    if (collection) {
      const res  = await fetch(PC_TOKEN_API + encodeURIComponent(collection), {
        headers: { 'User-Agent': 'DEM-Explorer/1.0' }
      });
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3300' }
      });
    }

    if (!href) {
      return new Response(JSON.stringify({ error: 'Missing href or collection parameter' }), {
        status: 400, headers: corsHeaders
      });
    }

    // ── Detect hosts that need the token route instead of sign?href= ──────
    let hrefHostname;
    try { hrefHostname = new URL(href).hostname; } catch { hrefHostname = ''; }
    const tokenCollection = TOKEN_ROUTE_HOSTS[hrefHostname];

    if (tokenCollection) {
      // Fetch the collection token, then stitch it onto the blob URL
      const tokenRes  = await fetch(PC_TOKEN_API + encodeURIComponent(tokenCollection), {
        headers: { 'User-Agent': 'DEM-Explorer/1.0' }
      });
      if (!tokenRes.ok) {
        return new Response(JSON.stringify({ error: `Token endpoint returned ${tokenRes.status}` }), {
          status: tokenRes.status, headers: corsHeaders
        });
      }
      const { token, 'msft:expiry': expiry } = await tokenRes.json();
      const signedHref = href + (href.includes('?') ? '&' : '?') + token;
      return new Response(JSON.stringify({ href: signedHref, 'msft:expiry': expiry }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3300' }
      });
    }

    // ── Default: per-blob sign endpoint ──────────────────────────────────
    const res  = await fetch(PC_SIGN_API + encodeURIComponent(href), {
      headers: { 'User-Agent': 'DEM-Explorer/1.0' }
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        ...corsHeaders,
        'Content-Type': res.headers.get('content-type') || 'application/json',
        'Cache-Control': 'public, max-age=3300'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Sign proxy failed: ' + err.message }), {
      status: 502, headers: corsHeaders
    });
  }
}
