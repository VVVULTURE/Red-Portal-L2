/**
 * api/bare/[...path].js
 *
 * Vercel catch-all serverless function that runs the Ultraviolet bare server.
 * Handles all requests to /api/bare/* — the UV service worker routes fetches
 * through here so they happen server-side (bypassing browser CORS).
 *
 * Note: Vercel hobby plan has a 10 s function timeout and no WebSocket support.
 * HTTP-only games work fine. Multiplayer games using WebSockets will fall back
 * to direct navigation automatically in the proxy error handler.
 */

const { createBareServer } = require('@tomphttp/bare-server-node');

// Reuse the bare server instance across warm invocations
let bare;
function getBare() {
  if (!bare) bare = createBareServer('/api/bare/');
  return bare;
}

module.exports = async function handler(req, res) {
  // CORS pre-flight — UV needs these
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const server = getBare();

  if (server.shouldRoute(req)) {
    try {
      await server.routeRequest(req, res);
    } catch (err) {
      console.error('[bare] routeRequest error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Bare server error: ' + err.message);
      }
    }
  } else {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Invalid bare request — expected path starting with /api/bare/');
  }
};
