/**
 * Shared request handler for Wowo (zkVerify Agent Games).
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
const { validateTurn, buildResponse } = require('./steal');
const { proveGatekeeper, provePolicy, PROOF_READY } = require('./proof');
const { submitProof, waitFinalized } = require('./kurier');

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

async function handlePreflight() {
  // The platform sends {type:"agent-games.preflight.v1", agent_id, ...}
  // before marking the agent active. Must answer {ok:true, protocolVersion:"v1"}.
  return { ok: true, protocolVersion: 'v1' };
}

async function handleGatekeeper(envelope) {
  const input = envelope.input || {};
  const taskId = envelope.task_id || envelope.taskId || '';
  // Local checks decide; on-chain verification is re-enabled once the
  // Kurier proof path is wired (see gatekeeper.js for the trade-off).
  const result = decide(input, { seenProofs, requireOnChain: false });
  if (result.decision === 'APPROVE') seenProofs.add(result.proof_tx);

  const response = {
    decision: result.decision,
    reason_code: result.reason_code,
    proof_tx: result.proof_tx,
  };

  // Attach a Groth16 proof when the schema is ready; without it a
  // correct decision still scores but loses the reliability bonus (-2).
  // The proof is also submitted to Kurier until Finalized.
  if (PROOF_READY) {
    try {
      const p = await proveGatekeeper(input, result);
      response.proof = p.proof;
      response.public_signals = p.publicSignals;
      response.circuitVersion = p.circuitVersion;
      response.vkHash = p.vkHash;
      const job = await submitProof({ proof: p.proof, publicSignals: p.publicSignals, vkHash: p.vkHash });
      await waitFinalized(job.jobId);
    } catch (e) {
      console.error('[gatekeeper] proof/kurier failed:', e.message);
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
    // Fail closed: HOLD is always provable and never invalid.
    console.warn(`[steal] invalid turn envelope (${err}) — answering HOLD`);
    return {
      matchId, turn,
      action: { type: 'HOLD' },
      policyProof: { circuitVersion: 'v1', proofReference: '', publicInputsHash: '' },
      agentTimestamp: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID(),
    };
  }
  const key = `${matchId}:${turn}`;
  if (seenTurns.has(key)) {
    console.warn(`[steal] duplicate turn ${key} — answering HOLD`);
    return {
      matchId, turn,
      action: { type: 'HOLD' },
      policyProof: { circuitVersion: 'v1', proofReference: '', publicInputsHash: '' },
      agentTimestamp: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID(),
    };
  }
  seenTurns.add(key);

  let proof;
  if (PROOF_READY) {
    try {
      const p = await provePolicy(envelope, null);
      proof = { proof: p.proof, publicSignals: p.publicSignals };
      const job = await submitProof({ proof: p.proof, publicSignals: p.publicSignals, vkHash: p.vkHash });
      await waitFinalized(job.jobId);
    } catch (e) {
      console.error('[steal] policy proof failed:', e.message);
    }
  }

  const out = buildResponse(envelope, proof);
  const reason = out._reason;
  delete out._reason;
  console.log(`[steal] ${key} -> ${out.action.type} (${reason})`);
  return out;
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
  if (type.includes('preflight')) {
    out = await handlePreflight();
    console.log(`[preflight] ok ${Date.now() - started}ms`);
  } else if (type.includes('proof-gatekeeper') || envelope.input) {
    out = await handleGatekeeper(envelope);
    console.log(`[gatekeeper] ${Date.now() - started}ms`);
  } else if (type.includes('steal') || envelope.eventId === 'steal-the-vfy' || envelope.matchId || envelope.match_id) {
    out = await handleSteal(envelope);
    console.log(`[steal] ${Date.now() - started}ms`);
  } else {
    console.warn('[warn] unknown envelope type:', type);
    out = {
      matchId: envelope.matchId || '', turn: envelope.turn ?? 0,
      action: { type: 'HOLD' },
      agentTimestamp: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID(),
    };
  }
  return json(200, out);
}

module.exports = { handleRequest };
