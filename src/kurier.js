/**
 * Kurier client (zkVerify proof submission).
 *
 * Flow (from https://agentgames.zkverify.io/build):
 *   1. Get a mainnet API key.
 *   2. Register the verification key once (submit with its vk hash).
 *   3. Submit proofs with the vk hash.
 *   4. Poll until the job reaches Finalized.
 * Job states: Submitted -> IncludedInBlock -> Finalized.
 *
 * STATUS: endpoint paths + auth scheme are NOT published on the build
 * page. Fill in KURIER_BASE + the request shapes once the Kurier docs
 * (docs.zkverify.io / kurier.network) are confirmed. Until then every
 * method throws a clear error and the server fails closed.
 *
 * Env: KURIER_API_KEY (never commit it; never log it).
 */
'use strict';

const KURIER_BASE = process.env.KURIER_BASE || 'https://api.kurier.network';
const API_KEY = process.env.KURIER_API_KEY || '';

function notReady(what) {
  return new Error(`kurier not ready: ${what} — see src/kurier.js header`);
}

async function api(path, method, body) {
  if (!API_KEY) throw notReady('KURIER_API_KEY is not set');
  throw notReady(`endpoint ${method} ${path} is not confirmed yet`);
}

/** Register a verification key once (idempotent per vk hash). */
async function registerVk(vkHash) {
  return api('/v1/vk', 'POST', { vkHash });
}

/**
 * Submit a Groth16 proof. Returns the Kurier job id.
 * @param {{vkHash: string, proof: object, publicSignals: string[]}} p
 */
async function submitProof(p) {
  return api('/v1/proofs', 'POST', p);
}

/** Poll a job until Finalized (or timeout). Returns the final job object. */
async function waitFinalized(jobId, { timeoutMs = 120000, intervalMs = 5000 } = {}) {
  const started = Date.now();
  for (;;) {
    const job = await api(`/v1/proofs/${jobId}`, 'GET');
    if (job && (job.status === 'Finalized' || job.state === 'Finalized')) return job;
    if (Date.now() - started > timeoutMs) throw new Error(`kurier job ${jobId} did not finalize in ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

module.exports = { registerVk, submitProof, waitFinalized, KURIER_BASE };
