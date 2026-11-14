/**
 * Committed Steal the VFY policy — version v1 (FROZEN).
 *
 * This is the policy the agent plays in every Steal match. It is a pure,
 * deterministic function of the public turn state only (no hidden history),
 * so a turn's action can be proven by the vfy-policy circuit from the
 * public inputs alone.
 *
 * Registration (dashboard, by paman — no public API exists):
 *   Dashboard → My Agents → Edit agent → Steal the VFY section →
 *   register an active strategy commitment BEFORE Swiss Round 1 opens.
 *   The commitment is a hash of the policy circuit:
 *   vfy-policy vkHash 0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047
 *   (circuitVersion "v1"). The platform freezes it when matches are paired
 *   and rejects any turn that uses a different circuit version.
 *   Without an active commitment the agent cannot be paired.
 *
 * Mechanics (from agentgames.zkverify.io/build §06):
 *   - 100 VFY each, 20 turns, Swiss 5 rounds → Top 16 knockout.
 *   - HOLD: free, no movement.
 *   - FORTIFY: costs 2 VFY, blocks up to 6 VFY of incoming extraction.
 *   - EXTRACT: free, takes a bounded amount from the opponent's exposed
 *     balance. Documented example amount: 5.
 *
 * Policy rules (stateless, in priority order):
 *   1. Opponent is fortified this turn → EXTRACT is blocked.
 *      Protect ourselves instead if we are not fortified and can afford it,
 *      otherwise HOLD.
 *   2. We are behind (selfBalance < opponentBalance) and the opponent is
 *      not fortified → EXTRACT 5 (take value, catch up).
 *   3. We are ahead or level, not fortified, mid-game (turn ≤ 16) and our
 *      balance is worth protecting (≥ 60) → FORTIFY (spend 2 to block up
 *      to 6 — good value while the opponent is extracting).
 *   4. Otherwise (opponent exposed, nothing to protect) → EXTRACT 5.
 *   5. Late game (turn ≥ 17): never FORTIFY (too few turns left for the
 *      2 VFY to pay back) → EXTRACT 5 if the opponent is not fortified,
 *      else HOLD.
 *
 * publicInputsHash (published formula, /build §06 — viem keccak256 over
 * ABI-packed 32-byte big-endian fields, in this order):
 *   commitment, matchId (UUID as integer), turn, selfBalance,
 *   opponentBalance, action (HOLD 0 / FORTIFY 1 / EXTRACT 2), amount,
 *   circuitVersion (1).
 */
'use strict';

const { keccak256, concat, numberToHex } = require('viem');

const POLICY_VERSION = 'v1';
const CIRCUIT_VERSION = 1;
const VK_HASH = '0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047';

const ACTIONS = { HOLD: 'HOLD', FORTIFY: 'FORTIFY', EXTRACT: 'EXTRACT' };
const ACTION_CODE = { HOLD: 0n, FORTIFY: 1n, EXTRACT: 2n };

const EXTRACT_AMOUNT = 5;       // documented example amount
const FORTIFY_MIN_BALANCE = 60; // only fortify a balance worth protecting
const FORTIFY_LAST_TURN = 16;   // no FORTIFY after this turn

function isFortified(untilTurn, turn) {
  return untilTurn !== null && untilTurn !== undefined && Number(untilTurn) >= turn;
}

/**
 * Choose an action for one turn. Pure function of the public state.
 * @param {object} state - { selfBalance, opponentBalance,
 *   selfFortifiedUntilTurn, opponentFortifiedUntilTurn, turn }
 * @returns {{action: string, amount?: number, reason: string}}
 */
function chooseAction(state) {
  const turn = Number(state.turn ?? 0);
  const selfBalance = Number(state.selfBalance ?? 100);
  const oppBalance = Number(state.opponentBalance ?? 100);
  const selfFort = isFortified(state.selfFortifiedUntilTurn, turn);
  const oppFort = isFortified(state.opponentFortifiedUntilTurn, turn);

  // 1. Opponent fortified → EXTRACT is blocked.
  if (oppFort) {
    if (!selfFort && selfBalance >= 30 && turn <= FORTIFY_LAST_TURN) {
      return { action: ACTIONS.FORTIFY, reason: 'opponent-fortified-protect' };
    }
    return { action: ACTIONS.HOLD, reason: 'opponent-fortified' };
  }

  // 5. Late game: never FORTIFY.
  if (turn >= 17) {
    return { action: ACTIONS.EXTRACT, amount: EXTRACT_AMOUNT, reason: 'late-extract' };
  }

  // 2. Behind → take value.
  if (selfBalance < oppBalance) {
    return { action: ACTIONS.EXTRACT, amount: EXTRACT_AMOUNT, reason: 'behind-extract' };
  }

  // 3. Ahead/level with something to protect → FORTIFY.
  if (!selfFort && selfBalance >= FORTIFY_MIN_BALANCE && turn <= FORTIFY_LAST_TURN) {
    return { action: ACTIONS.FORTIFY, reason: 'protect-lead' };
  }

  // 4. Otherwise take the exposed value.
  return { action: ACTIONS.EXTRACT, amount: EXTRACT_AMOUNT, reason: 'opponent-exposed' };
}

/**
 * publicInputsHash for a turn — the platform computes the same hash from
 * the game state it knows; a wrong hash/order means the proof is rejected
 * and the turn scores as HOLD.
 */
function publicInputsHash({ commitment, matchId, turn, selfBalance, opponentBalance, action, amount }) {
  return keccak256(concat([
    numberToHex(BigInt(commitment), { size: 32 }),
    numberToHex(BigInt('0x' + String(matchId).replace(/-/g, '')), { size: 32 }),
    numberToHex(BigInt(turn), { size: 32 }),
    numberToHex(BigInt(selfBalance), { size: 32 }),
    numberToHex(BigInt(opponentBalance), { size: 32 }),
    numberToHex(ACTION_CODE[action], { size: 32 }),
    numberToHex(BigInt(amount), { size: 32 }),
    numberToHex(BigInt(CIRCUIT_VERSION), { size: 32 }),
  ]));
}

module.exports = {
  POLICY_VERSION, CIRCUIT_VERSION, VK_HASH, ACTIONS,
  EXTRACT_AMOUNT, FORTIFY_MIN_BALANCE, FORTIFY_LAST_TURN,
  isFortified, chooseAction, publicInputsHash,
};
