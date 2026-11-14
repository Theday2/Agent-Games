/**
 * Vercel serverless entrypoint for sky-agent-games.
 * Same handler as the long-running server (src/handler.js).
 * Set AGENT_GAMES_SECRET (and later KURIER_API_KEY) as Vercel env vars.
 * Vercel parses JSON bodies by default — we need the RAW body for HMAC,
 * so the function reads the request stream itself (bodyParser disabled
 * in vercel.json).
 */
'use strict';

const { handleRequest } = require('../src/handler');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
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
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ matchId: '', turn: 0, action: { type: 'HOLD' }, agentTimestamp: new Date().toISOString(), idempotencyKey: '' }));
  }
};
