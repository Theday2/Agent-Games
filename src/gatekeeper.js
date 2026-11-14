/**
 * Proof Gatekeeper decision logic.
 *
 * Implements the 7 trap varieties documented at
 * https://agentgames.zkverify.io/events/proof-gatekeeper
 * Scoring: correct APPROVE/REJECT +12, incorrect APPROVE -6,
 * incorrect REJECT -3, timeout -2, missing/invalid proof -2.
 * Wrong approvals are penalised more than wrong rejections, so on any
 * uncertainty we FAIL CLOSED (REJECT).
 *
 * Task input fields (from the sample payload):
 *   registered_vk, proof_vk, minimum, public_balance,
 *   expiry_block, current_block, recipient, condition_recipient,
 *   amount, max_transfer, proof_tx
 */
'use strict';

const REASON = {
  VALID: 'VALID_CONDITION',
  VK_SUBSTITUTION: 'VK_SUBSTITUTION',
  THRESHOLD_MISMATCH: 'THRESHOLD_MISMATCH',
  PROOF_REUSED: 'PROOF_REUSED',
  EXPIRED_CONDITION: 'EXPIRED_CONDITION',
  RECIPIENT_MISMATCH: 'RECIPIENT_MISMATCH',
  AMOUNT_OVERFLOW: 'AMOUNT_OVERFLOW',
  UNVERIFIED: 'UNVERIFIED', // fail-closed fallback when on-chain check is unavailable
};

function toBig(v) {
  try {
    if (v === undefined || v === null || v === '') return null;
    return BigInt(v);
  } catch {
    return null;
  }
}

function normAddr(a) {
  return String(a || '').toLowerCase();
}

/**
 * Decide a gatekeeper task.
 * @param {object} input - task.input from the envelope
 * @param {object} opts
 * @param {Set<string>} opts.seenProofs - proof_tx values already accepted
 * @param {boolean} opts.onChainVerified - true when the proof was confirmed
 *   on-chain AND its VK matches the registered condition VK (via Kurier/zkVerifyJS).
 *   If the on-chain check could not run, pass false and we fail closed.
 * @returns {{decision: 'APPROVE'|'REJECT', reason_code: string, proof_tx: string}}
 */
function decide(input, opts = {}) {
  const seenProofs = opts.seenProofs || new Set();
  const proofTx = String(input.proof_tx || '');

  // 1. VK substitution — proof verifies but VK != registered condition VK.
  if (input.proof_vk && input.registered_vk &&
      normAddr(input.proof_vk) !== normAddr(input.registered_vk)) {
    return { decision: 'REJECT', reason_code: REASON.VK_SUBSTITUTION, proof_tx: proofTx };
  }

  // 2. Threshold mismatch — public balance below the required minimum.
  const minimum = toBig(input.minimum);
  const balance = toBig(input.public_balance);
  if (minimum !== null && balance !== null && balance < minimum) {
    return { decision: 'REJECT', reason_code: REASON.THRESHOLD_MISMATCH, proof_tx: proofTx };
  }

  // 3. Proof reused — reference already accepted in a previous task.
  if (proofTx && seenProofs.has(proofTx)) {
    return { decision: 'REJECT', reason_code: REASON.PROOF_REUSED, proof_tx: proofTx };
  }

  // 4. Expired condition — current block past the expiry block.
  const expiry = toBig(input.expiry_block);
  const current = toBig(input.current_block);
  if (expiry !== null && current !== null && current > expiry) {
    return { decision: 'REJECT', reason_code: REASON.EXPIRED_CONDITION, proof_tx: proofTx };
  }

  // 5. Recipient mismatch — proof recipient != payment condition recipient.
  if (input.recipient && input.condition_recipient &&
      normAddr(input.recipient) !== normAddr(input.condition_recipient)) {
    return { decision: 'REJECT', reason_code: REASON.RECIPIENT_MISMATCH, proof_tx: proofTx };
  }

  // 6. Amount overflow — amount exceeds the single-transfer cap.
  const amount = toBig(input.amount);
  const maxTransfer = toBig(input.max_transfer);
  if (amount !== null && maxTransfer !== null && amount > maxTransfer) {
    return { decision: 'REJECT', reason_code: REASON.AMOUNT_OVERFLOW, proof_tx: proofTx };
  }

  // 7. On-chain confirmation required before any APPROVE.
  // A proof can verify perfectly and still authorise the wrong action.
  if (opts.onChainVerified !== true) {
    return { decision: 'REJECT', reason_code: REASON.UNVERIFIED, proof_tx: proofTx };
  }

  return { decision: 'APPROVE', reason_code: REASON.VALID, proof_tx: proofTx };
}

module.exports = { decide, REASON };
