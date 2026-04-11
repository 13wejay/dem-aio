// Vercel Serverless Function — Expose required public ENV variables
export default function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET');
  response.setHeader('Content-Type', 'application/json');

  response.status(200).json({
    OPENTOPO_API_KEY: process.env.OPENTOPO_API_KEY || '',
    EARTHDATA_TOKEN: process.env.EARTHDATA_TOKEN ? '(set)' : '',  // Do NOT expose token to browser
    EARTHDATA_USERNAME: process.env.EARTHDATA_USERNAME || ''
  });
}
