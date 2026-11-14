/**
 * sky-agent-games — long-running HTTP server (local dev / tunnel use).
 * All logic lives in src/handler.js; this file is only the HTTP shell.
 * Env: PORT (default 3000), AGENT_GAMES_SECRET, KURIER_API_KEY.
 */
'use strict';

const http = require('http');
const { handleRequest } = require('./handler');

const PORT = Number(process.env.PORT || 3000);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const rawBody = req.method === 'POST' ? await readBody(req) : Buffer.alloc(0);
    const out = await handleRequest({
      method: req.method,
      url: req.url,
      headers: req.headers,
      rawBody,
    });
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  } catch (e) {
    console.error('[error]', e);
    try {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ matchId: '', turn: 0, action: 'HOLD' }));
    } catch { /* socket gone */ }
  }
});

server.listen(PORT, () => {
  console.log(`sky-agent-games listening on :${PORT}`);
});
