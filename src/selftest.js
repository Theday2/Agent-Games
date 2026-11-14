/**
 * Self-test: spins the server on a random port and sends mock envelopes
 * in the REAL platform formats (agentgames.zkverify.io/build):
 *   - preflight {type:"agent-games.preflight.v1"} → {ok:true, protocolVersion:"v1"}
 *   - gatekeeper valid + all trap varieties
 *   - steal turns with the real state fields (selfBalance/opponentBalance/
 *     selfFortifiedUntilTurn/opponentFortifiedUntilTurn)
 * No network, no secrets, no Kurier. Exit 0 when every case behaves as
 * the documented scoring expects.
 */
'use strict';

const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SECRET = 'test-secret-32-bytes-0123456789abcdef';
const PORT = 3456;

function hmac(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

function post(path, obj, sign = true) {
  const body = JSON.stringify(obj);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path, method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...(sign ? { 'x-agent-games-signature': hmac(body) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, sig: res.headers['x-agent-games-signature'] }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: PORT, path }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

const baseInput = {
  registered_vk: '0x7d3a00000000000000000000000000000000000000000000000000000000f291',
  proof_vk: '0x7d3a00000000000000000000000000000000000000000000000000000000f291',
  minimum: '1000', public_balance: '1460', expiry_block: 19842201,
  current_block: 19832000, recipient: '0xDe4200000000000000000000000000000000009f01',
  condition_recipient: '0xDe4200000000000000000000000000000000009f01',
  amount: '500', max_transfer: '1000', proof_tx: '0xa4c1000000000000000000000000000000000000000000000000000000008ff1',
};

const trapCases = [
  ['VK_SUBSTITUTION', { ...baseInput, proof_vk: '0xa4c100000000000000000000000000000000000000000000000000000000b8ff' }, 'REJECT', 'VK_SUBSTITUTION'],
  ['THRESHOLD_MISMATCH', { ...baseInput, public_balance: '999' }, 'REJECT', 'THRESHOLD_MISMATCH'],
  ['EXPIRED_CONDITION', { ...baseInput, current_block: 19842202 }, 'REJECT', 'EXPIRED_CONDITION'],
  ['RECIPIENT_MISMATCH', { ...baseInput, condition_recipient: '0xDe4200000000000000000000000000000000009999' }, 'REJECT', 'RECIPIENT_MISMATCH'],
  ['AMOUNT_OVERFLOW', { ...baseInput, amount: '1001' }, 'REJECT', 'AMOUNT_OVERFLOW'],
];

function stealEnvelope(matchId, turn, state) {
  return {
    protocolVersion: 'v1', eventId: 'steal-the-vfy', mode: 'competition',
    matchId, turn, issuedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    state: { selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null, ...state },
    strategyCommitment: { hash: '0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047' },
    resolverVersion: 'v1', nonce: 'test-nonce-' + turn,
  };
}

async function main() {
  const srv = spawn('node', ['src/server.js'], {
    cwd: __dirname + '/..',
    env: { ...process.env, PORT: String(PORT), AGENT_GAMES_SECRET: SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
  srv.stderr.on('data', (d) => process.stdout.write('[srv:err] ' + d));
  await new Promise((r) => setTimeout(r, 1200));

  let pass = 0; let fail = 0;
  const check = (name, cond, extra = '') => {
    if (cond) { pass++; console.log(`PASS ${name}`); }
    else { fail++; console.log(`FAIL ${name} ${extra}`); }
  };

  try {
    const h = await get('/health');
    check('health 200', h.status === 200 && JSON.parse(h.body).ok === true, h.body);

    const bad = await post('/', { type: 'agent-games.proof-gatekeeper.v1', input: baseInput }, false);
    check('unsigned request rejected (401)', bad.status === 401, `status=${bad.status}`);

    // Preflight must answer {ok:true, protocolVersion:"v1"}.
    const pf = await post('/', { type: 'agent-games.preflight.v1', agent_id: 'agt_test', issued_at: new Date().toISOString(), nonce: 'abc123' });
    const pfo = JSON.parse(pf.body);
    check('preflight ok', pf.status === 200 && pfo.ok === true && pfo.protocolVersion === 'v1', pf.body);

    // Valid task: all fields match → APPROVE (local checks; on-chain gate off).
    const ok = await post('/', { type: 'agent-games.proof-gatekeeper.v1', task_id: 'gk_test_valid', input: { ...baseInput, proof_tx: '0xvalid00000000000000000000000000000000000000000000000000000001' } });
    const oko = JSON.parse(ok.body);
    check('gatekeeper valid → APPROVE', ok.status === 200 && oko.decision === 'APPROVE' && oko.reason_code === 'VALID_CONDITION', ok.body);

    // Same proof_tx again → PROOF_REUSED (first APPROVE recorded it).
    const re = await post('/', { type: 'agent-games.proof-gatekeeper.v1', task_id: 'gk_test_reuse', input: { ...baseInput, proof_tx: '0xvalid00000000000000000000000000000000000000000000000000000001' } });
    const reo = JSON.parse(re.body);
    check('gatekeeper reuse → PROOF_REUSED', reo.decision === 'REJECT' && reo.reason_code === 'PROOF_REUSED', re.body);

    for (const [name, input, wantDec, wantReason] of trapCases) {
      const r = await post('/', { type: 'agent-games.proof-gatekeeper.v1', task_id: `gk_test_${name}`, input });
      const o = JSON.parse(r.body);
      check(`gatekeeper ${name}`, r.status === 200 && o.decision === wantDec && o.reason_code === wantReason, r.body);
      check(`response signed (${name})`, typeof r.sig === 'string' && r.sig.length === 64);
    }

    // Steal: real envelope shapes + committed policy v1.
    const s1 = await post('/', stealEnvelope('9f4e1b2a-0000-4000-8000-000000000001', 1, { selfBalance: 100, opponentBalance: 100 }));
    const so1 = JSON.parse(s1.body);
    check('steal level+rich → FORTIFY', so1.action.type === 'FORTIFY' && !('amount' in so1.action), s1.body);
    check('steal response has policyProof+hash', typeof so1.policyProof.publicInputsHash === 'string' && /^0x[0-9a-f]{64}$/.test(so1.policyProof.publicInputsHash), s1.body);
    check('steal response has idempotencyKey+timestamp', typeof so1.idempotencyKey === 'string' && typeof so1.agentTimestamp === 'string', s1.body);
    check('steal response has no _reason leak', !('_reason' in so1));

    const s2 = await post('/', stealEnvelope('9f4e1b2a-0000-4000-8000-000000000001', 2, { selfBalance: 80, opponentBalance: 100 }));
    const so2 = JSON.parse(s2.body);
    check('steal behind → EXTRACT 5', so2.action.type === 'EXTRACT' && so2.action.amount === 5, s2.body);

    const s3 = await post('/', stealEnvelope('9f4e1b2a-0000-4000-8000-000000000002', 1, { selfBalance: 100, opponentBalance: 100, opponentFortifiedUntilTurn: 5 }));
    const so3 = JSON.parse(s3.body);
    check('steal opponent fortified → FORTIFY (protect)', so3.action.type === 'FORTIFY', s3.body);

    const s4 = await post('/', stealEnvelope('9f4e1b2a-0000-4000-8000-000000000003', 18, { selfBalance: 100, opponentBalance: 100 }));
    const so4 = JSON.parse(s4.body);
    check('steal late game → EXTRACT', so4.action.type === 'EXTRACT' && so4.action.amount === 5, s4.body);

    const s5 = await post('/', stealEnvelope('9f4e1b2a-0000-4000-8000-000000000004', 3, { selfBalance: 40, opponentBalance: 40 }));
    const so5 = JSON.parse(s5.body);
    check('steal poor balance → EXTRACT', so5.action.type === 'EXTRACT', s5.body);

    // publicInputsHash is deterministic per turn inputs (unit-level check:
    // re-sending the same turn would hit the duplicate guard, so call the
    // policy function directly twice).
    const { publicInputsHash } = require('./policy');
    const hashInput = {
      commitment: '0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047',
      matchId: '9f4e1b2a-0000-4000-8000-000000000001', turn: 1,
      selfBalance: 100, opponentBalance: 100, action: 'FORTIFY', amount: 0,
    };
    const h1 = so1.policyProof.publicInputsHash;
    const h1b = publicInputsHash(hashInput);
    check('publicInputsHash deterministic', h1 === h1b, `${h1} vs ${h1b}`);
    check('publicInputsHash changes with turn', h1 !== publicInputsHash({ ...hashInput, turn: 2 }));
    check('publicInputsHash changes with action', h1 !== publicInputsHash({ ...hashInput, action: 'EXTRACT', amount: 5 }));
  } finally {
    srv.kill('SIGTERM');
  }
  console.log(`\nselftest: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
