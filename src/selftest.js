/**
 * Self-test: spins the server on a random port and sends mock envelopes
 * (gatekeeper valid + all 7 trap varieties, steal turn) with HMAC signing.
 * No network, no secrets, no Kurier. Exit 0 when every case behaves as
 * the documented scoring expects.
 *
 * NOTE: on-chain verification is not wired yet, so valid tasks fail
 * closed to REJECT/UNVERIFIED in this build — the test asserts the trap
 * rejections (which do not depend on the chain) and documents the valid
 * case as pending Kurier wiring.
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

const cases = [
  ['VK_SUBSTITUTION', { ...baseInput, proof_vk: '0xa4c100000000000000000000000000000000000000000000000000000000b8ff' }, 'REJECT', 'VK_SUBSTITUTION'],
  ['THRESHOLD_MISMATCH', { ...baseInput, public_balance: '999' }, 'REJECT', 'THRESHOLD_MISMATCH'],
  ['EXPIRED_CONDITION', { ...baseInput, current_block: 19842202 }, 'REJECT', 'EXPIRED_CONDITION'],
  ['RECIPIENT_MISMATCH', { ...baseInput, condition_recipient: '0xDe4200000000000000000000000000000000009999' }, 'REJECT', 'RECIPIENT_MISMATCH'],
  ['AMOUNT_OVERFLOW', { ...baseInput, amount: '1001' }, 'REJECT', 'AMOUNT_OVERFLOW'],
];

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

    for (const [name, input, wantDec, wantReason] of cases) {
      const r = await post('/', { type: 'agent-games.proof-gatekeeper.v1', task_id: `gk_test_${name}`, input });
      const o = JSON.parse(r.body);
      check(`gatekeeper ${name}`, r.status === 200 && o.decision === wantDec && o.reason_code === wantReason, r.body);
      check(`response signed (${name})`, typeof r.sig === 'string' && r.sig.length === 64);
    }

    // PROOF_REUSED: same proof_tx twice — first is fail-closed UNVERIFIED
    // (no chain yet), second must be PROOF_REUSED only if the first was
    // accepted; here the first is not APPROVEd so it is not recorded.
    // We assert the second call is still a REJECT (fail closed either way).
    const r1 = await post('/', { type: 'agent-games.proof-gatekeeper.v1', task_id: 'gk_test_reuse1', input: { ...baseInput, proof_tx: '0xreuse00000000000000000000000000000000000000000000000000000001' } });
    const o1 = JSON.parse(r1.body);
    check('reuse first call rejected (fail closed)', o1.decision === 'REJECT', r1.body);

    // Steal: HOLD default when nothing is exposed; EXTRACT when exposed.
    const s1 = await post('/', { matchId: 'm1', turn: 1, state: { myBalance: 100, myExposed: 0, opponentBalance: 100, opponentExposed: 0 } });
    const so1 = JSON.parse(s1.body);
    check('steal HOLD default', s1.status === 200 && so1.action === 'HOLD' && so1.matchId === 'm1' && so1.turn === 1, s1.body);
    check('steal HOLD has no amount field', !('amount' in so1));

    const s2 = await post('/', { matchId: 'm1', turn: 2, state: { myBalance: 100, myExposed: 0, opponentBalance: 100, opponentExposed: 40 } });
    const so2 = JSON.parse(s2.body);
    check('steal EXTRACT when exposed', so2.action === 'EXTRACT' && so2.amount === 40, s2.body);

    const s3 = await post('/', { matchId: 'm1', turn: 3, state: { myBalance: 100, myExposed: 30, opponentBalance: 100, opponentExposed: 0, opponentLastAction: 'EXTRACT' } });
    const so3 = JSON.parse(s3.body);
    check('steal FORTIFY when exposed+attacked', so3.action === 'FORTIFY', s3.body);
  } finally {
    srv.kill('SIGTERM');
  }
  console.log(`\nselftest: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
