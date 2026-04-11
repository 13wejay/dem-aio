// Local Development Server with static file serving + proxy
const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const url = require('url');

const PORT = 3000;
const ROOT = __dirname;

// Simple .env parser for local dev
let envVars = {};
try {
  const envContent = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  envContent.split('\n').forEach(line => {
    const parts = line.trim().split('=');
    if (parts.length >= 2) {
      const key = parts[0];
      const val = parts.slice(1).join('=');
      envVars[key] = val.replace(/["']/g, ''); // strip quotes
    }
  });
} catch (e) {
  console.log('No .env file found or failed to parse.');
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.geojson': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

const ALLOWED_DOMAINS = [
  'copernicus-dem-30m.s3',
  'copernicus-dem-90m.s3',
  'portal.opentopography.org',
  'data.hydrosheds.org',
  'opentopography.s3.sdsc.edu',
  'planetarycomputer.microsoft.com',
  'data.ornldaac.earthdata.nasa.gov',
  'cmr.earthdata.nasa.gov',
  'urs.earthdata.nasa.gov'
];

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Env endpoint
  if (parsedUrl.pathname === '/api/env') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      OPENTOPO_API_KEY: envVars.OPENTOPO_API_KEY || '',
      EARTHDATA_USERNAME: envVars.EARTHDATA_USERNAME || '',
      EARTHDATA_PASSWORD: envVars.EARTHDATA_PASSWORD || '',
      EARTHDATA_TOKEN: envVars.EARTHDATA_TOKEN || ''
    }));
    return;
  }

  // Proxy endpoint
  if (parsedUrl.pathname === '/api/proxy') {
    const targetUrl = parsedUrl.query.url;
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url parameter' }));
      return;
    }

    const isAllowed = ALLOWED_DOMAINS.some(d => targetUrl.includes(d));
    if (!isAllowed) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Domain not allowed' }));
      return;
    }

    console.log(`[PROXY] ${targetUrl}`);
    const protocol = targetUrl.startsWith('https') ? https : http;

    protocol.get(targetUrl, (proxyRes) => {
      // Forward headers
      if (proxyRes.headers['content-type']) res.setHeader('Content-Type', proxyRes.headers['content-type']);
      if (proxyRes.headers['content-length']) res.setHeader('Content-Length', proxyRes.headers['content-length']);
      if (proxyRes.headers['content-range']) res.setHeader('Content-Range', proxyRes.headers['content-range']);
      res.setHeader('Accept-Ranges', 'bytes');
      res.writeHead(proxyRes.statusCode);
      proxyRes.pipe(res);
    }).on('error', (err) => {
      console.error('[PROXY ERROR]', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy failed: ' + err.message }));
    });
    return;
  }

  // Earthdata proxy endpoint that follows redirects and injects Basic Auth
  if (parsedUrl.pathname === '/api/earthdata') {
    const targetUrl = parsedUrl.query.url;
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url parameter' }));
      return;
    }

    // Must be Earthdata
    if (!targetUrl.includes('earthdata.nasa.gov')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Domain not allowed' }));
      return;
    }

    console.log(`[EARTHDATA] Fetching ${targetUrl}`);

    const fetchFollowRedirects = (currentUrl, options, redirectCount = 0) => {
      if (redirectCount > 10) {
        res.writeHead(500);
        res.end('Too many redirects');
        return;
      }
      
      const reqProto = currentUrl.startsWith('https') ? https : http;
      const req = reqProto.request(currentUrl, options, (proxyRes) => {
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
          const redirectUrl = new URL(proxyRes.headers.location, currentUrl).toString();
          
          // Maintain cookies across redirects
          let cookies = options.headers.Cookie || '';
          if (proxyRes.headers['set-cookie']) {
            const newCookies = proxyRes.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
            cookies = cookies ? `${cookies}; ${newCookies}` : newCookies;
          }
          
          const newOptions = { ...options };
          newOptions.headers = { ...options.headers, Cookie: cookies };
          
          // If redirecting to Earthdata Login, provide Basic Auth if needed
          // But usually we just pass Bearer token everywhere if we have it
          if (envVars.EARTHDATA_TOKEN) {
             newOptions.headers.Authorization = `Bearer ${envVars.EARTHDATA_TOKEN}`;
          } else if (redirectUrl.includes('urs.earthdata.nasa.gov') && envVars.EARTHDATA_USERNAME) {
            const auth = Buffer.from(`${envVars.EARTHDATA_USERNAME}:${envVars.EARTHDATA_PASSWORD}`).toString('base64');
            newOptions.headers.Authorization = `Basic ${auth}`;
          }
          
          fetchFollowRedirects(redirectUrl, newOptions, redirectCount + 1);
        } else {
          // Final destination reached — log status for debugging
          console.log(`[EARTHDATA] ${proxyRes.statusCode} from ${currentUrl.split('?')[0]}`);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
          if (proxyRes.headers['content-type']) res.setHeader('Content-Type', proxyRes.headers['content-type']);
          if (proxyRes.headers['content-length']) res.setHeader('Content-Length', proxyRes.headers['content-length']);
          if (proxyRes.headers['content-range']) res.setHeader('Content-Range', proxyRes.headers['content-range']);
          if (proxyRes.headers['accept-ranges']) res.setHeader('Accept-Ranges', proxyRes.headers['accept-ranges']);
          else res.setHeader('Accept-Ranges', 'bytes');
          res.writeHead(proxyRes.statusCode);
          proxyRes.pipe(res);
        }
      });
      req.on('error', (err) => {
        console.error('[EARTHDATA ERROR]', err.message);
        res.writeHead(502);
        res.end(JSON.stringify({ error: 'Earthdata proxy failed: ' + err.message }));
      });
      req.end();
    };

    // Begin fetch
    const headers = {
      'User-Agent': 'DEM-Explorer/1.0',
      ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {})
    };
    
    // Inject Bearer token immediately if provided
    if (envVars.EARTHDATA_TOKEN) {
      headers.Authorization = `Bearer ${envVars.EARTHDATA_TOKEN}`;
    }

    fetchFollowRedirects(targetUrl, {
      method: req.method,
      headers: headers
    });
    
    return;
  }

  // Save files locally
  if (parsedUrl.pathname === '/api/save' && req.method === 'POST') {
    const filename = parsedUrl.query.filename || `export_${Date.now()}.dat`;
    const exportsDir = path.join(ROOT, 'exports');
    
    // Ensure exports directory exists
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir);
    }
    
    const savePath = path.join(exportsDir, filename);
    const writeStream = fs.createWriteStream(savePath);
    
    req.pipe(writeStream);
    
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, path: savePath }));
    });
    
    req.on('error', (err) => {
      console.error('[SAVE ERROR]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Save failed: ' + err.message }));
    });
    return;
  }

  // Static file serving
  let filePath = parsedUrl.pathname;
  if (filePath === '/') filePath = '/index.html';
  filePath = path.join(ROOT, filePath);

  // Prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`
  ┌───────────────────────────────────────┐
  │                                       │
  │   🌍 DEM Explorer Dev Server          │
  │                                       │
  │   Local:  http://localhost:${PORT}       │
  │   Proxy:  /api/proxy?url=...          │
  │                                       │
  │   Press Ctrl+C to stop                │
  │                                       │
  └───────────────────────────────────────┘
  `);
});
