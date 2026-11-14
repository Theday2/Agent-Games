/**
 * Steal the VFY — turn handling.
 *
 * Real turn envelope (agentgames.zkverify.io/build §06):
 *   { protocolVersion:"v1", eventId:"steal-the-vfy", mode, matchId, turn,
 *     issuedAt, deadlineAt,
 *     state:{ selfBalance, opponentBalance,
 *             selfFortifiedUntilTurn, opponentFortifiedUntilTurn },
 *     strategyCommitment:{ hash }, resolverVersion, nonce }
 *
 * The decision itself lives in src/policy.js (the frozen committed
 * policy v1). This module only validates the envelope and shapes the
 * response. Response (200, signed):
 *   { matchId, turn, action:{ type, amount? }, policyProof,
 *     agentTimestamp, idempotencyKey }
 * `action.amount` MUST be omitted for HOLD/FORTIFY. `idempotencyKey` is
 * unique per turn. policyProof carries circuitVersion, proofReference
 * (the vfy-policy vkHash) and publicInputsHash; the Groth16 proof +
 * public_signals are added inside policyProof once PROOF_READY.
 */
'use strict';

const crypto = require('crypto');
const policy = require('./policy');

/** Validate a turn envelope minimally before acting. Error string or null. */
function validateTurn(envelope) {
  if (!envelope || typeof envelope !== 'object') return 'empty-envelope';
  if (!envelope.matchId) return 'missing-matchId';
  if (envelope.turn === undefined || envelope.turn === null) return 'missing-turn';
  if (envelope.deadlineAt && Date.now() > Date.parse(envelope.deadlineAt)) return 'turn-expired';
  if (envelope.deadline && Date.now() > Date.parse(envelope.deadline)) return 'turn-expired';
  return null;
}

/**
 * Build the full signed response object for a turn.
 * @param {object} envelope - the turn envelope
 * @param {object} [proof] - optional { proof, publicSignals } (when PROOF_READY)
 * @returns {object} the response body object
 */
function buildResponse(envelope, proof) {
  const matchId = envelope.matchId;
  const turn = envelope.turn;
  const state = envelope.state || {};
  const choice = policy.chooseAction({ ...state, turn });

  const action = { type: choice.action };
  if (choice.action === 'EXTRACT' && choice.amount !== undefined) {
    action.amount = choice.amount;
  }

  const commitment = (envelope.strategyCommitment && envelope.strategyCommitment.hash)
    || policy.VK_HASH;
  const amount = action.amount ?? 0;
  let hash;
  try {
    hash = policy.publicInputsHash({
      commitment,
      matchId,
      turn,
      selfBalance: state.selfBalance ?? 100,
      opponentBalance: state.opponentBalance ?? 100,
      action: choice.action,
      amount,
    });
  } catch (e) {
    // Malformed matchId/commitment (not a real UUID/hash) — never crash
    // the turn over the hash; answer with a zero hash and log it.
    console.error('[steal] publicInputsHash failed:', e.message);
    hash = '0x' + '0'.repeat(64);
  }

  const policyProof = {
    circuitVersion: policy.POLICY_VERSION,
    proofReference: policy.VK_HASH,
    publicInputsHash: hash,
  };
  if (proof) {
    policyProof.proof = proof.proof;
    policyProof.public_signals = proof.publicSignals;
  }

  return {
    matchId,
    turn,
    action,
    policyProof,
    agentTimestamp: new Date().toISOString(),
    idempotencyKey: crypto.randomUUID(),
    _reason: choice.reason, // stripped before sending; kept for logs/tests
  };
}

module.exports = { validateTurn, buildResponse, policy };
