/**
 * Kurier client (zkVerify proof submission) — mainnet, RECOMMENDED by
 * https://agentgames.zkverify.io/build.
 *
 * Signup (FREE, email): https://kurier.xyz → generate API key → save as
 * KURIER_API_KEY in .env (never commit it, never log it). The key goes in
 * the URL PATH of every request (not a header).
 *
 * Base URL: https://api.kurier.xyz/api/v1
 *   POST /register-vk/{apiKey}     — once per verification key
 *   POST /submit-proof/{apiKey}    — submit a Groth16 proof
 *   GET  /job-status/{apiKey}/{jobId} — poll until Finalized
 * Job states: Queued → Valid → Submitted → IncludedInBlock → Finalized
 * (or Failed).
 *
 * For Agent Games the circuit VKs are ALREADY registered on mainnet, so
 * submit with vkRegistered: true + the published vkHash — no register-vk
 * call is needed.
 *
 * Env: KURIER_API_KEY (required), KURIER_BASE (default mainnet above).
 * Uses global fetch (Node 20+). On this VM, start the server with
 * NODE_USE_ENV_PROXY=1 so fetch goes through the egress proxy; on
 * Vercel no proxy is needed.
 */
'use strict';

const KURIER_BASE = (process.env.KURIER_BASE || 'https://api.kurier.xyz/api/v1').replace(/\/$/, '');
const API_KEY = process.env.KURIER_API_KEY || '';

function needKey() {
  if (!API_KEY) throw new Error('KURIER_API_KEY is not set — sign up free at https://kurier.xyz');
}

async function api(path, method, body) {
  needKey();
  const url = `${KURIER_BASE}${path}/${API_KEY}`;
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`kurier ${method} ${path} → HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

/** Register a verification key once (idempotent per vk hash). */
async function registerVk(vk) {
  return api('/register-vk', 'POST', {
    proofType: 'groth16',
    proofOptions: { library: 'snarkjs', curve: 'bn128' },
    vk,
  });
}

/**
 * Submit a Groth16 proof. Returns { jobId, optimisticVerify, ... }.
 * @param {{proof: object, publicSignals: string[], vkHash: string}} p
 */
async function submitProof(p) {
  return api('/submit-proof', 'POST', {
    proofType: 'groth16',
    vkRegistered: true,
    proofOptions: { library: 'snarkjs', curve: 'bn128' },
    proofData: { proof: p.proof, publicSignals: p.publicSignals, vk: p.vkHash },
  });
}

/** Poll a job until Finalized (or Failed/timeout). Returns the final job object. */
async function waitFinalized(jobId, { timeoutMs = 180000, intervalMs = 5000 } = {}) {
  const started = Date.now();
  for (;;) {
    const job = await api(`/job-status/${jobId}`, 'GET');
    const status = job.status || job.state;
    if (status === 'Finalized') return job;
    if (status === 'Failed') throw new Error(`kurier job ${jobId} Failed: ${JSON.stringify(job).slice(0, 300)}`);
    if (Date.now() - started > timeoutMs) throw new Error(`kurier job ${jobId} did not finalize in ${timeoutMs}ms (last: ${status})`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

module.exports = { registerVk, submitProof, waitFinalized, KURIER_BASE };
