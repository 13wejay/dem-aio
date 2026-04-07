const https = require('https');

const postData = JSON.stringify({
  collections: ["esa-worldcover"],
  bbox: [-122, 37, -121, 38],
  sortby: [{ field: "datetime", direction: "desc" }]
});

const req = https.request('https://planetarycomputer.microsoft.com/api/stac/v1/search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
}, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => console.log('Status:', res.statusCode, '\nBody starts with:', body.substring(0, 100)));
});

req.on('error', console.error);
req.write(postData);
req.end();
