/**
 * Shared request handler for sky-agent-games.
 * Used by both the long-running server (src/server.js) and the Vercel
 * serverless function (api/index.js). Pure logic — no HTTP server here.
 *
 * State (seenProofs / seenTurns) is in-memory per process. On a
 * long-running server it persists for the whole competition. On Vercel
 * (serverless) each function instance has its own copy, so PROOF_REUSED
 * detection is best-effort there — a reused proof could slip through if
 * it lands on a fresh instance. That is a known limitation, documented
 * in README.md; the on-chain check (once wired) is the real guard.
 *
 * @param {object} req - { method, url, headers, rawBody: Buffer }
 * @returns {Promise<{status:number, body:string, headers:object}>}
 */
'use strict';

const crypto = require('crypto');
const { decide } = require('./gatekeeper');
const { chooseAction, validateTurn } = require('./steal');
const { proveGatekeeper, provePolicy, PROOF_READY } = require('./proof');

const SECRET = process.env.AGENT_GAMES_SECRET || '';
const AGENT_NAME = process.env.AGENT_NAME || 'Wowo';

const seenProofs = new Set();
const seenTurns = new Set();

function hmacHex(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifySignature(headers, rawBody) {
  if (!SECRET) {
    console.warn('[warn] AGENT_GAMES_SECRET not set — skipping HMAC verification (DEV ONLY)');
    return true;
  }
  const sig = headers['x-agent-games-signature'];
  if (!sig) return false;
  const presented = String(sig).replace(/^sha256=/, '');
  return safeEqual(presented, hmacHex(SECRET, rawBody));
}

function signResponse(rawBody) {
  if (!SECRET) return '';
  return hmacHex(SECRET, rawBody);
}

async function handleGatekeeper(envelope) {
  const input = envelope.input || {};
  const taskId = envelope.task_id || envelope.taskId || '';
  // TODO(kurier): verify proof_tx on-chain before approving. Until then
  // we fail closed (REJECT/UNVERIFIED) — never let a trap through.
  const onChainVerified = false;
  const result = decide(input, { seenProofs, onChainVerified });
  if (result.decision === 'APPROVE') seenProofs.add(result.proof_tx);

  const response = {
    decision: result.decision,
    reason_code: result.reason_code,
    proof_tx: result.proof_tx,
  };

  if (PROOF_READY) {
    try {
      const p = await proveGatekeeper(input, result);
      response.proof = p.proof;
      response.public_signals = p.publicSignals;
      response.circuitVersion = p.circuitVersion;
      response.vkHash = p.vkHash;
    } catch (e) {
      console.error('[gatekeeper] proof failed:', e.message);
    }
  }
  console.log(`[gatekeeper] ${taskId} -> ${result.decision} ${result.reason_code}`);
  return response;
}

async function handleSteal(envelope) {
  const err = validateTurn(envelope);
  const matchId = envelope.matchId || envelope.match_id || '';
  const turn = envelope.turn;
  if (err) {
    console.warn(`[steal] invalid turn envelope (${err}) — answering HOLD`);
    return { matchId, turn, action: 'HOLD' };
  }
  const key = `${matchId}:${turn}`;
  if (seenTurns.has(key)) {
    console.warn(`[steal] duplicate turn ${key} — answering HOLD`);
    return { matchId, turn, action: 'HOLD' };
  }
  seenTurns.add(key);

  const state = envelope.state || envelope.gameState || envelope;
  const choice = chooseAction(state);
  const response = { matchId, turn, action: choice.action };
  if (choice.action === 'EXTRACT' && choice.amount !== undefined) {
    response.amount = choice.amount;
  }

  if (PROOF_READY) {
    try {
      const p = await provePolicy(envelope, choice);
      response.policyProof = { circuitVersion: p.circuitVersion, proof: p.proof, public_signals: p.publicSignals };
      response.proofReference = p.vkHash;
    } catch (e) {
      console.error('[steal] policy proof failed:', e.message);
    }
  }
  console.log(`[steal] ${key} -> ${choice.action} (${choice.reason})`);
  return response;
}

async function handleRequest(req) {
  const started = Date.now();
  const json = (status, obj) => {
    const body = JSON.stringify(obj);
    return {
      status,
      body,
      headers: {
        'content-type': 'application/json',
        'x-agent-games-signature': signResponse(body),
      },
    };
  };

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health' || req.url === '/api/health')) {
    return json(200, {
      ok: true, agent: AGENT_NAME,
      tracks: ['proof_gatekeeper', 'steal_the_vfy'],
      proofReady: PROOF_READY,
      time: new Date().toISOString(),
    });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method not allowed' });
  }

  const raw = req.rawBody || Buffer.alloc(0);
  if (!verifySignature(req.headers || {}, raw)) {
    console.warn('[auth] bad/missing HMAC signature — rejecting');
    return json(401, { error: 'bad signature' });
  }

  let envelope;
  try {
    envelope = JSON.parse(raw.toString('utf8'));
  } catch {
    return json(400, { error: 'invalid json' });
  }

  const type = String(envelope.type || '');
  let out;
  if (type.includes('proof-gatekeeper') || envelope.input) {
    out = await handleGatekeeper(envelope);
    console.log(`[gatekeeper] ${Date.now() - started}ms`);
  } else if (type.includes('steal') || type.includes('vfy') || envelope.matchId || envelope.match_id) {
    out = await handleSteal(envelope);
    console.log(`[steal] ${Date.now() - started}ms`);
  } else {
    console.warn('[warn] unknown envelope type:', type);
    out = { matchId: envelope.matchId || '', turn: envelope.turn ?? 0, action: 'HOLD' };
  }
  return json(200, out);
}

module.exports = { handleRequest };
