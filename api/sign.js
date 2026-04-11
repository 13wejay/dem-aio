// Vercel Serverless Function — Planetary Computer SAS URL Signer
// Proxies signing requests so browser CORS is not an issue
export const config = { runtime: 'edge' };

const PC_SIGN_API = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=';
const PC_TOKEN_API = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/';

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
  const href = url.searchParams.get('href');
  const collection = url.searchParams.get('collection'); // for token endpoint

  try {
    let upstreamUrl;
    if (collection) {
      // Token endpoint: /api/sign?collection=esa-worldcover
      upstreamUrl = PC_TOKEN_API + encodeURIComponent(collection);
    } else if (href) {
      // Sign endpoint: /api/sign?href=<blob_url>
      upstreamUrl = PC_SIGN_API + encodeURIComponent(href);
    } else {
      return new Response(JSON.stringify({ error: 'Missing href or collection parameter' }), {
        status: 400, headers: corsHeaders
      });
    }

    const res = await fetch(upstreamUrl, {
      headers: { 'User-Agent': 'DEM-Explorer/1.0' }
    });

    const body = await res.text();

    return new Response(body, {
      status: res.status,
      headers: {
        ...corsHeaders,
        'Content-Type': res.headers.get('content-type') || 'application/json',
        'Cache-Control': 'public, max-age=3300' // SAS tokens last ~1hr
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Sign proxy failed: ' + err.message }), {
      status: 502, headers: corsHeaders
    });
  }
}
